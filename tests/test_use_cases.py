import pytest
import asyncio
from backend.core.use_cases import GenerateUploadUrlsUseCase, FinalizeJobUseCase, ProcessHdrGroupUseCase, StreamHDRProgressUseCase
from backend.tests.fakes import InMemoryBlobStorage, InMemoryTaskQueue, InMemoryPubSub

def test_generate_upload_urls_use_case():
    storage = InMemoryBlobStorage()
    use_case = GenerateUploadUrlsUseCase(storage)
    
    files = ["ev-2.jpg", "ev-1.jpg", "ev0.jpg", "ev+1.jpg", "ev+2.jpg"]
    session_id = "test-session"
    
    urls = use_case.execute(session_id, files)
    
    assert len(urls) == 5
    assert urls[0]["path"] == "test-session/ev-2.jpg"
    assert urls[0]["url"] == "http://fake-storage/test-session/ev-2.jpg"

def test_finalize_job_use_case():
    task_queue = InMemoryTaskQueue()
    use_case = FinalizeJobUseCase(task_queue)
    
    session_id = "test-session"
    rooms = ["kitchen", "living_room"]
    
    result = use_case.execute(session_id, rooms)
    
    assert result["status"] == "enqueued"
    assert result["tasks_count"] == 2
    assert len(task_queue.tasks) == 2
    assert task_queue.tasks[0]["room"] == "kitchen"
    assert task_queue.tasks[1]["room"] == "living_room"

@pytest.mark.asyncio
async def test_process_hdr_group_use_case():
    event_publisher = InMemoryPubSub()
    task_queue = InMemoryTaskQueue()
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue)
    
    session_id = "test-session"
    room = "kitchen"
    
    # Passing no photos should proceed with alignment
    result = await use_case.execute(session_id, room)

    assert result["status"] == "success"
    assert result["room"] == "kitchen"

    assert len(event_publisher.events) == 6
    assert event_publisher.events[0]["status"] == "ALIGNING"
    assert event_publisher.events[-1]["status"] == "PENDING_CORRECTION"
    
    assert len(task_queue.tasks) == 1
    assert task_queue.tasks[0]["type"] == "perspective_correction"

@pytest.mark.asyncio
async def test_process_hdr_group_skip_merge_use_case():
    event_publisher = InMemoryPubSub()
    task_queue = InMemoryTaskQueue()
    use_case = ProcessHdrGroupUseCase(event_publisher, task_queue)
    
    session_id = "test-session"
    room = "single-photo-room"
    
    # Passing exactly 1 photo should skip HDR merge
    result = await use_case.execute(session_id, room, photos=["ev0.jpg"])
    
    assert result["status"] == "success"
    assert result.get("skipped_merge") is True
    assert result["room"] == "single-photo-room"
    
    assert len(event_publisher.events) == 2
    assert event_publisher.events[0]["status"] == "SKIPPING_HDR_MERGE"
    assert event_publisher.events[1]["status"] == "PENDING_CORRECTION"
    
    assert len(task_queue.tasks) == 1
    assert task_queue.tasks[0]["type"] == "perspective_correction"

@pytest.mark.asyncio
async def test_stream_progress_use_case():
    subscriber = InMemoryPubSub()
    await subscriber.publish_progress("test", "room1", "ALIGNING")
    await subscriber.publish_progress("test", "room1", "COMPLETED")
    
    use_case = StreamHDRProgressUseCase(subscriber)
    events = []
    async for event in use_case.execute("test"):
        events.append(event)
        
    assert len(events) == 2
    assert events[0]["status"] == "ALIGNING"
    assert events[1]["status"] == "COMPLETED"
