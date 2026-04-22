import cv2
import numpy as np

def decode_image(image_bytes: bytes) -> np.ndarray:
    """
    Decodes an image from bytes. Supports JPEG, PNG, TIFF via OpenCV,
    and falls back to pillow_heif for HEIC/HEIF images.
    Returns a BGR numpy array (OpenCV standard).
    """
    # Try OpenCV first (handles JPEG, PNG, TIFF, etc.)
    img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is not None:
        return img
        
    # If OpenCV failed, try HEIF/HEIC
    try:
        import pillow_heif
        heif_file = pillow_heif.read_heif(image_bytes)
        img_np = np.asarray(heif_file)
        
        # Convert from pillow_heif format to OpenCV BGR
        if heif_file.mode == 'RGB':
            img = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        elif heif_file.mode == 'RGBA':
            img = cv2.cvtColor(img_np, cv2.COLOR_RGBA2BGR)
        else:
            # Grayscale or other
            img = cv2.cvtColor(img_np, cv2.COLOR_GRAY2BGR)
        return img
    except Exception as e:
        # Re-raise or return None
        raise ValueError("Unsupported image format or corrupt image") from e
