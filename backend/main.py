import os
import uuid
import json
import logging
import asyncio
from typing import List, Optional, Dict
from fastapi import FastAPI, Depends, Body, Request, HTTPException, status, UploadFile, File, Header
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone

from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher
from backend.core.use_cases import (
    GenerateUploadUrlsUseCase, 
    FinalizeJobUseCase, 
    ProcessHdrGroupUseCase,
    UploadStyleImageUseCase,
    UploadTrainingPairUseCase,
    OverrideJobImageUseCase,
    TrainingPairConsistencyError,
)

logger = logging.getLogger(__name__)
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
MAX_TRAINING_BRACKETS = int(os.environ.get("MAX_TRAINING_BRACKETS", "9"))
MAX_IMAGE_DIMENSION = int(os.environ.get("MAX_IMAGE_DIMENSION", "12000"))


def _is_production_env() -> bool:
    env = (os.environ.get("APP_ENV") or os.environ.get("ENV") or "").lower()
    return env in {"prod", "production"}


def _validate_production_security_config() -> None:
    if _is_production_env() and not os.environ.get("EXPECTED_TASK_INVOKER"):
        raise RuntimeError("EXPECTED_TASK_INVOKER must be set in production")

app = FastAPI(title="Real Estate HDR Backend")
_validate_production_security_config()

# Auth flows pass the Firebase ID token via Authorization header (not cookies),
# so we do not need credentialed CORS. Allowing wildcard origins with
# allow_credentials=True is also rejected by browsers, so disable it explicitly.
_allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "*")
_allowed_origins = (
    [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]
    if _allowed_origins_env != "*"
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# Dependency Injection
# -----------------------------------------------------------------------------

def _log_debug(message: str, data: dict = None, hyp: str = "H1"):
    pass

def get_database() -> IDatabase:
    if os.environ.get("GCP_UPLOAD_BUCKET"):
        from backend.infrastructure.adapters import FirestoreAdapter
        if not hasattr(app.state, "db"):
            app.state.db = FirestoreAdapter()
        return app.state.db
    else:
        from backend.tests.fakes import FakeDatabase
        if not hasattr(app.state, "db"):
            app.state.db = FakeDatabase()
        return app.state.db

def get_blob_storage() -> IBlobStorage:
    bucket = os.environ.get("GCP_UPLOAD_BUCKET")
    if bucket:
        from backend.infrastructure.adapters import GCSBlobStorageAdapter
        return GCSBlobStorageAdapter(bucket)
    from backend.tests.fakes import FakeBlobStorage
    return FakeBlobStorage()

def get_task_queue() -> ITaskQueue:
    project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "development-resources-488110")
    region = os.environ.get("REGION", "us-central1")
    queue_name = os.environ.get("CLOUD_TASKS_QUEUE")
    if queue_name:
        from backend.infrastructure.adapters import CloudTasksAdapter
        return CloudTasksAdapter(project_id, region, queue_name)
    from backend.tests.fakes import FakeTaskQueue
    return FakeTaskQueue()

def get_event_publisher() -> IEventPublisher:
    from backend.tests.fakes import FakeEventPublisher
    return FakeEventPublisher()

# -----------------------------------------------------------------------------
# Request Models
# -----------------------------------------------------------------------------
class UploadUrlRequest(BaseModel):
    session_id: str
    files: List[str]

class FinalizeJobRequest(BaseModel):
    session_id: str
    idempotency_key: str
    files: Optional[List[dict]] = None
    groups: Optional[List[dict]] = None

class CloudTaskPayload(BaseModel):
    job_id: str
    session_id: str
    room_name: str
    photos: List[str]
    agency_id: str = "default"

class BatchStatusRequest(BaseModel):
    job_ids: List[str]

class BatchSignedUrlRequest(BaseModel):
    blob_paths: List[str]


class SignedUrlItem(BaseModel):
    path: str
    url: str
    expires_at: int


class SignedUrlBatchResponse(BaseModel):
    urls: List[SignedUrlItem]

class GroupPhotosRequest(BaseModel):
    files: List[dict]  # {"name": "...", "thumbnail": "base64..."}

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
import random
from backend.core.auth import get_current_agency_id
from backend.session_words import STYLES, RESIDENCES


def _resolve_job_agency(job: dict) -> Optional[str]:
    return job.get("agency_id") or (job.get("result") or {}).get("agency_id")


def _build_signed_url_payload(storage: IBlobStorage, blob_path: str, expiration_minutes: int = 60) -> dict:
    expires_at = int(datetime.now(timezone.utc).timestamp()) + (expiration_minutes * 60)
    return {
        "path": blob_path,
        "url": storage.generate_signed_url(blob_path, expiration_minutes=expiration_minutes),
        "expires_at": expires_at,
    }

