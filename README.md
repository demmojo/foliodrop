# Folio

Next-Gen luxury serverless HDR platform for real estate agents and professional photographers. Folio provides a "Pro Utility" interface to upload bracketed exposures (e.g., -2, 0, +2 EV) and process them into stunning, architecturally accurate HDR images using advanced optical flow and AI-driven grading.

## Key Features

*   **Zero-Click Processing Pipeline**: Drag and drop 3, 5, or 7-bracket sets. The system automatically groups, aligns, and fuses exposures.
*   **Pro Utility Aesthetic**: A clean, accessible, and fast Next.js UI optimized for power users.
*   **Interactive "Before/After" Slider**: Pixel-peep your results using the interactive slider in the Exposure Modal to compare the median raw exposure with the final fused image.
*   **Internationalization (i18n)**: Full support for English, Slovak (Slovenčina), Spanish (Español), Italian (Italiano), and Greek (Ελληνικά).
*   **Dark Mode**: Seamless light and dark mode toggling, respecting system preferences and eliminating eye strain in dark editing rooms.
*   **Client-Side ZIP Export**: Package all your fused deliverables directly in the browser and download them instantly.
*   **Secure 48-Hour Sessions**: Workspaces are tied to a unique session ID. Files are safely auto-deleted after 48 hours to protect client privacy.
*   **Advanced AI Backend**: Utilizing OpenCV, ONNX models, and Python-based computer vision for Semantic Window Masking, Exposure Fusion (Mertens), and AI Denoising & Color Grading.

## Architecture

Folio is built on a highly scalable, local-cloud-hybrid architecture deployed to Google Cloud Platform (GCP).

### Frontend (Next.js)
- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand
- **Uploads**: Direct-to-GCS uploads with chunking via Pre-Signed URLs
- **Key Components**: `UploadFlow`, `ReviewGrid`, `BeforeAfterSlider`, `ProcessingConsole`

### Backend (FastAPI)
- **Framework**: FastAPI (Python 3.x)
- **Computer Vision**: OpenCV, scikit-image, numpy
- **AI Models**: ONNX (for denoising/masking)
- **Event Bus**: Redis Pub/Sub 
- **Architecture Pattern**: Hexagonal Architecture (Ports & Adapters)

### Infrastructure (GCP)
- **Compute**: Google Cloud Run (Frontend & Backend)
- **Storage**: Google Cloud Storage (with 48-hour Object Lifecycle Management)
- **Database**: Google Cloud Firestore (Session metadata)
- **Task Queue**: Google Cloud Tasks (Asynchronous processing)
- **Deployment**: Idempotent `deploy.sh` and `deploy_frontend.sh` scripts

---

## ⚠️ Production & Operational Context (Read Before Scaling)

Folio operates in a high-compute, data-heavy domain. Operating this at scale requires strict adherence to the following architectural constraints and business realities:

### 1. Compute Economics & Abuse Prevention
HDR fusion (OpenCV/ONNX) is exceptionally CPU and RAM intensive. **This repository currently provides unauthenticated access to heavy GPU/CPU workloads.** 
*   **Risk**: A malicious actor or sudden viral traffic can trigger massive Cloud Run scaling, exhausting GCP billing credits.
*   **Mitigation**: Before launching to production, you **must** implement authentication (e.g., Firebase Auth/Clerk), enforce strict payload limits on GCS pre-signed URLs, and introduce Stripe billing tiers to offset compute costs.

### 2. OOM (Out Of Memory) Handling & Cloud Tasks
Fusing 7-bracket, 42-megapixel RAW/JPEG images requires significant RAM. If a Cloud Run instance exceeds its memory limit, GCP will kill the container with a `SIGKILL`. 
*   **Risk**: Cloud Tasks will see the 500 error and retry the job indefinitely, creating an infinite loop of OOM kills that drives up costs.
*   **Mitigation**: Cloud Run memory limits must be heavily provisioned (e.g., 4GB+ per instance). Cloud Tasks queues must be explicitly configured with `max_retry_duration` and dead-letter queues.

### 3. Session Security & Data Privacy
While sessions use unguessable UUIDs and auto-delete after 48 hours, they rely on *security through obscurity*. 
*   **Risk**: Real estate photos are often under strict pre-listing embargo. If a session URL leaks, unauthorized users can view the deliverables.
*   **Mitigation**: Production deployments should upgrade from anonymous UUID sessions to authenticated user-tenant workspaces.

### 4. Serverless State & WebSockets (Redis Requirement)
The backend uses Server-Sent Events (SSE) to stream job progress to the UI.
*   **Risk**: Cloud Run scales horizontally. The "in-memory fallback" for the Event Bus is strictly for local development. In production, if a webhook hits Instance A while the user is listening on Instance B, the progress bar will permanently stall without a distributed message broker.
*   **Mitigation**: You **must** deploy GCP MemoryStore (Redis) and attach a Serverless VPC Access Connector to your Cloud Run instances to ensure cross-container Pub/Sub delivery. Alternatively, refactor the frontend to listen directly to Firestore document snapshots (`onSnapshot`), eliminating the need for Redis entirely.

---

## Project Structure

```
folio/
├── frontend/
│   ├── src/
│   │   ├── app/            # Next.js App Router (page.tsx, layout.tsx, globals.css)
│   │   ├── components/     # React UI Components (UploadFlow, ReviewGrid, ThemeToggle, etc.)
│   │   ├── hooks/          # Custom React Hooks (useImageProcessor, useTranslation)
│   │   └── i18n/           # Multi-language dictionaries
│   ├── e2e/                # Playwright end-to-end tests
│   └── package.json
├── backend/
│   ├── core/               # Domain logic (use_cases.py, ports.py, vision.py, grouping.py)
│   ├── infrastructure/     # External adapters (Firestore, GCP Storage, Redis)
│   ├── tests/              # Pytest unit and integration tests
│   ├── main.py             # FastAPI entry point
│   └── requirements.txt
├── deploy.sh               # Full stack GCP deployment script
└── deploy_frontend.sh      # Frontend-only GCP deployment script
```

## Getting Started

### Prerequisites
- Node.js (v20+)
- Python 3.10+
- Google Cloud CLI (`gcloud`) installed and authenticated

### Local Development - Backend
1. Navigate to the `backend` directory.
2. Create a virtual environment: `python -m venv venv && source venv/bin/activate`
3. Install dependencies: `pip install -r requirements.txt`
4. Run the server: `uvicorn main:app --reload --port 8080`

### Local Development - Frontend
1. Navigate to the `frontend` directory.
2. Install dependencies: `npm install`
3. Run the development server: `npm run dev`

### Testing
- **Backend**: `pytest`
- **Frontend Unit**: `npm run test`
- **End-to-End**: `npx playwright test`

## Deployment

Deployment to Google Cloud Platform is fully automated via bash scripts.

1. Ensure you are authenticated with GCP: `gcloud auth login`
2. Set your active project: `gcloud config set project <your-project-id>`
3. Run the deployment script from the project root:
   ```bash
   ./deploy.sh
   ```

The script is idempotent and handles enabling necessary APIs, creating the Cloud Tasks queue, configuring GCS buckets (with CORS and 48h expiration), and deploying the Cloud Run services.
