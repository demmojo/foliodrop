import pytest
import os
from fastapi.testclient import TestClient
from backend.main import app
from unittest.mock import patch, MagicMock

client = TestClient(app)

@pytest.fixture(autouse=True)
def reset_app_state():
    app.dependency_overrides.clear()
    if hasattr(app.state, "db"):
        del app.state.db
    yield
    app.dependency_overrides.clear()
    if hasattr(app.state, "db"):
        del app.state.db

def test_dependency_injection_gcp_bucket():
    with patch.dict(os.environ, {"GCP_UPLOAD_BUCKET": "test-bucket", "CLOUD_TASKS_QUEUE": "test-queue"}):
        with patch("backend.infrastructure.adapters.FirestoreAdapter") as mock_fs:
            with patch("backend.infrastructure.adapters.CloudTasksAdapter") as mock_ct:
                with patch("backend.infrastructure.adapters.GCSBlobStorageAdapter") as mock_gcs:
                    if hasattr(app.state, "db"):
                        del app.state.db
                    
                    # Hit get_database twice to cover cache
                    client.get("/api/v1/quota")
                    client.get("/api/v1/quota")
                    
                    # Hit get_blob_storage and get_task_queue
                    from backend.main import get_blob_storage, get_task_queue
                    get_blob_storage()
                    get_task_queue()

def test_generate_upload_urls():
    req = {
        "session_id": "session1",
        "files": ["file1.jpg", "file2.jpg"]
    }
    resp = client.post("/api/v1/upload-urls", json=req)
    assert resp.status_code == 200
    assert "urls" in resp.json()

def test_get_quota():
    resp = client.get("/api/v1/quota")
    assert resp.status_code == 200

def test_finalize_job_already_exists():
    # Pre-seed job
    from backend.main import get_database
    db = get_database()
    db.save_job("existing_job", "session", "PENDING", "key_existing")
    
    req = {
        "session_id": "session",
        "idempotency_key": "key_existing",
        "files": [{"name": "file.jpg", "timestamp": 1000}]
    }
    resp = client.post("/api/v1/finalize-job", json=req)
    assert resp.status_code == 202
    assert resp.json()["message"] == "Job already exists"
    assert resp.json()["job_id"] == "existing_job"

def test_finalize_job_success():
    from backend.main import get_database
    db = get_database()
    db.increment_quota_usage = MagicMock(return_value=True)
    req = {
        "session_id": "session",
        "idempotency_key": "key_new",
        "files": [{"name": "file.jpg", "timestamp": 1000}]
    }
    resp = client.post("/api/v1/finalize-job", json=req)
    assert resp.status_code == 202
    assert resp.json()["status"] == "enqueued"

def test_finalize_job_quota_exceeded():
    from backend.main import get_database
    db = get_database()
    db.increment_quota_usage = MagicMock(return_value=False)
    
    req = {
        "session_id": "session",
        "idempotency_key": "key_quota",
        "files": [{"name": "file.jpg", "timestamp": 1000}]
    }
    resp = client.post("/api/v1/finalize-job", json=req)
    assert resp.status_code == 402

def test_process_job_task():
    from backend.main import get_database
    db = get_database()
    db.save_job("job_process", "session", "PENDING", "key_process")
    
    req = {
        "job_id": "job_process",
        "session_id": "session",
        "room_name": "Room 1",
        "photos": ["file.jpg"]
    }
    resp = client.post("/api/v1/jobs/process", json=req)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error" # < 2 photos

    # Test job not found
    req["job_id"] = "job_missing"
    resp = client.post("/api/v1/jobs/process", json=req)
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"
    
def test_get_active_jobs():
    resp = client.get("/api/v1/jobs/active?session_id=session")
    assert resp.status_code == 200

def test_batch_status():
    from backend.main import get_database
    db = get_database()
    db.save_job("job_batch_1", "session", "PENDING", "key_batch_1")
    db.save_job("job_batch_2", "session", "COMPLETED", "key_batch_2", result={"blob_path": "a", "thumb_blob_path": "b"})
    db.save_job("job_batch_3", "session", "COMPLETED", "key_batch_3", result={"blob_path": "a"}) # no thumb
    db.save_job("job_batch_4", "session", "COMPLETED", "key_batch_4", result={"thumb_blob_path": "b"}) # no blob
    
    req = {"job_ids": ["job_batch_1", "job_batch_2", "job_batch_3", "job_batch_4"]}
    resp = client.post("/api/v1/jobs/batch-status", json=req)
    
    assert resp.status_code == 200
    jobs = resp.json()["jobs"]
    assert len(jobs) == 4

def test_batch_signed_url():
    req = {"blob_paths": ["path1", "path2"]}
    resp = client.post("/api/v1/jobs/batch-signed-url", json=req)
    assert resp.status_code == 200
    assert len(resp.json()["urls"]) == 2

def test_override_job_image_error():
    from backend.main import get_database
    db = get_database()
    # Missing job
    with open("test.jpg", "wb") as f:
        f.write(b"data")
    with open("test.jpg", "rb") as f:
        resp = client.post("/api/v1/jobs/missing_override/override", files={"file": ("test.jpg", f, "image/jpeg")})
    assert resp.status_code == 400
    os.remove("test.jpg")
