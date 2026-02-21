# ============================================
# ML Service Dockerfile — Inference Only
# ============================================
# Training is NOT done here.
# Run scripts/train_offline.py locally to generate the model,
# then commit models/latest.joblib + models/latest_meta.json to git.
# This image just loads the pre-trained model and serves inference.

FROM python:3.11-slim

WORKDIR /app

# System deps (libgomp1 required by LightGBM/XGBoost)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code + pre-trained model (committed to repo by developer)
COPY . .

# Create necessary directories
RUN mkdir -p /app/versions /app/data /app/models && chmod +x /app/startup.sh

# Non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD python -c "import httpx; r = httpx.get('http://localhost:${PORT:-8000}/health'); assert r.status_code == 200"

EXPOSE ${PORT:-8000}

# startup.sh: loads pre-trained model (instant) or trains once if missing (first deploy)
CMD ["/app/startup.sh"]
