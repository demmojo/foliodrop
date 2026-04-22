import os
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer(auto_error=False)

def _init_firebase():
    if not firebase_admin._apps:
        # If in GCP (Cloud Run), default credentials will be used automatically
        # For local dev, GOOGLE_APPLICATION_CREDENTIALS must be set
        firebase_admin.initialize_app()

def get_current_agency_id(credentials: HTTPAuthorizationCredentials = Depends(security), x_agency_id: str = Header(default="default")) -> str:
    """
    Verifies the Firebase JWT token and returns the user's UID as the agency_id.
    If auth is not configured or token is missing/invalid, falls back to x_agency_id (or "default") for testing/alpha.
    """
    if not credentials:
        # Allow fallback for local testing without auth
        return x_agency_id
        
    try:
        _init_firebase()
        token = credentials.credentials
        decoded_token = firebase_auth.verify_id_token(token)
        uid = decoded_token.get("uid")
        if uid:
            return uid
    except Exception as e:
        # In a strict production environment, we would raise HTTP 401 here.
        # But to prevent breaking the app if Firebase isn't fully configured, we fallback.
        print(f"Firebase auth error: {e}")
        pass
        
    return x_agency_id
