FROM python:3.12-slim

# Install system dependencies for OpenCV and Hugin
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    hugin-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create backend directory structure to match Python imports
RUN mkdir backend
COPY . backend/

ENV PYTHONPATH=/app

CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}
