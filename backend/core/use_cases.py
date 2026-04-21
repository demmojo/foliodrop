import asyncio
import uuid
import numpy as np
from typing import List, Optional, Any
from backend.core.ports import IBlobStorage, ITaskQueue, IEventPublisher, IDatabase

class GenerateUploadUrlsUseCase:
    def __init__(self, storage: IBlobStorage):
        self.storage = storage

    def execute(self, session_id: str, files: List[str]) -> List[dict]:
        return self.storage.generate_upload_urls(session_id, files)

class FinalizeJobUseCase:
    def __init__(self, task_queue: ITaskQueue, db: IDatabase):
        self.task_queue = task_queue
        self.db = db

    def execute(self, session_id: str, idempotency_key: str, files_data: List[dict]) -> dict:
        from backend.core.grouping import group_photos, Photo, ExifData
        import datetime
        import uuid
        
        photos = []
        for file in files_data:
            dt = datetime.datetime.fromtimestamp(file["timestamp"] / 1000.0, tz=datetime.timezone.utc)
            photos.append(Photo(id=file["name"], capture_time=dt, exif=ExifData()))
            
        groups = group_photos(photos)
        job_ids = []
        new_jobs = []
        
        for idx, group in enumerate(groups):
            room_name = f"Scene {idx + 1}"
            filenames = [p.id for p in group]
            
            # Create a deterministic sub-key for each group if needed, or just one Job ID per finalize call?
            # A single upload might spawn multiple room groups. We can make a job per group.
            group_job_id = f"job_{uuid.uuid4().hex[:12]}"
            group_idemp_key = f"{idempotency_key}_group_{idx}"
            
            # Check if this sub-job already exists
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
            
        return {"status": "enqueued", "job_ids": job_ids, "tasks_count": len(groups)}

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
            
            # We will use the middle bracket as the "original" before comparison
            mid_idx = len(downsampled_images) // 2
            _, encoded_orig = cv2.imencode('.jpg', downsampled_images[mid_idx], [cv2.IMWRITE_JPEG_QUALITY, 90])
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
                
                max_retries = 3
                for attempt in range(max_retries + 1):
                    try:
                        gen_img_bytes, gen_info = await generate_hybrid_hdr(
                            client, fused_base_bytes, bracket_bytes_list, retry_count=attempt
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
                                is_flagged = True
                                report_data = {"reason": "Structural QA failed 3 times. Falling back to OpenCV base."}
                                logger.warning(f"Room {room} structural QA failed 3x. Fallback used.")
                                
                    except Exception as e:
                        logger.error(f"Generation error on attempt {attempt}: {e}")
                        telemetry.append({"attempt": attempt, "error": str(e)})
                        if attempt == max_retries:
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
