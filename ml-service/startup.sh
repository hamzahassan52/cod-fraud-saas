#!/bin/bash
# ML Service startup script
# Generates synthetic data and trains model if no model exists

set -e

echo "=== ML Service Startup ==="

# Check if any model exists
MODEL_COUNT=$(ls -1 versions/*.joblib 2>/dev/null | wc -l)

if [ "$MODEL_COUNT" -eq "0" ]; then
    echo "No trained model found. Generating synthetic data and training..."
    python scripts/generate_synthetic_data.py --n 20000
    python train.py
    echo "Initial model trained successfully!"
else
    echo "Found $MODEL_COUNT model(s). Skipping training."
fi

echo "Starting uvicorn..."
exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2
