#!/bin/bash
set -e
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
FRONTEND_SERVICE="hdr-frontend"
BUCKET_NAME="${PROJECT_ID}-hdr-uploads"
BACKEND_URL=$(gcloud run services describe hdr-worker --region $REGION --format='value(status.url)')

echo "Deploying Frontend..."
gcloud run deploy $FRONTEND_SERVICE \
    --source ./frontend \
    --region $REGION \
    --allow-unauthenticated \
    --quiet \
    --set-env-vars NEXT_PUBLIC_API_URL=$BACKEND_URL,GCP_UPLOAD_BUCKET=$BUCKET_NAME \
    --set-build-env-vars NEXT_PUBLIC_API_URL=$BACKEND_URL

FRONTEND_URL=$(gcloud run services describe $FRONTEND_SERVICE --region $REGION --format='value(status.url)')
echo "Public URL: $FRONTEND_URL"