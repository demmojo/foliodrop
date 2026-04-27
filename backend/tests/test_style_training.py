import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.tests.fakes import FakeDatabase, FakeBlobStorage


def _valid_image_bytes() -> bytes:
    return FakeBlobStorage().download_blobs("sess", ["seed.jpg"])[0]


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

def test_delete_style_profile_not_found(client):
    c, _db, _storage = client
    response = c.delete("/api/v1/style/profiles/nonexistent-id-12345")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_upload_style_image(client):
    c, db, storage = client
    image_bytes = _valid_image_bytes()

    # Upload 4 images
    for i in range(4):
        response = c.post(
            "/api/v1/style/upload",
            files={"file": (f"style{i}.jpg", image_bytes, "image/jpeg")}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"

    # Check DB using API
    response = c.get("/api/v1/style/profiles")
    assert response.status_code == 200
    profiles = response.json()["profiles"]
    assert len(profiles) == 4
    
    # Delete one
    profile_id = profiles[0]["id"]
    response = c.delete(f"/api/v1/style/profiles/{profile_id}")
    assert response.status_code == 200
    
    # Check again
    response = c.get("/api/v1/style/profiles")
    assert response.status_code == 200
    profiles = response.json()["profiles"]
    assert len(profiles) == 3
    # The first one should have been evicted
    assert not any("style0" in profile["blob_path"] for profile in profiles)
    assert any("style3" in profile["blob_path"] for profile in profiles)

def test_upload_training_pair(client):
    c, db, storage = client
    image_bytes = _valid_image_bytes()
    
    response = c.post(
        "/api/v1/training/upload",
        files=[
            ("brackets", ("bracket1.jpg", image_bytes, "image/jpeg")),
            ("brackets", ("bracket2.jpg", image_bytes, "image/jpeg")),
            ("final_edit", ("final.jpg", image_bytes, "image/jpeg"))
        ]
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert len(data["bracket_paths"]) == 2
    assert "final.jpg" in data["final_path"]

def test_override_job_image(client):
    c, db, storage = client
    image_bytes = _valid_image_bytes()
    
    # First create a mock job
    db.save_job("job_123", "sess_1", "COMPLETED", "key_1", result={"blob_path": "old_path.jpg", "thumb_blob_path": "old_thumb.jpg"})
    
    response = c.post(
        "/api/v1/jobs/job_123/override",
        files={"file": ("override.jpg", image_bytes, "image/jpeg")}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "override.jpg" in data["blob_path"]
    
    # Check if job is updated
    job = db.get_job("job_123")
    assert "override.jpg" in job["result"]["blob_path"]


def test_style_profiles_are_isolated_per_authenticated_user(client):
    c, db, storage = client
    image_bytes = _valid_image_bytes()
    from backend.main import get_current_agency_id

    # user A uploads a profile
    app.dependency_overrides[get_current_agency_id] = lambda: "agency_a"
    resp_a = c.post("/api/v1/style/upload", files={"file": ("a.jpg", image_bytes, "image/jpeg")})
    assert resp_a.status_code == 200

    # user B uploads a profile
    app.dependency_overrides[get_current_agency_id] = lambda: "agency_b"
    resp_b = c.post("/api/v1/style/upload", files={"file": ("b.jpg", image_bytes, "image/jpeg")})
    assert resp_b.status_code == 200

    # user A can only see A profiles
    app.dependency_overrides[get_current_agency_id] = lambda: "agency_a"
    list_a = c.get("/api/v1/style/profiles")
    assert list_a.status_code == 200
    blob_paths_a = [p["blob_path"] for p in list_a.json()["profiles"]]
    assert all("/agency_a/" in p for p in blob_paths_a)
    assert all("/agency_b/" not in p for p in blob_paths_a)

    # user B can only see B profiles
    app.dependency_overrides[get_current_agency_id] = lambda: "agency_b"
    list_b = c.get("/api/v1/style/profiles")
    assert list_b.status_code == 200
    blob_paths_b = [p["blob_path"] for p in list_b.json()["profiles"]]
    assert all("/agency_b/" in p for p in blob_paths_b)
    assert all("/agency_a/" not in p for p in blob_paths_b)


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
    
    res = await use_case.execute("default", "job_123", "sess_1", "Room 1", ["photo1.jpg", "photo2.jpg"])
    assert res["status"] == "COMPLETED"
    
    # The telemetry should have "mock": "used dummy-key"
    assert any(t.get("mock") == "used dummy-key" for t in res["telemetry"])

