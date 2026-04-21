---
title: Generative HDR Pipeline with Human QA
type: refactor
status: active
date: 2026-04-21
origin: docs/plans/zero-click-hybrid-qa-pipeline.plan.md
---

# Generative HDR Pipeline with Human QA

## Overview

Replacing the strict deterministic-only HDR pipeline with a powerful Generative Hybrid approach. We will merge exposure brackets using OpenCV to establish a structural base, then pass both the merged image and the original brackets into Gemini 3.1 Pro Image Generation (Nano Banana Pro) to synthesize an outstanding, highly polished final listing photo.

## Problem Frame

The previous pipeline strictly forbade generative AI due to MLS compliance fears, relying entirely on OpenCV Mertens fusion. However, the deterministic approach only yields "ok" results—often failing to pull the absolute best details from all brackets. Real estate agents have approved the use of generative AI (Nano Banana Pro) to achieve a luxurious, vibrant, "overdone" HDR look, provided they can manually review and approve the photos before MLS submission.

## Requirements Trace

- R1. Achieve a stunning, highly polished aesthetic (popping colors, dramatic lighting, luxurious wood textures).
- R2. Ensure maximum detail retention by giving the AI access to both the merged base and original exposure brackets.
- R3. Maintain the Split-Triage UI so agents can manually review and approve the generatively altered images.

## Scope Boundaries

- **No fully automated MLS uploads**: Because we are using generative AI, a human *must* remain in the loop via the Split-Triage UI.
- **Data Privacy & PII Compliance**: Uploading private residential interiors to the Free Tier of Google AI Studio grants Google rights to use the images for model training and human review. To prevent a massive PII breach, the system **must** be deployed using a Paid Tier billing account or Google Cloud Vertex AI, which strictly opts-out of foundation model training.
- **Asynchronous Architecture**: The 45-60s generation time requires an async `HTTP 202` job pattern with Server-Directed Polling. The queue must be strictly idempotent to prevent quota-draining duplicate submissions from flaky network retries.
- **State Persistence & Rehydration**: The Split-Triage UI must survive page refreshes during the 60-second generation window. The backend will persist active Job IDs to the user session, and the frontend will fetch `GET /jobs/active` on mount to resume polling, avoiding ephemeral Zustand state loss.
- **Resilient Asset Delivery**: GCS Signed URLs are short-lived for security (15 mins). If an agent leaves the tab open and returns, images will 403. The frontend must implement an `onError` auto-refresh handler linked to a dedicated `GET /jobs/{id}/signed-url` endpoint to seamlessly reload expired images.

## Context & Research

### Relevant Code and Patterns

- `backend/core/vision.py`: Currently handles OpenCV `cv2.createMergeMertens()`.
- `backend/core/vlm_loop.py`: Currently uses `google-genai` for QA; will be repurposed or augmented for Image Generation.
- `gemini-imagegen` skill: Demonstrates passing multiple reference images (up to 14) to `gemini-3-pro-image-preview`.

### External References

- **Leeroopedia MCP**: An ML & AI Knowledge Wiki that we will query to ensure we follow best practices for hybrid image pipelines, Gemini prompt engineering, and OpenCV optimization.

## Key Technical Decisions

- **Hybrid Input Strategy**: We will use OpenCV to generate a `fused.jpg` base. We will then feed `[Prompt, fused.jpg, bracket_1.jpg, bracket_2.jpg, bracket_3.jpg, bracket_4.jpg, bracket_5.jpg]` into Gemini 3.1 Pro Image Generation. This gives the AI the structural composition (from the fused image) and the complete highlight/shadow details across all exposures.
  - *Note on Brackets*: The Gemini API supports up to 14 reference images. We will pass all 5 original brackets alongside the fused image to give the model the maximum possible dynamic range context, assuming the payload size allows it after downsampling.
