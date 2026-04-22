import pytest
import numpy as np
import cv2
import sys
from unittest.mock import patch, MagicMock

mock_pillow_heif = MagicMock()
sys.modules['pillow_heif'] = mock_pillow_heif

from backend.core.image_decoding import decode_image

def test_decode_image_cv2_success():
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    res = decode_image(buf.tobytes())
    assert res.shape == (10, 10, 3)

@patch("backend.core.image_decoding.cv2.cvtColor")
@patch("backend.core.image_decoding.np.asarray")
def test_decode_image_heif_paths(mock_asarray, mock_cvtColor):
    bad_bytes = b"bad bytes"
    
    # Simulate cv2.imdecode failing
    with patch("backend.core.image_decoding.cv2.imdecode", return_value=None):
        # RGB
        mock_file = MagicMock()
        mock_file.mode = "RGB"
        mock_pillow_heif.read_heif.return_value = mock_file
        mock_asarray.return_value = np.zeros((10,10,3))
        mock_cvtColor.return_value = "rgb"
        assert decode_image(bad_bytes) == "rgb"
        
        # RGBA
        mock_file.mode = "RGBA"
        mock_cvtColor.return_value = "rgba"
        assert decode_image(bad_bytes) == "rgba"
        
        # Gray
        mock_file.mode = "GRAY"
        mock_cvtColor.return_value = "gray"
        assert decode_image(bad_bytes) == "gray"

def test_decode_image_error():
    bad_bytes = b"bad bytes"
    with patch("backend.core.image_decoding.cv2.imdecode", return_value=None):
        mock_pillow_heif.read_heif.side_effect = Exception("corrupt")
        with pytest.raises(ValueError):
            decode_image(bad_bytes)
