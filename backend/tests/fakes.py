import asyncio
from typing import List, AsyncGenerator
from backend.core.ports import IDatabase, IBlobStorage, ITaskQueue, IEventPublisher, IProgressSubscriber

class FakeDatabase(IDatabase):
    def __init__(self):
        self.sessions = {}
        self.results = {}
        self.jobs = {}
        self.quotas = {"default": {"used": 0, "limit": 3000}}
        
    def save_session(self, session_id: str, data: dict):
        self.sessions[session_id] = data
        
    def get_session(self, session_id: str) -> dict:
        return self.sessions.get(session_id, {})
        
    def save_processing_result(self, session_id: str, result: dict):
        if session_id not in self.results:
            self.results[session_id] = []
        self.results[session_id].append(result)
        
    def get_processing_results(self, session_id: str) -> List[dict]:
        return self.results.get(session_id, [])

    def save_job(self, job_id: str, session_id: str, status: str, idempotency_key: str, result: dict = None, error: str = None):
        if job_id not in self.jobs:
            self.jobs[job_id] = {"id": job_id, "session_id": session_id, "idempotency_key": idempotency_key}
        self.jobs[job_id]["status"] = status
        if result is not None:
            self.jobs[job_id]["result"] = result
        if error is not None:
            self.jobs[job_id]["error"] = error

    def get_job(self, job_id: str) -> dict:
        return self.jobs.get(job_id)

    def get_job_by_idempotency_key(self, idempotency_key: str) -> dict:
        for job in self.jobs.values():
            if job.get("idempotency_key") == idempotency_key:
                return job
        return None

    def get_active_jobs(self, session_id: str) -> List[dict]:
        return [job for job in self.jobs.values() if job.get("session_id") == session_id]

    def get_jobs(self, job_ids: List[str]) -> List[dict]:
        return [self.jobs[jid] for jid in job_ids if jid in self.jobs]

    def get_agency_quota(self, agency_id: str) -> dict:
        return self.quotas.get(agency_id, {"used": 0, "limit": 3000})

    def increment_quota_usage(self, agency_id: str, amount: int) -> bool:
        quota = self.quotas.setdefault(agency_id, {"used": 0, "limit": 3000})
        if quota["used"] + amount > quota["limit"]:
            return False
        quota["used"] += amount
        return True

class FakeBlobStorage(IBlobStorage):
    def generate_upload_urls(self, session_id: str, files: List[str]) -> List[dict]:
        return [{"name": f, "url": f"http://fake-upload/{f}"} for f in files]
        
    def download_blobs(self, session_id: str, files: List[str]) -> List[bytes]:
        # Return a fake 10x10 black JPEG for testing
        fake_jpg = b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\xff\xdb\x00C\x01\t\t\t\x0c\x0b\x0c\x18\r\r\x182!\x1c!22222222222222222222222222222222222222222222222222\xff\xc0\x00\x11\x08\x00\n\x00\n\x03\x01"\x00\x02\x11\x01\x03\x11\x01\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19\x1a%&\'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xc4\x00\x1f\x01\x00\x03\x01\x01\x01\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xc4\x00\xb5\x11\x00\x02\x01\x02\x04\x04\x03\x04\x07\x05\x04\x04\x00\x01\x02w\x00\x01\x02\x03\x11\x04\x05!1\x06\x12AQ\x07aq\x13"2\x81\x08\x14B\x91\xa1\xb1\xc1\t#3R\xf0\x15br\xd1\n\x16$4\xe1%\xf1\x17\x18\x19\x1a&\'()*56789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x82\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xda\x00\x0c\x03\x01\x00\x02\x11\x03\x11\x00?\x00\xfd\xfc\xa2\x8a(\xa0\x0f\xff\xd9'
        return [fake_jpg for _ in files]
        
    def upload_blob(self, session_id: str, filename: str, data: bytes, content_type: str) -> str:
        return f"http://fake-storage/{session_id}/{filename}"

    def generate_signed_url(self, blob_path: str, expiration_minutes: int = 15) -> str:
        return f"http://fake-storage/{blob_path}?signed=true"

class FakeTaskQueue(ITaskQueue):
    def enqueue_room_processing(self, session_id: str, room_name: str, photos: List[str]):
        pass
    def enqueue_job(self, job_id: str, session_id: str, room_name: str, photos: List[str]):
        pass

class FakeEventPublisher(IEventPublisher):
    async def publish_progress(self, session_id: str, room: str, status: str, progress: int = None):
        pass
