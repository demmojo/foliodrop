import asyncio
import os
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

    def execute(self, agency_id: str, session_id: str, idempotency_key: str, files_data: Optional[List[dict]] = None, groups_data: Optional[List[dict]] = None) -> dict:
        import datetime
        import uuid
        
        job_ids = []
        new_jobs = []
        
        if groups_data:
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
            # We estimate cost per job/room to be ~ $0.135
            # We calculate total cost based on the number of groups
            total_cost = len(new_jobs) * 0.135
            if not self.db.increment_quota_usage(agency_id, total_cost):
                return {"status": "quota_exceeded", "message": "Monthly budget limit of $50 reached."}

            for group_job_id, group_idemp_key, room_name, filenames in new_jobs:
                self.db.save_job(group_job_id, session_id, "PENDING", group_idemp_key, agency_id=agency_id)
                self.task_queue.enqueue_job(group_job_id, session_id, room_name, filenames, agency_id)
                job_ids.append(group_job_id)
            
        return {"status": "enqueued", "job_ids": job_ids, "tasks_count": len(new_jobs)}

def downsample_for_vlm(image_bytes: bytes, max_dim: int = 1080) -> bytes:
    import cv2
    from backend.core.image_decoding import decode_image
    try:
        img = decode_image(image_bytes)
    except ValueError:
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

    async def execute(self, agency_id: str, job_id: str, session_id: str, room: str, photos: Optional[List[Any]] = None) -> dict:
        if not photos or len(photos) < 2:
             error_msg = "Need at least 2 photos for HDR"
             job = self.db.get_job(job_id)
             if job:
                 self.db.save_job(job_id, session_id, "FAILED", job.get("idempotency_key", ""), error=error_msg)
             return {"status": "error", "room": room, "message": error_msg}

        try:
            # 0. FETCH images from GCP Blob Storage
            raw_bytes_list = await asyncio.to_thread(self.storage.download_blobs, session_id, photos)
            
            import hashlib
            hasher = hashlib.sha256()
            for b in raw_bytes_list:
                hasher.update(b)
            group_hash = hasher.hexdigest()
            
            cache_enabled = os.environ.get("ENABLE_GROUP_CACHE", "").lower() in {"1", "true", "yes", "on"}
            if cache_enabled:
                cached_result = self.db.get_cached_group(group_hash)
                if cached_result:
                    logger.info(f"Cache hit for group_hash {group_hash} in job {job_id}")
                    cached_result["room"] = room
                    job = self.db.get_job(job_id)
                    if job:
                        self.db.save_job(job_id, session_id, "COMPLETED", job.get("idempotency_key", ""), result=cached_result)
                    await self.event_publisher.publish_progress(session_id, room, "COMPLETED")
                    return cached_result
            
            # 1. Deterministic OpenCV Pipeline with Pre-Merge Downsampling to 2K (2048px)
            import cv2
            import gc
            import ctypes
            from backend.core.vision import align_images, run_mertens_fusion, apply_real_estate_heuristics
            
            await self.event_publisher.publish_progress(session_id, room, "PROCESSING")
            
            from backend.core.image_decoding import decode_image
            np_images = [decode_image(b) for b in raw_bytes_list]
            
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

            # Composition + framing guard: refuse to merge brackets that do not
            # depict the same scene. AlignMTB cannot save us here -- it would
            # silently produce a smeared image. We flag the job instead.
            from backend.core.bracket_consistency import (
                report_to_payload,
                validate_bracket_consistency,
            )

            consistency_report = await asyncio.to_thread(
                validate_bracket_consistency, downsampled_images
            )
            if not consistency_report.is_consistent:
                logger.warning(
                    "Bracket consistency check failed for job %s: %s",
                    job_id,
                    consistency_report.reason,
                )
                await self.event_publisher.publish_progress(session_id, room, "FLAGGED")
                # Use the median-brightness bracket as the best fallback we can show.
                fallback_idx = sorted(
                    range(len(downsampled_images)),
                    key=lambda i: downsampled_images[i].mean(),
                )[len(downsampled_images) // 2]
                fallback_img = downsampled_images[fallback_idx]
                _, encoded_fallback = cv2.imencode(
                    ".jpg", fallback_img, [cv2.IMWRITE_JPEG_QUALITY, 90]
                )
                fallback_bytes = encoded_fallback.tobytes()

                h, w = fallback_img.shape[:2]
                thumb_scale = 800 / max(h, w)
                thumb_img = cv2.resize(
                    fallback_img,
                    (int(w * thumb_scale), int(h * thumb_scale)),
                    interpolation=cv2.INTER_AREA,
                )
                thumb_ok, encoded_thumb = cv2.imencode(
                    ".webp", thumb_img, [cv2.IMWRITE_WEBP_QUALITY, 80]
                )
                if not thumb_ok:
                    thumb_ok, encoded_thumb = cv2.imencode(
                        ".jpg", thumb_img, [cv2.IMWRITE_JPEG_QUALITY, 85]
                    )
                    if not thumb_ok:
                        raise RuntimeError("Failed to encode fallback thumbnail image")
                fallback_thumb_bytes = encoded_thumb.tobytes()

                final_filename = f"hdr_{room.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.jpg"
                thumb_filename = f"thumb_{room.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.webp"
                before_filename = f"raw_{room.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.jpg"

                final_path = await asyncio.to_thread(
                    self.storage.upload_blob, session_id, final_filename, fallback_bytes, "image/jpeg"
                )
                thumb_path = await asyncio.to_thread(
                    self.storage.upload_blob, session_id, thumb_filename, fallback_thumb_bytes, "image/webp"
                )
                original_path = await asyncio.to_thread(
                    self.storage.upload_blob, session_id, before_filename, fallback_bytes, "image/jpeg"
                )

                result_payload = {
                    "room": room,
                    "status": "FLAGGED",
                    "blob_path": final_path,
                    "thumb_blob_path": thumb_path,
                    "original_blob_path": original_path,
                    "bracket_paths": [f"{session_id}/{p}" for p in photos],
                    "isFlagged": True,
                    "vlmReport": {
                        "reason": consistency_report.reason
                        or "Brackets are not of the same scene/framing.",
                        "consistency": report_to_payload(consistency_report),
                    },
                    "telemetry": [{"consistency": report_to_payload(consistency_report)}],
                    "agency_id": agency_id,
                }
                job = self.db.get_job(job_id)
                if job:
                    self.db.save_job(
                        job_id,
                        session_id,
                        "FLAGGED",
                        job.get("idempotency_key", ""),
                        result=result_payload,
                    )
                return result_payload

            # Keep darkest bracket for deterministic window highlight recovery.
            darkest_bracket = min(downsampled_images, key=lambda x: x.mean())

            # Run OpenCV pipeline
            aligned_images = await asyncio.to_thread(align_images, downsampled_images)
            res_16bit = await asyncio.to_thread(run_mertens_fusion, aligned_images)
            final_bgr_8bit = await asyncio.to_thread(apply_real_estate_heuristics, res_16bit, darkest_bracket)
            
            # Free intermediate arrays
            del aligned_images
            del res_16bit
            
            def run_gc():
                gc.collect()
                try:
                    import ctypes
                    ctypes.CDLL('libc.so.6').malloc_trim(0)
                except Exception:
                    pass
            await asyncio.to_thread(run_gc)
            
            # Encode final fused base image to bytes
            _, encoded_base = cv2.imencode('.jpg', final_bgr_8bit, [cv2.IMWRITE_JPEG_QUALITY, 90])
            fused_base_bytes = encoded_base.tobytes()
            
            # We will use the middle bracket (median brightness) as the "original" before comparison
            brightness_sorted = sorted(downsampled_images, key=lambda x: x.mean())
            mid_idx = len(brightness_sorted) // 2
            _, encoded_orig = cv2.imencode('.jpg', brightness_sorted[mid_idx], [cv2.IMWRITE_JPEG_QUALITY, 90])
            original_bytes = encoded_orig.tobytes()
            
            # Encode only the darkest bracket to bytes for Gemini (Bracket Pruning)
            # This drastically reduces context size and prevents the VLM from being confused by overexposed brackets
            _, enc_dark = cv2.imencode('.jpg', darkest_bracket, [cv2.IMWRITE_JPEG_QUALITY, 90])
            bracket_bytes_list = [enc_dark.tobytes()]
                
            # Free bracket arrays
            del downsampled_images
            await asyncio.to_thread(gc.collect)

            # GenAI Loop with structural validation gate
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
                
                # Fetch context for Nano Banana Pro (Dynamic Few-Shot RAG)
                training_pairs = []
                style_urls = []
                
                recent_pairs = self.db.get_recent_training_pairs(agency_id, limit=2)
                if recent_pairs:
                    for pair in recent_pairs:
                        bracket_urls = [self.storage.generate_signed_url(p) for p in pair.get("bracket_paths", []) if p]
                        final_url = self.storage.generate_signed_url(pair.get("final_path", "")) if pair.get("final_path") else ""
                        if bracket_urls and final_url:
                            training_pairs.append({
                                "bracket_urls": bracket_urls,
                                "final_url": final_url
                            })
                
                # Graceful degradation to style images if no valid training pairs
                if not training_pairs:
                    style_paths = self.db.get_style_images(agency_id, limit=2)
                    style_urls = [self.storage.generate_signed_url(p) for p in style_paths]
                
                # Hoist file uploads outside of retry loop
                def upload(b, name):
                    import tempfile
                    tmp_path = None
                    try:
                        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                            tmp.write(b)
                            tmp_path = tmp.name
                        try:
                            f = client.files.upload(file=tmp_path, config={"display_name": name})
                        except Exception:
                            f = client.files.upload(file=tmp_path)
                        return f
                    finally:
                        if tmp_path and os.path.exists(tmp_path):
                            try:
                                os.remove(tmp_path)
                            except Exception:
                                pass

                uploaded_files = []
                try:
                    fused_file = await asyncio.to_thread(upload, fused_base_bytes, "fused_base.jpg")
                    uploaded_files.append(fused_file)
                    
                    bracket_files = []
                    for i, bb in enumerate(bracket_bytes_list):
                        bf = await asyncio.to_thread(upload, bb, f"bracket_{i}.jpg")
                        uploaded_files.append(bf)
                        bracket_files.append(bf)

                    max_retries = 3
                    for attempt in range(max_retries + 1):
                        try:
                            gen_img_bytes, gen_info = await generate_hybrid_hdr(
                                client, fused_file, bracket_files, retry_count=attempt, style_urls=style_urls, training_pairs=training_pairs
                            )

                            # Deterministic structural gate: generated output must preserve room geometry.
                            from backend.core.image_decoding import decode_image
                            gen_cv_img = decode_image(gen_img_bytes)
                            base_cv_img = decode_image(fused_base_bytes)
                            is_valid, inlier_ratio, void_ratio = compute_structural_diff(base_cv_img, gen_cv_img)
                            telemetry.append({
                                "attempt": attempt,
                                "is_valid": is_valid,
                                "inlier_ratio": inlier_ratio,
                                "void_ratio": void_ratio
                            })

                            del base_cv_img
                            del gen_cv_img
                            await asyncio.to_thread(gc.collect)

                            if is_valid:
                                final_image_bytes = gen_img_bytes
                                break

                            if attempt == max_retries:
                                final_image_bytes = fused_base_bytes
                                is_flagged = True
                                report_data = {
                                    "reason": "Structural consistency check failed after retries. Falling back to OpenCV base.",
                                    "inlier_ratio": inlier_ratio,
                                    "void_ratio": void_ratio
                                }
                                    
                        except Exception as e:
                            logger.error(f"Generation error on attempt {attempt}: {e}")
                            telemetry.append({"attempt": attempt, "error": str(e)})
                            if attempt == max_retries:
                                final_image_bytes = fused_base_bytes
                                is_flagged = True
                                report_data = {"reason": f"API Errors exhausted retries. Fallback used: {e}"}
                finally:
                    # Cleanup Gemini uploaded files
                    for f in uploaded_files:
                        try:
                            await asyncio.to_thread(client.files.delete, name=f.name)
                        except Exception as e:
                            logger.warning(f"Failed to delete Gemini file {f.name}: {e}")
            else:
                # Mock path for testing
                telemetry.append({"mock": "used dummy-key"})
            
            # Decode final chosen image bytes to create thumbnail
            from backend.core.image_decoding import decode_image
            final_bgr_8bit = decode_image(final_image_bytes)
            
            # Generate WebP thumbnail
            h, w = final_bgr_8bit.shape[:2]
            thumb_scale = 800 / max(h, w)
            thumb_img = cv2.resize(final_bgr_8bit, (int(w * thumb_scale), int(h * thumb_scale)), interpolation=cv2.INTER_AREA)
            thumb_ok, encoded_thumb = cv2.imencode('.webp', thumb_img, [cv2.IMWRITE_WEBP_QUALITY, 80])
            if not thumb_ok:
                thumb_ok, encoded_thumb = cv2.imencode('.jpg', thumb_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
                if not thumb_ok:
                    raise RuntimeError("Failed to encode thumbnail image")
            thumb_bytes = encoded_thumb.tobytes()
            
            del final_bgr_8bit
            del thumb_img
            await asyncio.to_thread(gc.collect)
            
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
                "bracket_paths": [f"{session_id}/{p}" for p in photos], # save bracket paths for training
                "isFlagged": is_flagged,
                "vlmReport": report_data,
                "telemetry": telemetry,
                # Tag the result with the agency that owns this job so later mutations
                # (override/training) can refuse to act on another agency's data.
                "agency_id": agency_id,
            }

            if cache_enabled and not is_flagged and status == "COMPLETED":
                self.db.save_cached_group(group_hash, result_payload)

            job = self.db.get_job(job_id)
            if job:
                self.db.save_job(job_id, session_id, status, job.get("idempotency_key", ""), result=result_payload)

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

class TrainingPairConsistencyError(Exception):
    """Raised when a training pair's brackets/final edit do not match scene/framing."""

    def __init__(self, message: str, report: dict):
        super().__init__(message)
        self.report = report


class UploadTrainingPairUseCase:
    def __init__(self, storage: IBlobStorage, db: IDatabase):
        self.storage = storage
        self.db = db

    def execute(self, agency_id: str, brackets: List[tuple[str, bytes, str]], final_edit: tuple[str, bytes, str]) -> dict:
        import uuid
        import re
        from backend.core.bracket_consistency import (
            report_to_payload,
            validate_bracket_consistency,
        )
        from backend.core.image_decoding import decode_image

        bracket_imgs = [decode_image(b[1]) for b in brackets]
        final_img = decode_image(final_edit[1])
        report = validate_bracket_consistency(bracket_imgs, final_edit=final_img)
        if not report.is_consistent:
            raise TrainingPairConsistencyError(
                report.reason or "Training pair photos must be of the same scene and framing.",
                report_to_payload(report),
            )

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

        if "result" not in job:
            return {"status": "error", "message": "Job had no result to override"}

        # Refuse to override jobs that belong to a different agency. Older jobs may
        # not have an agency_id stamped on the result (pre-fix); allow those to
        # preserve backwards compatibility while preventing fresh cross-agency edits.
        job_agency = job.get("result", {}).get("agency_id")
        if job_agency and job_agency != agency_id:
            return {"status": "error", "message": "Job does not belong to this agency"}
            
        import uuid
        import re
        batch_id = uuid.uuid4().hex[:8]
        
        final_name, final_data, final_content_type = final_edit
        sanitized_final = re.sub(r'[^a-zA-Z0-9_.-]', '', final_name)
        final_blob_path = f"training_pairs/{agency_id}/{batch_id}/final_override_{sanitized_final}"
        
        self.storage.upload_blob_direct(final_blob_path, final_data, final_content_type)
        
        # We don't have the original bracket paths here, so we store an empty list or try to fetch from job?
        # Actually, job might have original bracket paths if we saved them in job.
        # But we'll just save empty for now as in the original code.
        bracket_paths = job["result"].get("bracket_paths", []) 
        self.db.save_training_pair(agency_id, bracket_paths, final_blob_path)
        
        job["result"]["blob_path"] = final_blob_path
        try:
            import cv2
            import numpy as np
            from backend.core.image_decoding import decode_image
            final_bgr = decode_image(final_data)
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

