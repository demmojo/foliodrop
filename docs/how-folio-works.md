# How Folio Works: The Background Pipeline

## 1. The Bird's Eye: Philosophy & Architecture

*(Visual: High-level block diagram showing the flow from Camera Roll -> Folio Intelligent Ingestion -> Hybrid Processing Engine -> Instant Delivery)*

- **The Core Problem:** Real estate interiors have extreme dynamic ranges—bright exterior windows and dark interior shadows. Cameras cannot capture this in a single shot. 
- **The Folio Solution:** By ingesting bracketed photography (multiple exposures like -2, 0, +2 EV), Folio mathematically merges them into a single, perfectly balanced High Dynamic Range (HDR) image, prioritizing architectural accuracy and natural lighting.

## 2. Stage 1: Intelligent Ingestion (Local Processing)

- **Zero-Friction Import:** Full-viewport dropzone accepting JPEGs, TIFFs, and HEICs with immediate local file validation.
- **On-Device EXIF Parsing:** Before any data leaves the device, the browser securely extracts capture time, exposure compensation (EV), aperture (f-stop), and ISO.
- **Intelligent Room Identification:** During the processing pipeline, Folio employs AI Room Tagging strategies to automatically identify spaces. Using the Gemini Vision API or on-device models, it analyzes the merged image and metadata to tag scenes (e.g., "Kitchen", "Primary Bedroom") seamlessly.
- **Deterministic Scene Grouping:** The algorithm intelligently groups continuous rapid-fire shots into 3, 5, or 7-bracket scenes based on microsecond time gaps.
- **Visual AI Fallback:** If images lack EXIF data, the client generates lightweight thumbnails to visually cluster photos by room angle and composition without blocking the upload pipeline.

## 3. Stage 2: Direct-to-Cloud Secure Transfer

- **Accelerated Transfer:** To ensure maximum speed, the frontend requests secure signed URLs and uploads original brackets directly to the cloud storage layer.
- **Ephemeral Privacy:** All data is tied to secure, 48-hour ephemeral sessions identified by unguessable Room Codes.
- **Agency Settings & Style Isolation:** The system provides Agency Login, securely isolating individual agency style profiles, specific editing preferences, and dedicated quotas using Firebase Auth.

## 4. Stage 3: The Hybrid Engine (OpenCV + AI Polish)

*(Visual: Interactive slider comparing a raw bracket, the deterministic OpenCV merge, and the final AI Polish)*

- **Pre-Merge Optimization:** Original brackets are downsampled to an optimized 2K resolution (2048px), the perfect size for Multiple Listing Services (MLS), ensuring blazing fast processing.
- **Halo-Free Contrast (OpenCV Base):** 
  - *Alignment:* Corrects micro-jitter and camera shake between handheld brackets.
  - *Exposure Fusion:* Custom weights prioritize dark brackets to ensure crisp exterior views out of windows.
  - *Real Estate Heuristics:* Utilizes CLAHE in the LAB color space to boost room brightness without the glowing halos common in cheap HDR software.
- **The Generative Polish:** The optimized 2K inputs are refined by a Vision Language Model (VLM) to perfectly balance interior lighting, execute window pulls, and apply agency-specific color grading based on explicit training pairs provided by the agency.

## 5. Stage 4: Strict Quality Assurance (Anti-Hallucination)

*(Visual: Expandable flowchart showing the SIFT keypoint matching and fallback logic)*

- **The Problem with AI:** Generative models can hallucinate, occasionally adding fake furniture or altering structural lines like window mullions.
- **Pixel-Level Geometric Mapping:** Folio extracts SIFT (Scale-Invariant Feature Transform) keypoints from both the safe OpenCV base and the AI-polished output.
- **Strict Hallucination Thresholds:** Using mathematical homography (MAGSAC++), the system detects structural drift. If the AI alters the room's geometry beyond strict thresholds, it is instantly rejected.
- **Deterministic Fallback:** If the AI polish fails QA, the system safely falls back to the mathematically precise OpenCV base, flagging the image so the photographer knows exactly what happened.

## 6. Stage 5: Zero-Wait Local Delivery

- **Real-Time Processing Feedback:** Optimized batch-status syncing drives a fluid, deterministic Processing Console UI without hammering the network.
- **Review & Verification:** Users review the final 2K outputs. Flagged images (where AI QA executed a safe fallback) are clearly marked for verification.
- **Instant Device Packaging:** Once approved, images are packaged directly on the user's device (using the native Web Share API for mobile camera rolls, or batched ZIPs for desktop). This eliminates the need to wait for a server to pack and transmit a massive archive, allowing the photographer to walk away with their files instantly.

## 7. Testing & Reliability

Folio relies on extreme deterministic reliability, backed by 100% test coverage across both the frontend React/Zustand client and the backend Python/FastAPI pipeline. We mock external APIs, including storage buckets and Gemini Vision endpoints, to ensure robust behavior across edge cases—from processing massive files during server memory constraints to executing graceful fallbacks when the AI hallucination threshold is triggered.
