import pytest
import asyncio
import os
import cv2
import numpy as np
from unittest.mock import MagicMock, patch

from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher, IProgressSubscriber
from backend.core.use_cases import (
    FinalizeJobUseCase,
    ProcessHdrGroupUseCase,
    downsample_for_vlm,
    OverrideJobImageUseCase,
)
from backend.tests.fakes import FakeDatabase, FakeTaskQueue, FakeBlobStorage, FakeEventPublisher


def test_finalize_job_with_groups_data():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    use_case = FinalizeJobUseCase(task_queue, db)
    
    result = use_case.execute("fake-agency", "session", "key", groups_data=[
        {"name": "Scene 1", "files": ["file1.jpg", "file2.jpg"]},
        {"name": "Scene 2", "files": ["file3.jpg", "file4.jpg"]}
    ])
    
    assert result["status"] == "enqueued"
    assert result["tasks_count"] == 2
    assert len(result["job_ids"]) == 2

def test_finalize_job_quota_exceeded():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    use_case = FinalizeJobUseCase(task_queue, db)
    
    db.increment_quota_usage = MagicMock(return_value=False)
    result = use_case.execute("fake-agency", "session", "key", [{"name": "file", "timestamp": 1000}])
    assert result["status"] == "quota_exceeded"

def test_downsample_for_vlm_small_image():
    img = np.zeros((500, 500, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    bytes_data = encoded.tobytes()
    
    downsampled_bytes = downsample_for_vlm(bytes_data, max_dim=1000)
    
    img_out = cv2.imdecode(np.frombuffer(downsampled_bytes, np.uint8), cv2.IMREAD_COLOR)
    h, w = img_out.shape[:2]
    assert h == 500

@pytest.mark.asyncio
async def test_process_hdr_missing_photos_with_job():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    job_id = "test_job_1"
    db.save_job(job_id, "session", "PENDING", "key_1")
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute(job_id, "session", "Room 1", ["img1.jpg"])
    assert result["status"] == "error"

@pytest.mark.asyncio
async def test_process_hdr_missing_photos_no_job():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("missing_job", "session", "Room 1", ["img1.jpg"])
    assert result["status"] == "error"

@pytest.mark.asyncio
async def test_process_hdr_success_no_job():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes, fake_bytes]
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", "missing_job", "session", "Room 1", ["img1.jpg", "img2.jpg", "img3.jpg"])
    assert result["status"] == "COMPLETED"

@pytest.mark.asyncio
async def test_process_hdr_large_image_and_malloc_trim_fail():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((2500, 1000, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes, fake_bytes]
    
    job_id = "test_job_2"
    db.save_job(job_id, "session", "PENDING", "key_2")
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    
    with patch("ctypes.CDLL") as mock_cdll:
        mock_cdll.side_effect = Exception("malloc_trim error")
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg", "img3.jpg"])
    
    assert result["status"] == "COMPLETED"

@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_with_real_key_success(mock_compute_diff, mock_generate, mock_client):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    
    job_id = "test_job_3"
    db.save_job(job_id, "session", "PENDING", "key_3")
    
    mock_generate.return_value = (fake_bytes, {"status": "success"})
    mock_compute_diff.return_value = (True, 0.9, 0.0)
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "COMPLETED"

@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
@patch("backend.core.generation_loop.compute_structural_diff")
async def test_process_hdr_with_real_key_structural_failure_fallback(mock_compute_diff, mock_generate, mock_client):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    
    job_id = "test_job_4"
    db.save_job(job_id, "session", "PENDING", "key_4")
    
    mock_generate.return_value = (fake_bytes, {"status": "success"})
    mock_compute_diff.return_value = (False, 0.05, 0.6)
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "FLAGGED"
    assert result["isFlagged"] is True


@pytest.mark.asyncio
@patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"})
@patch("google.genai.Client")
@patch("backend.core.generation_loop.generate_hybrid_hdr")
async def test_process_hdr_with_real_key_exception(mock_generate, mock_client):
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    
    job_id = "test_job_5"
    db.save_job(job_id, "session", "PENDING", "key_5")
    
    mock_generate.side_effect = Exception("GenAI failed")
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "FLAGGED"

@pytest.mark.asyncio
async def test_process_hdr_exception_during_update():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    storage.download_blobs = MagicMock(side_effect=Exception("Storage error"))
    job_id = "test_job_6"
    db.save_job(job_id, "session", "PENDING", "key_6")
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("fake-agency", job_id, "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "error"

@pytest.mark.asyncio
async def test_process_hdr_exception_no_job():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    storage.download_blobs = MagicMock(side_effect=Exception("Storage error"))
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute("missing_job", "session", "Room 1", ["img1.jpg", "img2.jpg"])
    assert result["status"] == "error"

def test_override_job_image_job_not_found():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = OverrideJobImageUseCase(storage, db)
    res = use_case.execute("agency", "missing_job", ("file.jpg", b"data", "image/jpeg"))
    assert res["status"] == "error"

def test_override_job_image_thumb_fail():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = OverrideJobImageUseCase(storage, db)
    db.save_job("job_1", "session", "COMPLETED", "key", result={"blob_path": "a"})
    res = use_case.execute("agency", "job_1", ("file.jpg", b"bad_data", "image/jpeg"))
    assert res["status"] == "success"

def test_override_job_image_no_result():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = OverrideJobImageUseCase(storage, db)
    db.save_job("job_2", "session", "COMPLETED", "key")
    res = use_case.execute("agency", "job_2", ("file.jpg", b"data", "image/jpeg"))
    assert res["status"] == "error"

def test_override_job_image_success_thumb():
    storage = FakeBlobStorage()
    db = FakeDatabase()
    use_case = OverrideJobImageUseCase(storage, db)
    db.save_job("job_3", "session", "COMPLETED", "key", result={"blob_path": "a"})
    
    img = np.zeros((1000, 1000, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    fake_bytes = encoded.tobytes()
    
    res = use_case.execute("agency", "job_3", ("file.jpg", fake_bytes, "image/jpeg"))
    assert res["status"] == "success"
    job = db.get_job("job_3")
    assert "thumb_blob_path" in job["result"]
