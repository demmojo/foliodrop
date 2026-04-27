import numpy as np
import cv2
import pytest

from backend.core import bracket_consistency as bc
from backend.core.bracket_consistency import (
    validate_bracket_consistency,
    report_to_payload,
    _homography_is_sane,
    _has_acceptable_framing,
    _to_gray_resized,
    _score_pair,
)


def _scene_with_features(seed: int, w: int = 600, h: int = 400) -> np.ndarray:
    """Synthesise an image with enough corner/edge features for SIFT to lock onto.
    Different `seed` values produce visibly different scenes."""
    rng = np.random.default_rng(seed)
    img = np.full((h, w, 3), 220, dtype=np.uint8)
    # Sprinkle high-contrast rectangles so SIFT has plenty to match.
    for _ in range(35):
        x = int(rng.integers(0, w - 30))
        y = int(rng.integers(0, h - 30))
        size = int(rng.integers(15, 60))
        color = tuple(int(c) for c in rng.integers(0, 80, size=3))
        cv2.rectangle(img, (x, y), (x + size, y + size), color, -1)
    # Add diagonal lines for additional structure
    for _ in range(8):
        p1 = (int(rng.integers(0, w)), int(rng.integers(0, h)))
        p2 = (int(rng.integers(0, w)), int(rng.integers(0, h)))
        cv2.line(img, p1, p2, (0, 0, 0), 2)
    return img


def _exposure_shift(img: np.ndarray, gain: float) -> np.ndarray:
    """Mimic an exposure bracket by gain-adjusting the same scene."""
    return np.clip(img.astype(np.float32) * gain, 0, 255).astype(np.uint8)


def test_passes_for_consistent_bracket_set():
    base = _scene_with_features(seed=1)
    brackets = [
        _exposure_shift(base, 0.5),
        base,
        _exposure_shift(base, 1.4),
    ]
    report = validate_bracket_consistency(brackets)
    assert report.is_consistent is True
    assert report.framing_consistent is True
    assert report.composition_consistent is True


def test_fails_when_brackets_are_different_scenes():
    a = _scene_with_features(seed=1)
    b = _scene_with_features(seed=99)  # Completely different layout
    report = validate_bracket_consistency([a, b])
    assert report.is_consistent is False
    assert report.composition_consistent is False
    assert "same scene" in (report.reason or "")


def test_fails_when_framing_aspect_ratio_changes():
    a = _scene_with_features(seed=2, w=600, h=400)
    b = _scene_with_features(seed=2, w=400, h=600)  # Different aspect ratio
    report = validate_bracket_consistency([a, b])
    assert report.is_consistent is False
    assert report.framing_consistent is False
    assert "Aspect ratio" in (report.reason or "")


def test_fails_when_resolution_drifts_significantly():
    a = _scene_with_features(seed=3, w=600, h=400)
    b = cv2.resize(a, (300, 200))  # Same aspect, very different size
    report = validate_bracket_consistency([a, b])
    assert report.is_consistent is False
    assert "Resolution mismatch" in (report.reason or "")


def test_fails_when_image_has_zero_dimension():
    a = _scene_with_features(seed=4)
    b = np.zeros((0, 0, 3), dtype=np.uint8)
    report = validate_bracket_consistency([a, b])
    assert report.is_consistent is False
    assert "zero dimension" in (report.reason or "")


def test_zero_dimension_in_reference_image_fails():
    a = np.zeros((0, 0, 3), dtype=np.uint8)
    b = _scene_with_features(seed=5)
    report = validate_bracket_consistency([a, b])
    assert report.is_consistent is False


def test_soft_passes_low_texture_brackets():
    # Solid grey walls produce very few SIFT features.
    blank = np.full((400, 600, 3), 200, dtype=np.uint8)
    blank2 = np.full((400, 600, 3), 210, dtype=np.uint8)
    report = validate_bracket_consistency([blank, blank2])
    assert report.is_consistent is True
    assert any(p.soft_pass for p in report.pair_scores)


