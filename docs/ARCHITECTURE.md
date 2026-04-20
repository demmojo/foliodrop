## Repository Research Summary

### Technology & Infrastructure
- **Languages and Frameworks**: 
  - Frontend: Next.js 16 (App Router), React 19, Tailwind CSS 4, Zustand, Vite (for tests).
  - Backend: Python 3.10+, FastAPI, OpenCV, ONNX Runtime, Pydantic.
- **Deployment model**: Serverless microservices on Google Cloud Platform. Cloud Run instances handle frontend and backend (configured heavily with 8Gi Memory, 2 CPUs, and concurrency=1).
- **API styles in use**: REST APIs for session/job management, Direct-to-GCS signed URLs for uploads, and Server-Sent Events (SSE) for real-time progress.
- **Data stores and async patterns**:
  - Firestore for tracking short-lived session metadata (48h TTL).
  - Google Cloud Storage for raw images and final exports with 48h Object Lifecycle Management.
  - Cloud Tasks for reliable job queuing and dispatch to the backend.
  - Redis Pub/Sub for cross-service event messaging backing the SSE stream.
- **Module organization style**: 
  - Frontend uses App Router standards with `app/`, `components/`, `hooks/`, and `store/` separated.
  - Backend follows a Ports and Adapters (Hexagonal Architecture) model divided into `core/` (use cases, domain models) and `infrastructure/` (adapters for GCP/Redis).

### Architecture & Structure
- **Key findings about project organization**: The repository is a mono-repo separating `frontend/` and `backend/`. Both feature independent deployment scripts (`deploy_frontend.sh` and `deploy.sh`).
- **Important architectural decisions**: The architecture prioritizes client-side packaging (client-side ZIP exports to save bandwidth), direct-to-browser GCS uploads (saving backend memory from large RAW photos), and completely isolated task dispatches via Cloud Tasks to manage memory constraints securely.

### Implementation Patterns & Undocumented Edge Cases
- **Aggressive C-Extension Memory Cleanup**: Inside `ProcessHdrGroupUseCase`, there's a highly specific undocumented hack to mitigate OpenCV/ONNX memory leaks. The `finally` block runs `gc.collect()` alongside `ctypes.CDLL('libc.so.6').malloc_trim(0)` to force the OS allocator to reclaim memory immediately.
- **Conditional HDR Bypassing**: If a user uploads only 1 photo to a room group, the HDR merging pipeline is safely skipped (`SKIPPING_HDR_MERGE`), but it remains queued for post-processing/perspective correction.
- **Auto-injected Real Estate AI Grading**: The `ai_review_and_edit` pipeline in `vision.py` does not solely rely on an ONNX model; it automatically manipulates contrast and RGB channels (bumping red, reducing blue) behind the scenes to force an "inviting real estate" aesthetic.
- **Rolling Sessions**: Every fetch request to `/api/session/{session_id}` dynamically updates the Firestore record with a rolling TTL extending expiry to exactly 48 hours from the time of the request.
- **Graceful Redis Degradation**: In `main.py`, if `REDIS_URL` isn't set or fails to connect, it gracefully catches the exception and falls back to an `InMemoryPubSub` fake class, allowing easy local development without a Redis container.
- **Strategy Fallbacks**: `RoomIdentifier` uses a Strategy pattern to toggle between a mocked `GeminiRoomIdentificationStrategy` and a fallback `OnDeviceMobileNetStrategy`.

### Recommendations
- **Document Memory Workarounds**: Add comments/documentation warning future developers about the `malloc_trim(0)` glibc call, as it will cause segmentation faults or breakages on non-Linux architectures (like Macs during local development).
- **Expand the Event Bus**: The transition from `InMemoryPubSub` to actual Redis should be strictly managed in CI to ensure testing handles exact production replication.
- **Clarify AI Modifications**: The subtle hardcoded color grading in `ai_review_and_edit` should be exposed as configuration environment variables or user preferences so the "look" can be customized per real estate agency.