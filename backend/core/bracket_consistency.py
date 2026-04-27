"""Pre-merge validation that brackets actually depict the same scene.

We separate three levels of "sameness":
- Composition: are these photos of the same place at all?
- Framing: do the boundaries (sensor crop, aspect ratio) match?
- Alignment: are pixels (x, y) the same physical point in the world?

Alignment is enforced downstream by AlignMTB + Mertens fusion. This module
guards the two earlier stages so we fail fast and loud if a user accidentally
mixes scenes (HDR brackets) or pairs brackets with an unrelated final edit
(training pair).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover - opencv is a hard runtime dep
    cv2 = None

logger = logging.getLogger(__name__)


# Tuned to be permissive enough to allow exposure brackets and tone-mapped
# final edits while still catching obvious mistakes (different rooms / cropped
# reframes). AlignMTB still handles tripod micro-shake downstream.
COMPOSITION_INLIER_RATIO_THRESHOLD = 0.30
COMPOSITION_MIN_INLIERS = 25
COMPOSITION_MIN_GOOD_MATCHES = 12
COMPOSITION_MIN_KEYPOINTS = 12
LOW_TEXTURE_VARIANCE_THRESHOLD = 8.0
ASPECT_RATIO_TOLERANCE = 0.04  # 4% drift in aspect ratio is fine; cropped reframe is not.
FRAMING_MAX_DIMENSION_MISMATCH_PCT = 0.15  # >15% size delta = different framing.

# When SIFT cannot help (low-texture / blank walls) we soft-pass on geometry,
# but unrelated walls of clearly different colour must still fail. LAB a/b
# capture chroma independent of luminance, so legitimate exposure brackets of
# the same wall stay within a tight tolerance even though brightness varies.
# HSV saturation catches the case where one image is a saturated coloured wall
# and the other is neutral grey.
LOW_TEXTURE_CHROMA_TOLERANCE = 12.0
LOW_TEXTURE_SATURATION_TOLERANCE = 35.0

# Homography sanity: the per-bracket warp must be close to identity. Translation
# bigger than 25% of an image dimension, scale outside [0.7, 1.4], or rotation
# beyond ~25 degrees indicates the brackets were not framed the same way.
HOMOGRAPHY_MAX_TRANSLATION_FRACTION = 0.25
HOMOGRAPHY_SCALE_BOUNDS = (0.7, 1.4)
HOMOGRAPHY_MAX_ROTATION_DEG = 25.0
HOMOGRAPHY_MAX_PERSPECTIVE_TERM = 5e-3


@dataclass(frozen=True)
class PairScore:
    """Composition similarity score for a single (reference, candidate) pair."""
    candidate_index: int
    inlier_ratio: float
    good_matches: int
    inlier_count: int
    homography_ok: bool
    soft_pass: bool


@dataclass(frozen=True)
class ConsistencyReport:
    """Verdict + diagnostics for a set of brackets (and optionally a final edit)."""
    is_consistent: bool
    reason: Optional[str]
    framing_consistent: bool
    composition_consistent: bool
    pair_scores: Tuple[PairScore, ...]


def _laplacian_variance(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _chroma_summary(img: np.ndarray) -> Tuple[float, float, float]:
    """Mean LAB a, LAB b, and HSV saturation for an image.

    LAB a/b describe chroma independent of luminance so two exposure brackets
    of the same wall produce nearly identical a/b values even though
    brightness differs. HSV saturation is a coarse "is this a coloured wall
    at all?" signal. Together they let us reject low-texture pairs that
    SIFT cannot distinguish (e.g. a beige wall vs. a teal wall).
    """
    if cv2 is None:  # pragma: no cover
        raise ImportError("cv2 is required")
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    return (
        float(lab[..., 1].mean()),
        float(lab[..., 2].mean()),
        float(hsv[..., 1].mean()),
    )


def _has_acceptable_framing(images: List[np.ndarray]) -> Tuple[bool, Optional[str]]:
    if not images:
        return True, None
    ref_h, ref_w = images[0].shape[:2]
    if ref_h == 0 or ref_w == 0:
        return False, "Image has zero dimension"
    ref_aspect = ref_w / ref_h
    for idx, img in enumerate(images[1:], start=1):
        h, w = img.shape[:2]
        if h == 0 or w == 0:
            return False, f"Image at index {idx} has zero dimension"
        aspect = w / h
        if abs(aspect - ref_aspect) / ref_aspect > ASPECT_RATIO_TOLERANCE:
            return False, (
                f"Aspect ratio mismatch between bracket 0 ({ref_w}x{ref_h}) "
                f"and bracket {idx} ({w}x{h})"
            )
        size_delta = max(
            abs(h - ref_h) / ref_h,
            abs(w - ref_w) / ref_w,
        )
        if size_delta > FRAMING_MAX_DIMENSION_MISMATCH_PCT:
            return False, (
                f"Resolution mismatch >15% between bracket 0 and bracket {idx}"
            )
    return True, None


def _select_reference_index(images: List[np.ndarray]) -> int:
    """Pick the bracket with median brightness; that bracket is most likely to
    have usable detail in both shadows and highlights, so SIFT can match it
    against any other bracket robustly."""
    means = [float(img.mean()) for img in images]
    sorted_indices = sorted(range(len(means)), key=lambda i: means[i])
    return sorted_indices[len(sorted_indices) // 2]


def _homography_is_sane(H: np.ndarray, image_shape: Tuple[int, int]) -> bool:
    """Reject homographies that imply major framing changes.

    Identity-like H means the two images share the same framing (within
    tripod micro-shake). Large translation/rotation/scale or perspective
    components indicate the brackets are framed differently."""
    if H is None or H.shape != (3, 3) or not np.isfinite(H).all():
        return False
    h, w = image_shape
    tx, ty = float(H[0, 2]), float(H[1, 2])
    if abs(tx) > HOMOGRAPHY_MAX_TRANSLATION_FRACTION * w:
        return False
    if abs(ty) > HOMOGRAPHY_MAX_TRANSLATION_FRACTION * h:
        return False
    a, b, c, d = float(H[0, 0]), float(H[0, 1]), float(H[1, 0]), float(H[1, 1])
    sx = float(np.hypot(a, c))
    sy = float(np.hypot(b, d))
    if not (HOMOGRAPHY_SCALE_BOUNDS[0] <= sx <= HOMOGRAPHY_SCALE_BOUNDS[1]):
        return False
    if not (HOMOGRAPHY_SCALE_BOUNDS[0] <= sy <= HOMOGRAPHY_SCALE_BOUNDS[1]):
        return False
    rotation_deg = abs(float(np.degrees(np.arctan2(c, a))))
    if rotation_deg > HOMOGRAPHY_MAX_ROTATION_DEG:
        return False
    if abs(float(H[2, 0])) > HOMOGRAPHY_MAX_PERSPECTIVE_TERM:
        return False
    if abs(float(H[2, 1])) > HOMOGRAPHY_MAX_PERSPECTIVE_TERM:
        return False
    return True


def _score_pair(
    ref_gray: np.ndarray,
    cand_gray: np.ndarray,
) -> Tuple[float, int, int, bool, bool]:
    if cv2 is None:  # pragma: no cover
        raise ImportError("cv2 is required")

    sift = cv2.SIFT_create()
    kp_ref, des_ref = sift.detectAndCompute(ref_gray, None)
    kp_cand, des_cand = sift.detectAndCompute(cand_gray, None)

    low_texture = (
        _laplacian_variance(ref_gray) < LOW_TEXTURE_VARIANCE_THRESHOLD
        and _laplacian_variance(cand_gray) < LOW_TEXTURE_VARIANCE_THRESHOLD
    )

    if (
        des_ref is None
        or des_cand is None
        or len(des_ref) < COMPOSITION_MIN_KEYPOINTS
        or len(des_cand) < COMPOSITION_MIN_KEYPOINTS
    ):
        if low_texture:
            return 1.0, 0, 0, True, True
        return 0.0, 0, 0, False, False

    flann = cv2.FlannBasedMatcher(
        dict(algorithm=1, trees=5),
        dict(checks=50),
    )
    raw_matches = flann.knnMatch(des_ref, des_cand, k=2)
    good = []
    for pair in raw_matches:
        if len(pair) != 2:
            continue
        m, n = pair
        if m.distance < 0.7 * n.distance:
            good.append(m)

    if len(good) < COMPOSITION_MIN_GOOD_MATCHES:
        if low_texture:
            return 1.0, len(good), 0, True, True
        return 0.0, len(good), 0, False, False

    src_pts = np.float32([kp_ref[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp_cand[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src_pts, dst_pts, cv2.USAC_MAGSAC, 8.0)
    if mask is None or H is None:
        if low_texture:
            return 1.0, len(good), 0, True, True
        return 0.0, len(good), 0, False, False

    inlier_count = int(mask.sum())
    homography_ok = _homography_is_sane(H, ref_gray.shape[:2])
    return inlier_count / len(good), len(good), inlier_count, homography_ok, False


def _to_gray_resized(img: np.ndarray, max_dim: int = 1024) -> np.ndarray:
    if cv2 is None:  # pragma: no cover
        raise ImportError("cv2 is required")
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def validate_bracket_consistency(
    images: List[np.ndarray],
    final_edit: Optional[np.ndarray] = None,
) -> ConsistencyReport:
    """Verify brackets share scene + framing.

    If `final_edit` is provided (training pair flow), it is also matched
    against the reference bracket so we reject pairs where the user's final
    edit clearly does not depict the same room as their brackets.
    """
    if cv2 is None:  # pragma: no cover
        raise ImportError("cv2 is required")
    if not images or len(images) < 2:
        return ConsistencyReport(
            is_consistent=True,
            reason=None,
            framing_consistent=True,
            composition_consistent=True,
            pair_scores=(),
        )

    framing_targets = list(images)
    if final_edit is not None:
        framing_targets.append(final_edit)
    framing_ok, framing_reason = _has_acceptable_framing(framing_targets)
    if not framing_ok:
        return ConsistencyReport(
            is_consistent=False,
            reason=framing_reason,
            framing_consistent=False,
            composition_consistent=True,
            pair_scores=(),
        )

    ref_idx = _select_reference_index(images)
    ref_gray = _to_gray_resized(images[ref_idx])
    ref_chroma = _chroma_summary(images[ref_idx])

    pair_scores: List[PairScore] = []
    composition_ok = True
    failure_reason: Optional[str] = None

    candidates: List[Tuple[int, np.ndarray]] = [
        (i, img) for i, img in enumerate(images) if i != ref_idx
    ]
    if final_edit is not None:
        candidates.append((-1, final_edit))

    for idx, candidate in candidates:
        cand_gray = _to_gray_resized(candidate)
        ratio, good_matches, inlier_count, homography_ok, soft_pass = _score_pair(
            ref_gray, cand_gray
        )
        pair_scores.append(
            PairScore(
                candidate_index=idx,
                inlier_ratio=ratio,
                good_matches=good_matches,
                inlier_count=inlier_count,
                homography_ok=homography_ok,
                soft_pass=soft_pass,
            )
        )
        label = "final edit" if idx == -1 else f"bracket {idx}"
        if soft_pass:
            # SIFT was no help (low-texture). Confirm the two images at least
            # share a colour signature so we don't admit a teal wall as a
            # match for a beige wall.
            cand_chroma = _chroma_summary(candidate)
            da = abs(cand_chroma[0] - ref_chroma[0])
            db = abs(cand_chroma[1] - ref_chroma[1])
            ds = abs(cand_chroma[2] - ref_chroma[2])
            if (
                da > LOW_TEXTURE_CHROMA_TOLERANCE
                or db > LOW_TEXTURE_CHROMA_TOLERANCE
                or ds > LOW_TEXTURE_SATURATION_TOLERANCE
            ):
                composition_ok = False
                failure_reason = (
                    f"{label} appears to be a different low-texture scene "
                    f"(chroma drift Δa={da:.1f}, Δb={db:.1f}, Δsat={ds:.1f})"
                )
                break
            continue
        if (
            ratio < COMPOSITION_INLIER_RATIO_THRESHOLD
            or inlier_count < COMPOSITION_MIN_INLIERS
        ):
            composition_ok = False
            failure_reason = (
                f"{label} does not appear to be the same scene as the reference bracket "
                f"(inlier_ratio={ratio:.2f}, inliers={inlier_count}, "
                f"good_matches={good_matches})"
            )
            break
        if not homography_ok:
            composition_ok = False
            failure_reason = (
                f"{label} is framed differently from the reference bracket "
                f"(homography exceeds translation/scale/rotation tolerance)"
            )
            break

    return ConsistencyReport(
        is_consistent=composition_ok,
        reason=failure_reason,
        framing_consistent=True,
        composition_consistent=composition_ok,
        pair_scores=tuple(pair_scores),
    )


def report_to_payload(report: ConsistencyReport) -> dict:
    """Serialise a report for telemetry / API responses."""
    return {
        "is_consistent": report.is_consistent,
        "framing_consistent": report.framing_consistent,
        "composition_consistent": report.composition_consistent,
        "reason": report.reason,
        "pair_scores": [
            {
                "candidate_index": s.candidate_index,
                "inlier_ratio": s.inlier_ratio,
                "good_matches": s.good_matches,
                "inlier_count": s.inlier_count,
                "homography_ok": s.homography_ok,
                "soft_pass": s.soft_pass,
            }
            for s in report.pair_scores
        ],
    }
