# Test Architecture Strategy: Intent-Based Flows & 100% Coverage

This document outlines the architectural shift in testing required to support the Generative HDR Pipeline, ensuring 100% branch and unit coverage across the stack.

## Architecture Overview
The current test suite establishes a baseline but is fundamentally brittle.
- **Backend**: Uses a Golden Master approach (`test_golden_master.py`) with Dependency Injection (Fakes), which is a strong architectural foundation. However, it tests the deterministic OpenCV flow, not the complex async HTTP 202 state machine.
- **Frontend**: Vitest and RTL are present (`UploadFlow.test.tsx`), but the suite relies on heavy monkey-patching (`global.fetch = vi.fn()`, mocking out entire hooks). Tests like `it.skip('rejects non-image files...')` indicate fragile integration paths.

## Change Assessment
Moving to a Generative HDR Pipeline shifts the system from a synchronous process to an asynchronous, long-polling, stateful process. To achieve 100% coverage, the test architecture must shift from testing *components in isolation* to testing *intents* and *state machines* across boundaries.

## Compliance Check
- **Violation: Leaky Abstractions via Global Mocking**: Frontend tests heavily mock `global.fetch` and local hooks. This destroys the ability to test real branch coverage inside network/error-handling layers.
- **Violation: Tight Coupling**: Frontend components are deeply coupled to the `fetch` API directly inside components.
- **Principle Upheld**: Backend uses Dependency Injection (Fakes) for external services, aligning perfectly with SOLID principles.

## Risk Analysis
- **Async Branch Coverage**: Achieving 100% branch coverage on the `POST /jobs/batch-status` polling loop and exponential backoff retry logic is highly prone to test flakiness if not properly abstracted using virtual timers.
- **State Hydration Branches**: The edge cases for rehydrating Zustand stores from `GET /jobs/active` on page refresh are difficult to hit consistently in DOM tests without tightly coupling to component lifecycles.
- **Third-Party API Boundaries**: Mocking Gemini API responses (429s, 413s, and safety block payloads) requires rigorous contract definitions in tests to hit fallback branches.

## Recommendations: Intent-Based User Flows

Organize both backend use cases and frontend tests around these core intents to map to the new Generative HDR plan:

1. **Flow A: The Resilient Processing Lifecycle (Happy Path)**
   - *Intent*: User expects to drop files and see them emerge fully processed.
   - *Test Path*: Submit brackets -> Assert idempotent 202 Accepted -> Fast-forward virtual timers -> Simulate `BATCH-STATUS` transitions (`PENDING` -> `PROCESSING` -> `COMPLETED`) -> Assert UI renders GCS URL thumbnails in the "Needs Review" queue.
2. **Flow B: Ephemeral State Recovery (Refresh Survival)**
   - *Intent*: User expects to not lose their processing batch if their browser tab closes or refreshes.
   - *Test Path*: Initiate upload -> Unmount App / simulate refresh -> Mount App -> Assert `GET /jobs/active` is called -> Assert Zustand store rehydrates `Job IDs` -> Assert background polling resumes seamlessly.
3. **Flow C: Asset Delivery Auto-Healing (The Coffee Break)**
   - *Intent*: User expects images to load even if they left the tab open past the 15-minute GCS Signed URL expiry.
   - *Test Path*: Render `ReviewGrid` -> Simulate Network 403 Forbidden on the `<img>` tag -> Assert `onError` boundary catches it -> Assert `POST /jobs/batch-signed-url` is dispatched -> Assert component re-renders with fresh URL.
4. **Flow D: Generative Fallback & Safety Guardrails (Hallucination Defense)**
   - *Intent*: User expects the system to gracefully handle generative failures without crashing the batch.
   - *Test Path*: Inject simulated Gemini safety block or SIFT Spatial Void failure -> Assert background worker retries up to 3 times -> Assert fallback to deterministic OpenCV `fused.jpg` -> Assert UI displays a "Geometric Drift" warning badge.
5. **Flow E: Split-Triage & Approval (Human QA)**
   - *Intent*: User expects to review the generative image against the deterministic base and make a final call.
   - *Test Path*: Render QA modal -> User flags image -> Assert image moves to rejected state -> User approves image -> Assert final listing payload is assembled and persisted.

## Recommendations: Architecture Strategy for Tests (100% Coverage)

### Frontend Strategy (Next.js, Zustand, Vitest)
- **Kill `global.fetch` Mocks, Introduce MSW**: Replace `vi.fn()` fetch mocks with Mock Service Worker (MSW). MSW intercepts requests at the network level, allowing React components and Zustand stores to execute their *actual* fetch/error-handling branches. This is the only reliable way to hit 100% branch coverage on network error states (like the 403 GCS expiry).
- **Isolate State Machine Testing**: Move the complex polling loop and rehydration logic strictly into the Zustand store. Test the Zustand store in isolation using `vitest` without mounting React components. Use `vi.advanceTimersByTime` to hit branches for exponential backoff and polling limits deterministically.
- **Component Harnesses**: Use React Testing Library solely to assert DOM states based on injected/mocked Zustand states. If the Zustand store has 100% coverage, the UI components only need to cover their render branches.

### Backend Strategy (FastAPI, Pytest)
- **Contract-Based Fakes for Gemini**: Do not use `unittest.mock.patch` for the Gemini SDK. Create a `FakeGeminiClient` that implements the exact interface. Configure this Fake to emit simulated 413 Payload Too Large, 429 Quota Exhausted, and `FinishReason.SAFETY` exceptions to explicitly hit the error handling branches in the background worker.
- **Synchronous Testing of Asynchronous Queues**: Decouple background Cloud Tasks / Workers from the transport layer. Test the `ProcessGenerativeHdrTask` as a synchronous Python function in pytest. This allows asserting that 100% of the SIFT retry loops, `gc.collect()` calls, and memory management branches execute without standing up external queues.
- **Idempotency Matrix Testing**: Create a parameterized pytest suite specifically for the `HTTP 202` endpoint. Ensure 100% branch coverage by testing:
  - Idempotency key is missing.
  - Idempotency key is new (creates job).
  - Idempotency key exists and job is pending (returns existing).
  - Idempotency key exists and job is done (returns existing).
