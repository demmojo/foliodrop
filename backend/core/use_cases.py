import asyncio
import uuid
import numpy as np
import logging
from typing import List, Optional, Any
from backend.core.ports import IBlobStorage, ITaskQueue, IEventPublisher, IDatabase

logger = logging.getLogger(__name__)

class GenerateUploadUrlsUseCase:
    def __init__(self, storage: IBlobStorage):
        self.storage = storage

    def execute(self, session_id: str, files: List[str]) -> List[dict]:
        return self.storage.generate_upload_urls(session_id, files)

class FinalizeJobUseCase:
    def __init__(self, task_queue: ITaskQueue, db: IDatabase):
        self.task_queue = task_queue
        self.db = db

    def execute(self, session_id: str, idempotency_key: str, files_data: Optional[List[dict]] = None, groups_data: Optional[List[dict]] = None) -> dict:
        import datetime
        import uuid
        
        job_ids = []
        new_jobs = []
        
        if groups_data:
            # #region agent log
            import json, time
            try:
                with open("/home/demmojo/real-estate-hdr/.cursor/debug-8ca7b1.log", "a") as f:
                    f.write(json.dumps({"sessionId":"8ca7b1","hypothesisId":"H_BACKEND_GROUPS","location":"FinalizeJobUseCase:execute","message":"received groups_data","data":{"num_groups":len(groups_data), "sizes": [len(g.get("files", [])) for g in groups_data]},"timestamp":int(time.time()*1000)}) + "\n")
            except Exception: pass
            # #endregion
            for idx, group in enumerate(groups_data):
                room_name = group.get("name", f"Scene {idx + 1}")
                filenames = group.get("files", [])
                
                if not filenames:
                    continue
                    
                group_job_id = f"job_{uuid.uuid4().hex[:12]}"
                group_idemp_key = f"{idempotency_key}_group_{idx}"
                
                existing_job = self.db.get_job_by_idempotency_key(group_idemp_key)
                if existing_job:
                    job_ids.append(existing_job["id"])
                    continue
                new_jobs.append((group_job_id, group_idemp_key, room_name, filenames))
                
        elif files_data:
            from backend.core.grouping import group_photos, Photo, ExifData
            photos = []
            for file in files_data:
                dt = datetime.datetime.fromtimestamp(file["timestamp"] / 1000.0, tz=datetime.timezone.utc)
                photos.append(Photo(id=file["name"], capture_time=dt, exif=ExifData()))
                
            groups = group_photos(photos)
            
            for idx, group in enumerate(groups):
                room_name = f"Scene {idx + 1}"
                filenames = [p.id for p in group]
                
                group_job_id = f"job_{uuid.uuid4().hex[:12]}"
                group_idemp_key = f"{idempotency_key}_group_{idx}"
                
                existing_job = self.db.get_job_by_idempotency_key(group_idemp_key)
                if existing_job:
                    job_ids.append(existing_job["id"])
                    continue
                new_jobs.append((group_job_id, group_idemp_key, room_name, filenames))
                
        if new_jobs:
            if not self.db.increment_quota_usage("default", len(new_jobs)):
                return {"status": "quota_exceeded", "message": "Monthly quota limit of 3000 HDR generations reached."}

            for group_job_id, group_idemp_key, room_name, filenames in new_jobs:
                self.db.save_job(group_job_id, session_id, "PENDING", group_idemp_key)
                self.task_queue.enqueue_job(group_job_id, session_id, room_name, filenames)
                job_ids.append(group_job_id)
            
        return {"status": "enqueued", "job_ids": job_ids, "tasks_count": len(new_jobs)}

def downsample_for_vlm(image_bytes: bytes, max_dim: int = 1080) -> bytes:
    import cv2
    img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return image_bytes
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    _, encoded = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return encoded.tobytes()

