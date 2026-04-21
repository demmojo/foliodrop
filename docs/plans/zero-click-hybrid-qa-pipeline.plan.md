---
name: Zero-Click Hybrid Pipeline with VLM QA
overview: A robust Real Estate HDR pipeline that combines deterministic OpenCV Mertens fusion for mathematical accuracy with Gemini 3.1 Pro acting as a strict, non-destructive QA judge. The frontend uses a 'Split-Triage' design with a darkroom aesthetic to support professional, high-volume batch processing. Generative AI for pixel manipulation is strictly forbidden to ensure MLS compliance. The project adheres to strict Red-Green TDD with 100% unit and branch coverage, and intent-based tests for key flows.
todos:
  - id: tdd-coverage-setup
    content: Set up Pytest coverage reporting and Playwright intent-based testing infrastructure to mandate 100% unit and branch coverage.
    status: pending
  - id: backend-opencv-pipeline
    content: Replace VLM-ImageMagick math with OpenCV `cv2.createMergeMertens` and 16-bit CLAHE local contrast. Add deterministic polish (Unsharp Mask, Bilateral Filtering).
    status: pending
  - id: backend-vlm-qa-judge
    content: Refactor `vlm_loop.py` to evaluate the final fused image against the darkest bracket, using Chain-of-Thought scoring for Window Detail.
    status: pending
  - id: frontend-outcome-ui
    content: Update `ProcessingConsole.tsx` to use HTTP polling for batch outcome states (Processing -> Ready -> Flagged), removing SSE bloat.
    status: pending
  - id: frontend-triage-ui
    content: Implement the 'Split-Triage' UI with a darkroom aesthetic (#222222), separating flagged images into a sidebar and allowing click-to-loupe A/B inspection.
    status: pending
isProject: true
---

# Zero-Click Hybrid Pipeline with VLM QA

## 1. Product & Architecture Thesis
Based on extensive product and adversarial review, we are finalizing the architecture to prioritize **Heuristics Over Complexity** for the image processing, while leveraging the VLM (Gemini 3.1 Pro) for its true strength: **Semantic Quality Assurance**. 

**CRITICAL CONSTRAINT: MLS Compliance & Generative AI**
Generative AI models (such as Nano Banana Pro or any image-to-image synthesis models) are **strictly forbidden** in the pixel alteration path. Real Estate Multiple Listing Services (MLS) have strict regulations against misrepresenting properties. Using generative models to "polish" an image risks hallucinating window views, removing structural blemishes, or synthesizing textures, which exposes our users to severe legal liability and MLS bans. All image manipulation must remain mathematically deterministic.

To maintain the "Zero-Click Appliance" promise for batch uploads, the frontend will drop complex SSE streaming in favor of robust HTTP polling. It will display outcome-based states rather than raw backend logs, which overwhelm high-volume users. The UI will adopt a "Split-Triage" Pro Utility design.

## 2. Testing Strategy: Red-Green TDD & 100% Coverage
Quality and predictability are paramount. All new features and refactors must strictly adhere to **Red-Green Test-Driven Development (TDD)**. 

### 2.1 100% Unit and Branch Coverage
- **Backend (Pytest)**: Every core utility, use case, and domain model must have 100% unit and branch coverage (`pytest --cov --cov-branch`).
- **Frontend (Vitest/RTL)**: All pure functions, hooks, and complex components (like the Triage UI parsing logic) must achieve 100% branch coverage.
- Code cannot be merged if it drops coverage below 100%.

### 2.2 Intent-Based Flow Testing (Playwright)
Beyond unit tests, the most critical user flows must be covered by **Intent-Based Tests** that verify the system from the user's perspective, without being tightly coupled to DOM implementation details.
- **The "Zero-Click" Upload & Export Flow**: Test the entire journey from dropping 50 images to clicking "Export Batch" without touching any sliders.
- **The "Split-Triage" QA Flow**: Test that an image artificially flagged by a mocked VLM correctly routes to the sidebar, allows A/B inspection, and can be successfully discarded or kept.

## 3. Backend Pipeline (FastAPI + OpenCV + Gemini)

The image processing pipeline will be strictly linear and deterministic.

### 3.1 Deterministic Core (OpenCV 16-bit Pipeline)
1. **Intake & Alignment**: Load bracketed byte streams into memory. Align using `cv2.createAlignMTB()`.
2. **Exposure Fusion**: Merge brackets using `cv2.createMergeMertens()`.
3. **Contrast & Polish (16-bit)**: 
    - *Correction*: Avoid premature 8-bit truncation. Scale the `float32` Mertens output to `uint16` (multiplying by 65535 and clipping).
    - Convert to LAB space. Apply `cv2.createCLAHE` on the 16-bit Luminance channel to pop interior shadows without posterization/banding.
    - **Deterministic Polish**: Apply safe, non-generative finishing touches:
        - *Edge-Preserving Noise Reduction*: Use `cv2.bilateralFilter` to smooth shadow noise without softening architectural lines.
        - *Unsharp Masking*: Apply an unsharp mask on the Luminance channel for crisp, professional detail.
    - Convert back to BGR and downsample to 8-bit `uint8` for JPEG encoding.

### 3.2 The VLM QA Judge (Gemini 3.1 Pro)
The VLM acts purely as a reviewer and observability tool, not a hard blocker that creates manual labor.
- **Input**: Pass the final fused image AND the darkest original bracket (as a reference for window details).
- **Schema**: Use a `VLMQualityReport` Pydantic schema with **Chain-of-Thought**. The model must output `window_reasoning` before `window_score` to stabilize the numerical output.
- **Action**: If the image scores poorly, it is marked as `Needs Review` but *still delivered*. This prevents a failed image from halting a 50-image batch export.

## 4. Frontend Transparency & Pro Utility Design (Next.js)

### 4.1 The "Split-Triage" Hybrid UI
To solve the UX challenge of surfacing flagged images without blocking the batch export or burying them in a grid, the UI will use a Split-Triage approach:

1. **Information Architecture**: A master-detail split screen. A "Review Queue" left sidebar contains *only* the flagged images. The right side is a dense "Cargo" grid of successfully processed images. 
2. **Needs Review Flow**: In the sidebar, the VLM's `window_reasoning` is surfaced as a subtle tooltip or collapsible detail under the thumbnail. The user has explicit `[✓ Keep]` and `[🗑️ Discard]` actions inline.
3. **Inspection Mechanics**: Clicking a flagged image in the sidebar opens a full-screen "Loupe" modal featuring an **A/B Before & After slider**. The user compares the darkest reference bracket (Before) with the fused HDR (After) to verify window detail.
4. **Environment Tone**: The UI uses a true neutral 18% charcoal (`#222222`) to prevent color-tinting the user's perception of the photos. It avoids generic SaaS "white card" dashboards in favor of a professional darkroom aesthetic.
5. **Robust State**: Uses stateless 2-second HTTP polling instead of fragile SSE streams.
