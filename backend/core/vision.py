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
    print("Running AI Review & Grading (Airy, Crisp, Vibrant)")
    
    # Handle alpha channel if present
    has_alpha = len(image.shape) == 3 and image.shape[2] == 4
    if has_alpha:
        img_bgr = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    else:
        img_bgr = image.copy()

    # 1. Subtle Denoise (Bilateral Filter)
    # Preserves edges while reducing high-ISO noise before sharpening.
    img_bgr = cv2.bilateralFilter(img_bgr, d=5, sigmaColor=25, sigmaSpace=25)

    # 2. Balanced Lighting & Lighter Airy Feel (CLAHE on L channel in LAB)
    # Lifts shadows and equalizes lighting without blowing out window highlights.
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    
    clahe = cv2.createCLAHE(clipLimit=1.2, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    
    lab_merged = cv2.merge((cl, a, b))
    img_bgr = cv2.cvtColor(lab_merged, cv2.COLOR_LAB2BGR)

    # 3. Slightly More Vibrant/Alive (Saturation boost in HSV)
    # Use float32 to prevent overflow during multiplication
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    # 15% increase in saturation, safely clipped
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.15, 0, 255)
    img_bgr = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    # 4. Crisp (Unsharp Masking)
    # Subtracts a blurred version of the image to enhance edges cleanly.
    gaussian_blur = cv2.GaussianBlur(img_bgr, (0, 0), 1.5)
    img_bgr = cv2.addWeighted(img_bgr, 1.25, gaussian_blur, -0.25, 0)
    
    # 5. Final safety clip
    img_bgr = np.clip(img_bgr, 0, 255).astype(np.uint8)

    # Re-attach alpha if it was there
    if has_alpha:
        b_ch, g_ch, r_ch = cv2.split(img_bgr)
        alpha = image[:, :, 3]
        return cv2.merge((b_ch, g_ch, r_ch, alpha))
    
    return img_bgr
