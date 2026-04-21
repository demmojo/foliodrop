import os
import uuid
import json
import logging
import asyncio
from typing import List, Optional, Dict
from fastapi import FastAPI, Depends, Body, Request, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone

from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher
from backend.core.use_cases import (
    GenerateUploadUrlsUseCase, 
    FinalizeJobUseCase, 
    ProcessHdrGroupUseCase
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
# #region agent log
import json, time
def _log_debug(message: str, data: dict = None, hyp: str = "H1"):
    try:
        payload = {
            "sessionId": "769fb2",
            "hypothesisId": hyp,
            "location": "backend/main.py",
            "message": message,
            "data": data or {},
            "timestamp": int(time.time() * 1000)
        }
        with open("/home/demmojo/real-estate-hdr/.cursor/debug-769fb2.log", "a") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        pass
# #endregion

def get_database() -> IDatabase:
    _log_debug("get_database invoked", hyp="H3")
    from backend.tests.fakes import FakeDatabase
    # In a real app, use a singleton or app state for fake DB to persist across requests
    if not hasattr(app.state, "db"):
        app.state.db = FakeDatabase()
    return app.state.db

def get_blob_storage() -> IBlobStorage:
    _log_debug("get_blob_storage invoked", hyp="H1")
    from backend.tests.fakes import FakeBlobStorage
    return FakeBlobStorage()

def get_task_queue() -> ITaskQueue:
    _log_debug("get_task_queue invoked", hyp="H2")
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
    files: List[dict]

class CloudTaskPayload(BaseModel):
    job_id: str
    session_id: str
    room_name: str
    photos: List[str]

class BatchStatusRequest(BaseModel):
    job_ids: List[str]

class BatchSignedUrlRequest(BaseModel):
    blob_paths: List[str]

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
@app.post("/api/v1/upload-urls")
def generate_upload_urls(req: UploadUrlRequest, storage: IBlobStorage = Depends(get_blob_storage)):
    use_case = GenerateUploadUrlsUseCase(storage)
    urls = use_case.execute(req.session_id, req.files)
    _log_debug("generate_upload_urls returning", {"urls": urls}, hyp="H1")
    return {"urls": urls}

@app.get("/api/v1/quota")
def get_quota(db: IDatabase = Depends(get_database)):
    return db.get_agency_quota("default")

@app.post("/api/v1/finalize-job", status_code=status.HTTP_202_ACCEPTED)
def finalize_job(
    req: FinalizeJobRequest, 
    task_queue: ITaskQueue = Depends(get_task_queue),
    db: IDatabase = Depends(get_database)
):
    # Check idempotency key
    existing_job = db.get_job_by_idempotency_key(req.idempotency_key)
    if existing_job:
        return {"message": "Job already exists", "job_id": existing_job["id"]}

    use_case = FinalizeJobUseCase(task_queue, db)
    result = use_case.execute(req.session_id, req.idempotency_key, req.files)
    
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
    result = await use_case.execute(payload.job_id, payload.session_id, payload.room_name, payload.photos)
    
    # Note: DB is updated inside the execute method now to handle both COMPLETED and FAILED
    return result

@app.get("/api/v1/jobs/active")
def get_active_jobs(session_id: str, db: IDatabase = Depends(get_database)):
    jobs = db.get_active_jobs(session_id)
    return {"jobs": jobs}

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

