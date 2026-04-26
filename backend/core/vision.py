import numpy as np
from typing import List

try:
    import cv2
except ImportError: # pragma: no cover
    cv2 = None

def align_images(images: List[np.ndarray]) -> List[np.ndarray]:
    if cv2 is None:
        raise ImportError("cv2 is required")
    print("Running AlignMTB")
    alignMTB = cv2.createAlignMTB()
    alignMTB.process(images, images)
    return images

def run_mertens_fusion(images: List[np.ndarray]) -> np.ndarray:
    if cv2 is None:
        raise ImportError("cv2 is required")
    print("Running Mertens Exposure Fusion (32-bit float)")
    # Balanced real-estate fusion: keep highlight detail and color depth, but avoid brittle local contrast.
    merge_mertens = cv2.createMergeMertens(
        contrast_weight=0.6,
        saturation_weight=1.2,
        exposure_weight=2.4,
    )
    # Returns float32 in roughly [0, 1]
    res_mertens = merge_mertens.process(images)
    # Strictly clip to [0.0, 1.0] to prevent wraparound
    res_mertens = np.clip(res_mertens, 0.0, 1.0)
    return res_mertens

def apply_real_estate_heuristics(image_float: np.ndarray, darkest_bracket: np.ndarray | None = None) -> np.ndarray:
    """Applies deterministic polish and local contrast (CLAHE)."""
    if cv2 is None:
        raise ImportError("cv2 is required")

    # Convert float32 BGR to float32 LAB
    lab_float = cv2.cvtColor(image_float, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab_float)
    
    # L channel in float32 LAB is [0, 100]. Scale to 16-bit for CLAHE.
    l_16 = np.clip((l / 100.0) * 65535.0, 0, 65535).astype(np.uint16)
    
    # Apply CLAHE
    # Keep midtone lift subtle while preserving local edge transitions on walls/trim.
    clahe = cv2.createCLAHE(clipLimit=0.9, tileGridSize=(12, 12))
    l_clahe = clahe.apply(l_16)
    
    # Scale back to float32 L channel [0.0, 100.0]
    l_out_float = (l_clahe.astype(np.float32) / 65535.0) * 100.0
    
    # Perform Unsharp Masking on the L channel to avoid color fringing and chromatic aberration
    # Blur the L channel
    gaussian_blur = cv2.GaussianBlur(l_out_float, (0, 0), 2.0)
    # unsharp_mask = original + (original - blur) * amount
    # Slightly stronger unsharp to recover micro-detail without pushing "crunchy HDR".
    l_unsharp = l_out_float + (l_out_float - gaussian_blur) * 0.18
    # Clip to valid L range
    l_unsharp = np.clip(l_unsharp, 0.0, 100.0)
    
    # Merge back and convert to BGR float32
    lab_merged = cv2.merge((l_unsharp, a, b))
    bgr_out_float = cv2.cvtColor(lab_merged, cv2.COLOR_LAB2BGR)
    
    # 1. Edge-Preserving Noise Reduction
    # Decrease sigmaColor to prevent large blotchy "watercolor" areas on flat walls
    polished_float = cv2.bilateralFilter(bgr_out_float, d=5, sigmaColor=0.06, sigmaSpace=9.0)
    
    # Gentle tone remap to keep interiors bright while preserving contrast in corners.
    gamma = 1.12
    unsharp = np.power(np.clip(polished_float, 0.0, 1.0), 1.0 / gamma)

    # Soft S-curve for clearer subject contrast without hard clipping in highlights.
    contrast_gain = 1.06
    unsharp = np.clip((unsharp - 0.5) * contrast_gain + 0.5, 0.0, 1.0)

    # Optional window highlight recovery:
    # Do this at the end so later contrast steps do not re-clip recovered details.
    if darkest_bracket is not None:
        dark_float = darkest_bracket.astype(np.float32) / 255.0
        if dark_float.shape[:2] != unsharp.shape[:2]:
            dark_float = cv2.resize(
                dark_float,
                (unsharp.shape[1], unsharp.shape[0]),
                interpolation=cv2.INTER_AREA,
            )

        fused_luma = cv2.cvtColor(unsharp, cv2.COLOR_BGR2GRAY)
        dark_luma = cv2.cvtColor(dark_float, cv2.COLOR_BGR2GRAY)
        blown_mask = (fused_luma > 0.88) & (dark_luma < (fused_luma - 0.04))
        blend_alpha = np.clip((fused_luma - 0.88) / 0.12, 0.0, 1.0) * 0.75
        blend_alpha = blend_alpha * blown_mask.astype(np.float32)
        unsharp = unsharp * (1.0 - blend_alpha[:, :, None]) + dark_float * blend_alpha[:, :, None]
        unsharp = np.clip(unsharp, 0.0, 1.0)

    # Downsample to 8-bit for final JPEG output
    bgr_8_out = np.clip(unsharp * 255.0, 0, 255).astype(np.uint8)
    return bgr_8_out
