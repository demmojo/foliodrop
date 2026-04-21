import numpy as np
from typing import List

try:
    import cv2
except ImportError:
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
    print("Running Mertens Exposure Fusion (16-bit float)")
    merge_mertens = cv2.createMergeMertens()
    # Returns float32 in [0, 1]
    res_mertens = merge_mertens.process(images)
    return res_mertens

def apply_real_estate_heuristics(image_float: np.ndarray) -> np.ndarray:
    """Applies deterministic polish and local contrast (CLAHE)."""
    if cv2 is None:
        raise ImportError("cv2 is required")
    
    # 1. Edge-Preserving Noise Reduction
    # Using bilateral filter on float32 image. d=5, sigmaColor=0.1, sigmaSpace=5.0
    image_float = cv2.bilateralFilter(image_float, d=5, sigmaColor=0.1, sigmaSpace=5.0)
    
    # Convert float32 BGR to LAB
    lab_float = cv2.cvtColor(image_float, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab_float)
    
    # L channel in float32 is [0, 100]. Scale to 16-bit for CLAHE.
    l_16 = np.clip(l * (65535.0 / 100.0), 0, 65535).astype(np.uint16)
    
    # Apply CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_clahe = clahe.apply(l_16)
    
    # Unsharp Masking on Luminance channel for crisp architectural lines
    # Blur the L channel
    gaussian_blur = cv2.GaussianBlur(l_clahe, (0, 0), 1.5)
    # unsharp_mask = original + (original - blur) * amount
    l_clahe_float = l_clahe.astype(np.float32)
    blur_float = gaussian_blur.astype(np.float32)
    unsharp = l_clahe_float + (l_clahe_float - blur_float) * 1.2
    l_16_sharp = np.clip(unsharp, 0, 65535).astype(np.uint16)
    
    # Convert back to float32 L channel
    l_out_float = (l_16_sharp.astype(np.float32) / 65535.0) * 100.0
    
    # Merge back and convert to BGR
    lab_merged = cv2.merge((l_out_float, a, b))
    bgr_out_float = cv2.cvtColor(lab_merged, cv2.COLOR_LAB2BGR)
    
    # Downsample to 8-bit for final JPEG output
    bgr_8_out = np.clip(bgr_out_float * 255.0, 0, 255).astype(np.uint8)
    return bgr_8_out

