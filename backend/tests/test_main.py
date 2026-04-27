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
    from backend.main import get_database
    db = get_database()
    db.save_job("job_active_1", "session", "COMPLETED", "key_active_1", result={"blob_path": "a", "thumb_blob_path": "b", "original_blob_path": "c"}, agency_id="default")
    db.save_job("job_active_2", "session", "COMPLETED", "key_active_2", agency_id="default") # no result
    db.save_job("job_active_3", "session", "COMPLETED", "key_active_3", result={"thumb_blob_path": "b"}, agency_id="default") # no blob
    db.save_job("job_active_4", "session", "COMPLETED", "key_active_4", result={"blob_path": "a", "original_blob_path": "c"}, agency_id="default") # no thumb
    db.save_job("job_active_5", "session", "COMPLETED", "key_active_5", result={"blob_path": "a", "thumb_blob_path": "b"}, agency_id="default") # no original
    
    resp = client.get("/api/v1/jobs/active?session_id=session")
    assert resp.status_code == 200
    jobs = resp.json()["jobs"]
    assert len(jobs) == 5
    assert "original_url" in jobs[0]["result"]
    assert isinstance(jobs[0]["result"].get("url_expires_at"), int)
    assert isinstance(jobs[0]["result"].get("thumb_url_expires_at"), int)
    assert isinstance(jobs[0]["result"].get("original_url_expires_at"), int)
    assert "url_expires_at" in jobs[0]["result"]
    assert "thumb_url_expires_at" in jobs[0]["result"]
    assert "original_url_expires_at" in jobs[0]["result"]

def test_get_active_jobs_includes_signed_urls_for_flagged():
    from backend.main import get_database
    db = get_database()
    db.save_job(
        "job_flagged_1",
        "session_flagged",
        "FLAGGED",
        "key_flagged_1",
        result={"blob_path": "a", "thumb_blob_path": "b", "original_blob_path": "c"},
        agency_id="default",
    )

    resp = client.get("/api/v1/jobs/active?session_id=session_flagged")
    assert resp.status_code == 200
    jobs = resp.json()["jobs"]
    assert len(jobs) == 1
    assert jobs[0]["status"] == "FLAGGED"
    assert "url" in jobs[0]["result"]
    assert "thumb_url" in jobs[0]["result"]
    assert "original_url" in jobs[0]["result"]

def test_batch_status():
    from backend.main import get_database
    db = get_database()
    db.save_job("job_batch_1", "session", "PENDING", "key_batch_1", agency_id="default")
    db.save_job("job_batch_2", "session", "COMPLETED", "key_batch_2", result={"blob_path": "a", "thumb_blob_path": "b", "original_blob_path": "c"}, agency_id="default")
    db.save_job("job_batch_3", "session", "COMPLETED", "key_batch_3", result={"blob_path": "a"}, agency_id="default") # no thumb
    db.save_job("job_batch_4", "session", "COMPLETED", "key_batch_4", result={"thumb_blob_path": "b"}, agency_id="default") # no blob
    
    req = {"job_ids": ["job_batch_1", "job_batch_2", "job_batch_3", "job_batch_4"]}
    resp = client.post("/api/v1/jobs/batch-status", json=req)
    
    assert resp.status_code == 200
    jobs = resp.json()["jobs"]
    assert len(jobs) == 4

def test_batch_status_includes_signed_urls_for_flagged():
    from backend.main import get_database
    db = get_database()
    db.save_job(
        "job_batch_flagged",
        "session",
        "FLAGGED",
        "key_batch_flagged",
        result={"blob_path": "a", "thumb_blob_path": "b", "original_blob_path": "c"},
        agency_id="default",
    )
    req = {"job_ids": ["job_batch_flagged"]}
    resp = client.post("/api/v1/jobs/batch-status", json=req)
    assert resp.status_code == 200
    jobs = resp.json()["jobs"]
    assert len(jobs) == 1
    assert jobs[0]["status"] == "FLAGGED"
    assert "url" in jobs[0]["result"]
    assert "thumb_url" in jobs[0]["result"]
    assert "original_url" in jobs[0]["result"]

