import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.tests.fakes import FakeDatabase, FakeBlobStorage

@pytest.fixture
def client():
    # Override dependencies
    db = FakeDatabase()
    storage = FakeBlobStorage()
    
    app.dependency_overrides = {}
    from backend.main import get_database, get_blob_storage
    app.dependency_overrides[get_database] = lambda: db
    app.dependency_overrides[get_blob_storage] = lambda: storage
    
    with TestClient(app) as c:
        yield c, db, storage
        
    app.dependency_overrides.clear()

def test_upload_style_image(client):
    c, db, storage = client
    
    # Upload 4 images to test FIFO eviction
    for i in range(4):
        response = c.post(
            "/api/v1/style/upload",
            files={"file": (f"style{i}.jpg", b"fake_image_data", "image/jpeg")}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        
    # Check DB
    images = db.get_style_images("default")
    assert len(images) == 3
    # The first one should have been evicted
    assert not any("style0" in img for img in images)
    assert any("style3" in img for img in images)

def test_upload_training_pair(client):
    c, db, storage = client
    
    response = c.post(
        "/api/v1/training/upload",
        files=[
            ("brackets", ("bracket1.jpg", b"data1", "image/jpeg")),
            ("brackets", ("bracket2.jpg", b"data2", "image/jpeg")),
            ("final_edit", ("final.jpg", b"data_final", "image/jpeg"))
        ]
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert len(data["bracket_paths"]) == 2
    assert "final.jpg" in data["final_path"]

def test_override_job_image(client):
    c, db, storage = client
    
    # First create a mock job
    db.save_job("job_123", "sess_1", "COMPLETED", "key_1", result={"blob_path": "old_path.jpg", "thumb_blob_path": "old_thumb.jpg"})
    
    response = c.post(
        "/api/v1/jobs/job_123/override",
        files={"file": ("override.jpg", b"override_data", "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "override.jpg" in data["blob_path"]
    
    # Check if job is updated
    job = db.get_job("job_123")
    assert "override.jpg" in job["result"]["blob_path"]


@pytest.mark.asyncio
async def test_process_hdr_group_use_case_with_style_urls():
    from backend.core.use_cases import ProcessHdrGroupUseCase
    from backend.tests.fakes import FakeEventPublisher, FakeTaskQueue
    
    db = FakeDatabase()
    storage = FakeBlobStorage()
    publisher = FakeEventPublisher()
    queue = FakeTaskQueue()
    
    # Save a job
    db.save_job("job_123", "sess_1", "PENDING", "key_1")
    
    # Save a style image
    db.save_style_image("default", "style_1.jpg")
    
    use_case = ProcessHdrGroupUseCase(publisher, queue, storage, db)
    
    # Needs valid dummy photos to test execution path without crashing
    import cv2
    import numpy as np
    
    # Let's mock download_blobs to return a valid 10x10 jpg
    fake_img = np.zeros((10, 10, 3), dtype=np.uint8)
    _, encoded = cv2.imencode('.jpg', fake_img)
    fake_bytes = encoded.tobytes()
    storage.download_blobs = lambda s, f: [fake_bytes, fake_bytes]
    
    res = await use_case.execute("job_123", "sess_1", "Room 1", ["photo1.jpg", "photo2.jpg"])
    assert res["status"] == "COMPLETED"
    
    # The telemetry should have "mock": "used dummy-key"
    assert any(t.get("mock") == "used dummy-key" for t in res["telemetry"])

