import pytest
from fastapi.testclient import TestClient
from backend.main import app
from unittest.mock import patch, MagicMock

client = TestClient(app)

def test_generate_session():
    # Mock DB dependency
    from backend.infrastructure.adapters import IDatabase
    db_mock = MagicMock(spec=IDatabase)
    db_mock.check_session_code_availability.return_value = True
    db_mock.reserve_session_code.return_value = None
    
    app.dependency_overrides[IDatabase] = lambda: db_mock
    response = client.get("/api/v1/sessions/generate")
    assert response.status_code == 200
    assert "code" in response.json()
    app.dependency_overrides.clear()

def test_generate_session_fails():
    db_mock = MagicMock()
    db_mock.check_session_code_availability.return_value = False
    
    from backend.main import get_database
    app.dependency_overrides[get_database] = lambda: db_mock
    response = client.get("/api/v1/sessions/generate")
    assert response.status_code == 500
    app.dependency_overrides.clear()

def test_validate_session_short():
    response = client.post("/api/v1/sessions/validate", json={"code": "sh"})
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert "Code must be at least 3 letters" in data["message"]
    assert data["suggested"] is not None

def test_validate_session_valid():
    db_mock = MagicMock()
    db_mock.check_session_code_availability.return_value = True

    from backend.main import get_database
    app.dependency_overrides[get_database] = lambda: db_mock
    response = client.post("/api/v1/sessions/validate", json={"code": "longenoughcode"})
    assert response.status_code == 200
    assert response.json()["valid"] is True
    app.dependency_overrides.clear()

def test_validate_session_invalid_if_taken():
    db_mock = MagicMock()
    db_mock.check_session_code_availability.return_value = False

    from backend.main import get_database
    app.dependency_overrides[get_database] = lambda: db_mock
    response = client.post("/api/v1/sessions/validate", json={"code": "longenoughcode"})
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert data["message"] == "Code is already in use"
    assert data["suggested"] is not None
    app.dependency_overrides.clear()

def test_group_photos_dummy_key():
    response = client.post("/api/v1/group-photos", json={"files": [
        {"name": "file1.jpg", "thumbnail": "base64"},
        {"name": "file2.jpg", "thumbnail": "base64"}
    ]})
    assert response.status_code == 200
    assert response.json()["groups"] == [["file1.jpg", "file2.jpg"]]

def test_group_photos_real_key_success():
    import os
    with patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"}):
        with patch("google.genai.Client") as mock_client:
            # Need to mock the asyncio.to_thread call or mock generate_content inside it
            # asyncio.to_thread runs the sync function
            mock_model = MagicMock()
            mock_response = MagicMock()
            mock_response.text = '```json\n[["file1.jpg", "file2.jpg"]]\n```'
            mock_model.generate_content.return_value = mock_response
            mock_client.return_value.models = mock_model
            
            response = client.post("/api/v1/group-photos", json={"files": [
                {"name": "file1.jpg", "thumbnail": "base64data=="},
                {"name": "file2.jpg", "thumbnail": "data:image/jpeg;base64,base64data=="}
            ]})
            assert response.status_code == 200
            assert response.json()["groups"] == [["file1.jpg", "file2.jpg"]]

def test_group_photos_real_key_malformed_thumbnail_still_runs():
    import os
    with patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"}):
        with patch("google.genai.Client") as mock_client:
            inst = MagicMock()
            inst.models.generate_content = MagicMock(
                return_value=MagicMock(text='[["a.jpg", "b.jpg"]]')
            )
            mock_client.return_value = inst
            response = client.post(
                "/api/v1/group-photos",
                json={"files": [
                    {"name": "bad.jpg", "thumbnail": "~~~not-base64~~~"},
                    {"name": "b.jpg", "thumbnail": "dGVzdA=="},
                ]},
            )
    assert response.status_code == 200
    assert response.json()["groups"] == [["a.jpg", "b.jpg"]]


def test_group_photos_response_strips_markdown_fences():
    import os
    with patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"}):
        with patch("google.genai.Client") as mock_client:
            inst = MagicMock()
            inst.models.generate_content = MagicMock(
                return_value=MagicMock(text='```\n[["x.jpg", "y.jpg"]]\n```')
            )
            mock_client.return_value = inst
            response = client.post(
                "/api/v1/group-photos",
                json={"files": [
                    {"name": "x.jpg", "thumbnail": "dGVzdA=="},
                    {"name": "y.jpg", "thumbnail": "dGVzdA=="},
                ]},
            )
    assert response.status_code == 200
    assert response.json()["groups"] == [["x.jpg", "y.jpg"]]


def test_group_photos_real_key_invalid_json_shape_falls_back():
    import os
    with patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"}):
        with patch("google.genai.Client") as mock_client:
            inst = MagicMock()
            inst.models.generate_content = MagicMock(
                return_value=MagicMock(text='["a.jpg", "b.jpg"]')
            )
            mock_client.return_value = inst
            response = client.post(
                "/api/v1/group-photos",
                json={"files": [
                    {"name": "a.jpg", "thumbnail": "dGVzdA=="},
                    {"name": "b.jpg", "thumbnail": "dGVzdA=="},
                ]},
            )
    assert response.status_code == 200
    assert response.json()["groups"] == [["a.jpg", "b.jpg"]]


def test_group_photos_real_key_error():
    import os
    with patch.dict(os.environ, {"GEMINI_API_KEY": "real-key"}):
        with patch("google.genai.Client") as mock_client:
            mock_model = MagicMock()
            mock_model.generate_content.side_effect = Exception("failed")
            mock_client.return_value.models = mock_model
            
            response = client.post("/api/v1/group-photos", json={"files": [
                {"name": "file1.jpg", "thumbnail": "base64data=="},
                {"name": "file2.jpg", "thumbnail": "base64data=="}
            ]})
            assert response.status_code == 200
            assert response.json()["groups"] == [["file1.jpg", "file2.jpg"]]