class ProcessHdrGroupUseCase:
    def __init__(self, event_publisher: IEventPublisher, task_queue: ITaskQueue, storage: IBlobStorage, db: IDatabase):
        self.event_publisher = event_publisher
        self.task_queue = task_queue
        self.storage = storage
        self.db = db

    async def execute(self, job_id: str, session_id: str, room: str, photos: Optional[List[Any]] = None) -> dict:
        if not photos or len(photos) < 2:
             error_msg = "Need at least 2 photos for HDR"
             job = self.db.get_job(job_id)
             if job:
                 self.db.save_job(job_id, session_id, "FAILED", job.get("idempotency_key", ""), error=error_msg)
             return {"status": "error", "room": room, "message": error_msg}

        try:
            # 0. FETCH images from GCP Blob Storage
            raw_bytes_list = await asyncio.to_thread(self.storage.download_blobs, session_id, photos)
            
            # 1. Deterministic OpenCV Pipeline with Pre-Merge Downsampling to 2K (2048px)
            import cv2
            import gc
            import ctypes
            from backend.core.vision import align_images, run_mertens_fusion, apply_real_estate_heuristics
            
            await self.event_publisher.publish_progress(session_id, room, "PROCESSING")
            
            # Decode bytes to numpy arrays
            np_images = [cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR) for b in raw_bytes_list]
            
            # Downsample brackets to 2048px max dimension BEFORE merge to prevent OOM
            downsampled_images = []
            for img in np_images:
                h, w = img.shape[:2]
                max_dim = 2048
                if max(h, w) > max_dim:
                    scale = max_dim / max(h, w)
                    img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                downsampled_images.append(img)
            
            # Free raw arrays
            del np_images
            gc.collect()

            # Run OpenCV pipeline
            aligned_images = await asyncio.to_thread(align_images, downsampled_images)
            res_16bit = await asyncio.to_thread(run_mertens_fusion, aligned_images)
            final_bgr_8bit = await asyncio.to_thread(apply_real_estate_heuristics, res_16bit)
            
            # Free intermediate arrays
            del aligned_images
            del res_16bit
            gc.collect()
            try:
                ctypes.CDLL('libc.so.6').malloc_trim(0)
            except Exception:
                pass
            
            # Encode final fused base image to bytes
            _, encoded_base = cv2.imencode('.jpg', final_bgr_8bit, [cv2.IMWRITE_JPEG_QUALITY, 90])
            fused_base_bytes = encoded_base.tobytes()
            
            # We will use the middle bracket (median brightness) as the "original" before comparison
            brightness_sorted = sorted(downsampled_images, key=lambda x: x.mean())
            mid_idx = len(brightness_sorted) // 2
            _, encoded_orig = cv2.imencode('.jpg', brightness_sorted[mid_idx], [cv2.IMWRITE_JPEG_QUALITY, 90])
            original_bytes = encoded_orig.tobytes()
            
            # Encode all brackets to bytes for Gemini
            bracket_bytes_list = []
            for d_img in downsampled_images:
                _, enc = cv2.imencode('.jpg', d_img, [cv2.IMWRITE_JPEG_QUALITY, 90])
                bracket_bytes_list.append(enc.tobytes())
                
            # Free bracket arrays
            del downsampled_images
            gc.collect()

            # GenAI + Structural QA Loop
            from backend.core.generation_loop import generate_hybrid_hdr, compute_structural_diff
            from google import genai
            import os
            
            api_key = os.getenv("GEMINI_API_KEY", "dummy-key")
            final_image_bytes = fused_base_bytes
            is_flagged = False
            report_data = None
            telemetry = []
            
            if api_key != "dummy-key":
                client = genai.Client(api_key=api_key)
                
                # Fetch style images
                style_paths = self.db.get_style_images("default")
                style_urls = [self.storage.generate_signed_url(p) for p in style_paths]
                
                max_retries = 3
                for attempt in range(max_retries + 1):
                    try:
                        gen_img_bytes, gen_info = await generate_hybrid_hdr(
                            client, fused_base_bytes, bracket_bytes_list, retry_count=attempt, style_urls=style_urls
                        )
                        
                        # Structural QA
                        gen_cv_img = cv2.imdecode(np.frombuffer(gen_img_bytes, np.uint8), cv2.IMREAD_COLOR)
                        base_cv_img = cv2.imdecode(np.frombuffer(fused_base_bytes, np.uint8), cv2.IMREAD_COLOR)
                        
                        is_valid, inlier_ratio, void_ratio = compute_structural_diff(base_cv_img, gen_cv_img)
                        telemetry.append({
                            "attempt": attempt,
                            "is_valid": is_valid,
                            "inlier_ratio": inlier_ratio,
                            "void_ratio": void_ratio
                        })
                        
                        del base_cv_img
                        gc.collect()
                        
                        if is_valid:
                            final_image_bytes = gen_img_bytes
                            # We got a good generated image
                            break
                        else:
                            del gen_cv_img
                            gc.collect()
                            if attempt == max_retries:
                                # Fallback to OpenCV base
                                final_image_bytes = fused_base_bytes
                                is_flagged = True
                                report_data = {"reason": "Structural QA failed 3 times. Falling back to OpenCV base."}
                                import logging
                                logger = logging.getLogger(__name__)
                                logger.warning(f"Room {room} structural QA failed 3x. Fallback used.")
                                
                    except Exception as e:
                        import logging
                        logger = logging.getLogger(__name__)
                        logger.error(f"Generation error on attempt {attempt}: {e}")
                        telemetry.append({"attempt": attempt, "error": str(e)})
                        if attempt == max_retries:
                            final_image_bytes = fused_base_bytes
                            is_flagged = True
                            report_data = {"reason": f"API Errors exhausted retries. Fallback used: {e}"}
            else:
                # Mock path for testing
                telemetry.append({"mock": "used dummy-key"})
            
            # Decode final chosen image bytes to create thumbnail
            final_bgr_8bit = cv2.imdecode(np.frombuffer(final_image_bytes, np.uint8), cv2.IMREAD_COLOR)
            
            # Generate WebP thumbnail
            h, w = final_bgr_8bit.shape[:2]
            thumb_scale = 800 / max(h, w)
            thumb_img = cv2.resize(final_bgr_8bit, (int(w * thumb_scale), int(h * thumb_scale)), interpolation=cv2.INTER_AREA)
            _, encoded_thumb = cv2.imencode('.webp', thumb_img, [cv2.IMWRITE_WEBP_QUALITY, 80])
            thumb_bytes = encoded_thumb.tobytes()
            
            del final_bgr_8bit
            del thumb_img
            gc.collect()
            
            # 2. Upload the finished assets
            final_filename = f"hdr_{room.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.jpg"
            thumb_filename = f"thumb_{room.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.webp"
            before_filename = f"raw_{room.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.jpg"
            
            final_path = await asyncio.to_thread(self.storage.upload_blob, session_id, final_filename, final_image_bytes, "image/jpeg")
            thumb_path = await asyncio.to_thread(self.storage.upload_blob, session_id, thumb_filename, thumb_bytes, "image/webp")
            original_path = await asyncio.to_thread(self.storage.upload_blob, session_id, before_filename, original_bytes, "image/jpeg")

            # 4. Finalize
            status = "FLAGGED" if is_flagged else "COMPLETED"
            await self.event_publisher.publish_progress(session_id, room, status)

            result_payload = {
                "room": room,
                "status": status,
                "blob_path": final_path,
                "thumb_blob_path": thumb_path,
                "original_blob_path": original_path,
                "isFlagged": is_flagged,
                "vlmReport": report_data,
                "telemetry": telemetry
            }

            job = self.db.get_job(job_id)
            if job:
                self.db.save_job(job_id, session_id, "COMPLETED", job.get("idempotency_key", ""), result=result_payload)

            return result_payload

        except Exception as e:
            import traceback
            traceback.print_exc()
            await self.event_publisher.publish_progress(session_id, room, "FAILED")
            job = self.db.get_job(job_id)
            if job:
                self.db.save_job(job_id, session_id, "FAILED", job.get("idempotency_key", ""), error=str(e))
            return {"status": "error", "room": room, "message": str(e)}

