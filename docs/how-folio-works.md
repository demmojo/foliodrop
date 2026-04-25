# How Folio Works: The Background Pipeline

## 1. The Bird's Eye: Philosophy & Architecture

*(Visual: High-level block diagram showing the flow from Camera Roll -> Folio Intelligent Ingestion -> Hybrid Processing Engine -> Instant Delivery)*

- **The Core Problem:** Real estate interiors have extreme dynamic ranges—bright exterior windows and dark interior shadows. Cameras cannot capture this in a single shot. 
- **The Folio Solution:** By ingesting bracketed photography (multiple exposures like -2, 0, +2 EV), Folio mathematically merges them into a single, perfectly balanced High Dynamic Range (HDR) image, prioritizing architectural accuracy and natural lighting.

## 2. Stage 1: Intelligent Ingestion (Local Processing)

- **Zero-Friction Import:** Full-viewport dropzone accepting JPEGs, TIFFs, and HEICs with immediate local file validation.
- **On-Device EXIF Parsing:** Before any data leaves the device, the browser securely extracts capture time, exposure compensation (EV), aperture (f-stop), and ISO.
- **Time-Based Scene Grouping:** The algorithm groups continuous rapid-fire shots into scenes based on microsecond time gaps and exposure metadata.
- **Visual AI Fallback:** If images lack EXIF data, the client generates lightweight thumbnails to visually cluster photos by room angle and composition without blocking the upload pipeline.

## 3. Stage 2: Direct-to-Cloud Secure Transfer

- **Accelerated Transfer:** To ensure maximum speed, the frontend requests secure signed URLs and uploads original brackets directly to the cloud storage layer.
- **Ephemeral Privacy:** All data is tied to secure, 48-hour ephemeral sessions identified by unguessable Room Codes.
- **Agency Settings & Style Isolation:** The system provides Agency Login, securely isolating individual agency style profiles, specific editing preferences, and dedicated quotas using Firebase Auth.

## 4. Stage 3: The Hybrid Engine (OpenCV + AI Polish)

*(Visual: Interactive slider comparing a raw bracket, the deterministic OpenCV merge, and the final AI Polish)*

- **Bracket Caching (Short-Circuit):** Before processing begins, Folio hashes the incoming brackets. If identical photos have been processed previously, the system serves the HDR result instantly from cache, saving compute time and eliminating wait periods.
- **Pre-Merge Optimization:** Original brackets are downsampled to an optimized 2K resolution (2048px), the perfect size for Multiple Listing Services (MLS), ensuring blazing fast processing without freezing server resources.
- **Halo-Free Contrast (OpenCV Base):** 
  - *Alignment:* Corrects micro-jitter and camera shake between handheld brackets.
  - *Exposure Fusion:* Custom weights prioritize dark brackets to ensure crisp exterior views out of windows.
  - *Real Estate Heuristics:* Utilizes CLAHE in the LAB color space to boost room brightness without the glowing halos common in cheap HDR software.
- **Bracket Pruning & Optimized Uploads:** To optimize the VLM process, Folio sends only two inputs to the model: the perfectly fused OpenCV base (for interior details) and the single darkest bracket (for window recovery). Uploads are hoisted to accelerate processing.
- **Deterministic Generative Polish:** The pruned 2K inputs are refined by a Vision Language Model (VLM) running at a strict temperature of `0.0`. This guarantees consistent structural adherence while balancing interior lighting, executing window pulls, and applying agency-specific color grading based on explicit training pairs provided by the agency.

## 5. Stage 4: Zero-Wait Local Delivery

- **Real-Time Feedback:** Optimized batch-status syncing drives a fluid, deterministic Processing Console UI without hammering the network.
- **Review & Verification:** Users review the final 2K outputs. Flagged images (where AI QA executed a safe fallback) are clearly marked for verification.
- **Instant Device Packaging:** Once approved, images are packaged directly on the user's device (using the native Web Share API for mobile camera rolls, or batched ZIPs for desktop). This eliminates the need to wait for a server to pack and transmit a massive archive, allowing the photographer to walk away with their files instantly.

## 6. Testing & Reliability

Folio relies on extreme deterministic reliability, backed by 100% test coverage across both the frontend React/Zustand client and the backend Python/FastAPI pipeline. We mock external APIs, including storage buckets and Gemini Vision endpoints, to ensure robust behavior across edge cases—from processing massive files during server memory constraints to executing graceful fallbacks when the AI hallucination threshold is triggered.