def test_batch_signed_url():
    req = {"blob_paths": ["style_profiles/default/path1", "training_pairs/default/path2"]}
    resp = client.post("/api/v1/jobs/batch-signed-url", json=req)
    assert resp.status_code == 200
    assert len(resp.json()["urls"]) == 2
    assert all(isinstance(item.get("expires_at"), int) for item in resp.json()["urls"])
    assert all("expires_at" in item for item in resp.json()["urls"])

def test_override_job_image_error():
    from backend.tests.fakes import FakeBlobStorage
    image_bytes = FakeBlobStorage().download_blobs("sess", ["seed.jpg"])[0]
    from backend.main import get_database
    db = get_database()
    # Missing job
    with open("test.jpg", "wb") as f:
        f.write(image_bytes)
    with open("test.jpg", "rb") as f:
        resp = client.post("/api/v1/jobs/missing_override/override", files={"file": ("test.jpg", f, "image/jpeg")})
    assert resp.status_code == 400
    os.remove("test.jpg")


def test_log_debug_noop_does_not_raise():
    from backend.main import _log_debug
    _log_debug("message", {"k": 1}, hyp="H0")


def test_process_job_oidc_skipped_when_invoker_unset():
    # No EXPECTED_TASK_INVOKER => verification is skipped entirely.
    from backend.main import get_database
    db = get_database()
    db.save_job("job_oidc_skip", "session", "PENDING", "key_oidc_skip")

    req = {
        "job_id": "job_oidc_skip",
        "session_id": "session",
        "room_name": "Room",
        "photos": ["a.jpg"],
    }
    resp = client.post("/api/v1/jobs/process", json=req)
    # Returns 200 even if auth would otherwise be required, because the env var is unset.
    assert resp.status_code == 200


def test_process_job_oidc_missing_token():
    with patch.dict(os.environ, {"EXPECTED_TASK_INVOKER": "tasks@example.iam.gserviceaccount.com"}):
        req = {
            "job_id": "j",
            "session_id": "s",
            "room_name": "r",
            "photos": ["a.jpg"],
        }
        resp = client.post("/api/v1/jobs/process", json=req)
        assert resp.status_code == 401


def test_process_job_oidc_invalid_token():
    with patch.dict(os.environ, {"EXPECTED_TASK_INVOKER": "tasks@example.iam.gserviceaccount.com"}):
        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=ValueError("bad token")):
            req = {
                "job_id": "j",
                "session_id": "s",
                "room_name": "r",
                "photos": ["a.jpg"],
            }
            resp = client.post(
                "/api/v1/jobs/process",
                json=req,
                headers={"Authorization": "Bearer bogus"},
            )
            assert resp.status_code == 401


def test_process_job_oidc_wrong_invoker():
    with patch.dict(os.environ, {"EXPECTED_TASK_INVOKER": "tasks@example.iam.gserviceaccount.com"}):
        with patch(
            "google.oauth2.id_token.verify_oauth2_token",
            return_value={"email": "attacker@evil.com", "email_verified": True},
        ):
            req = {
                "job_id": "j",
                "session_id": "s",
                "room_name": "r",
                "photos": ["a.jpg"],
            }
            resp = client.post(
                "/api/v1/jobs/process",
                json=req,
                headers={"Authorization": "Bearer x"},
            )
            assert resp.status_code == 403


def test_process_job_oidc_accepts_expected_invoker():
    from backend.main import get_database
    db = get_database()
    db.save_job("job_oidc_ok", "session", "PENDING", "key_oidc_ok")

    with patch.dict(os.environ, {"EXPECTED_TASK_INVOKER": "tasks@example.iam.gserviceaccount.com"}):
        with patch(
            "google.oauth2.id_token.verify_oauth2_token",
            return_value={
                "email": "tasks@example.iam.gserviceaccount.com",
                "email_verified": True,
            },
        ):
            req = {
                "job_id": "job_oidc_ok",
                "session_id": "session",
                "room_name": "Room",
                "photos": ["a.jpg"],
            }
            resp = client.post(
                "/api/v1/jobs/process",
                json=req,
                headers={"Authorization": "Bearer x"},
            )
            assert resp.status_code == 200