- **Automated Structural QA Judge**: Relying solely on fatigued humans to spot subtle structural hallucinations (e.g., altered window mullions, missing outlets) across 50-image batches carries massive MLS liability. We will replace the VLM QA step with a **Deterministic Computer Vision Structural Diff**. Using SIFT feature matching or ORB feature matching, we will mathematically compute the homography warp of the original OpenCV fused image against the Gemini generated image, strictly ignoring lighting/color to flag geometric drift.
- **Memory Lifecycle Management**: OpenCV's `float32` matrix math for 24MP images will cause severe OOM spikes (1.5GB+ per image) in serverless containers, and its `glibc` C++ bindings cause permanent memory fragmentation. Workers must enforce a concurrency limit of 1 and explicitly call `gc.collect()` and `ctypes.CDLL('libc.so.6').malloc_trim(0)` at boundary steps to forcefully return memory to the OS.
- **Payload Paradox & Files API**: Passing 6 images (Base + 5 brackets) as Base64 `inline_data` will result in `413 Payload Too Large` errors or force destructive downsampling. The pipeline will instead upload references via the Gemini **Files API** (`genai.Client().files.upload()`), allowing larger files without JSON bloat. 
  - *Execution Note on Brackets*: The implementing engineer should A/B test if providing 5 brackets actually improves the output or just causes attention dilution compared to simply providing the high-quality OpenCV fused image.
- **Safety Filter Bypassing**: Indoor real estate (bedrooms/bathrooms) often triggers Gemini's `HARM_CATEGORY_SEXUALLY_EXPLICIT` filters. The API call must explicitly set thresholds to `BLOCK_NONE` and append "Professional interior architectural photography" to the prompt to bypass Layer 2 safety blocks.
- **Aspect Ratio Handling**: We will explicitly **omit** the `aspect_ratio` parameter in the Gemini API `ImageConfig`. The framework defaults to matching the input image's exact dimensions if omitted. Forcing an idiosyncratic DSLR ratio (1.45:1) into a standard bucket (16:9) causes the API to natively center-crop or stretch the image, ruining downstream geometric diffs.
- **Image Generation Model**: `gemini-3-pro-image-preview` at 2K resolution (to balance high-end real estate quality with generation speed).

## Open Questions

### Resolved During Planning

- **Should we use OpenCV first?** Yes. Providing a deterministically merged base grounds the generative model's composition.
- **Do we still need the automated VLM QA Judge?** Yes, but its purpose has changed. Instead of checking for blown-out windows, it acts as an adversarial `diff` tool comparing the OpenCV base to the generated image to spot structural hallucinations before the human agent reviews it.

### Deferred to Implementation

- **API Tier Scaling**: The current dispatch throttle targets the Tier 1 limit (10 Images Per Minute). As the application scales and unlocks higher Gemini tiers, the queue throttle will need to be parameterized and adjusted.

## Implementation Units

- [ ] **Unit 0: Leeroopedia ML/AI Best Practices Research**

**Goal:** Query the Leeroopedia MCP knowledge base before writing code to discover industry best practices for our specific hybrid deterministic+AI pipeline.

**Requirements:** R1, R2

**Dependencies:** None

**Approach:**
- Use the Leeroopedia MCP to run expert-level semantic searches tailored to its strengths (ML inference optimization, GPU kernels, and multimodal pipeline architecture):
  1. *Multimodal Payload Engineering:* "Best practices for passing multiple high-resolution images as multimodal context to LLMs/Vision models to avoid attention dilution and API payload exhaustion."
  2. *OpenCV/Triton Optimization:* "How to optimize OpenCV Mertens fusion or write a custom Triton kernel for exposure fusion to minimize inference latency before passing data to an LLM."
  3. *Human-in-the-Loop Architecture:* "Production architectural patterns for handling generative vision safety blocks and human-in-the-loop (HITL) review queues for image generation pipelines."
- Synthesize the findings and update the implementation approach for Unit 1 if the knowledge base recommends specific architectural tweaks (like using Triton kernels for OpenCV or specific multimodal batching strategies).

