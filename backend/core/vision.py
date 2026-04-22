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
    merge_mertens = cv2.createMergeMertens(contrast_weight=1.0, saturation_weight=1.5, exposure_weight=2.0)
    # Returns float32 in roughly [0, 1]
    res_mertens = merge_mertens.process(images)
    # Strictly clip to [0.0, 1.0] to prevent wraparound
    res_mertens = np.clip(res_mertens, 0.0, 1.0)
    return res_mertens

def apply_real_estate_heuristics(image_float: np.ndarray) -> np.ndarray:
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
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(16, 16))
    l_clahe = clahe.apply(l_16)
    
    # Scale back to float32 L channel [0.0, 100.0]
    l_out_float = (l_clahe.astype(np.float32) / 65535.0) * 100.0
    
    # Perform Unsharp Masking on the L channel to avoid color fringing and chromatic aberration
    # Blur the L channel
    gaussian_blur = cv2.GaussianBlur(l_out_float, (0, 0), 1.5)
    # unsharp_mask = original + (original - blur) * amount
    l_unsharp = l_out_float + (l_out_float - gaussian_blur) * 0.5
    # Clip to valid L range
    l_unsharp = np.clip(l_unsharp, 0.0, 100.0)
    
    # Merge back and convert to BGR float32
    lab_merged = cv2.merge((l_unsharp, a, b))
    bgr_out_float = cv2.cvtColor(lab_merged, cv2.COLOR_LAB2BGR)
    
    # 1. Edge-Preserving Noise Reduction
    # Using bilateral filter on float32 image. d=5, sigmaColor=0.1 (scaled), sigmaSpace=5.0
    polished_float = cv2.bilateralFilter(bgr_out_float, d=5, sigmaColor=0.1, sigmaSpace=5.0)
    
    # Slight gamma correction to lift midtones/shadows before sending to GenAI
    gamma = 1.2
    unsharp = np.power(polished_float, 1.0 / gamma)

    # Downsample to 8-bit for final JPEG output
    bgr_8_out = np.clip(unsharp * 255.0, 0, 255).astype(np.uint8)
    return bgr_8_out
