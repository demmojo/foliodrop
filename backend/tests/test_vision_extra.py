import pytest
import numpy as np
import cv2
from unittest.mock import patch, MagicMock
from backend.core.vision import align_images, run_mertens_fusion, apply_real_estate_heuristics

def test_align_images_no_cv2():
    with patch("backend.core.vision.cv2", None):
        with pytest.raises(ImportError):
            align_images([])

def test_run_mertens_fusion_no_cv2():
    with patch("backend.core.vision.cv2", None):
        with pytest.raises(ImportError):
            run_mertens_fusion([])

def test_apply_real_estate_heuristics_no_cv2():
    with patch("backend.core.vision.cv2", None):
        with pytest.raises(ImportError):
            apply_real_estate_heuristics(np.zeros((10, 10, 3)))

def test_align_images_success():
    img1 = np.zeros((10, 10, 3), dtype=np.uint8)
    img2 = np.zeros((10, 10, 3), dtype=np.uint8)
    res = align_images([img1, img2])
    assert len(res) == 2

def test_run_mertens_fusion_success():
    img1 = np.zeros((10, 10, 3), dtype=np.uint8)
    img2 = np.zeros((10, 10, 3), dtype=np.uint8)
    res = run_mertens_fusion([img1, img2])
    # The return type should be float32 in [0, 1]
    assert res.dtype == np.float32

def test_apply_real_estate_heuristics_success():
    img = np.zeros((10, 10, 3), dtype=np.float32)
    res = apply_real_estate_heuristics(img)
    # The return type should be uint8 in [0, 255]
    assert res.dtype == np.uint8

def test_apply_real_estate_heuristics_resizes_darkest_when_mismatched_shape():
    fused = np.ones((20, 20, 3), dtype=np.float32) * 0.95
    darkest = np.ones((8, 8, 3), dtype=np.uint8) * 50
    out = apply_real_estate_heuristics(fused, darkest)
    assert out.shape == (20, 20, 3)


def test_apply_real_estate_heuristics_recovers_bright_windows_from_darkest():
    # Simulate a blown-out fused image and a darker bracket with detail.
    fused = np.ones((20, 20, 3), dtype=np.float32) * 0.98
    darkest = np.ones((20, 20, 3), dtype=np.uint8) * 120

    res_no_dark = apply_real_estate_heuristics(fused)
    res_with_dark = apply_real_estate_heuristics(fused, darkest)

    # Window-highlight recovery should reduce clipping (lower average intensity).
    assert res_with_dark.mean() < res_no_dark.mean()