def test_returns_consistent_when_fewer_than_two_images():
    report = validate_bracket_consistency([])
    assert report.is_consistent is True
    assert report.pair_scores == ()
    one = _scene_with_features(seed=10)
    report = validate_bracket_consistency([one])
    assert report.is_consistent is True


def test_training_pair_final_edit_must_match_brackets():
    base = _scene_with_features(seed=20)
    other = _scene_with_features(seed=21)
    report = validate_bracket_consistency(
        [base, _exposure_shift(base, 1.2)],
        final_edit=other,
    )
    assert report.is_consistent is False
    assert "final edit" in (report.reason or "")


def test_training_pair_final_edit_matching_brackets_passes():
    base = _scene_with_features(seed=30)
    final = _exposure_shift(base, 0.85)  # Looks "edited" but same scene
    report = validate_bracket_consistency(
        [base, _exposure_shift(base, 1.4)],
        final_edit=final,
    )
    assert report.is_consistent is True


def test_report_to_payload_serialises_all_fields():
    a = _scene_with_features(seed=40)
    b = _scene_with_features(seed=40)
    report = validate_bracket_consistency([a, b])
    payload = report_to_payload(report)
    assert payload["is_consistent"] is True
    assert payload["framing_consistent"] is True
    assert payload["composition_consistent"] is True
    assert isinstance(payload["pair_scores"], list)
    if payload["pair_scores"]:
        assert {"candidate_index", "inlier_ratio", "good_matches", "soft_pass"} <= set(
            payload["pair_scores"][0].keys()
        )


def test_keypoint_starvation_with_textured_other_scene_fails():
    # Reference is blank (low texture, soft-pass against itself), but candidate
    # has heavy texture; pair should still register: when *only one* side is
    # low-texture we no longer auto-soft-pass.
    blank = np.full((400, 600, 3), 200, dtype=np.uint8)
    rich = _scene_with_features(seed=77)
    report = validate_bracket_consistency([rich, blank])
    # Expect either a hard fail (no inliers) or a low-quality score below threshold.
    assert report.is_consistent is False


def test_homography_sanity_accepts_identity():
    H = np.eye(3, dtype=np.float64)
    assert _homography_is_sane(H, (480, 640)) is True