def test_jobs_endpoints_filter_other_agency_data():
    from backend.main import get_database
    db = get_database()
    db.save_job(
        "job_default",
        "session_authz",
        "COMPLETED",
        "key_default",
        result={"blob_path": "a", "thumb_blob_path": "b", "original_blob_path": "c"},
        agency_id="default",
    )
    db.save_job(
        "job_other",
        "session_authz",
        "COMPLETED",
        "key_other",
        result={"blob_path": "x", "thumb_blob_path": "y", "original_blob_path": "z"},
        agency_id="other",
    )

    active = client.get("/api/v1/jobs/active?session_id=session_authz")
    assert active.status_code == 200
    ids = {j["id"] for j in active.json()["jobs"]}
    assert ids == {"job_default"}

    batch = client.post("/api/v1/jobs/batch-status", json={"job_ids": ["job_default", "job_other"]})
    assert batch.status_code == 200
    ids = {j["id"] for j in batch.json()["jobs"]}
    assert ids == {"job_default"}


def test_batch_signed_url_rejects_unowned_paths():
    req = {"blob_paths": ["style_profiles/default/ok", "style_profiles/other/nope"]}
    resp = client.post("/api/v1/jobs/batch-signed-url", json=req)
    assert resp.status_code == 200
    paths = [u["path"] for u in resp.json()["urls"]]
    assert paths == ["style_profiles/default/ok"]


def test_result_level_agency_fallback_is_honored_for_visibility_and_signing():
    from backend.main import get_database
    db = get_database()
    db.save_job(
        "job_result_agency",
        "session_result_agency",
        "COMPLETED",
        "key_result_agency",
        result={
            "agency_id": "default",
            "blob_path": "session_result_agency/hdr.jpg",
            "thumb_blob_path": "session_result_agency/thumb.webp",
            "original_blob_path": "session_result_agency/original.jpg",
        },
        agency_id=None,
    )

    active = client.get("/api/v1/jobs/active?session_id=session_result_agency")
    assert active.status_code == 200
    jobs = active.json()["jobs"]
    assert len(jobs) == 1
    assert jobs[0]["id"] == "job_result_agency"

    signed = client.post(
        "/api/v1/jobs/batch-signed-url",
        json={"blob_paths": ["session_result_agency/thumb.webp"]},
    )
    assert signed.status_code == 200
    assert signed.json()["urls"][0]["path"] == "session_result_agency/thumb.webp"


def test_batch_signed_url_handles_collisions_across_agencies():
    """Regression: two tenants having a job whose result.blob_path collides
    must not block the rightful owner from receiving a signed URL.

    Production hit this when job naming did not include agency_id and
    Firestore's `.limit(1)` returned a sibling tenant's document first."""
    from backend.main import get_database
    db = get_database()
    shared_blob = "shared-session/hdr_collision.jpg"
    shared_thumb = "shared-session/thumb_collision.webp"

    db.save_job(
        "job_collision_other",
        "shared-session",
        "COMPLETED",
        "key_collision_other",
        result={
            "blob_path": shared_blob,
            "thumb_blob_path": shared_thumb,
        },
        agency_id="agency_other",
    )
    db.save_job(
        "job_collision_default",
        "shared-session",
        "COMPLETED",
        "key_collision_default",
        result={
            "blob_path": shared_blob,
            "thumb_blob_path": shared_thumb,
        },
        agency_id="default",
    )

    resp = client.post(
        "/api/v1/jobs/batch-signed-url",
        json={"blob_paths": [shared_blob, shared_thumb]},
    )
    assert resp.status_code == 200
    paths = sorted(u["path"] for u in resp.json()["urls"])
    assert paths == sorted([shared_blob, shared_thumb])


