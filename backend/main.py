import os
import uuid
import json
import logging
import asyncio
from typing import List, Optional
from fastapi import FastAPI, Depends, Body, Request, HTTPException
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
def get_database() -> IDatabase:
    from backend.tests.fakes import FakeDatabase
    return FakeDatabase()

def get_blob_storage() -> IBlobStorage:
    from backend.tests.fakes import FakeBlobStorage
    return FakeBlobStorage()

def get_task_queue() -> ITaskQueue:
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
    files: List[dict]

class CloudTaskPayload(BaseModel):
    session_id: str
    room_name: str
    photos: List[str]

# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------
@app.post("/api/v1/upload-urls")
def generate_upload_urls(req: UploadUrlRequest, storage: IBlobStorage = Depends(get_blob_storage)):
    use_case = GenerateUploadUrlsUseCase(storage)
    urls = use_case.execute(req.session_id, req.files)
    return {"urls": urls}

@app.post("/api/v1/finalize-job")
def finalize_job(req: FinalizeJobRequest, task_queue: ITaskQueue = Depends(get_task_queue)):
    use_case = FinalizeJobUseCase(task_queue)
    result = use_case.execute(req.session_id, req.files)
    return result

@app.post("/tasks/process-room")
async def process_room_task(
    payload: CloudTaskPayload, 
    event_publisher: IEventPublisher = Depends(get_event_publisher),
    task_queue: ITaskQueue = Depends(get_task_queue),
    storage: IBlobStorage = Depends(get_blob_storage),
    db: IDatabase = Depends(get_database)
):
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue, storage)
    result = await use_case.execute(payload.session_id, payload.room_name, payload.photos)
    
    # Store outcome in the DB so the frontend polling endpoint can read it
    db.save_processing_result(payload.session_id, result)
    return result

@app.get("/api/v1/hdr-jobs/{session_id}/status")
def get_job_status(session_id: str, db: IDatabase = Depends(get_database)):
    results = db.get_processing_results(session_id)
    # The frontend uses this to count how many rooms are READY/FLAGGED
    return {"status": "POLLING", "results": results}