**Test scenarios:**
- Test expectation: none -- this is a research step.

- [ ] **Unit 1: Implement Async HTTP 202 Polling Architecture**

**Goal:** Build a robust state machine and background queue to handle 60-second generation times without triggering 504 Gateway Timeouts.

**Requirements:** R3, Asynchronous Architecture Scope

**Dependencies:** None

**Files:**
- Modify: `backend/core/use_cases.py`
- Modify: `backend/infrastructure/api_routes.py` (or equivalent routing file)

**Approach:**
- Create a simple database table or Redis structure for `JobState` (ID, Status, Result, Error).
- Refactor the current synchronous upload route to return `HTTP 202 Accepted` immediately with a Job ID. **Must require an Idempotency Key**. The frontend must generate an Action-Scoped UUIDv4 when the user initiates the upload and persist it in component state (to reuse the exact same UUID across network retries for that specific batch), guaranteeing deterministic backend deduplication without blocking the main UI thread with heavy hashing operations.
- Offload the actual processing (OpenCV + Gemini) to a background worker or Cloud Task.
- **Queue Rate Limiting:** Enforce a strict "Leaky Bucket" dispatch throttle of **1 request every 6 seconds** to strictly respect Gemini 3.1 Pro's Tier 1 limit of 10 Images Per Minute (IPM). Add exponential backoff with jitter to gracefully handle `HTTP 429 Resource Exhausted` errors. Auto-retries must be re-enqueued here, not looped synchronously in the worker.
- Implement a `GET /jobs/active` endpoint for the frontend to fetch all running/completed jobs for the current session on page mount.
- **Batch Polling (Preventing the Stampede)**: Instead of `GET /jobs/{id}` which causes O(N) scaling issues and DDoS risks, implement a single `POST /jobs/batch-status` endpoint. The frontend will pass an array of active Job IDs. The response will return an array of job statuses, embedding a per-job `retryAfterSeconds` directly in the JSON payload (to handle heterogeneous generation times) alongside a global API Gateway `Retry-After` HTTP header.
- **Signed URL Generation**: When a job status is `COMPLETED` in the batch response, the backend must generate short-lived **GCS Signed URLs** for BOTH the full 2K image and the thumbnail. Because Cloud Run instances lack private key JSON files, the backend must use the IAM API for *remote signing* (passing `service_account_email` and `access_token` explicitly) and the service account must have the `Service Account Token Creator` role.
- Implement a `POST /jobs/batch-signed-url` endpoint to allow the frontend to request fresh URLs when they naturally expire during long sessions.

**Test scenarios:**
- Happy path: Submitting brackets returns 202 instantly, and polling eventually yields a COMPLETED status with image URLs.

- [ ] **Unit 2: Repurpose Vision Pipeline for Hybrid Generation**

**Goal:** Modify the backend pipeline to generate the OpenCV merged base, then pass it along with the brackets to Nano Banana Pro.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `backend/core/use_cases.py`
- Modify: `backend/core/vision.py`
- Modify: `backend/core/vlm_loop.py` (Rename/refactor to `generation_loop.py`)

