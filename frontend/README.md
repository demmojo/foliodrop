# Folio

Folio is an intelligent HDR processing pipeline tailored for real estate photography. By ingesting bracketed photography, Folio mathematically merges them into a single, perfectly balanced High Dynamic Range (HDR) image, prioritizing architectural accuracy and natural lighting, and then refines the output using Vision Language Models (VLMs).

## Features

- **Intelligent Ingestion**: Zero-friction drag-and-drop import for bracketed sets, backed by on-device EXIF parsing and scene grouping.
- **Agency Profiles**: Secure Firebase Auth login for managing custom style training pairs and specific editing preferences per agency.
- **Hybrid Processing Engine**: Combines deterministic OpenCV-based exposure fusion with generative AI polish for perfect window pulls and lighting balance.
- **Strict Quality Assurance**: Mathematically protects against AI hallucinations by detecting structural drift using SIFT keypoints.
- **Instant Delivery**: Real-time progress updates and direct-to-device native sharing or ZIP downloads without waiting for slow server archiving.

## Architecture & Documentation

To understand the core processing flow and architectural philosophy, see our detailed guide:
- [How Folio Works](./docs/how-folio-works.md)
- [Architecture Details](./docs/ARCHITECTURE.md)

## Testing & Reliability

Folio maintains a high bar for reliability and deterministic fallback:
- **100% Test Coverage**: The entire pipeline—both the FastAPI backend and Next.js frontend—maintains full test coverage to protect critical image processing paths.

## Getting Started

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```
