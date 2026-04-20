#!/bin/bash
set -e

# GCP Deployment Script for Folio Pipeline
# Ensures idempotency and strict DoS/Budget limits

PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"
BUCKET_NAME="${PROJECT_ID}-hdr-uploads"
QUEUE_NAME="hdr-queue"
FRONTEND_SERVICE="hdr-frontend"
BACKEND_SERVICE="hdr-worker"

echo "Deploying to Project: $PROJECT_ID"

# 1. Enable APIs
echo "Enabling GCP APIs..."
gcloud services enable \
    run.googleapis.com \
    cloudtasks.googleapis.com \
    storage.googleapis.com \
    firestore.googleapis.com \
    secretmanager.googleapis.com
sleep 10 # Allow IAM propagation

# 2. Create Cloud Tasks Queue
echo "Setting up App Engine (Required for Cloud Tasks in some regions)..."
if ! gcloud app describe >/dev/null 2>&1; then
    gcloud app create --region=$REGION || true
fi

echo "Setting up Cloud Tasks Queue..."
if ! gcloud tasks queues describe $QUEUE_NAME --location=$REGION >/dev/null 2>&1; then
    gcloud tasks queues create $QUEUE_NAME \
        --location=$REGION \
        --max-concurrent-dispatches=10 \
        --max-attempts=3 \
        --routing-override=service:$BACKEND_SERVICE
else
    echo "Queue $QUEUE_NAME already exists."
fi

# 3. Create GCS Bucket with 48h OLM
echo "Setting up GCS Bucket..."
if ! gcloud storage buckets describe gs://$BUCKET_NAME >/dev/null 2>&1; then
    gcloud storage buckets create gs://$BUCKET_NAME --location=$REGION --uniform-bucket-level-access
    
    # Create OLM JSON
    cat <<EOF > /tmp/olm.json
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 2}
    }
  ]
}
EOF
    gcloud storage buckets update gs://$BUCKET_NAME --lifecycle-file=/tmp/olm.json
    
    # Configure CORS for direct browser uploads
    cat <<EOF > /tmp/cors.json
[
    {
      "origin": ["*"],
      "method": ["GET", "PUT", "POST", "OPTIONS"],
      "responseHeader": ["Content-Type", "x-goog-resumable"],
      "maxAgeSeconds": 3600
    }
]
EOF
    gcloud storage buckets update gs://$BUCKET_NAME --cors-file=/tmp/cors.json
else
    echo "Bucket $BUCKET_NAME already exists."
fi

# 4. Deploy Backend Worker (Cloud Run)
echo "Deploying Backend Worker..."
gcloud run deploy $BACKEND_SERVICE \
    --source ./backend \
    --region $REGION \
    --memory 8Gi \
    --cpu 2 \
    --concurrency 1 \
    --max-instances 10 \
    --timeout 3600 \
    --allow-unauthenticated \
    --quiet \
    --set-env-vars GCP_UPLOAD_BUCKET=$BUCKET_NAME,CLOUD_TASKS_QUEUE=$QUEUE_NAME,REGION=$REGION

# Grant Cloud Tasks permissions to invoke backend
gcloud run services add-iam-policy-binding $BACKEND_SERVICE \
    --region=$REGION \
    --member="serviceAccount:service-$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')@gcp-sa-cloudtasks.iam.gserviceaccount.com" \
    --role="roles/run.invoker" || true

BACKEND_URL=$(gcloud run services describe $BACKEND_SERVICE --region $REGION --format='value(status.url)')

# 5. Deploy Frontend (Cloud Run)
echo "Deploying Frontend..."
gcloud run deploy $FRONTEND_SERVICE \
    --source ./frontend \
    --region $REGION \
    --allow-unauthenticated \
    --quiet \
    --set-env-vars NEXT_PUBLIC_API_URL=$BACKEND_URL,GCP_UPLOAD_BUCKET=$BUCKET_NAME \
    --set-build-env-vars NEXT_PUBLIC_API_URL=$BACKEND_URL

echo "Deployment Complete!"
FRONTEND_URL=$(gcloud run services describe $FRONTEND_SERVICE --region $REGION --format='value(status.url)')
echo "Public URL: $FRONTEND_URL"
