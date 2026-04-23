---
title: Cost & Performance Optimization for HDR Processing
type: refactor
status: active
date: 2026-04-22
---

# Cost & Performance Optimization for HDR Processing

## Overview

The current HDR processing pipeline suffers from excessive API costs, high latency, and server instability. This plan implements a series of optimizations identified by architectural review to reduce the Gemini API context payload, eliminate expensive retry loops, and fix critical event-loop blocking issues without impacting final image quality.

## Problem Frame

When a user uploads a bracketed room scene, the system fuses the images using OpenCV and then sends the fused base plus all 5 original brackets to `gemini-3-pro-image-preview`. Strict SIFT/MAGSAC QA checks and sub-optimal prompt temperatures cause frequent generation rejections, leading to multi-attempt retry loops. During these loops, all 6 images are redundantly re-uploaded to Gemini, blowing through API quotas, preventing Context Caching, and driving up costs. Additionally, synchronous garbage collection freezes the FastAPI event loop, and failed uploads leak temporary files on disk.

## Requirements Trace

- R1. Reduce API costs per bracket to a predictable baseline (~$0.135) by minimizing payload size and eliminating retry loops.
- R2. Maintain or improve the quality of the generated HDR images (structural integrity + window view preservation).
- R3. Eliminate server freezing (ASGI event loop blocking) during heavy load.
- R4. Prevent disk space exhaustion from leaked temporary files.

## Scope Boundaries

- We are not changing the classical OpenCV fusion algorithm (alignMTB + Mertens).
- We are not swapping Gemini out for a different model.
- We are not modifying the grouping agent logic.

## Key Technical Decisions

- **Bracket Pruning**: Send only 2 images to Gemini (the `fused_base` and the single darkest bracket) instead of 6. The `fused_base` handles the interior, while the darkest bracket provides the window recovery data.
- **Hoisting Uploads**: Gemini file uploads will occur *once* before the generation retry loop, ensuring Context Caching activates.
- **Deterministic Prompting**: Setting `temperature=0.0` to force structural adherence, combined with a slightly relaxed SIFT threshold (`8.0`), to drastically reduce false-positive QA rejections.

## Implementation Units

- [ ] **Unit 1: Fix Temporary File Leak in Uploads**
**Goal:** Ensure local temp files are deleted even if Gemini upload fails.
**Requirements:** R4
**Files:**
- Modify: `backend/core/generation_loop.py`
**Approach:** 
Refactor the `upload` helper function inside `generate_hybrid_hdr` to use a `try...finally` block to ensure `os.remove(tmp_path)` executes regardless of API exceptions.

- [ ] **Unit 2: Prevent Event Loop Blocking**
**Goal:** Stop `gc.collect()` and `malloc_trim` from freezing the server.
**Requirements:** R3
**Files:**
- Modify: `backend/core/use_cases.py`
**Approach:** 
Move the `gc.collect()` and `ctypes.CDLL('libc.so.6').malloc_trim(0)` calls inside an `asyncio.to_thread` wrapper, or remove them entirely if python's implicit GC is sufficient after unreferencing the large numpy arrays.

- [ ] **Unit 3: Hoist Gemini Uploads & Reduce Payload (Bracket Pruning)**
**Goal:** Upload files once to enable Context Caching and send only the darkest bracket alongside the base.
**Requirements:** R1
**Files:**
- Modify: `backend/core/use_cases.py`
- Modify: `backend/core/generation_loop.py`
**Approach:**
In `ProcessHdrGroupUseCase`, identify the darkest bracket (lowest mean brightness) from the `downsampled_images` array. Only convert this single bracket to bytes (instead of all 5). Update `generate_hybrid_hdr` signature and logic to accept `darkest_bracket_bytes` instead of a list of brackets. Move the `client.files.upload` logic out of the retry loop.

- [ ] **Unit 4: Tune Model Temperature & SIFT QA Thresholds**
**Goal:** Eliminate false-positive QA rejections and ensure deterministic output.
**Requirements:** R1, R2
**Files:**
- Modify: `backend/core/generation_loop.py`
**Approach:**
Change the `temperature` in `types.GenerateContentConfig` to `0.0`. In `compute_structural_diff`, increase the `cv2.USAC_MAGSAC` threshold from `5.0` to `8.0` to accommodate minor generative smoothing while still catching major hallucinations.

## System-Wide Impact

- **Interaction graph:** Gemini API usage will shift from multiple redundant file uploads per job to a single optimized payload upload.
- **State lifecycle risks:** Files will correctly clear from `/tmp` even on 5xx API errors.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Pruning brackets loses lighting context | The OpenCV `fused_base` already contains perfectly merged exposure data. The darkest bracket is sufficient for the VLM to recover window blowouts. |
| Relaxed SIFT allows hallucinations | 8.0 is still a tight threshold for 1024px images. It will catch major structural changes but allow generative sub-pixel noise. |