def generate_random_code(fallback=False):
    style = random.choice(STYLES)
    residence = random.choice(RESIDENCES)
    word = f"{style}-{residence}"
    if fallback:
        num = random.randint(10, 999)
        return f"{word}-{num}"
    return word

@app.get("/api/v1/sessions/generate")
def generate_session(db: IDatabase = Depends(get_database)):
    attempts = 0
    # Try up to 20 times without numbers, then 10 times with numbers
    for fallback in [False] * 20 + [True] * 10:
        attempts += 1
        code = generate_random_code(fallback)
        is_avail = db.check_session_code_availability(code)

        if is_avail:
            db.reserve_session_code(code)
            return {"code": code}

    raise HTTPException(status_code=500, detail="Failed to generate room code")

class ValidateSessionRequest(BaseModel):
    code: str

@app.post("/api/v1/sessions/validate")
def validate_session(req: ValidateSessionRequest, db: IDatabase = Depends(get_database)):
    if len(req.code) < 3:
        sugg = generate_random_code()
        return {"valid": False, "message": "Code must be at least 3 letters", "suggested": sugg}
    
    is_avail = db.check_session_code_availability(req.code)
    if not is_avail:
        sugg = generate_random_code()
        return {"valid": False, "message": "Code is already in use", "suggested": sugg}

    db.reserve_session_code(req.code)
    return {"valid": True}

@app.post("/api/v1/group-photos")
async def group_photos_endpoint(req: GroupPhotosRequest):
    import base64
    from google import genai
    import os
    import json
    import asyncio
    
    api_key = os.getenv("GEMINI_API_KEY", "dummy-key")
    if api_key == "dummy-key":
        # Fallback to blind chunking if no API key
        return {"groups": [ [f["name"] for f in req.files[i:i+5]] for i in range(0, len(req.files), 5) ]}
        
    client = genai.Client(api_key=api_key)
    
    contents = [
        "You are an expert real estate photographer. I am providing you with low-resolution thumbnails of a bracketed HDR photo shoot. "
        "Your task is to group the photos into scenes. Photos of the exact same room taken from the exact same angle belong in the same scene. "
        "Photos that show different rooms or completely different angles are different scenes. "
        "Return a JSON array of arrays, where each inner array contains the exact filenames of the photos in that scene. "
        "Output ONLY valid JSON without markdown formatting. Example: [[\"IMG_1.jpg\", \"IMG_2.jpg\"], [\"IMG_3.jpg\"]]"
    ]
    
    for f in req.files:
        try:
            b64_data = f["thumbnail"].split(",")[1] if "," in f["thumbnail"] else f["thumbnail"]
            img_bytes = base64.b64decode(b64_data)
            contents.append(f"Filename: {f['name']}")
            contents.append({"mime_type": "image/jpeg", "data": img_bytes})
        except Exception as e:
            _log_debug("Failed to process thumbnail", {"file": f.get("name"), "error": str(e)}, hyp="H_GEMINI")
            
    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model='gemini-3.1-flash',
            contents=contents
        )
        
        # Clean up response text to extract JSON
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        groups = json.loads(text)
        if isinstance(groups, list) and all(isinstance(g, list) for g in groups):
            return {"groups": groups}
        else:
            raise ValueError("Response was not a list of lists")
            
    except Exception as e:
        _log_debug("Gemini grouping failed", {"error": str(e)}, hyp="H_GEMINI")
        # Fallback to blind chunking
        return {"groups": [ [f["name"] for f in req.files[i:i+5]] for i in range(0, len(req.files), 5) ]}

@app.post("/api/v1/upload-urls")
def generate_upload_urls(req: UploadUrlRequest, storage: IBlobStorage = Depends(get_blob_storage)):
    use_case = GenerateUploadUrlsUseCase(storage)
    urls = use_case.execute(req.session_id, req.files)
    _log_debug("generate_upload_urls returning", {"urls": urls}, hyp="H1")
    return {"urls": urls}

@app.get("/api/v1/quota")
def get_quota(
    db: IDatabase = Depends(get_database),
    agency_id: str = Depends(get_current_agency_id)
):
    return db.get_agency_quota(agency_id)

@app.post("/api/v1/finalize-job", status_code=status.HTTP_202_ACCEPTED)
def finalize_job(
    req: FinalizeJobRequest, 
    task_queue: ITaskQueue = Depends(get_task_queue),
    db: IDatabase = Depends(get_database),
    agency_id: str = Depends(get_current_agency_id)
):
    # Check idempotency key
    existing_job = db.get_job_by_idempotency_key(req.idempotency_key)
    if existing_job:
        return {"message": "Job already exists", "job_id": existing_job["id"]}

    use_case = FinalizeJobUseCase(task_queue, db)
    result = use_case.execute(agency_id, req.session_id, req.idempotency_key, files_data=req.files, groups_data=req.groups)
    
    if result.get("status") == "quota_exceeded":
        raise HTTPException(status_code=402, detail=result.get("message", "Monthly quota exceeded"))
        
    return result

