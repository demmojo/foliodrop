import numpy as np
from typing import List

# We'll use try/except for cv2 so that domain tests can mock or run conditionally without it if needed,
# though cv2 should ideally be installed.
try:
    import cv2
except ImportError:
    cv2 = None

def align_images(images: List[np.ndarray]) -> List[np.ndarray]:
    # Dense Optical Flow Alignment stub
    print("Running Dense Optical Flow Alignment")
    return images  # stub

def extract_window_mask(bright_img: np.ndarray) -> np.ndarray:
    if cv2 is None:
        raise ImportError("cv2 is required")
    # Semantic Window Masking stub
    print("Extracting Window Mask")
    gray = cv2.cvtColor(bright_img, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY)
    # expand mask slightly
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)
    return mask

def composite_dark_windows(bright_imgs: List[np.ndarray], dark_img: np.ndarray) -> List[np.ndarray]:
    if cv2 is None:
        raise ImportError("cv2 is required")
    print("Compositing dark EV into blown windows")
    composited_imgs = []
    for bright_img in bright_imgs:
        mask = extract_window_mask(bright_img)
        # 3 channel mask
        mask_3c = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR) / 255.0
        
        # Blend: Where mask is white (blown out), use dark_img. Otherwise use bright_img.
        composited = (bright_img * (1 - mask_3c) + dark_img * mask_3c).astype(np.uint8)
        composited_imgs.append(composited)
        
    return composited_imgs

def run_mertens_fusion(images: List[np.ndarray]) -> np.ndarray:
    if cv2 is None:
        raise ImportError("cv2 is required")
    print("Running Mertens Exposure Fusion")
    merge_mertens = cv2.createMergeMertens()
    res_mertens = merge_mertens.process(images)
    res_mertens_8bit = np.clip(res_mertens * 255, 0, 255).astype('uint8')
    return res_mertens_8bit

def tiled_onnx_denoise(image: np.ndarray) -> np.ndarray:
    # Stub for ONNX quantized denoising (e.g. NAFNet Q4)
    print("Running Tiled ONNX Denoise (512x512 patches with overlap)")
    return image  # stub

def ai_review_and_edit(image: np.ndarray) -> np.ndarray:
    if cv2 is None:
        raise ImportError("cv2 is required")
    print("Running AI Review & Grading (Mock Gemini 2.5 Flash / ControlNet)")
    
    # 1. Slight contrast boost (simulating HDR pop)
    alpha = 1.05 # Contrast control
    beta = 5     # Brightness control
    graded = cv2.convertScaleAbs(image, alpha=alpha, beta=beta)
    
    # 2. Subtle warming (simulating "inviting real estate" look)
    # Ensure it's 3-channel BGR before tweaking colors
    if len(graded.shape) == 3 and graded.shape[2] == 3:
        b, g, r = cv2.split(graded)
        r = cv2.add(r, 10)
        b = cv2.subtract(b, 5)
        graded = cv2.merge((b, g, r))
    elif len(graded.shape) == 3 and graded.shape[2] == 4:
        # RGBA case
        b, g, r, a = cv2.split(graded)
        r = cv2.add(r, 10)
        b = cv2.subtract(b, 5)
        graded = cv2.merge((b, g, r, a))
        
    return graded
