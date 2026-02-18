# ============================================
# ML Service Dockerfile
# ============================================

FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Create model directory and make startup script executable
RUN mkdir -p /app/versions /app/data && chmod +x /app/startup.sh

# Train initial model during build (so container starts fast)
RUN python scripts/generate_synthetic_data.py --n 20000 && python train.py --csv data/training_data.csv

# Non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import httpx; r = httpx.get('http://localhost:${PORT:-8000}/health'); assert r.status_code == 200"

EXPOSE ${PORT:-8000}

# Railway sets PORT env var; fallback to 8000
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2
