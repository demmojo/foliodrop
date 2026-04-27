# How Folio Works: The Background Pipeline

## 1. The Bird's Eye: Philosophy & Architecture

*(Visual: High-level block diagram showing the flow from Camera Roll -> Folio Intelligent Ingestion -> Hybrid Processing Engine -> Instant Delivery)*

- **The Core Problem:** Real estate interiors have extreme dynamic ranges—bright exterior windows and dark interior shadows. Cameras cannot capture this in a single shot. 
- **The Folio Solution:** By ingesting bracketed photography (multiple exposures like -2, 0, +2 EV), Folio mathematically merges them into a single, perfectly balanced High Dynamic Range (HDR) image, prioritizing architectural accuracy and natural lighting.

## 2. Stage 1: Intelligent Ingestion (Local Processing)

- **Zero-Friction Import:** Full-viewport dropzone accepting JPEG, PNG, TIFF, HEIC, and HEIF files with immediate local validation.
- **On-Device EXIF Parsing:** Before any data leaves the device, the browser securely extracts capture time, exposure compensation (EV), aperture (f-stop), and ISO.
- **Time-Based Scene Grouping:** The algorithm groups continuous rapid-fire shots into scenes based on microsecond time gaps and exposure metadata.
- **Visual AI Fallback:** If images lack EXIF data, the client generates lightweight thumbnails to visually cluster photos by room angle and composition without blocking the upload pipeline.

## 3. Stage 2: Direct-to-Cloud Secure Transfer

- **Accelerated Transfer:** To ensure maximum speed, the frontend requests secure signed URLs and uploads original brackets directly to the cloud storage layer.
- **Session Codes for Continuity:** Data is scoped to session/room codes so teams can resume work later. Treat session codes like shareable access tokens and avoid posting them publicly.
- **Agency Settings & Style Isolation:** In production, agency isolation is enforced through auth-scoped requests. In local/dev mode, fallback agency IDs are supported for offline workflows.

## 4. Stage 3: The Hybrid Engine (OpenCV + AI Polish)

*(Visual: Interactive slider comparing a raw bracket, the deterministic OpenCV merge, and the final AI Polish)*

- **Bracket Caching (Short-Circuit):** Before processing begins, Folio hashes the incoming brackets. If identical photos have been processed previously, the system serves the HDR result instantly from cache, saving compute time and eliminating wait periods.
- **Pre-Merge Optimization:** Original brackets are downsampled to an optimized 2K resolution (2048px), the perfect size for Multiple Listing Services (MLS), ensuring blazing fast processing without freezing server resources.
- **Composition & Framing Pre-flight:** Before any merge happens, every bracket is matched against the median-brightness reference using SIFT keypoints, MAGSAC++ inlier counting, and a near-identity homography check. Three things must be true: the photos must depict the same scene (composition), share the same aspect ratio and resolution (framing), and produce a near-identity warp (no major pan, zoom, or rotation). If any of those checks fail, the job is flagged with a clear reason instead of producing a smeared output. Training-pair uploads use the same gate—including a check that the user's final edit matches the brackets—so corrupt training data is rejected at the API boundary. Pixel-perfect alignment within a verified scene is then enforced by AlignMTB.
- **Halo-Free Contrast (OpenCV Base):** 
  - *Alignment:* Corrects micro-jitter and camera shake between handheld brackets.
  - *Exposure Fusion:* Custom weights prioritize dark brackets to ensure crisp exterior views out of windows.
  - *Real Estate Heuristics:* Utilizes CLAHE in the LAB color space to boost room brightness without the glowing halos common in cheap HDR software.
- **Bracket Pruning & Optimized Uploads:** To optimize the VLM process, Folio sends only two inputs to the model: the perfectly fused OpenCV base (for interior details) and the single darkest bracket (for window recovery). Uploads are hoisted to accelerate processing.
- **Deterministic Generative Polish:** The pruned 2K inputs are refined by a Vision Language Model (VLM) running at a strict temperature of `0.0`. This guarantees consistent structural adherence while balancing interior lighting, executing window pulls, and applying agency-specific color grading based on explicit training pairs provided by the agency.
- **Structural QA Gate (Anti-Hallucination):** Every generated frame is compared back to the OpenCV base using SIFT feature matching with MAGSAC++ homography. If the inlier ratio drops below threshold or large feature voids appear (a tell-tale sign of invented windows or moved walls), the system automatically retries with a corrective prompt. After the retry budget is exhausted, the fused OpenCV base is shipped instead of the AI output and the result is flagged for human review—so no hallucinated geometry ever reaches the listing.

## 5. Stage 4: Zero-Wait Local Delivery

- **Real-Time Feedback:** Optimized batch-status syncing drives a fluid, deterministic Processing Console UI without hammering the network.
- **Review & Verification:** Users review the final 2K outputs. Flagged images (where AI QA executed a safe fallback) are clearly marked for verification.
- **Instant Device Packaging:** Once approved, images are packaged directly on the user's device (using the native Web Share API for mobile camera rolls, or batched ZIPs for desktop). This eliminates the need to wait for a server to pack and transmit a massive archive, allowing the photographer to walk away with their files instantly.

## 6. Testing & Reliability

Folio relies on deterministic fallback behavior and extensive automated tests across the React/Zustand frontend and Python/FastAPI backend. External services (storage and model calls) are mocked in test suites to validate edge cases such as memory pressure, retries, and structural-QA fallback behavior.
