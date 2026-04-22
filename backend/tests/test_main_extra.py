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
    response = client.post("/api/v1/sessions/validate", json={"code": "short"})
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert "Code must be at least 6 letters" in data["message"]
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

def test_validate_session_valid_even_if_taken():
    db_mock = MagicMock()
    db_mock.check_session_code_availability.return_value = False

    from backend.main import get_database
    app.dependency_overrides[get_database] = lambda: db_mock
    response = client.post("/api/v1/sessions/validate", json={"code": "longenoughcode"})
    assert response.status_code == 200
    assert response.json()["valid"] is True
    app.dependency_overrides.clear()
