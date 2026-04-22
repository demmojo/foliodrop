import pytest
import os
import cv2
import numpy as np
from backend.core.use_cases import ProcessHdrGroupUseCase
from backend.tests.fakes import FakeEventPublisher, FakeTaskQueue, FakeDatabase

class LocalDiskBlobStorage:
    def __init__(self, disk_dir):
        self.disk_dir = disk_dir
        self.blobs = {}

    def download_blobs(self, session_id, files):
        data = []
        for file in files:
            path = os.path.join(self.disk_dir, file)
            with open(path, "rb") as f:
                data.append(f.read())
        return data

    def generate_upload_urls(self, session_id, files):
        return []

    def upload_blob(self, session_id, filename, data, content_type):
        self.blobs[filename] = data
        return filename

    def upload_blob_direct(self, blob_path, data, content_type):
        self.blobs[blob_path] = data
        return blob_path

    def delete_blob(self, blob_path):
        pass

    def generate_signed_url(self, blob_path, expiration_minutes=15):
        return "http://fake"

@pytest.mark.asyncio
async def test_process_real_brackets():
    """
    Integration test using the real example_brackets images.
    It verifies the pipeline executes properly without crashing.
    """
    brackets_dir = os.path.join(os.path.dirname(__file__), "../../example_brackets")
    if not os.path.exists(brackets_dir):
        pytest.skip("example_brackets directory not found")

    files = sorted([f for f in os.listdir(brackets_dir) if f.endswith(".JPG")])
    # Let's just process the first group of 5 photos
    if len(files) < 5:
        pytest.skip("Not enough photos in example_brackets")
        
    photos = files[:5]

    event_publisher = FakeEventPublisher()
    task_queue = FakeTaskQueue()
    storage = LocalDiskBlobStorage(brackets_dir)
    db = FakeDatabase()

    job_id = "test_real_brackets_job"
    db.save_job(job_id, "session", "PENDING", "idem_real")

    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)

    # Use dummy Gemini to avoid API costs and network requests, 
    # but we still execute the OpenCV pipeline fully.
    # The dummy is activated if GEMINI_API_KEY is not set or is 'dummy-key'
    os.environ["GEMINI_API_KEY"] = "dummy-key"
    
    result = await use_case.execute("fake-agency", job_id, "session", "Real Room", photos)

    # Should complete or flag, but definitely not error
    assert result["status"] in ["COMPLETED", "FLAGGED"]
    
    # Check if output is saved
    assert result.get("blob_path") in storage.blobs
    
    # Check that OpenCV did output an image
    merged_data = storage.blobs[result["blob_path"]]
    merged_img = cv2.imdecode(np.frombuffer(merged_data, np.uint8), cv2.IMREAD_COLOR)
    assert merged_img is not None
    assert merged_img.shape[2] == 3
    
    # Downsampled size check (max dim 2048)
    h, w = merged_img.shape[:2]
    assert max(h, w) <= 2048
