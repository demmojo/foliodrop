# Legacy / Orphaned Tests (Do Not Run)

This top-level `tests/` directory is **not** part of the active test suite. The
running pytest configuration lives in `backend/pytest.ini`, which sets
`testpaths = tests`, resolving to `backend/tests/`. The files in this folder
date back to an earlier prototype of the API and reference symbols that no
longer exist in the current codebase, including but not limited to:

- `StreamHDRProgressUseCase` (replaced by polling-based progress APIs).
- `GET /api/v1/hdr-jobs/{job_id}/progress` SSE endpoint (no longer served).
- `POST /api/session/`, `GET /api/session/{id}`, `POST /api/session/{id}/extend`
  (the current code uses session codes / continuity tokens, not this lifecycle).
- `process_hdr_batch` (replaced by `ProcessHdrGroupUseCase`).

These files import from `backend.tests.fakes` and from `backend.core.use_cases`
in ways that will fail at collection time on a current checkout. Treat them as
historical reference, not as a behaviour spec.

The `fixtures/` folder still contains real bracket photos and golden-master
PNGs. They are currently unreferenced but kept on disk because they may be
useful if/when a golden-master regression suite is reintroduced. If you want
to bring back deterministic visual regression coverage, port the test logic
into `backend/tests/` against the current `ProcessHdrGroupUseCase` API and
re-link the fixtures from there.

If you have no use for the fixtures, this entire directory can safely be
deleted in a follow-up commit.
