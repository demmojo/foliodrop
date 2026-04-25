import pytest
import numpy as np
import cv2
from unittest.mock import MagicMock, patch
from backend.core.generation_loop import compute_structural_diff, generate_hybrid_hdr, GenerationError

def test_compute_structural_diff_pass():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    
    with patch("backend.core.generation_loop.cv2.findHomography") as mock_find:
        with patch("backend.core.generation_loop.cv2.SIFT_create") as mock_sift:
            with patch("backend.core.generation_loop.cv2.FlannBasedMatcher") as mock_flann:
                # Mock SIFT
                mock_sift_inst = MagicMock()
                mock_sift.return_value = mock_sift_inst
                
                kp = []
                for i in range(10):
                    for j in range(10):
                        kp.append(MagicMock(pt=(float(i * 10), float(j * 10))))
                des = np.zeros((100, 128), dtype=np.float32)
                mock_sift_inst.detectAndCompute.return_value = (kp, des)
    
                # Mock FLANN
                mock_flann_inst = MagicMock()
                mock_flann.return_value = mock_flann_inst
    
                # knnMatch returns list of lists of matches
                mock_matches = []
                for i in range(100):
                    m1 = MagicMock(queryIdx=i, trainIdx=i, distance=0.1)
                    m2 = MagicMock(queryIdx=i, trainIdx=i, distance=0.9)
                    mock_matches.append([m1, m2])
                mock_flann_inst.knnMatch.return_value = mock_matches
    
                # Mock findHomography
                mock_mask = np.ones((100, 1), dtype=np.uint8)
                mock_find.return_value = (np.eye(3), mock_mask)
                
                is_valid, inlier_ratio, void_ratio = compute_structural_diff(img, img)
                assert is_valid

def test_compute_structural_diff_no_keypoints():
    img = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    with patch("backend.core.generation_loop.cv2.SIFT_create") as mock_sift:
        mock_sift_inst = MagicMock()
        mock_sift.return_value = mock_sift_inst
        mock_sift_inst.detectAndCompute.return_value = ([], None)
        is_valid, inlier_ratio, void_ratio = compute_structural_diff(img, img)
    assert not is_valid

def test_compute_structural_diff_no_keypoints_low_texture_soft_pass():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    is_valid, _, _ = compute_structural_diff(img, img)
    assert is_valid

def test_compute_structural_diff_large_image():
    img = np.zeros((2000, 2000, 3), dtype=np.uint8)
    with patch("backend.core.generation_loop.cv2.findHomography") as mock_find:
        with patch("backend.core.generation_loop.cv2.SIFT_create") as mock_sift:
            with patch("backend.core.generation_loop.cv2.FlannBasedMatcher") as mock_flann:
                mock_sift_inst = MagicMock()
                mock_sift.return_value = mock_sift_inst
                kp = []
                for i in range(10):
                    for j in range(10):
                        kp.append(MagicMock(pt=(float(i * 100), float(j * 100))))
                des = np.zeros((100, 128), dtype=np.float32)
                mock_sift_inst.detectAndCompute.return_value = (kp, des)
                mock_flann_inst = MagicMock()
                mock_flann.return_value = mock_flann_inst
                mock_matches = []
                for i in range(100):
                    m1 = MagicMock(queryIdx=i, trainIdx=i, distance=0.1)
                    m2 = MagicMock(queryIdx=i, trainIdx=i, distance=0.9)
                    mock_matches.append([m1, m2])
                mock_flann_inst.knnMatch.return_value = mock_matches
                mock_mask = np.ones((100, 1), dtype=np.uint8)
                mock_find.return_value = (np.eye(3), mock_mask)
                is_valid, _, _ = compute_structural_diff(img, img)
                assert is_valid

def test_compute_structural_diff_no_homography():
    img = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    with patch("backend.core.generation_loop.cv2.findHomography") as mock_find:
        with patch("backend.core.generation_loop.cv2.SIFT_create") as mock_sift:
            with patch("backend.core.generation_loop.cv2.FlannBasedMatcher") as mock_flann:
                mock_sift_inst = MagicMock()
                mock_sift.return_value = mock_sift_inst
                kp = [MagicMock(pt=(float(i), float(i))) for i in range(20)]
                des = np.zeros((20, 128), dtype=np.float32)
                mock_sift_inst.detectAndCompute.return_value = (kp, des)
                mock_flann_inst = MagicMock()
                mock_flann.return_value = mock_flann_inst
                mock_matches = []
                for i in range(20):
                    m1 = MagicMock(queryIdx=i, trainIdx=i, distance=0.1)
                    m2 = MagicMock(queryIdx=i, trainIdx=i, distance=0.9)
                    mock_matches.append([m1, m2])
                mock_flann_inst.knnMatch.return_value = mock_matches
                
                # Mock findHomography to fail
                mock_find.return_value = (None, None)
                is_valid, _, _ = compute_structural_diff(img, img)
                assert not is_valid