**Approach:**
- Keep the `cv2.createMergeMertens` step to create the base image.
- Calculate the aspect ratio of the source image. Explicitly **omit** the `aspect_ratio` string parameter in the API config to allow Gemini to match the native input dimensions, preventing native cropping or stretching that ruins downstream geometric diffs.
- Upload the images via the **Gemini Files API** (`client.files.upload()`) rather than passing them as Base64 `inline_data` to bypass the 413 Payload limit.
- Refactor the `google-genai` integration to call `generate_content` on `gemini-3-pro-image-preview`.
- Configure `SafetySetting` to `BLOCK_NONE` for explicit/dangerous content to prevent bedroom/bathroom false positives.
- **Multimodal Payload Sequencing**: The `contents` array must use Interleaved Labeling and strictly follow the `[Images..., Text]` sequence to combat transformer recency bias. The array will be structured as: `["Base OpenCV merged image:", <fused_file_uri>, "Exposure brackets (dark to light):", <bracket_1_uri>, ..., <bracket_5_uri>, <Strict Text Prompt>]`.
- The prompt must use the **SCHEMA Prohibition methodology** with explicit blocks: `MANDATORY: Retain exact room geometry, window placement, and structural lines.` and `PROHIBIT: Do not add furniture. Do not move walls. Do not alter window frames.`
- Wrap the generation call in a `try/except` block. If a safety block is encountered, fallback to returning the deterministic OpenCV fused image.
- **Execute a Deterministic Structural Diff & Auto-Retry Loop:** Use OpenCV to extract SIFT or ORB feature matches between the original Fused Base and the generated Gemini image. Downsample to 1024px, use a strict Lowe's ratio test (0.7), and calculate homography via `MAGSAC++`. 
- **The Spatial Inlier Void Pattern (Hallucination Detection)**: MAGSAC++ will successfully calculate homographies even if a hallucinated object (like a massive virtual couch) occludes 40% of the room. To detect this, the worker must plot the *remaining inliers* onto a 2D spatial density map (2D histogram). If there is a massive contiguous void in the inlier density map, flag it as a hallucinated occlusion. If the structural warp exceeds the drift threshold or the spatial void check fails, the worker must **re-enqueue the job** (bypassing the throttle) up to 3 times, appending a penalty clause to the prompt.
- **Fallback**: If the generation fails the SIFT diff 3 times, simply return the deterministic OpenCV fused base. Do not attempt heavy LAB-space filtering, as this risks OOM crashes and "Frankenstein" color bleeding.
- **CRITICAL OOM Prevention**: Downsample the 5 brackets to a maximum dimension of `2048px` using `cv2.INTER_AREA` *before* the `cv2.createMergeMertens` step. This reduces memory spikes from 1.5GB to under 100MB and speeds up OpenCV processing. The worker must explicitly invoke `del`, `gc.collect()`, and `ctypes.CDLL('libc.so.6').malloc_trim(0)` immediately after OpenCV heavy operations.
- **CRITICAL Files Quota Limit**: The Gemini Files API has a strict 20GB project quota. Implement a `finally` block to explicitly call `client.files.delete()` for every reference file to keep baseline utilization near zero. The previously planned out-of-band cron job has been dropped (YAGNI), as Gemini's built-in 48-hour auto-deletion acts as a sufficient safety net for orphaned files caused by hard worker crashes (it would take 68+ consecutive crashes in 48 hours to exhaust the 20GB quota).
- Extract the generated `.jpg` from `part.as_image()`. **Generate a low-res thumbnail (e.g., 800px WebP) alongside the 2K output.** Save/upload both to GCS.

**Patterns to follow:**
- `gemini-imagegen` skill for handling multiple image inputs and extracting the output image payload.
- Existing `downsample_for_vlm` logic for reducing reference payload size.

**Test scenarios:**
- Happy path: 5 brackets input + OpenCV merge -> dynamically maps aspect ratio -> GenAI prompt successfully returns a valid JPEG image byte stream.
- Edge case: 3 brackets or 7 brackets input handled correctly.
- Edge case: Gemini safety filter triggers (e.g. face in portrait) -> gracefully falls back to returning the OpenCV fused image.
- Error path: Gemini API fails or times out -> Cloud Task retry logic triggers or raises clear domain error.

- [ ] **Unit 3: Update Frontend Review Flow (Manual Default & Resiliency)**

**Goal:** Ensure generated images land in the "Needs Review" queue by default, survive page refreshes, and handle expired secure URLs seamlessly.

**Requirements:** R3

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `frontend/src/components/UploadFlow.tsx`
- Modify: `frontend/src/components/ReviewGrid.tsx`
- Modify: `frontend/src/store/useJobStore.ts` (or equivalent Zustand store)

