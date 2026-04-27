# Folio Architecture (Current Runtime)

This document describes the architecture that is implemented in the current codebase.

## Stack

- Frontend: Next.js App Router, React, Zustand.
- Backend: FastAPI with hexagonal-style ports/adapters.
- CV/Imaging: OpenCV-based merge + structural checks.
- Async execution: Google Cloud Tasks.
- Storage/metadata: Google Cloud Storage + Firestore adapters.

## Runtime Flow

1. Client generates or reuses a human-readable session code.
2. Client requests signed upload URLs and uploads bracket images directly to storage.
3. Client finalizes grouped scenes via `POST /api/v1/finalize-job`.
4. Backend enqueues one Cloud Task per group/scene.
5. Worker processes each group:
   - Decodes/downsamples images.
   - Runs composition/framing consistency pre-flight.
   - Performs deterministic OpenCV base merge/alignment.
   - Optionally runs generative refinement with structural QA and fallback.
6. Results are persisted per job and surfaced to the UI.
7. Frontend tracks progress using periodic batch polling (`/api/v1/jobs/batch-status`).

## Key Guarantees

- **Consistency gate before expensive work**: Brackets/final edits that do not match scene/framing are rejected or flagged early.
- **Safe fallback behavior**: If generative output fails structural QA, the OpenCV base is returned and the result is flagged.
- **Agency scoping**: Production behavior expects token-based agency scope; local/dev allows fallback agency IDs for offline workflows.

## Auth and Environment Modes

- Production expects stricter security settings (for example, Cloud Tasks invoker verification and expected env vars).
- Local/dev supports convenience fallbacks (for example, local anonymous agency IDs and fake adapters).
- Documentation and UX text should call out this distinction explicitly to avoid implying local/dev behavior is production-grade isolation.

## Progress Delivery Model

- Current user-visible progress uses polling from the frontend store.
- Event-publisher abstractions exist in backend interfaces for internal/state propagation, but the primary UI contract is polling.

## Session and Data Retention Notes

- Session codes are human-readable room codes designed for workflow continuity, not high-entropy secrets.
- Upload/result lifecycle is governed by deployment/storage policies (for example, bucket lifecycle and adapter retention behavior).
- Avoid hardcoding retention durations in copy unless they are centrally enforced and tested.

