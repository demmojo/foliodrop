import pytest
from fastapi.testclient import TestClient
from backend.main import (
    app, 
    get_database, get_blob_storage, get_task_queue, get_event_publisher, get_progress_subscriber
)
from backend.tests.fakes import (
    InMemoryDatabase, InMemoryBlobStorage, InMemoryTaskQueue, InMemoryPubSub
)

@pytest.fixture
def fake_db():
    return InMemoryDatabase()

@pytest.fixture
def fake_storage():
    return InMemoryBlobStorage()

@pytest.fixture
def fake_queue():
    return InMemoryTaskQueue()

@pytest.fixture
def fake_pubsub():
    return InMemoryPubSub()

@pytest.fixture
def client(fake_db, fake_storage, fake_queue, fake_pubsub):
    app.dependency_overrides[get_database] = lambda: fake_db
    app.dependency_overrides[get_blob_storage] = lambda: fake_storage
    app.dependency_overrides[get_task_queue] = lambda: fake_queue
    app.dependency_overrides[get_event_publisher] = lambda: fake_pubsub
    app.dependency_overrides[get_progress_subscriber] = lambda: fake_pubsub
    
    with TestClient(app) as client:
        yield client
        
    app.dependency_overrides.clear()

def test_health_check(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_create_session(client, fake_db):
    response = client.post("/api/session")
    assert response.status_code == 200
    session_id = response.json()["session_id"]
    assert session_id in fake_db.sessions

def test_generate_upload_urls(client):
    response = client.post(
        "/api/upload-urls?session_id=test", 
        json={"files": ["file1.jpg", "file2.jpg"]}
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["urls"]) == 2
    assert data["urls"][0]["path"] == "test/file1.jpg"

def test_finalize_job(client, fake_queue):
    response = client.post(
        "/api/jobs/test-session/finalize",
        json={"rooms": ["kitchen", "living_room"]}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "enqueued"
    assert len(fake_queue.tasks) == 2

def test_process_room(client, fake_pubsub, fake_queue):
    response = client.post(
        "/api/process-room",
        json={"session_id": "test-session", "room": "kitchen"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    
    assert len(fake_pubsub.events) > 0
    assert len(fake_queue.tasks) > 0

def test_stream_hdr_progress(client, fake_pubsub):
    # Just checking it returns 200 and has correct media type
    response = client.get("/api/v1/hdr-jobs/test/progress")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

def test_session_rejoin_and_extend(client, fake_db):
    response = client.post("/api/session")
    session_id = response.json()["session_id"]
    
    get_res = client.get(f"/api/session/{session_id}")
    assert get_res.status_code == 200
    assert "expires_at" in get_res.json()
    
    extend_res = client.post(f"/api/session/{session_id}/extend")
    assert extend_res.status_code == 200
    assert "expires_at" in extend_res.json()
    assert extend_res.json()["status"] == "extended"

def test_get_nonexistent_session(client):
    res = client.get("/api/session/does-not-exist")
    assert res.status_code == 404
