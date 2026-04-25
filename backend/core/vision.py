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
    # Best practice for Real Estate HDR window preservation: 
    # Increase exposure weight significantly to penalize blown-out windows, pulling in darker exposures.
    # Increase saturation weight to preserve vibrant greens/blues from the window.
    # Lower contrast weight slightly to prevent overly harsh local contrast.
    merge_mertens = cv2.createMergeMertens(contrast_weight=0.7, saturation_weight=1.5, exposure_weight=2.0)
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
    # For a 2K image, 8x8 gives massive 256px tiles leading to halo sweeps. Use 16x16.
    # Lower clipLimit from 1.2 to 0.8 to further reduce "stark/aggressive" HDR contrast and blotches.
    clahe = cv2.createCLAHE(clipLimit=0.8, tileGridSize=(16, 16))
    l_clahe = clahe.apply(l_16)
    
    # Scale back to float32 L channel [0.0, 100.0]
    l_out_float = (l_clahe.astype(np.float32) / 65535.0) * 100.0
    
    # Perform Unsharp Masking on the L channel to avoid color fringing and chromatic aberration
    # Blur the L channel
    gaussian_blur = cv2.GaussianBlur(l_out_float, (0, 0), 2.0)
    # unsharp_mask = original + (original - blur) * amount
    # Lower amount from 0.25 to 0.15 to prevent fine details from becoming overly crunchy and harsh
    l_unsharp = l_out_float + (l_out_float - gaussian_blur) * 0.15
    # Clip to valid L range
    l_unsharp = np.clip(l_unsharp, 0.0, 100.0)
    
    # Merge back and convert to BGR float32
    lab_merged = cv2.merge((l_unsharp, a, b))
    bgr_out_float = cv2.cvtColor(lab_merged, cv2.COLOR_LAB2BGR)
    
    # 1. Edge-Preserving Noise Reduction
    # Decrease sigmaColor to prevent large blotchy "watercolor" areas on flat walls
    # d=5, sigmaColor=0.05, sigmaSpace=10.0
    polished_float = cv2.bilateralFilter(bgr_out_float, d=5, sigmaColor=0.05, sigmaSpace=10.0)
    
    # Slight gamma correction to lift midtones/shadows before sending to GenAI
    gamma = 1.2
    unsharp = np.power(polished_float, 1.0 / gamma)

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
        blown_mask = (fused_luma > 0.90) & (dark_luma < (fused_luma - 0.05))
        blend_alpha = np.clip((fused_luma - 0.90) / 0.10, 0.0, 1.0) * 0.85
        blend_alpha = blend_alpha * blown_mask.astype(np.float32)
        unsharp = unsharp * (1.0 - blend_alpha[:, :, None]) + dark_float * blend_alpha[:, :, None]
        unsharp = np.clip(unsharp, 0.0, 1.0)

    # Downsample to 8-bit for final JPEG output
    bgr_8_out = np.clip(unsharp * 255.0, 0, 255).astype(np.uint8)
    return bgr_8_out
