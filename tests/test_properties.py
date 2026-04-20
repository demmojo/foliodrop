import pytest
import numpy as np
from hypothesis import given, settings
import hypothesis.extra.numpy as hnp
import hypothesis.strategies as st
from backend.core.vision import (
    run_mertens_fusion,
    extract_window_mask,
    composite_dark_windows
)

try:
    import cv2
except ImportError:
    cv2 = None

@st.composite
def matched_images(draw, num_images=3):
    h = draw(st.integers(min_value=10, max_value=50))
    w = draw(st.integers(min_value=10, max_value=50))
    
    # Generate array of shape (num_images, h, w, 3)
    arrays = draw(hnp.arrays(
        dtype=np.uint8,
        shape=(num_images, h, w, 3),
        elements=st.integers(min_value=0, max_value=255)
    ))
    
    return [arrays[i] for i in range(num_images)]

@pytest.mark.skipif(cv2 is None, reason="OpenCV is required")
@settings(max_examples=20, deadline=None)
@given(matched_images(num_images=3))
def test_mertens_fusion_shape_invariant(images):
    """
    Property: Mertens fusion should always return an image with the exact same
    (height, width, channels) as the input images.
    """
    input_shape = images[0].shape
    result = run_mertens_fusion(images)
    assert result.shape == input_shape
    assert result.dtype == np.uint8

@pytest.mark.skipif(cv2 is None, reason="OpenCV is required")
def test_window_mask_invariant():
    """
    Property: An image consisting entirely of pure white (255) should yield a mask
    that is entirely white (255) for all pixels.
    """
    h, w = 20, 20
    pure_white = np.full((h, w, 3), 255, dtype=np.uint8)
    
    mask = extract_window_mask(pure_white)
    
    assert mask.shape == (h, w)
    assert np.all(mask == 255)

@pytest.mark.skipif(cv2 is None, reason="OpenCV is required")
def test_compositing_invariant():
    """
    Property: When compositing a pure white image (which yields a full mask)
    with a dark image, the result should exactly match the dark image.
    """
    h, w = 20, 20
    pure_white = np.full((h, w, 3), 255, dtype=np.uint8)
    dark_img = np.full((h, w, 3), 50, dtype=np.uint8)
    
    composited = composite_dark_windows([pure_white], dark_img)
    
    assert len(composited) == 1
    np.testing.assert_array_equal(composited[0], dark_img)