class UploadStyleImageUseCase:
    def __init__(self, storage: IBlobStorage, db: IDatabase):
        self.storage = storage
        self.db = db

    def execute(self, agency_id: str, file_name: str, file_data: bytes, content_type: str) -> dict:
        import uuid
        import re
        sanitized_name = re.sub(r'[^a-zA-Z0-9_.-]', '', file_name)
        blob_path = f"style_profiles/{agency_id}/{uuid.uuid4().hex[:8]}_{sanitized_name}"
        
        self.storage.upload_blob_direct(blob_path, file_data, content_type)
        deleted_paths = self.db.save_style_image(agency_id, blob_path)
        for path in deleted_paths:
            self.storage.delete_blob(path)
            
        return {"status": "success", "blob_path": blob_path, "evicted_count": len(deleted_paths)}

class UploadTrainingPairUseCase:
    def __init__(self, storage: IBlobStorage, db: IDatabase):
        self.storage = storage
        self.db = db

    def execute(self, agency_id: str, brackets: List[tuple[str, bytes, str]], final_edit: tuple[str, bytes, str]) -> dict:
        import uuid
        import re
        
        batch_id = uuid.uuid4().hex[:8]
        bracket_paths = []
        for file_name, file_data, content_type in brackets:
            sanitized_name = re.sub(r'[^a-zA-Z0-9_.-]', '', file_name)
            blob_path = f"training_pairs/{agency_id}/{batch_id}/brackets/{sanitized_name}"
            self.storage.upload_blob_direct(blob_path, file_data, content_type)
            bracket_paths.append(blob_path)
            
        final_name, final_data, final_content_type = final_edit
        sanitized_final = re.sub(r'[^a-zA-Z0-9_.-]', '', final_name)
        final_blob_path = f"training_pairs/{agency_id}/{batch_id}/final/{sanitized_final}"
        self.storage.upload_blob_direct(final_blob_path, final_data, final_content_type)
        
        self.db.save_training_pair(agency_id, bracket_paths, final_blob_path)
        return {"status": "success", "bracket_paths": bracket_paths, "final_path": final_blob_path}