@pytest.mark.parametrize(
    "matrix,shape",
    [
        (None, (480, 640)),  # H is None
        (np.eye(2, dtype=np.float64), (480, 640)),  # wrong shape
        (np.array([[1, 0, np.nan], [0, 1, 0], [0, 0, 1]], dtype=np.float64), (480, 640)),  # NaN
        (np.array([[1, 0, 500], [0, 1, 0], [0, 0, 1]], dtype=np.float64), (480, 640)),  # tx too large
        (np.array([[1, 0, 0], [0, 1, 500], [0, 0, 1]], dtype=np.float64), (480, 640)),  # ty too large
        (np.array([[3.0, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=np.float64), (480, 640)),  # sx too big
        (np.array([[1, 0, 0], [0, 3.0, 0], [0, 0, 1]], dtype=np.float64), (480, 640)),  # sy too big
        (
            np.array(
                [
                    [np.cos(np.radians(60)), -np.sin(np.radians(60)), 0],
                    [np.sin(np.radians(60)), np.cos(np.radians(60)), 0],
                    [0, 0, 1],
                ],
                dtype=np.float64,
            ),
            (480, 640),
        ),  # 60 degree rotation
        (np.array([[1, 0, 0], [0, 1, 0], [1.0, 0, 1]], dtype=np.float64), (480, 640)),  # H[2,0] perspective
        (np.array([[1, 0, 0], [0, 1, 0], [0, 1.0, 1]], dtype=np.float64), (480, 640)),  # H[2,1] perspective
    ],
)
def test_homography_sanity_rejects_invalid_transforms(matrix, shape):
    assert _homography_is_sane(matrix, shape) is False


def test_to_gray_resized_skips_resize_for_small_images():
    img = _scene_with_features(seed=200, w=300, h=200)
    out = _to_gray_resized(img, max_dim=1024)
    assert out.shape == (200, 300)


def test_to_gray_resized_downsamples_large_images():
    img = _scene_with_features(seed=201, w=4000, h=3000)
    out = _to_gray_resized(img, max_dim=1024)
    assert max(out.shape) <= 1024


def test_has_acceptable_framing_handles_empty_list():
    ok, reason = _has_acceptable_framing([])
    assert ok is True
    assert reason is None


def test_score_pair_with_no_descriptors_hard_fails(monkeypatch):
    rich = _scene_with_features(seed=300)
    rich_gray = cv2.cvtColor(rich, cv2.COLOR_BGR2GRAY)

    class _ZeroSift:
        def detectAndCompute(self, *args, **kwargs):
            return [], None

    monkeypatch.setattr(bc.cv2, "SIFT_create", lambda: _ZeroSift())
    ratio, good, inliers, hom_ok, soft = _score_pair(rich_gray, rich_gray)
    assert ratio == 0.0
    assert good == 0
    assert inliers == 0
    assert hom_ok is False
    assert soft is False


def test_score_pair_with_only_unmatched_pairs_hard_fails(monkeypatch):
    rich_a = _scene_with_features(seed=400)
    rich_b = _scene_with_features(seed=401)
    a_gray = cv2.cvtColor(rich_a, cv2.COLOR_BGR2GRAY)
    b_gray = cv2.cvtColor(rich_b, cv2.COLOR_BGR2GRAY)

    class _StubMatcher:
        def __init__(self, *args, **kwargs):
            pass

        def knnMatch(self, *args, **kwargs):
            return [[object()]]  # malformed length-1 match

    monkeypatch.setattr(bc.cv2, "FlannBasedMatcher", _StubMatcher)
    ratio, good, inliers, hom_ok, soft = _score_pair(a_gray, b_gray)
    assert ratio == 0.0
    assert good == 0
    assert hom_ok is False


def test_score_pair_low_texture_soft_passes_when_no_keypoints(monkeypatch):
    blank = np.full((400, 600), 200, dtype=np.uint8)

    class _ZeroSift:
        def detectAndCompute(self, *args, **kwargs):
            return [], None

    monkeypatch.setattr(bc.cv2, "SIFT_create", lambda: _ZeroSift())
    ratio, good, inliers, hom_ok, soft = _score_pair(blank, blank)
    assert ratio == 1.0
    assert soft is True
    assert hom_ok is True


def test_score_pair_low_texture_soft_passes_when_few_good_matches(monkeypatch):
    blank = np.full((400, 600), 200, dtype=np.uint8)
    # Provide enough fake keypoints to get past the keypoint-count gate, but
    # zero "good" matches after Lowe's ratio test.
    fake_kp = [cv2.KeyPoint(0, 0, 1) for _ in range(20)]
    fake_des = np.zeros((20, 128), dtype=np.float32)

    class _Sift:
        def detectAndCompute(self, *args, **kwargs):
            return fake_kp, fake_des

    class _BadMatcher:
        def __init__(self, *a, **kw):
            pass

        def knnMatch(self, *a, **kw):
            return []

    monkeypatch.setattr(bc.cv2, "SIFT_create", lambda: _Sift())
    monkeypatch.setattr(bc.cv2, "FlannBasedMatcher", _BadMatcher)
    ratio, good, inliers, hom_ok, soft = _score_pair(blank, blank)
    assert ratio == 1.0
    assert good == 0
    assert soft is True


def test_score_pair_low_texture_soft_passes_when_homography_missing(monkeypatch):
    blank = np.full((400, 600), 200, dtype=np.uint8)
    fake_kp = [cv2.KeyPoint(i, i, 1) for i in range(40)]
    fake_des = np.zeros((40, 128), dtype=np.float32)

    class _Sift:
        def detectAndCompute(self, *a, **kw):
            return fake_kp, fake_des

    class _GoodEnoughMatcher:
        def __init__(self, *a, **kw):
            pass

        def knnMatch(self, *a, **kw):
            class _M:
                def __init__(self, q, t, dist):
                    self.queryIdx = q
                    self.trainIdx = t
                    self.distance = dist

            return [
                [_M(i, i, 0.1), _M(i, i, 1.0)] for i in range(40)
            ]

    monkeypatch.setattr(bc.cv2, "SIFT_create", lambda: _Sift())
    monkeypatch.setattr(bc.cv2, "FlannBasedMatcher", _GoodEnoughMatcher)
    monkeypatch.setattr(bc.cv2, "findHomography", lambda *a, **kw: (None, None))

    ratio, good, inliers, hom_ok, soft = _score_pair(blank, blank)
    assert ratio == 1.0
    assert soft is True


def test_score_pair_textured_scene_hard_fails_when_homography_missing(monkeypatch):
    rich = _scene_with_features(seed=600)
    rich_gray = cv2.cvtColor(rich, cv2.COLOR_BGR2GRAY)
    monkeypatch.setattr(bc.cv2, "findHomography", lambda *a, **kw: (None, None))
    ratio, good, inliers, hom_ok, soft = _score_pair(rich_gray, rich_gray)
    assert ratio == 0.0
    assert soft is False
    assert hom_ok is False


def test_validate_returns_homography_failure_when_pair_geometrically_bad(monkeypatch):
    # Force _score_pair to return a "good ratio" but with homography_ok=False so
    # we exercise the framing-failure branch in validate_bracket_consistency.
    a = _scene_with_features(seed=500)
    b = _scene_with_features(seed=500)

    def fake_score(_ref, _cand):
        return 0.95, 100, 80, False, False  # good ratio, plenty of inliers, but bad homography

    monkeypatch.setattr(bc, "_score_pair", fake_score)
    report = validate_bracket_consistency([a, b])
    assert report.is_consistent is False
    assert "framed differently" in (report.reason or "")


def test_low_texture_scenes_with_different_chroma_fail():
    """Two unrelated solid-colour walls (different hue) must NOT slip through
    the soft-pass gate just because SIFT can't find features."""
    red_wall = np.zeros((400, 600, 3), dtype=np.uint8)
    red_wall[..., 2] = 200  # Pure red in BGR.
    teal_wall = np.zeros((400, 600, 3), dtype=np.uint8)
    teal_wall[..., 0] = 200  # Pure blue in BGR.
    teal_wall[..., 1] = 150
    report = validate_bracket_consistency([red_wall, teal_wall])
    assert report.is_consistent is False
    assert "low-texture" in (report.reason or "")
    assert any(p.soft_pass for p in report.pair_scores)


def test_low_texture_scenes_with_same_chroma_still_pass():
    """Two same-coloured walls under different exposures should still pass even
    when SIFT cannot find features."""
    bright = np.full((400, 600, 3), 220, dtype=np.uint8)
    dim = np.full((400, 600, 3), 140, dtype=np.uint8)
    report = validate_bracket_consistency([bright, dim])
    assert report.is_consistent is True
    assert any(p.soft_pass for p in report.pair_scores)


def test_low_texture_neutral_vs_coloured_wall_fails():
    """A neutral grey wall vs a clearly coloured wall must fail. This pair
    exercises both LAB a/b drift and saturation drift; either alone is
    sufficient to reject."""
    grey = np.full((400, 600, 3), 180, dtype=np.uint8)
    coloured = np.full((400, 600, 3), 180, dtype=np.uint8)
    coloured[..., 1] = 80   # Drop green
    coloured[..., 0] = 80   # Drop blue → red-tinted wall
    report = validate_bracket_consistency([grey, coloured])
    assert report.is_consistent is False
    assert "low-texture" in (report.reason or "")


def test_chroma_summary_returns_three_floats():
    """Direct unit test for the chroma helper -- catches accidental shape
    changes in the LAB/HSV pipeline without needing a full validation run."""
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    img[..., 2] = 200  # Red.
    a, b, s = bc._chroma_summary(img)
    assert isinstance(a, float)
    assert isinstance(b, float)
    assert isinstance(s, float)
    # Pure red should land far above neutral (a≈128) on the LAB a-axis.
    assert a > 150
