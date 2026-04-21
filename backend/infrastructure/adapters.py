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

    def save_session(self, session_id: str, data: dict) -> None:
        self.db.collection("sessions").document(session_id).set(data, merge=True)

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.collection("sessions").document(session_id).get()
        if doc.exists:
            return doc.to_dict()
        return None

    def save_processing_result(self, session_id: str, result: dict):
        self.db.collection("sessions").document(session_id).collection("results").add(result)

    def get_processing_results(self, session_id: str) -> List[dict]:
        docs = self.db.collection("sessions").document(session_id).collection("results").stream()
        return [doc.to_dict() for doc in docs]

    def save_job(self, job_id: str, session_id: str, status: str, idempotency_key: str, result: Optional[dict] = None, error: Optional[str] = None):
        job_data = {
            "id": job_id,
            "session_id": session_id,
            "status": status,
            "idempotency_key": idempotency_key,
            "updated_at": firestore.SERVER_TIMESTAMP
        }
        if result is not None:
            job_data["result"] = result
        if error is not None:
            job_data["error"] = error
        
        self.db.collection("jobs").document(job_id).set(job_data, merge=True)

    def get_job(self, job_id: str) -> Optional[dict]:
        doc = self.db.collection("jobs").document(job_id).get()
        if doc.exists:
            return doc.to_dict()
        return None

    def get_job_by_idempotency_key(self, idempotency_key: str) -> Optional[dict]:
        docs = self.db.collection("jobs").where("idempotency_key", "==", idempotency_key).limit(1).stream()
        for doc in docs:
            return doc.to_dict()
        return None

    def get_active_jobs(self, session_id: str) -> List[dict]:
        docs = self.db.collection("jobs").where("session_id", "==", session_id).stream()
        return [doc.to_dict() for doc in docs]

    def get_jobs(self, job_ids: List[str]) -> List[dict]:
        if not job_ids:
            return []
        
        # Firestore 'in' query supports up to 30 values
        results = []
        for i in range(0, len(job_ids), 30):
            batch_ids = job_ids[i:i+30]
            docs = self.db.collection("jobs").where("id", "in", batch_ids).stream()
            results.extend([doc.to_dict() for doc in docs])
        return results

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

    def download_blobs(self, session_id: str, filenames: List[str]) -> List[bytes]:
        bucket = self.client.bucket(self.bucket_name)
        data = []
        for filename in filenames:
            blob_name = f"{session_id}/{filename}"
            blob = bucket.blob(blob_name)
            data.append(blob.download_as_bytes())
        return data

    def upload_blob(self, session_id: str, filename: str, data: bytes, content_type: str) -> str:
        bucket = self.client.bucket(self.bucket_name)
        blob_name = f"{session_id}/{filename}"
        blob = bucket.blob(blob_name)
        blob.upload_from_string(data, content_type=content_type)
        return blob_name

    def generate_signed_url(self, blob_path: str, expiration_minutes: int = 15) -> str:
        # For serverless without private keys, we need to sign with a service account email.
        # This requires the IAM service account credentials. In production, provide service_account_email.
        # For simplicity, if standard sign works (e.g. ADC provides a way), we use it.
        bucket = self.client.bucket(self.bucket_name)
        blob = bucket.blob(blob_path)
        
        service_account_email = os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")
        
        try:
            url = blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(minutes=expiration_minutes),
                method="GET",
                service_account_email=service_account_email
            )
            return url
        except Exception as e:
            logger.warning(f"Failed remote signing, trying standard generate_signed_url: {e}")
            return blob.generate_signed_url(
                version="v4",
                expiration=datetime.timedelta(minutes=expiration_minutes),
                method="GET"
            )

class CloudTasksAdapter(ITaskQueue):
    def __init__(self, project_id: str, region: str, queue_name: str):
        self.client = tasks_v2.CloudTasksClient()
        self.project_id = project_id
        self.region = region
        self.queue_name = queue_name
        self.queue_path = self.client.queue_path(project_id, region, queue_name)

    def enqueue_room_processing(self, session_id: str, room: str, photos: List[str]) -> None:
        import json
        body_dict = {"session_id": session_id, "room": room, "photos": photos}
        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"https://{self.region}-{self.project_id}.run.app/api/process-room",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(body_dict).encode(),
            }
        }
        # self.client.create_task(request={"parent": self.queue_path, "task": task})

    def enqueue_job(self, job_id: str, session_id: str, room_name: str, photos: List[str]) -> None:
        import json
        body_dict = {"job_id": job_id, "session_id": session_id, "room": room_name, "photos": photos}
        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"https://{self.region}-{self.project_id}.run.app/api/v1/jobs/process",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(body_dict).encode(),
            }
        }
        # self.client.create_task(request={"parent": self.queue_path, "task": task})


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

    async def publish_progress(self, session_id: str, room: str, status: str, result: Optional[Dict[str, Any]] = None) -> None:
        if not self._pool:
            return
        channel = f"session:{session_id}"
        message_dict = {"room": room, "status": status}
        if result is not None:
            message_dict["result"] = result
        message = json.dumps(message_dict)
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
