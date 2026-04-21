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
        # Use google-cloud-firestore directly to specify the named database
        from google.cloud import firestore
        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "development-resources-488110")
        
        # When running locally, if credentials are not available, it might fail to init unless we handle it,
        # but since we only use this adapter when GCP_UPLOAD_BUCKET is set (which is usually in Cloud Run),
        # ADC will be available.
        self.db = firestore.Client(project=project_id, database="hdr-db")

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

    def get_agency_quota(self, agency_id: str) -> dict:
        doc = self.db.collection("quotas").document(agency_id).get()
        if doc.exists:
            return doc.to_dict()
        return {"used": 0, "limit": 3000}

    def increment_quota_usage(self, agency_id: str, amount: int) -> bool:
        doc_ref = self.db.collection("quotas").document(agency_id)
        doc = doc_ref.get()
        if doc.exists:
            data = doc.to_dict()
            if data.get("used", 0) + amount > data.get("limit", 3000):
                return False
            doc_ref.update({"used": data.get("used", 0) + amount})
        else:
            if amount > 3000:
                return False
            doc_ref.set({"used": amount, "limit": 3000})
        return True

    def save_style_image(self, agency_id: str, blob_path: str) -> List[str]:
        import datetime
        now = datetime.datetime.now(datetime.timezone.utc)
        doc_ref = self.db.collection("agencies").document(agency_id).collection("style_images").document()
        doc_ref.set({"blob_path": blob_path, "created_at": now})

        docs = self.db.collection("agencies").document(agency_id).collection("style_images").order_by("created_at").stream()
        docs = list(docs)
        deleted_paths = []
        if len(docs) > 3:
            for doc in docs[:-3]:
                deleted_paths.append(doc.to_dict().get("blob_path"))
                doc.reference.delete()
        return deleted_paths

    def get_style_images(self, agency_id: str) -> List[str]:
        docs = self.db.collection("agencies").document(agency_id).collection("style_images").order_by("created_at").stream()
        return [doc.to_dict().get("blob_path") for doc in docs if doc.to_dict().get("blob_path")]

    def save_training_pair(self, agency_id: str, bracket_paths: List[str], final_path: str) -> None:
        import datetime
        now = datetime.datetime.now(datetime.timezone.utc)
        self.db.collection("agencies").document(agency_id).collection("training_pairs").add({
            "bracket_paths": bracket_paths,
            "final_path": final_path,
            "created_at": now
        })

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
            
            # Use generate_signed_post_policy_v4 as it does not always require a private key 
            # if we explicitly pass the service_account_email and GCP auto-handles it 
            # when running on Cloud Run, OR we just construct a signed URL using IAM SignBlob
            service_account_email = os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")
            
            try:
                # We need to explicitly tell the client to use the IAM SignBlob API when we only have compute credentials
                # which is the case in Cloud Run
                import google.auth
                import google.auth.transport.requests
                credentials, _ = google.auth.default()
                from google.auth.iam import Signer
                
                # Fetch token if not populated yet
                if not credentials.valid:
                    credentials.refresh(google.auth.transport.requests.Request())
                    
                if hasattr(credentials, 'service_account_email') and not hasattr(credentials, 'signer'):
                    url = blob.generate_signed_url(
                        version="v4",
                        expiration=datetime.timedelta(minutes=15),
                        method="PUT",
                        content_type="image/jpeg",
                        service_account_email=credentials.service_account_email,
                        access_token=credentials.token
                    )
                else:
                    kwargs = {
                        "version": "v4",
                        "expiration": datetime.timedelta(minutes=15),
                        "method": "PUT",
                        "content_type": "image/jpeg",
                    }
                    if service_account_email:
                        kwargs["service_account_email"] = service_account_email
                    url = blob.generate_signed_url(**kwargs)
                    
            except Exception as e:
                logger.error(f"Error signing URL: {e}")
                # #region agent log
                try:
                    payload = {
                        "sessionId": "769fb2",
                        "hypothesisId": "H5",
                        "location": "backend/infrastructure/adapters.py:generate_upload_urls",
                        "message": "Error signing URL",
                        "data": {"error": str(e), "service_account": service_account_email},
                        "timestamp": int(datetime.datetime.now().timestamp() * 1000)
                    }
                    with open("/home/demmojo/real-estate-hdr/.cursor/debug-769fb2.log", "a") as f:
                        f.write(json.dumps(payload) + "\n")
                except Exception:
                    pass
                # #endregion
                # Fallback to a fake URL only if signing fails
                url = f"https://fake-upload/{blob_name}"

            # Ensure url is https if it's generated for GCS
            if url.startswith("http://storage.googleapis.com"):
                url = url.replace("http://storage.googleapis.com", "https://storage.googleapis.com", 1)

            urls.append({"file": file, "url": url, "path": blob_name})
            
            # #region agent log
            try:
                payload = {
                    "sessionId": "769fb2",
                    "hypothesisId": "H4",
                    "location": "backend/infrastructure/adapters.py:generate_upload_urls",
                    "message": "Generated URL",
                    "data": {"file": file, "url": url, "bucket": self.bucket_name},
                    "timestamp": int(datetime.datetime.now().timestamp() * 1000)
                }
                with open("/home/demmojo/real-estate-hdr/.cursor/debug-769fb2.log", "a") as f:
                    f.write(json.dumps(payload) + "\n")
            except Exception:
                pass
            # #endregion
            
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

    def upload_blob_direct(self, blob_path: str, data: bytes, content_type: str) -> str:
        bucket = self.client.bucket(self.bucket_name)
        blob = bucket.blob(blob_path)
        blob.upload_from_string(data, content_type=content_type)
        return blob_path

    def delete_blob(self, blob_path: str) -> None:
        try:
            bucket = self.client.bucket(self.bucket_name)
            blob = bucket.blob(blob_path)
            blob.delete()
        except Exception as e:
            logger.error(f"Failed to delete blob {blob_path}: {e}")

    def generate_signed_url(self, blob_path: str, expiration_minutes: int = 15) -> str:
        bucket = self.client.bucket(self.bucket_name)
        blob = bucket.blob(blob_path)
        
        service_account_email = os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")
        
        try:
            # We need to explicitly tell the client to use the IAM SignBlob API when we only have compute credentials
            # which is the case in Cloud Run
            import google.auth
            import google.auth.transport.requests
            credentials, _ = google.auth.default()
            
            # Fetch token if not populated yet
            if not credentials.valid:
                credentials.refresh(google.auth.transport.requests.Request())
                
            if hasattr(credentials, 'service_account_email') and not hasattr(credentials, 'signer'):
                url = blob.generate_signed_url(
                    version="v4",
                    expiration=datetime.timedelta(minutes=expiration_minutes),
                    method="GET",
                    service_account_email=credentials.service_account_email,
                    access_token=credentials.token
                )
                return url
            else:
                kwargs = {
                    "version": "v4",
                    "expiration": datetime.timedelta(minutes=expiration_minutes),
                    "method": "GET",
                }
                if service_account_email:
                    kwargs["service_account_email"] = service_account_email
                url = blob.generate_signed_url(**kwargs)
                return url
        except Exception as e:
            logger.error(f"Failed to generate signed url: {e}")
            return f"https://fake-download/{blob_path}"

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
        body_dict = {"job_id": job_id, "session_id": session_id, "room_name": room_name, "photos": photos}
        
        # We need the actual Cloud Run URL to send tasks to.
        # It's better to pass this as an env var, but for now we can rely on the typical format
        # or we could get it dynamically. Since we know the format from gcloud run describe:
        worker_url = os.environ.get("WORKER_URL", f"https://hdr-worker-spqvmwd2la-uc.a.run.app")
        
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{worker_url}/api/v1/jobs/process",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps(body_dict).encode(),
                # To make sure Cloud Tasks is authorized to hit Cloud Run
                "oidc_token": {"service_account_email": os.environ.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")}
            }
        }
        try:
            self.client.create_task(request={"parent": self.queue_path, "task": task})
        except Exception as e:
            logger.error(f"Failed to enqueue task: {e}")
            # #region agent log
            try:
                payload = {
                    "sessionId": "769fb2",
                    "hypothesisId": "H6",
                    "location": "backend/infrastructure/adapters.py:enqueue_job",
                    "message": "Error enqueuing task",
                    "data": {"error": str(e)},
                    "timestamp": int(datetime.datetime.now().timestamp() * 1000)
                }
                with open("/home/demmojo/real-estate-hdr/.cursor/debug-769fb2.log", "a") as f:
                    f.write(json.dumps(payload) + "\n")
            except Exception:
                pass
            # #endregion


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