def test_batch_signed_url_accepts_nested_result_agency_ownership():
    from backend.main import get_database
    db = get_database()
    db.save_job(
        "job_nested_agency",
        "sess_nested",
        "COMPLETED",
        "key_nested",
        result={
            "blob_path": "sess_nested/hdr_kitchen.jpg",
            "thumb_blob_path": "sess_nested/thumb_kitchen.webp",
            "original_blob_path": "sess_nested/raw_kitchen.jpg",
            "agency_id": "default",
        },
    )
    resp = client.post(
        "/api/v1/jobs/batch-signed-url",
        json={"blob_paths": ["sess_nested/thumb_kitchen.webp"]},
    )
    assert resp.status_code == 200
    urls = resp.json()["urls"]
    assert len(urls) == 1
    assert urls[0]["path"] == "sess_nested/thumb_kitchen.webp"
    assert "expires_at" in urls[0]


def test_validate_production_security_config_requires_expected_invoker():
    from backend.main import _validate_production_security_config
    with patch.dict(os.environ, {"APP_ENV": "production"}, clear=False):
        os.environ.pop("EXPECTED_TASK_INVOKER", None)
        with pytest.raises(RuntimeError):
            _validate_production_security_config()


def test_upload_style_image_rejects_oversized_file():
    with patch("backend.main.MAX_UPLOAD_BYTES", 8):
        with open("big.jpg", "wb") as f:
            f.write(b"0123456789")
        with open("big.jpg", "rb") as f:
            resp = client.post("/api/v1/style/upload", files={"file": ("big.jpg", f, "image/jpeg")})
        os.remove("big.jpg")
    assert resp.status_code == 413


def test_upload_training_pair_rejects_too_many_brackets():
    with patch("backend.main.MAX_TRAINING_BRACKETS", 1):
        with open("b1.jpg", "wb") as f:
            f.write(b"data1")
        with open("b2.jpg", "wb") as f:
            f.write(b"data2")
        with open("final.jpg", "wb") as f:
            f.write(b"final")
        with open("b1.jpg", "rb") as b1, open("b2.jpg", "rb") as b2, open("final.jpg", "rb") as final:
            resp = client.post(
                "/api/v1/training/upload",
                files=[
                    ("brackets", ("b1.jpg", b1, "image/jpeg")),
                    ("brackets", ("b2.jpg", b2, "image/jpeg")),
                    ("final_edit", ("final.jpg", final, "image/jpeg")),
                ],
            )
        os.remove("b1.jpg")
        os.remove("b2.jpg")
        os.remove("final.jpg")
    assert resp.status_code == 413


def test_process_job_oidc_missing_invoker_in_production():
    with patch.dict(os.environ, {"APP_ENV": "production"}, clear=False):
        os.environ.pop("EXPECTED_TASK_INVOKER", None)
        req = {
            "job_id": "j",
            "session_id": "s",
            "room_name": "r",
            "photos": ["a.jpg"],
        }
        resp = client.post("/api/v1/jobs/process", json=req, headers={"Authorization": "Bearer x"})
    assert resp.status_code == 500


def test_upload_style_image_rejects_oversized_dimensions():
    from backend.tests.fakes import FakeBlobStorage
    image_bytes = FakeBlobStorage().download_blobs("sess", ["seed.jpg"])[0]
    with patch("backend.main.MAX_IMAGE_DIMENSION", 1):
        resp = client.post(
            "/api/v1/style/upload",
            files={"file": ("tiny-limit.jpg", image_bytes, "image/jpeg")},
        )
    assert resp.status_code == 413


def test_upload_style_image_rejects_invalid_image():
    resp = client.post(
        "/api/v1/style/upload",
        files={"file": ("not-image.jpg", b"not-an-image", "image/jpeg")},
    )
    assert resp.status_code == 400
