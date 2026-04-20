from typing import List, Dict, Any, AsyncGenerator, Optional
import asyncio
from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher, IProgressSubscriber

class InMemoryDatabase(IDatabase):
    def __init__(self):
        self.sessions = {}

    def create_session(self, session_id: str) -> None:
        self.sessions[session_id] = {"created_at": "now", "processed_rooms": 0}

    def update_session(self, session_id: str, data: Dict[str, Any]) -> None:
        if session_id in self.sessions:
            self.sessions[session_id].update(data)

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self.sessions.get(session_id)

class InMemoryBlobStorage(IBlobStorage):
    def generate_upload_urls(self, session_id: str, files: List[str]) -> List[dict]:
        return [{"file": f, "url": f"http://fake-storage/{session_id}/{f}", "path": f"{session_id}/{f}"} for f in files]

class InMemoryTaskQueue(ITaskQueue):
    def __init__(self):
        self.tasks = []

    def enqueue_room_processing(self, session_id: str, room: str) -> None:
        self.tasks.append({"type": "process_room", "session_id": session_id, "room": room})

    def enqueue_perspective_correction(self, session_id: str, room: str) -> None:
        self.tasks.append({"type": "perspective_correction", "session_id": session_id, "room": room})

class InMemoryPubSub(IEventPublisher, IProgressSubscriber):
    def __init__(self):
        self.events = []

    async def publish_progress(self, session_id: str, room: str, status: str) -> None:
        self.events.append({"session_id": session_id, "room": room, "status": status})

    async def subscribe(self, channel: str) -> AsyncGenerator[Optional[Dict[str, Any]], None]:
        # Yield the events generated for testing purposes
        for event in self.events:
            yield event
            await asyncio.sleep(0)

