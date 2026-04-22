import pytest
import asyncio
import numpy as np
from backend.tests.fakes import FakeEventPublisher, FakeTaskQueue, FakeBlobStorage, FakeDatabase
from backend.core.use_cases import ProcessHdrGroupUseCase, GenerateUploadUrlsUseCase, FinalizeJobUseCase, downsample_for_vlm

def test_generate_upload_urls():
    storage = FakeBlobStorage()
    use_case = GenerateUploadUrlsUseCase(storage)
    urls = use_case.execute("test-session", ["img1.jpg", "img2.jpg"])
    assert len(urls) == 2
    assert urls[0]["file"] == "img1.jpg"

def test_finalize_job():
    task_queue = FakeTaskQueue()
    db = FakeDatabase()
    use_case = FinalizeJobUseCase(task_queue, db)
    files_data = [
        {"name": "img1.jpg", "timestamp": 1000},
        {"name": "img2.jpg", "timestamp": 1000},
    ]
    # new idempotency key
    result = use_case.execute("fake-agency", "test-session", "test-idem", files_data)
    assert result["status"] == "enqueued"
    assert len(result["job_ids"]) == 1
    
    # duplicate idempotency key
    result2 = use_case.execute("fake-agency", "test-session", "test-idem", files_data)
    assert result2["status"] == "enqueued"
    assert result2["job_ids"] == result["job_ids"]

def test_downsample_for_vlm():
    import cv2
    fake_img = np.zeros((2000, 2000, 3), dtype=np.uint8)
    _, encoded = cv2.imencode('.jpg', fake_img)
    fake_bytes = encoded.tobytes()
    res = downsample_for_vlm(fake_bytes, max_dim=1080)
    
    # decode again
    img = cv2.imdecode(np.frombuffer(res, np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    assert h == 1080 and w == 1080

def test_downsample_for_vlm_bad_image():
    res = downsample_for_vlm(b"bad bytes", max_dim=1080)
    assert res == b"bad bytes"

@pytest.mark.asyncio
async def test_hdr_pipeline_execution():
    """
    Tests the deterministic OpenCV HDR Pipeline + VLM QA Judge architecture.
    Since we don't have Gemini API keys in CI, the use case uses a dummy key 
    which returns a mocked VLMQualityReport. 
    """
    # Arrange
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    # FakeBlobStorage needs to return valid JPEGs for cv2.imdecode to not fail
    import cv2
    fake_img = np.zeros((100, 100, 3), dtype=np.uint8)
    _, encoded = cv2.imencode('.jpg', fake_img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes for _ in f]

    job_id = "test-job"
    session_id = "test-session"
    room = "Living Room"
    
    # Pre-populate job in fake DB
    db.save_job(job_id, session_id, "PENDING", "test-idem-key")

    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    
    # Provide dummy images to trigger the pipeline
    photos = ["img1.jpg", "img2.jpg", "img3.jpg"]
    
    # Act
    result = await use_case.execute("fake-agency", job_id, session_id, room, photos)
    
    # Assert
    assert result["status"] in ["COMPLETED", "FLAGGED"]
    assert "blob_path" in result
    assert "thumb_blob_path" in result
    assert "isFlagged" in result
    
    # Assert telemetry was captured
    assert "telemetry" in result

@pytest.mark.asyncio
async def test_process_hdr_missing_photos():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = FakeBlobStorage()
    db = FakeDatabase()
    
    job_id = "test-job-2"
    db.save_job(job_id, "session", "PENDING", "test-idem")
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    
    # Pass 1 photo
    result = await use_case.execute("fake-agency", job_id, "session", "Room", ["img1.jpg"])
    assert result["status"] == "error"
    
    # Check DB
    job = db.get_job(job_id)
    assert job["status"] == "FAILED"
    assert "error" in job

@pytest.mark.asyncio
async def test_process_hdr_exception():
    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    
    # Make storage raise an exception
    class BadStorage(FakeBlobStorage):
        def download_blobs(self, session_id, files):
            raise ValueError("Storage failed")
            
    storage = BadStorage()
    db = FakeDatabase()
    
    job_id = "test-job-3"
    db.save_job(job_id, "session", "PENDING", "test-idem")
    
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    
    # Provide enough photos to trigger pipeline
    photos = ["img1.jpg", "img2.jpg", "img3.jpg"]
    result = await use_case.execute("fake-agency", job_id, "session", "Room", photos)
    assert result["status"] == "error"
    
    job = db.get_job(job_id)
    assert job["status"] == "FAILED"
    assert "Storage failed" in job["error"]