def verify_cloud_tasks_oidc(request: Request, authorization: Optional[str] = Header(default=None)):
    """Validate the OIDC token Cloud Tasks attaches to /jobs/process.

    In production we deploy with `--allow-unauthenticated` so the public web app
    can hit `/api/v1/sessions/generate`, which means the platform layer does NOT
    enforce auth on `/jobs/process`. We verify the ID token in the application
    instead. When `EXPECTED_TASK_INVOKER` is unset we skip verification (local
    dev / tests / Cloud Run with --no-allow-unauthenticated).
    """
    expected_invoker = os.environ.get("EXPECTED_TASK_INVOKER")
    if not expected_invoker and not _is_production_env():
        return
    if not expected_invoker:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="EXPECTED_TASK_INVOKER missing")

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as ga_requests
        claims = id_token.verify_oauth2_token(token, ga_requests.Request())
    except Exception as e:
        logger.warning("OIDC verification failed: %s", e)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid OIDC token") from e

    if claims.get("email") != expected_invoker or not claims.get("email_verified", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Untrusted invoker")


async def _run_process_job_task(
    payload: CloudTaskPayload,
    event_publisher: IEventPublisher,
    task_queue: ITaskQueue,
    storage: IBlobStorage,
    db: IDatabase,
):
    """Core processing logic. Shared between the HTTP route and local fakes."""
    # Update status to PROCESSING
    job = db.get_job(payload.job_id)
    if job:
        db.save_job(payload.job_id, payload.session_id, "PROCESSING", job["idempotency_key"])

    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    return await use_case.execute(
        payload.agency_id,
        payload.job_id,
        payload.session_id,
        payload.room_name,
        payload.photos,
    )


@app.post("/api/v1/jobs/process")
async def process_job_task(
    payload: CloudTaskPayload,
    request: Request,
    authorization: Optional[str] = Header(default=None),
    event_publisher: IEventPublisher = Depends(get_event_publisher),
    task_queue: ITaskQueue = Depends(get_task_queue),
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database),
):
    verify_cloud_tasks_oidc(request, authorization)
    return await _run_process_job_task(payload, event_publisher, task_queue, storage, db)

@app.get("/api/v1/jobs/active")
def get_active_jobs(
    session_id: str,
    db: IDatabase = Depends(get_database),
    storage: IBlobStorage = Depends(get_blob_storage),
    agency_id: str = Depends(get_current_agency_id),
):
    jobs = db.get_active_jobs(session_id)
    
    response_jobs = []
    for job in jobs:
        job_agency = _resolve_job_agency(job)
        if job_agency != agency_id:
            continue
        job_status = {
            "id": job["id"],
            "status": job["status"],
            "result": job.get("result"),
            "error": job.get("error")
        }
        
        # If reviewable, generate signed URLs
        if job["status"] in {"COMPLETED", "FLAGGED"} and "result" in job:
            if "blob_path" in job["result"]:
                signed = _build_signed_url_payload(storage, job["result"]["blob_path"], expiration_minutes=60)
                job_status["result"]["url"] = signed["url"]
                job_status["result"]["url_expires_at"] = signed["expires_at"]
            if "thumb_blob_path" in job["result"]:
                signed = _build_signed_url_payload(storage, job["result"]["thumb_blob_path"], expiration_minutes=60)
                job_status["result"]["thumb_url"] = signed["url"]
                job_status["result"]["thumb_url_expires_at"] = signed["expires_at"]
            if "original_blob_path" in job["result"]:
                signed = _build_signed_url_payload(storage, job["result"]["original_blob_path"], expiration_minutes=60)
                job_status["result"]["original_url"] = signed["url"]
                job_status["result"]["original_url_expires_at"] = signed["expires_at"]
                
        response_jobs.append(job_status)
        
    return {"jobs": response_jobs}

