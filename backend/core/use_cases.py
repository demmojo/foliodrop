import asyncio
import uuid
import numpy as np
from typing import List, Optional, Any
from backend.core.ports import IBlobStorage, ITaskQueue, IEventPublisher

class GenerateUploadUrlsUseCase:
    def __init__(self, storage: IBlobStorage):
        self.storage = storage

    def execute(self, session_id: str, files: List[str]) -> List[dict]:
        return self.storage.generate_upload_urls(session_id, files)

class FinalizeJobUseCase:
    def __init__(self, task_queue: ITaskQueue):
        self.task_queue = task_queue

    def execute(self, session_id: str, files_data: List[dict]) -> dict:
        from backend.core.grouping import group_photos, Photo, ExifData
        import datetime
        
        photos = []
        for file in files_data:
            dt = datetime.datetime.fromtimestamp(file["timestamp"] / 1000.0, tz=datetime.timezone.utc)
            photos.append(Photo(id=file["name"], capture_time=dt, exif=ExifData()))
            
        groups = group_photos(photos)
        
        for idx, group in enumerate(groups):
            room_name = f"Scene {idx + 1}"
            filenames = [p.id for p in group]
            self.task_queue.enqueue_room_processing(session_id, room_name, filenames)
            
        return {"status": "enqueued", "tasks_count": len(groups)}

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
    def __init__(self, event_publisher: IEventPublisher, task_queue: ITaskQueue, storage: IBlobStorage):
        self.event_publisher = event_publisher
        self.task_queue = task_queue
        self.storage = storage

    async def execute(self, session_id: str, room: str, photos: Optional[List[Any]] = None) -> dict:
        if not photos or len(photos) < 2:
             return {"status": "error", "room": room, "message": "Need at least 2 photos for HDR"}

        try:
            # 0. FETCH images from GCP Blob Storage
            raw_bytes_list = await asyncio.to_thread(self.storage.download_blobs, session_id, photos)
            
            # The darkest bracket is usually the first or last depending on camera settings.
            # We'll calculate brightness to be safe, or assume standard sorting.
            # For simplicity in this mock, we assume the list is sorted dark -> bright or we just grab index 0.
            darkest_bracket_bytes = raw_bytes_list[0]
            middle_bracket_bytes = raw_bytes_list[len(raw_bytes_list) // 2]
            
            # 1. Deterministic OpenCV Pipeline
            import cv2
            from backend.core.vision import align_images, run_mertens_fusion, apply_real_estate_heuristics
            
            await self.event_publisher.publish_progress(session_id, room, "PROCESSING")
            
            # Decode bytes to numpy arrays
            np_images = [cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR) for b in raw_bytes_list]
            
            # Run OpenCV pipeline
            aligned_images = await asyncio.to_thread(align_images, np_images)
            res_16bit = await asyncio.to_thread(run_mertens_fusion, aligned_images)
            final_bgr_8bit = await asyncio.to_thread(apply_real_estate_heuristics, res_16bit)
            
            # Encode final fused image to bytes
            _, encoded_img = cv2.imencode('.jpg', final_bgr_8bit)
            fused_image_bytes = encoded_img.tobytes()
            
            # 2. Upload the finished asset AND the original BEFORE asset
            final_filename = f"hdr_{room.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.jpg"
            before_filename = f"raw_{room.replace(' ', '_')}_{uuid.uuid4().hex[:8]}.jpg"
            
            final_url = await asyncio.to_thread(self.storage.upload_blob, session_id, final_filename, fused_image_bytes, "image/jpeg")
            original_url = await asyncio.to_thread(self.storage.upload_blob, session_id, before_filename, middle_bracket_bytes, "image/jpeg")

            # 3. VLM QA Judge (Non-Blocking Soft Flag)
            from backend.core.vlm_loop import evaluate_fused_image
            from google import genai
            import os
            
            api_key = os.getenv("GEMINI_API_KEY", "dummy-key")
            is_flagged = False
            telemetry = []
            report_data = None
            
            if api_key == "dummy-key":
                # Mock QA result
                is_flagged = False
                report_data = {"window_reasoning": "Mock: Windows look OK.", "window_score": 8}
            else:
                try:
                    # Downsample images for VLM to avoid token/latency limits
                    vlm_darkest_bytes = await asyncio.to_thread(downsample_for_vlm, darkest_bracket_bytes)
                    vlm_fused_bytes = await asyncio.to_thread(downsample_for_vlm, fused_image_bytes)
                    
                    client = genai.Client(api_key=api_key)
                    report, telemetry = await evaluate_fused_image(client, vlm_darkest_bytes, vlm_fused_bytes)
                    is_flagged = report.window_score < 7
                    report_data = report.model_dump()
                except Exception as e:
                    # If VLM fails, we STILL return the image, we just don't flag it or we flag it as an error.
                    is_flagged = False
                    telemetry = [{"error": str(e)}]

            # 4. Finalize
            status = "FLAGGED" if is_flagged else "READY"
            await self.event_publisher.publish_progress(session_id, room, status)

            result_payload = {
                "room": room,
                "url": final_url,
                "originalUrl": original_url,
                "status": status,
                "isFlagged": is_flagged,
                "vlmReport": report_data,
                "telemetry": telemetry
            }

            return result_payload

        except Exception as e:
            import traceback
            traceback.print_exc()
            await self.event_publisher.publish_progress(session_id, room, "FAILED")
            return {"status": "error", "room": room, "message": str(e)}
