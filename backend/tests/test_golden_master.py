import pytest
import asyncio
import numpy as np
from backend.tests.fakes import FakeEventPublisher, FakeTaskQueue, FakeBlobStorage, FakeDatabase
from backend.core.use_cases import ProcessHdrGroupUseCase

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
    result = await use_case.execute(job_id, session_id, room, photos)
    
    # Assert
    assert result["status"] in ["COMPLETED", "FLAGGED"]
    assert "blob_path" in result
    assert "thumb_blob_path" in result
    assert "isFlagged" in result
    
    # Assert telemetry was captured
    assert "telemetry" in result