class OverrideJobImageUseCase:
    def __init__(self, storage: IBlobStorage, db: IDatabase):
        self.storage = storage
        self.db = db

    def execute(self, agency_id: str, job_id: str, final_edit: tuple[str, bytes, str]) -> dict:
        job = self.db.get_job(job_id)
        if not job:
            return {"status": "error", "message": "Job not found"}
            
        import uuid
        import re
        batch_id = uuid.uuid4().hex[:8]
        
        final_name, final_data, final_content_type = final_edit
        sanitized_final = re.sub(r'[^a-zA-Z0-9_.-]', '', final_name)
        final_blob_path = f"training_pairs/{agency_id}/{batch_id}/final_override_{sanitized_final}"
        
        self.storage.upload_blob_direct(final_blob_path, final_data, final_content_type)
        
        bracket_paths = [] 
        self.db.save_training_pair(agency_id, bracket_paths, final_blob_path)
        
        if "result" in job:
            job["result"]["blob_path"] = final_blob_path
            try:
                import cv2
                import numpy as np
                final_bgr = cv2.imdecode(np.frombuffer(final_data, np.uint8), cv2.IMREAD_COLOR)
                h, w = final_bgr.shape[:2]
                thumb_scale = 800 / max(h, w)
                thumb_img = cv2.resize(final_bgr, (int(w * thumb_scale), int(h * thumb_scale)), interpolation=cv2.INTER_AREA)
                _, encoded_thumb = cv2.imencode('.webp', thumb_img, [cv2.IMWRITE_WEBP_QUALITY, 80])
                thumb_bytes = encoded_thumb.tobytes()
                
                thumb_blob_path = f"training_pairs/{agency_id}/{batch_id}/thumb_override_{sanitized_final}.webp"
                self.storage.upload_blob_direct(thumb_blob_path, thumb_bytes, "image/webp")
                job["result"]["thumb_blob_path"] = thumb_blob_path
            except Exception:
                pass
                
            self.db.save_job(job_id, job["session_id"], job["status"], job["idempotency_key"], result=job["result"])
            
            return {
                "status": "success", 
                "blob_path": final_blob_path, 
                "thumb_blob_path": job["result"].get("thumb_blob_path"),
                "url": self.storage.generate_signed_url(final_blob_path),
                "thumb_url": self.storage.generate_signed_url(job["result"].get("thumb_blob_path")) if job["result"].get("thumb_blob_path") else None
            }
        
        return {"status": "error", "message": "Job had no result"}

