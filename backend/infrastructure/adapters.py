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

    def save_job(self, job_id: str, session_id: str, status: str, idempotency_key: str, result: Optional[dict] = None, error: Optional[str] = None, agency_id: Optional[str] = None):
        job_data = {
            "id": job_id,
            "session_id": session_id,
            "status": status,
            "idempotency_key": idempotency_key,
            "updated_at": firestore.SERVER_TIMESTAMP
        }
        if agency_id is not None:
            job_data["agency_id"] = agency_id
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

    def is_blob_path_owned_by_agency(self, blob_path: str, agency_id: str) -> bool:
        # Explicit agency-scoped prefixes are safe to sign for the owner.
        if blob_path.startswith(f"style_profiles/{agency_id}/") or blob_path.startswith(f"training_pairs/{agency_id}/"):
            return True

        # Job outputs are stored by session path. Resolve ownership via job.result fields.
        for field in ("result.blob_path", "result.thumb_blob_path", "result.original_blob_path"):
            docs = self.db.collection("jobs").where(field, "==", blob_path).limit(1).stream()
            for doc in docs:
                job = doc.to_dict() or {}
                job_agency = job.get("agency_id") or (job.get("result") or {}).get("agency_id")
                if job_agency == agency_id:
                    return True
        return False

    def get_cached_group(self, group_hash: str) -> Optional[dict]:
        doc = self.db.collection("group_cache").document(group_hash).get()
        if doc.exists:
            return doc.to_dict()
        return None

    def save_cached_group(self, group_hash: str, result: dict) -> None:
        self.db.collection("group_cache").document(group_hash).set(result, merge=True)

    def get_agency_quota(self, agency_id: str) -> dict:
        doc = self.db.collection("quotas").document(agency_id).get()
        if doc.exists:
            data = doc.to_dict()
            if data.get("limit") == 3000:
                data["limit"] = 50.0
                data["used"] = 0.0
            return data
        return {"used": 0.0, "limit": 50.0}

    def increment_quota_usage(self, agency_id: str, amount: float) -> bool:
        doc_ref = self.db.collection("quotas").document(agency_id)

        # Use a transaction so concurrent finalize-job calls cannot both observe the
        # same `used` value and double-charge past the limit.
        transaction = self.db.transaction()

        @firestore.transactional
        def _txn(txn) -> bool:
            snapshot = doc_ref.get(transaction=txn)
            if snapshot.exists:
                data = snapshot.to_dict() or {}
                limit = data.get("limit", 50.0)
                used = data.get("used", 0.0)

                # Auto-migrate legacy generation-based quotas
                if limit == 3000:
                    limit = 50.0
                    used = 0.0

                if used + amount > limit:
                    return False
                txn.update(doc_ref, {"used": used + amount, "limit": limit})
                return True

            if amount > 50.0:
                return False
            txn.set(doc_ref, {"used": amount, "limit": 50.0})
            return True

        return _txn(transaction)

    def save_style_image(self, agency_id: str, blob_path: str) -> List[str]:
        import datetime
        now = datetime.datetime.now(datetime.timezone.utc)
        doc_ref = self.db.collection("agencies").document(agency_id).collection("style_images").document()
        doc_ref.set({"blob_path": blob_path, "created_at": now})

        return []

    def get_style_images(self, agency_id: str, limit: int = 2) -> List[str]:
        docs = self.db.collection("agencies").document(agency_id).collection("style_images").order_by("created_at", direction=firestore.Query.DESCENDING).limit(limit).stream()
        return [doc.to_dict().get("blob_path") for doc in docs if doc.to_dict().get("blob_path")]

    def get_style_profiles(self, agency_id: str) -> List[dict]:
        docs = self.db.collection("agencies").document(agency_id).collection("style_images").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
        profiles = []
        for doc in docs:
            data = doc.to_dict()
            blob_path = data.get("blob_path")
            if blob_path:
                profiles.append({
                    "id": doc.id,
                    "blob_path": blob_path,
                    "created_at": data.get("created_at").timestamp() * 1000 if data.get("created_at") else 0
                })
        return profiles

    def delete_style_profile(self, agency_id: str, profile_id: str) -> Optional[str]:
        doc_ref = self.db.collection("agencies").document(agency_id).collection("style_images").document(profile_id)
        doc = doc_ref.get()
        if doc.exists:
            blob_path = doc.to_dict().get("blob_path")
            doc_ref.delete()
            return blob_path
        return None

    def save_training_pair(self, agency_id: str, bracket_paths: List[str], final_path: str) -> None:
        import datetime
        now = datetime.datetime.now(datetime.timezone.utc)
        self.db.collection("agencies").document(agency_id).collection("training_pairs").add({
            "bracket_paths": bracket_paths,
            "final_path": final_path,
            "created_at": now
        })

    def get_recent_training_pairs(self, agency_id: str, limit: int = 2) -> List[dict]:
        docs = self.db.collection("agencies").document(agency_id).collection("training_pairs").order_by("created_at", direction=firestore.Query.DESCENDING).limit(limit).stream()
        return [doc.to_dict() for doc in docs]

    def check_session_code_availability(self, code: str) -> bool:
        doc = self.db.collection("sessions").document(code).get()
        if doc.exists:
            # Check if there are any jobs currently pending or processing for this code
            active_jobs = self.db.collection("jobs").where("session_id", "==", code).where("status", "in", ["PENDING", "PROCESSING"]).limit(1).stream()
            has_active_jobs = False
            for _ in active_jobs:
                has_active_jobs = True
                break
                
            if has_active_jobs:
                return False

            data = doc.to_dict()
            created_at = data.get("created_at")
            if created_at:
                from datetime import datetime, timezone, timedelta
                # Give a 24-hour grace period before a session is considered "no longer active"
                if datetime.now(timezone.utc) - created_at < timedelta(hours=24):
                    return False
        return True

    def reserve_session_code(self, code: str) -> bool:
        from firebase_admin import firestore
        
        # Cleanup any old jobs from previous usage of this code
        old_jobs = self.db.collection("jobs").where("session_id", "==", code).stream()
        for doc in old_jobs:
            doc.reference.delete()
            
        # Cleanup any old processing results
        old_results = self.db.collection("sessions").document(code).collection("results").stream()
        for doc in old_results:
            doc.reference.delete()

        self.db.collection("sessions").document(code).set({
            "created_at": firestore.SERVER_TIMESTAMP,
            "reserved": True
        }, merge=False)
        return True

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
                # Fallback to a fake URL only if signing fails
                url = f"https://fake-upload/{blob_name}"

            # Ensure url is https if it's generated for GCS
            if url.startswith("http://storage.googleapis.com"):
                url = url.replace("http://storage.googleapis.com", "https://storage.googleapis.com", 1)

            urls.append({"file": file, "url": url, "path": blob_name})

        return urls

    def download_blobs(self, session_id: str, filenames: List[str]) -> List[bytes]:
        bucket = self.client.bucket(self.bucket_name)

        def _fetch(filename: str) -> bytes:
            blob_name = f"{session_id}/{filename}"
            return bucket.blob(blob_name).download_as_bytes()

        # Bracketed scenes are typically 3-7 large JPEGs; serial GCS GETs add
        # ~hundreds of ms each. Fetch them concurrently while preserving order.
        from concurrent.futures import ThreadPoolExecutor

        if not filenames:
            return []

        max_workers = min(len(filenames), 8)
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            return list(pool.map(_fetch, filenames))

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

    def enqueue_job(self, job_id: str, session_id: str, room_name: str, photos: List[str], agency_id: str = "default") -> None:
        import json
        body_dict = {"job_id": job_id, "session_id": session_id, "room_name": room_name, "photos": photos, "agency_id": agency_id}
        
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
