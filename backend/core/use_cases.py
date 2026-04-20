import gc
import ctypes
import asyncio
from typing import List, AsyncGenerator, Optional, Dict, Any
from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher, IProgressSubscriber

class GenerateUploadUrlsUseCase:
    def __init__(self, storage: IBlobStorage):
        self.storage = storage

    def execute(self, session_id: str, files: List[str]) -> List[dict]:
        return self.storage.generate_upload_urls(session_id, files)

class FinalizeJobUseCase:
    def __init__(self, task_queue: ITaskQueue):
        self.task_queue = task_queue

    def execute(self, session_id: str, rooms: List[str]) -> dict:
        for room in rooms:
            self.task_queue.enqueue_room_processing(session_id, room)
        return {"status": "enqueued", "tasks_count": len(rooms)}

class ProcessHdrGroupUseCase:
    def __init__(self, event_publisher: IEventPublisher, task_queue: ITaskQueue):
        self.event_publisher = event_publisher
        self.task_queue = task_queue

    async def execute(self, session_id: str, room: str, photos: Optional[List[Any]] = None) -> dict:
        # If there's only one photo in the room/batch, skip the HDR merge
        if photos is not None and len(photos) <= 1:
            await self.event_publisher.publish_progress(session_id, room, "SKIPPING_HDR_MERGE")
            
            # Still enqueue for perspective correction or finalization
            await self.event_publisher.publish_progress(session_id, room, "PENDING_CORRECTION")
            self.task_queue.enqueue_perspective_correction(session_id, room)
            await self.event_publisher.publish_progress(session_id, room, "COMPLETED")
            
            return {"status": "success", "room": room, "skipped_merge": True}

        try:
            await self.event_publisher.publish_progress(session_id, room, "ALIGNING")
            await asyncio.sleep(0.5)
            
            await self.event_publisher.publish_progress(session_id, room, "SEMANTIC_MASKING")
            await asyncio.sleep(0.5)
            
            await self.event_publisher.publish_progress(session_id, room, "FUSING")
            await asyncio.sleep(0.5)
            
            await self.event_publisher.publish_progress(session_id, room, "DENOISING")
            await asyncio.sleep(0.5)
            
            await self.event_publisher.publish_progress(session_id, room, "AI_REVIEW_AND_EDIT")
            await asyncio.sleep(0.5)
            
            # Domain logic would call vision.py functions here
            # e.g., await asyncio.to_thread(vision.ai_review_and_edit, image)
            
            await self.event_publisher.publish_progress(session_id, room, "PENDING_CORRECTION")
            self.task_queue.enqueue_perspective_correction(session_id, room)
            
            # Since perspective correction is mocked/not implemented, signal completion here to avoid hanging the UI
            await self.event_publisher.publish_progress(session_id, room, "COMPLETED")
            
            return {"status": "success", "room": room}
            
        except Exception as e:
            await self.event_publisher.publish_progress(session_id, room, "FAILED")
            return {"status": "error", "room": room, "message": str(e)}
        finally:
            # Schedule memory cleanup off the main event loop if possible,
            # or rely on normal Python GC to avoid freezing SSE streams.
            def _cleanup():
                gc.collect()
                try:
                    ctypes.CDLL('libc.so.6').malloc_trim(0)
                except Exception:
                    pass
            await asyncio.to_thread(_cleanup)

class StreamHDRProgressUseCase:
    def __init__(self, subscriber: IProgressSubscriber):
        self.subscriber = subscriber

    async def execute(self, session_id: str) -> AsyncGenerator[Optional[Dict[str, Any]], None]:
        channel = f"session:{session_id}"
        async for message in self.subscriber.subscribe(channel):
            yield message
            if message is not None:
                status = message.get("status")
                # We no longer break the stream on COMPLETED for individual rooms,
                # as there may be multiple rooms processing concurrently. The client will
                # close the SSE connection when it receives the expected number of completed rooms.
                if status in ("JOB_FINISHED", "FAILED", "CANCELLED"):
                    break
