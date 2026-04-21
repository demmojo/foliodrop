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
    
    # CRITICAL: Scale float32 directly to 16-bit uint16 to prevent 8-bit banding 
    # during subsequent Contrast stretching (CLAHE)
    res_16bit = np.clip(res_mertens * 65535, 0, 65535).astype(np.uint16)
    return res_16bit

def apply_real_estate_heuristics(image_16bit: np.ndarray) -> np.ndarray:
    """Applies deterministic 16-bit local contrast (CLAHE) and downsamples to 8-bit."""
    if cv2 is None:
        raise ImportError("cv2 is required")
    
    # Convert 16-bit BGR to LAB
    lab_16 = cv2.cvtColor(image_16bit, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab_16)
    
    # Apply CLAHE only to the Luminance channel.
    # clipLimit 2.0 is conservative to prevent noise amplification in shadows.
    # tileGridSize (8,8) is standard for localized contrast.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_clahe = clahe.apply(l)
    
    # Merge back and convert to BGR
    lab_16_merged = cv2.merge((l_clahe, a, b))
    bgr_16_out = cv2.cvtColor(lab_16_merged, cv2.COLOR_LAB2BGR)
    
    # Downsample to 8-bit for final JPEG output
    bgr_8_out = (bgr_16_out / 256.0).astype(np.uint8)
    return bgr_8_out