**Approach:**
- **Job Rehydration:** Add a `useEffect` hook to `UploadFlow.tsx` that calls `GET /jobs/active` on mount to repopulate the Zustand store with any jobs that were processing if the user refreshed the page.
- **Centralized Zustand Polling Loop**: Transition from individual component polling to a centralized `pollDueJobs` interval loop in Zustand. The store tracks `nextPollAt` for each job, and the loop collects only the IDs due for a status check, sending them to the `POST /jobs/batch-status` endpoint.
- **Manual Default:** Hardcode the state transition so that all generated images default to the "Needs Review" queue for human approval.
- **OOM-Safe Rendering (Thumbnails)**: The `ReviewGrid` must exclusively render the Signed URLs for the lightweight WebP thumbnails. The full 5MB 2K Signed URLs are only requested/rendered when an agent clicks to view a specific image in a single full-screen modal.
- **Signed URL Auto-Refresh:** Add an `onError` handler to the `<img>` tags in `ReviewGrid.tsx`. If an image fails to load (e.g., 403 Forbidden due to an expired 15-min Signed URL), it automatically requests a fresh token via the batch signed URL endpoint and retries the render.
- Expose the new Structural Diff QA score in the UI. If the SIFT diff flagged geometric drift and exhausted its 3 retries, display a prominent warning to the agent next to the photo.

**Test scenarios:**
- Happy path: When a batch finishes processing, all items appear in the "Needs Review" sidebar.

## System-Wide Impact

- **Storage (The Unbounded Graveyard Risk)**: We are now generating 2K JPEGs via Gemini. We must ensure the byte streams are correctly handled and uploaded to GCS without media type mismatches. **Crucially**, to prevent an infinitely scaling cloud bill from intermediate files, the GCS output bucket MUST be configured with a strict Object Lifecycle Management (OLM) policy (e.g., `Age > 7 days -> Delete`) to automatically garbage collect images after the human agent has triaged them.
- **Latency**: Generative image creation takes longer than deterministic OpenCV math. The frontend polling mechanism must be robust enough to handle 10-20 second generation times per image.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Generative Hallucination (e.g., changing floor plans) | Use SCHEMA prompting (MANDATORY/PROHIBIT) to guide the model. Use SIFT Homography diff as an automated loss function to auto-retry 3x. If all 3 fail, return the OpenCV base before sending to Split-Triage UI. |
| API Payload Exhaustion (413 Errors) | Upload Fused Base + Brackets using Gemini **Files API**. Include strict `finally` cleanup block to avoid the 20GB quota crash. Built-in 48h expiration catches hard crash orphans. |
| Memory OOM Crashes (1.5GB+ spikes) | Remove heavy LAB-space filtering. Explicit `malloc_trim(0)` at worker boundaries. Hard concurrency limit of 1 per container. |
| API Rate Limits (429 Errors) | Async queue must implement an Idempotency Key, a strict 1-request-per-6-seconds dispatch throttle, and exponential backoff to respect the 10 IPM quota. |
| Data Privacy / PII Leak | Do NOT use the Free Tier (AI Studio). Explicitly mandate a Paid Billing Account or Vertex AI to opt-out of Google model training and human review. |
| Frontend Delivery Bottleneck | `GET /jobs/{id}` endpoint returns a **GCS Signed URL** for the 5MB 2K image, keeping heavy bandwidth off the backend proxy. |
| Ephemeral State Loss & Broken UI | Fetch `GET /jobs/active` on mount to rehydrate jobs after a page refresh. Use an `onError` hook to fetch a fresh Signed URL if the QA session exceeds 15 minutes. |
| Safety Blocks (bedrooms, portraits) | Set Layer 1 safety to `BLOCK_NONE`. Add "Professional architectural photography" intent to the prompt. Graceful fallback to OpenCV base. |
| Aspect Ratio distortion & Padding Hallucinations | **Do not pre-pad** images with black bars, and **omit** `aspect_ratio` from `ImageConfig` so the model natively matches the exact input bounds without cropping. |
