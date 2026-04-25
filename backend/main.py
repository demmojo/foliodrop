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
    OverrideJobImageUseCase
)

logger = logging.getLogger(__name__)

app = FastAPI(title="Real Estate HDR Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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

class GroupPhotosRequest(BaseModel):
    files: List[dict]  # {"name": "...", "thumbnail": "base64..."}

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
import random
from backend.core.auth import get_current_agency_id
from backend.session_words import STYLES, RESIDENCES

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
        # Let's see what happens here, wait, originally the code was:
        # if db.check_session_code_availability(req.code):
        #     db.reserve_session_code(req.code)
        # return {"valid": True}
        # Wait, if it wasn't available, it STILL returned {"valid": True}!
        # Oh, if it wasn't available, it means someone else created it, so it's a valid existing code!
        pass
        
    if is_avail:
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

@app.post("/api/v1/jobs/process")
async def process_job_task(
    payload: CloudTaskPayload, 
    event_publisher: IEventPublisher = Depends(get_event_publisher),
    task_queue: ITaskQueue = Depends(get_task_queue),
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database)
):
    # Update status to PROCESSING
    job = db.get_job(payload.job_id)
    if job:
        db.save_job(payload.job_id, payload.session_id, "PROCESSING", job["idempotency_key"])

    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage, db)
    result = await use_case.execute(payload.agency_id, payload.job_id, payload.session_id, payload.room_name, payload.photos)
    
    # Note: DB is updated inside the execute method now to handle both COMPLETED and FAILED
    return result

@app.get("/api/v1/jobs/active")
def get_active_jobs(session_id: str, db: IDatabase = Depends(get_database), storage: IBlobStorage = Depends(get_blob_storage)):
    jobs = db.get_active_jobs(session_id)
    
    response_jobs = []
    for job in jobs:
        job_status = {
            "id": job["id"],
            "status": job["status"],
            "result": job.get("result"),
            "error": job.get("error")
        }
        
        # If completed, generate signed URLs
        if job["status"] == "COMPLETED" and "result" in job:
            if "blob_path" in job["result"]:
                job_status["result"]["url"] = storage.generate_signed_url(job["result"]["blob_path"])
            if "thumb_blob_path" in job["result"]:
                job_status["result"]["thumb_url"] = storage.generate_signed_url(job["result"]["thumb_blob_path"])
            if "original_blob_path" in job["result"]:
                job_status["result"]["original_url"] = storage.generate_signed_url(job["result"]["original_blob_path"])
                
        response_jobs.append(job_status)
        
    return {"jobs": response_jobs}

@app.post("/api/v1/jobs/batch-status")
def get_batch_status(req: BatchStatusRequest, db: IDatabase = Depends(get_database), storage: IBlobStorage = Depends(get_blob_storage)):
    jobs = db.get_jobs(req.job_ids)
    
    response_jobs = []
    for job in jobs:
        job_status = {
            "id": job["id"],
            "status": job["status"],
            "retryAfterSeconds": 10 if job["status"] in ["PENDING", "PROCESSING"] else None,
            "result": job.get("result"),
            "error": job.get("error")
        }
        
        # If completed, generate signed URLs
        if job["status"] == "COMPLETED" and "result" in job:
            if "blob_path" in job["result"]:
                job_status["result"]["url"] = storage.generate_signed_url(job["result"]["blob_path"])
            if "thumb_blob_path" in job["result"]:
                job_status["result"]["thumb_url"] = storage.generate_signed_url(job["result"]["thumb_blob_path"])
            if "original_blob_path" in job["result"]:
                job_status["result"]["original_url"] = storage.generate_signed_url(job["result"]["original_blob_path"])
                
        response_jobs.append(job_status)
        
    return JSONResponse(
        content={"jobs": response_jobs},
        headers={"Retry-After": "6"} # Global API rate limit hint
    )

@app.post("/api/v1/jobs/batch-signed-url")
def batch_signed_url(req: BatchSignedUrlRequest, storage: IBlobStorage = Depends(get_blob_storage)):
    urls = []
    for path in req.blob_paths:
        urls.append({
            "path": path,
            "url": storage.generate_signed_url(path)
        })
    return {"urls": urls}



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
    
    bracket_data = []
    for b in brackets:
        data = await b.read()
        bracket_data.append((b.filename, data, b.content_type))
        
    final_data = await final_edit.read()
    final_tuple = (final_edit.filename, final_data, final_edit.content_type)
    
    result = use_case.execute(agency_id, bracket_data, final_tuple)
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
    final_tuple = (file.filename, file_data, file.content_type)
    result = use_case.execute(agency_id, job_id, final_tuple)
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result
