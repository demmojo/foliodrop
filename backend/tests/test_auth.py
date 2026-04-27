import pytest
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from backend.core.auth import get_current_agency_id, _init_firebase

def test_init_firebase():
    with patch("backend.core.auth.firebase_admin") as mock_admin:
        mock_admin._apps = {}
        _init_firebase()
        mock_admin.initialize_app.assert_called_once()
        
        mock_admin.initialize_app.reset_mock()
        mock_admin._apps = {"app": 1}
        _init_firebase()
        mock_admin.initialize_app.assert_not_called()

def test_get_current_agency_id_no_creds():
    assert get_current_agency_id(credentials=None, x_agency_id="my-agency") == "my-agency"

@patch("backend.core.auth._init_firebase")
@patch("backend.core.auth.firebase_auth.verify_id_token")
def test_get_current_agency_id_valid_token(mock_verify, mock_init):
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid_token")
    mock_verify.return_value = {"uid": "user123"}
    assert get_current_agency_id(credentials=creds, x_agency_id="default") == "user123"

@patch("backend.core.auth._init_firebase")
@patch("backend.core.auth.firebase_auth.verify_id_token")
def test_get_current_agency_id_invalid_token(mock_verify, mock_init):
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="invalid_token")
    mock_verify.side_effect = Exception("expired")
    assert get_current_agency_id(credentials=creds, x_agency_id="fallback-agency") == "fallback-agency"

@patch("backend.core.auth._init_firebase")
@patch("backend.core.auth.firebase_auth.verify_id_token")
def test_get_current_agency_id_no_uid(mock_verify, mock_init):
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid_token")
    mock_verify.return_value = {}
    assert get_current_agency_id(credentials=creds, x_agency_id="fallback") == "fallback"


def test_get_current_agency_id_rejects_path_traversal_header():
    # `..` and `/` in the header must not slip through into GCS paths.
    assert get_current_agency_id(credentials=None, x_agency_id="../evil") == "default"
    assert get_current_agency_id(credentials=None, x_agency_id="a/b/c") == "default"


def test_get_current_agency_id_accepts_safe_header():
    assert get_current_agency_id(credentials=None, x_agency_id="agency_42") == "agency_42"


@patch("backend.core.auth._init_firebase")
@patch("backend.core.auth.firebase_auth.verify_id_token")
def test_get_current_agency_id_sanitizes_uid(mock_verify, mock_init):
    # Belt-and-braces: even if a malformed UID somehow ended up in a token,
    # we should not interpolate it into storage paths.
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="valid_token")
    mock_verify.return_value = {"uid": "../escape"}
    assert get_current_agency_id(credentials=creds, x_agency_id="other") == "default"


def test_get_current_agency_id_requires_token_in_production():
    with patch.dict("os.environ", {"APP_ENV": "production"}, clear=False):
        with pytest.raises(HTTPException) as exc:
            get_current_agency_id(credentials=None, x_agency_id="agency_42")
        assert exc.value.status_code == 401


@patch("backend.core.auth._init_firebase")
@patch("backend.core.auth.firebase_auth.verify_id_token")
def test_get_current_agency_id_rejects_invalid_token_in_production(mock_verify, mock_init):
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="invalid_token")
    mock_verify.side_effect = Exception("expired")
    with patch.dict("os.environ", {"APP_ENV": "production"}, clear=False):
        with pytest.raises(HTTPException) as exc:
            get_current_agency_id(credentials=creds, x_agency_id="fallback-agency")
        assert exc.value.status_code == 401
