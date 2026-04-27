from typing import List, AsyncGenerator, Protocol, Optional, Dict, Any

class IDatabase(Protocol):
    def save_session(self, session_id: str, data: dict): ... # pragma: no cover
    def get_session(self, session_id: str) -> dict: ... # pragma: no cover
    def save_processing_result(self, session_id: str, result: dict): ... # pragma: no cover
    def get_processing_results(self, session_id: str) -> List[dict]: ... # pragma: no cover
    
    # Job-related methods for async polling
    def save_job(self, job_id: str, session_id: str, status: str, idempotency_key: str, result: Optional[dict] = None, error: Optional[str] = None, agency_id: Optional[str] = None): ... # pragma: no cover
    def get_job(self, job_id: str) -> Optional[dict]: ... # pragma: no cover
    def get_job_by_idempotency_key(self, idempotency_key: str) -> Optional[dict]: ... # pragma: no cover
    def get_active_jobs(self, session_id: str) -> List[dict]: ... # pragma: no cover
    def get_jobs(self, job_ids: List[str]) -> List[dict]: ... # pragma: no cover
    def is_blob_path_owned_by_agency(self, blob_path: str, agency_id: str) -> bool: ... # pragma: no cover
    
    # Caching methods
    def get_cached_group(self, group_hash: str) -> Optional[dict]: ... # pragma: no cover
    def save_cached_group(self, group_hash: str, result: dict): ... # pragma: no cover

    def get_agency_quota(self, agency_id: str) -> dict: ... # pragma: no cover
    def increment_quota_usage(self, agency_id: str, amount: float) -> bool: ... # pragma: no cover
    def save_style_image(self, agency_id: str, blob_path: str) -> List[str]: ... # pragma: no cover
    def get_style_images(self, agency_id: str, limit: int = 2) -> List[str]: ... # pragma: no cover
    def get_style_profiles(self, agency_id: str) -> List[dict]: ... # pragma: no cover
    def delete_style_profile(self, agency_id: str, profile_id: str) -> Optional[str]: ... # pragma: no cover
    def save_training_pair(self, agency_id: str, bracket_paths: List[str], final_path: str) -> None: ... # pragma: no cover
    def get_recent_training_pairs(self, agency_id: str, limit: int = 2) -> List[dict]: ... # pragma: no cover
    
    def check_session_code_availability(self, code: str) -> bool: ... # pragma: no cover
    def reserve_session_code(self, code: str) -> bool: ... # pragma: no cover

class IBlobStorage(Protocol):
    def generate_upload_urls(self, session_id: str, files: List[str]) -> List[dict]: ... # pragma: no cover
    def download_blobs(self, session_id: str, files: List[str]) -> List[bytes]: ... # pragma: no cover

    def upload_blob(self, session_id: str, filename: str, data: bytes, content_type: str) -> str: ... # pragma: no cover
    def upload_blob_direct(self, blob_path: str, data: bytes, content_type: str) -> str: ... # pragma: no cover
    def generate_signed_url(self, blob_path: str, expiration_minutes: int = 15) -> str: ... # pragma: no cover
    def delete_blob(self, blob_path: str) -> None: ... # pragma: no cover

class ITaskQueue(Protocol):
    def enqueue_job(self, job_id: str, session_id: str, room_name: str, photos: List[str], agency_id: str = "default"): ... # pragma: no cover

class IEventPublisher(Protocol):
    async def publish_progress(self, session_id: str, room: str, status: str, progress: Optional[int] = None): ... # pragma: no cover

class IProgressSubscriber(Protocol):
    async def subscribe(self, session_id: str) -> AsyncGenerator[str, None]: ... # pragma: no cover