def test_compute_structural_diff_bad_matches():
    img = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
    with patch("backend.core.generation_loop.cv2.SIFT_create") as mock_sift:
        with patch("backend.core.generation_loop.cv2.FlannBasedMatcher") as mock_flann:
            mock_sift_inst = MagicMock()
            mock_sift.return_value = mock_sift_inst
            kp = [MagicMock(pt=(float(i), float(i))) for i in range(20)]
            des = np.zeros((20, 128), dtype=np.float32)
            mock_sift_inst.detectAndCompute.return_value = (kp, des)
            mock_flann_inst = MagicMock()
            mock_flann.return_value = mock_flann_inst
            
            mock_matches = []
            for i in range(20):
                # distance ratio fails
                m1 = MagicMock(queryIdx=i, trainIdx=i, distance=0.8)
                m2 = MagicMock(queryIdx=i, trainIdx=i, distance=0.9)
                mock_matches.append([m1, m2])
            # also one match without 2 elements
            mock_matches.append([MagicMock(distance=0.1)])
            mock_flann_inst.knnMatch.return_value = mock_matches
            
            is_valid, _, _ = compute_structural_diff(img, img)
            assert not is_valid

def test_compute_structural_diff_low_inlier_ratio():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    with patch("backend.core.generation_loop.cv2.findHomography") as mock_find:
        with patch("backend.core.generation_loop.cv2.SIFT_create") as mock_sift:
            with patch("backend.core.generation_loop.cv2.FlannBasedMatcher") as mock_flann:
                mock_sift_inst = MagicMock()
                mock_sift.return_value = mock_sift_inst
                kp = [MagicMock(pt=(float(i), float(i))) for i in range(20)]
                des = np.zeros((20, 128), dtype=np.float32)
                mock_sift_inst.detectAndCompute.return_value = (kp, des)
                mock_flann_inst = MagicMock()
                mock_flann.return_value = mock_flann_inst
                mock_matches = []
                for i in range(20):
                    m1 = MagicMock(queryIdx=i, trainIdx=i, distance=0.1)
                    m2 = MagicMock(queryIdx=i, trainIdx=i, distance=0.9)
                    mock_matches.append([m1, m2])
                mock_flann_inst.knnMatch.return_value = mock_matches
                
                # Only 1 inlier out of 20 matches (ratio = 0.05 < 0.12)
                mock_mask = np.zeros((20, 1), dtype=np.uint8)
                mock_mask[0] = 1
                mock_find.return_value = (np.eye(3), mock_mask)
                is_valid, inlier_ratio, _ = compute_structural_diff(img, img)
                assert not is_valid
                assert inlier_ratio == 0.05

def test_compute_structural_diff_void_ratio():
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    with patch("backend.core.generation_loop.cv2.findHomography") as mock_find:
        with patch("backend.core.generation_loop.cv2.SIFT_create") as mock_sift:
            with patch("backend.core.generation_loop.cv2.FlannBasedMatcher") as mock_flann:
                mock_sift_inst = MagicMock()
                mock_sift.return_value = mock_sift_inst
                kp = []
                for i in range(10):
                    for j in range(10):
                        # All points in top left corner (0,0) to create a void
                        kp.append(MagicMock(pt=(float(1), float(1))))
                des = np.zeros((100, 128), dtype=np.float32)
                mock_sift_inst.detectAndCompute.return_value = (kp, des)
                mock_flann_inst = MagicMock()
                mock_flann.return_value = mock_flann_inst
                mock_matches = []
                for i in range(100):
                    m1 = MagicMock(queryIdx=i, trainIdx=i, distance=0.1)
                    m2 = MagicMock(queryIdx=i, trainIdx=i, distance=0.9)
                    mock_matches.append([m1, m2])
                mock_flann_inst.knnMatch.return_value = mock_matches
                
                # Make some inliers 0 to hit that branch
                mock_mask = np.ones((100, 1), dtype=np.uint8)
                mock_mask[0] = 0
                mock_find.return_value = (np.eye(3), mock_mask)
                is_valid, _, void_ratio = compute_structural_diff(img, img)
                assert not is_valid
                assert void_ratio > 0.55

@pytest.mark.asyncio
async def test_generate_hybrid_hdr_success():
    client = MagicMock()
    mock_file = MagicMock()
    mock_file.name = "test_file_name"
    
    # Mock generate_content
    mock_response = MagicMock()
    mock_part = MagicMock()
    mock_part.inline_data.data = b"generated_image_bytes"
    mock_response.parts = [mock_part]
    client.aio.models.generate_content = __import__("unittest.mock").mock.AsyncMock(return_value=mock_response)
    
    style_urls = ["http://style1.jpg"]

    with patch("google.genai.types.Part.from_uri") as mock_from_uri:
        mock_from_uri.return_value = "mocked_part"
        result, status = await generate_hybrid_hdr(client, mock_file, [mock_file, mock_file], retry_count=1, style_urls=style_urls)
    assert result == b"generated_image_bytes"
    assert status == {"status": "success"}

    # We hoisted file deletion, so it is 0
    assert client.files.delete.call_count == 0

@pytest.mark.asyncio
async def test_generate_hybrid_hdr_no_parts():
    client = MagicMock()
    mock_response = MagicMock()
    mock_response.parts = []
    client.aio.models.generate_content = __import__("unittest.mock").mock.AsyncMock(return_value=mock_response)
    
    mock_file = MagicMock()
    with pytest.raises(GenerationError, match="No parts in response"):
        await generate_hybrid_hdr(client, mock_file, [])

@pytest.mark.asyncio
async def test_generate_hybrid_hdr_no_inline_data():
    client = MagicMock()
    mock_response = MagicMock()
    mock_part = MagicMock()
    mock_part.inline_data = None
    mock_response.parts = [mock_part]
    client.aio.models.generate_content = __import__("unittest.mock").mock.AsyncMock(return_value=mock_response)
    
    mock_file = MagicMock()
    with pytest.raises(GenerationError, match="No image returned by model"):
        await generate_hybrid_hdr(client, mock_file, [])
