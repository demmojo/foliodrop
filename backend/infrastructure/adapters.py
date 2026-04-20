import json
import logging
import asyncio
import os
import re
import datetime
from typing import List, Dict, Any, AsyncGenerator, Optional
from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher, IProgressSubscriber
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud import storage, tasks_v2
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

class FirestoreAdapter(IDatabase):
    def __init__(self):
        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        self.db = firestore.client()

    def create_session(self, session_id: str) -> None:
        self.db.collection("sessions").document(session_id).set({
            "created_at": firestore.SERVER_TIMESTAMP,
            "processed_rooms": 0
        })

    def update_session(self, session_id: str, data: Dict[str, Any]) -> None:
        self.db.collection("sessions").document(session_id).update(data)

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.collection("sessions").document(session_id).get()
        if doc.exists:
            return doc.to_dict()
        return None

class GCSBlobStorageAdapter(IBlobStorage):
    def __init__(self, bucket_name: str):
        self.client = storage.Client()
        self.bucket_name = bucket_name

    def generate_upload_urls(self, session_id: str, files: List[str]) -> List[dict]:
        urls = []
        bucket = self.client.bucket(self.bucket_name)
        for file in files:
            sanitized_name = re.sub(r'[^a-zA-Z0-9_.-]', '', file)
            blob_name = f"{session_id}/{sanitized_name}"
            blob = bucket.blob(blob_name)
            url = blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(minutes=15),
                method="PUT",
                content_type="image/jpeg",
            )
            urls.append({"file": file, "url": url, "path": blob_name})
        return urls

class CloudTasksAdapter(ITaskQueue):
    def __init__(self, project_id: str, region: str, queue_name: str):
        self.client = tasks_v2.CloudTasksClient()
        self.project_id = project_id
        self.region = region
        self.queue_name = queue_name
        self.queue_path = self.client.queue_path(project_id, region, queue_name)

    def enqueue_room_processing(self, session_id: str, room: str) -> None:
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"https://{self.region}-{self.project_id}.run.app/api/process-room",
                "headers": {"Content-Type": "application/json"},
                "body": f'{{"session_id": "{session_id}", "room": "{room}"}}'.encode(),
            }
        }
        # self.client.create_task(request={"parent": self.queue_path, "task": task})

    def enqueue_perspective_correction(self, session_id: str, room: str) -> None:
        pass

class RedisPubSubAdapter(IEventPublisher, IProgressSubscriber):
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self._pool: Optional[Redis] = None

    async def connect(self):
        self._pool = Redis.from_url(self.redis_url, decode_responses=True)
        logger.info("Connected to Redis for Pub/Sub")

    async def close(self):
        if self._pool:
            await self._pool.close()
            logger.info("Redis connection closed")

    async def publish_progress(self, session_id: str, room: str, status: str) -> None:
        if not self._pool:
            return
        channel = f"session:{session_id}"
        message = json.dumps({"room": room, "status": status})
        await self._pool.publish(channel, message)

    async def subscribe(self, channel: str) -> AsyncGenerator[Optional[Dict[str, Any]], None]:
        if not self._pool:
            raise RuntimeError("Redis adapter is not connected.")

        pubsub = self._pool.pubsub()
        await pubsub.subscribe(channel)

        try:
            while True:
                try:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if message is not None:
                        try:
                            data = json.loads(message["data"])
                            yield data
                        except json.JSONDecodeError:
                            logger.error(f"Failed to decode Redis message: {message['data']}")
                    else:
                        yield None
                except asyncio.CancelledError:
                    logger.info(f"Subscription to {channel} cancelled.")
                    break
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