@app.post("/api/v1/jobs/batch-status")
def get_batch_status(
    req: BatchStatusRequest,
    db: IDatabase = Depends(get_database),
    storage: IBlobStorage = Depends(get_blob_storage),
    agency_id: str = Depends(get_current_agency_id),
):
    jobs = db.get_jobs(req.job_ids)
    
    response_jobs = []
    for job in jobs:
        job_agency = _resolve_job_agency(job)
        if job_agency != agency_id:
            continue
        job_status = {
            "id": job["id"],
            "status": job["status"],
            "retryAfterSeconds": 10 if job["status"] in ["PENDING", "PROCESSING"] else None,
            "result": job.get("result"),
            "error": job.get("error")
        }
        
        # If reviewable, generate signed URLs
        if job["status"] in {"COMPLETED", "FLAGGED"} and "result" in job:
            if "blob_path" in job["result"]:
                signed = _build_signed_url_payload(storage, job["result"]["blob_path"], expiration_minutes=60)
                job_status["result"]["url"] = signed["url"]
                job_status["result"]["url_expires_at"] = signed["expires_at"]
            if "thumb_blob_path" in job["result"]:
                signed = _build_signed_url_payload(storage, job["result"]["thumb_blob_path"], expiration_minutes=60)
                job_status["result"]["thumb_url"] = signed["url"]
                job_status["result"]["thumb_url_expires_at"] = signed["expires_at"]
            if "original_blob_path" in job["result"]:
                signed = _build_signed_url_payload(storage, job["result"]["original_blob_path"], expiration_minutes=60)
                job_status["result"]["original_url"] = signed["url"]
                job_status["result"]["original_url_expires_at"] = signed["expires_at"]
                
        response_jobs.append(job_status)
        
    return JSONResponse(
        content={"jobs": response_jobs},
        headers={"Retry-After": "6"} # Global API rate limit hint
    )

@app.post("/api/v1/jobs/batch-signed-url")
def batch_signed_url(
    req: BatchSignedUrlRequest,
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database),
    agency_id: str = Depends(get_current_agency_id),
)-> SignedUrlBatchResponse:
    urls = []
    for path in req.blob_paths:
        if not db.is_blob_path_owned_by_agency(path, agency_id):
            continue
        urls.append(_build_signed_url_payload(storage, path, expiration_minutes=60))
    return SignedUrlBatchResponse(urls=[SignedUrlItem(**item) for item in urls])


def _validate_image_payload(file_name: str, file_data: bytes) -> None:
    if len(file_data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=f"{file_name} exceeds max upload size")

    try:
        from backend.core.image_decoding import decode_image
        img = decode_image(file_data)
        h, w = img.shape[:2]
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{file_name} is not a valid image") from e

    if h > MAX_IMAGE_DIMENSION or w > MAX_IMAGE_DIMENSION:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"{file_name} exceeds max dimensions {MAX_IMAGE_DIMENSION}x{MAX_IMAGE_DIMENSION}",
        )


@app.get("/api/v1/style/profiles")
def get_style_profiles(
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database),
    agency_id: str = Depends(get_current_agency_id)
):
    profiles = db.get_style_profiles(agency_id)
    for profile in profiles:
        profile["url"] = storage.generate_signed_url(profile["blob_path"], expiration_minutes=60)
    return {"profiles": profiles}

@app.delete("/api/v1/style/profiles/{profile_id}")
def delete_style_profile(
    profile_id: str,
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database),
    agency_id: str = Depends(get_current_agency_id)
):
    blob_path = db.delete_style_profile(agency_id, profile_id)
    if blob_path:
        storage.delete_blob(blob_path)
        return {"status": "success", "message": "Profile deleted"}
    raise HTTPException(status_code=404, detail="Profile not found")

@app.post("/api/v1/style/upload")
async def upload_style_image(
    file: UploadFile = File(...),
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database),
    agency_id: str = Depends(get_current_agency_id)
):
    use_case = UploadStyleImageUseCase(storage, db)
    file_data = await file.read()
    _validate_image_payload(file.filename, file_data)
    result = use_case.execute(agency_id, file.filename, file_data, file.content_type)
    return result

@app.post("/api/v1/training/upload")
async def upload_training_pair(
    brackets: List[UploadFile] = File(...),
    final_edit: UploadFile = File(...),
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database),
    agency_id: str = Depends(get_current_agency_id)
):
    use_case = UploadTrainingPairUseCase(storage, db)
    if len(brackets) > MAX_TRAINING_BRACKETS:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Too many bracket files (max {MAX_TRAINING_BRACKETS})",
        )
    
    bracket_data = []
    for b in brackets:
        data = await b.read()
        _validate_image_payload(b.filename, data)
        bracket_data.append((b.filename, data, b.content_type))
        
    final_data = await final_edit.read()
    _validate_image_payload(final_edit.filename, final_data)
    final_tuple = (final_edit.filename, final_data, final_edit.content_type)

    try:
        result = use_case.execute(agency_id, bracket_data, final_tuple)
    except TrainingPairConsistencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": str(exc), "report": exc.report},
        )
    return result

@app.post("/api/v1/jobs/{job_id}/override")
async def override_job_image(
    job_id: str,
    file: UploadFile = File(...),
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database),
    agency_id: str = Depends(get_current_agency_id)
):
    use_case = OverrideJobImageUseCase(storage, db)
    file_data = await file.read()
    _validate_image_payload(file.filename, file_data)
    final_tuple = (file.filename, file_data, file.content_type)
    result = use_case.execute(agency_id, job_id, final_tuple)
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result
