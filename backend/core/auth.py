import os
import re
import logging
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)

# agency_id ends up in GCS object paths and Firestore document IDs. Restrict it
# to a safe character set so a spoofed `x-agency-id` header cannot inject path
# segments (`..`, `/`) or other shenanigans.
_AGENCY_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _sanitize_agency_id(value: str) -> str:
    if value and _AGENCY_ID_PATTERN.match(value):
        return value
    return "default"


def _init_firebase():
    if not firebase_admin._apps:
        # If in GCP (Cloud Run), default credentials will be used automatically.
        # For local dev, GOOGLE_APPLICATION_CREDENTIALS must be set.
        firebase_admin.initialize_app()


def _is_production() -> bool:
    env = (os.environ.get("APP_ENV") or os.environ.get("ENV") or "").lower()
    return env in {"prod", "production"}


def get_current_agency_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    x_agency_id: str = Header(default="default"),
) -> str:
    """Resolve the calling agency.

    In production, a valid Firebase token is required and header fallback is
    disabled. In non-production environments we allow `x-agency-id` fallback to
    support local workflows without Firebase.
    """
    if credentials:
        try:
            _init_firebase()
            token = credentials.credentials
            decoded_token = firebase_auth.verify_id_token(token)
            uid = decoded_token.get("uid")
            if uid:
                return _sanitize_agency_id(uid)
        except Exception as e:
            logger.warning("Firebase auth error: %s", e)
            if _is_production():
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication token",
                ) from e

    if _is_production():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
        )
    return _sanitize_agency_id(x_agency_id)
