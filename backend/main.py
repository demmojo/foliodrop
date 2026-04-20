import os
import uuid
import json
import logging
import asyncio
from typing import List, AsyncGenerator
from fastapi import FastAPI, Depends, Body, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone

from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher, IProgressSubscriber
from backend.core.use_cases import (
    GenerateUploadUrlsUseCase, 
    FinalizeJobUseCase, 
    ProcessHdrGroupUseCase, 
    StreamHDRProgressUseCase
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
# Global Instances (for lifecycle management)
# -----------------------------------------------------------------------------
event_bus = None

@app.on_event("startup")
async def startup_event():
    global event_bus
    redis_url = os.getenv("REDIS_URL", "")
    
    if redis_url and redis_url != "memory://":
        from backend.infrastructure.adapters import RedisPubSubAdapter
        try:
            adapter = RedisPubSubAdapter(redis_url)
            await adapter.connect()
            event_bus = adapter
            logger.info("Using Redis for Pub/Sub")
            return
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}. Falling back to InMemoryPubSub.")
    
    from backend.tests.fakes import InMemoryPubSub
    event_bus = InMemoryPubSub()
    logger.info("Using InMemoryPubSub")

@app.on_event("shutdown")
async def shutdown_event():
    global event_bus
    if hasattr(event_bus, "close") and callable(event_bus.close):
        await event_bus.close()

# -----------------------------------------------------------------------------
# Dependency Injection
# -----------------------------------------------------------------------------
def get_database() -> IDatabase:
    if os.getenv("TESTING") == "true":
        from backend.tests.fakes import InMemoryDatabase
        return InMemoryDatabase()
    from backend.infrastructure.adapters import FirestoreAdapter
    return FirestoreAdapter()

def get_blob_storage() -> IBlobStorage:
    if os.getenv("TESTING") == "true":
        from backend.tests.fakes import InMemoryBlobStorage
        return InMemoryBlobStorage()
    from backend.infrastructure.adapters import GCSBlobStorageAdapter
    bucket_name = os.getenv("GCP_UPLOAD_BUCKET", "real-estate-hdr-bucket")
    return GCSBlobStorageAdapter(bucket_name=bucket_name)

def get_task_queue() -> ITaskQueue:
    if os.getenv("TESTING") == "true":
        from backend.tests.fakes import InMemoryTaskQueue
        return InMemoryTaskQueue()
    from backend.infrastructure.adapters import CloudTasksAdapter
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "developer-resources")
    region = os.getenv("REGION", "us-central1")
    queue_name = os.getenv("CLOUD_TASKS_QUEUE", "hdr-queue")
    return CloudTasksAdapter(project_id, region, queue_name)

def get_event_publisher() -> IEventPublisher:
    global event_bus
    return event_bus

def get_progress_subscriber() -> IProgressSubscriber:
    global event_bus
    return event_bus

# -----------------------------------------------------------------------------
# Use Case Factories
# -----------------------------------------------------------------------------
def get_generate_upload_urls_use_case(storage: IBlobStorage = Depends(get_blob_storage)) -> GenerateUploadUrlsUseCase:
    return GenerateUploadUrlsUseCase(storage=storage)

def get_finalize_job_use_case(task_queue: ITaskQueue = Depends(get_task_queue)) -> FinalizeJobUseCase:
    return FinalizeJobUseCase(task_queue=task_queue)

def get_process_hdr_use_case(
    event_publisher: IEventPublisher = Depends(get_event_publisher),
    task_queue: ITaskQueue = Depends(get_task_queue)
) -> ProcessHdrGroupUseCase:
    return ProcessHdrGroupUseCase(event_publisher=event_publisher, task_queue=task_queue)

def get_stream_use_case(
    subscriber: IProgressSubscriber = Depends(get_progress_subscriber)
) -> StreamHDRProgressUseCase:
    return StreamHDRProgressUseCase(subscriber=subscriber)

# -----------------------------------------------------------------------------
# API Models
# -----------------------------------------------------------------------------
class GenerateUrlsRequest(BaseModel):
    files: List[str]

class FinalizeJobRequest(BaseModel):
    rooms: List[str]

# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------
@app.get("/")
def health_check():
    return {"status": "ok"}

@app.post("/api/session")
def create_session(db: IDatabase = Depends(get_database)):
    session_id = str(uuid.uuid4())
    db.create_session(session_id)
    return {"session_id": session_id}

@app.get("/api/session/{session_id}")
def get_session(session_id: str, db: IDatabase = Depends(get_database)):
    session_data = db.get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Extend session TTL on fetch (rolling TTL)
    new_expiry = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
    db.update_session(session_id, {"expires_at": new_expiry})
    session_data["expires_at"] = new_expiry

    return session_data

@app.post("/api/session/{session_id}/extend")
def extend_session(session_id: str, db: IDatabase = Depends(get_database)):
    session_data = db.get_session(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Calculate new expiry: 48 hours from current UTC time
    new_expiry = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
    
    # Update the session in the database
    db.update_session(session_id, {"expires_at": new_expiry})
    
    return {"status": "extended", "expires_at": new_expiry}

@app.post("/api/upload-urls")
def generate_upload_urls(
    request: GenerateUrlsRequest, 
    session_id: str = "demo-session",
    use_case: GenerateUploadUrlsUseCase = Depends(get_generate_upload_urls_use_case)
):
    urls = use_case.execute(session_id, request.files)
    return {"urls": urls}

@app.post("/api/jobs/{session_id}/finalize")
def finalize_job(
    session_id: str, 
    request: FinalizeJobRequest,
    use_case: FinalizeJobUseCase = Depends(get_finalize_job_use_case)
):
    result = use_case.execute(session_id, request.rooms)
    return result

@app.post("/api/process-room")
async def process_room(
    payload: dict = Body(...),
    use_case: ProcessHdrGroupUseCase = Depends(get_process_hdr_use_case)
):
    session_id = payload.get("session_id")
    room = payload.get("room")
    photos = payload.get("photos", None)
    result = await use_case.execute(session_id, room, photos)
    return result

@app.post("/api/perspective-correction")
def perspective_correction(payload: dict = Body(...)):
    # Run hugin-tools as a subprocess
    pass

@app.get("/api/v1/hdr-jobs/{job_id}/progress")
async def stream_hdr_progress(
    job_id: str, 
    request: Request, 
    use_case: StreamHDRProgressUseCase = Depends(get_stream_use_case)
):
    async def sse_generator():
        try:
            async for message in use_case.execute(job_id):
                if await request.is_disconnected():
                    logger.info(f"Client disconnected during HDR job {job_id}. Dropping connection.")
                    break
                
                if message is None:
                    yield ": heartbeat\n\n"
                    continue
                
                sse_payload = json.dumps(message)
                yield f"data: {sse_payload}\n\n"

                if message.get("status") in ("COMPLETED", "FAILED", "CANCELLED"):
                    yield f"event: close\ndata: {message.get('status')}\n\n"
                    break
                    
        except asyncio.CancelledError:
            logger.info(f"SSE request cancelled for HDR job {job_id}")
            raise

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no" 
        }
    )
