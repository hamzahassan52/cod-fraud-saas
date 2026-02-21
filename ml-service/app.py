#!/usr/bin/env python3
"""
COD Fraud Detection -- ML Microservice (FastAPI)

Endpoints
---------
POST  /predict        Run inference on a feature vector
GET   /health         Shallow health check
GET   /model/info     Metadata and metrics for the active model
POST  /model/reload   Hot-reload the latest model from disk
POST  /train          Trigger a training run (from CSV or DB)

Start the server::

    uvicorn app:app --host 0.0.0.0 --port 8001 --reload
"""

from __future__ import annotations

import logging
import os
import sys
import time

import numpy as np
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from api.predict import predict
from api.schemas import (
    HealthResponse,
    ModelInfo,
    PredictionRequest,
    PredictionResponse,
    TrainingRequest,
    TrainingResponse,
)
from utils.model_manager import ModelManager

load_dotenv()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ml-service")

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
model_manager = ModelManager()


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the latest model on startup."""
    try:
        artifact = model_manager.load_model()
        logger.info(
            "Model %s loaded on startup (features=%d)",
            artifact.version,
            len(artifact.feature_names),
        )
    except FileNotFoundError:
        logger.warning(
            "No model found in versions/ directory. "
            "Run 'python scripts/generate_synthetic_data.py' to create an initial model."
        )
    yield
    logger.info("ML service shutting down")


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="COD Fraud Detection - ML Service",
    description="XGBoost-based RTO probability prediction for Cash-on-Delivery orders",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS -- allow the Node.js backend and any dev frontends
ALLOWED_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://localhost:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s -> %d (%.1fms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
    )
    return response


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/predict", response_model=PredictionResponse)
async def predict_endpoint(body: PredictionRequest):
    """Return the RTO probability for the supplied feature vector."""
    artifact = model_manager.active_model
    if artifact is None:
        raise HTTPException(
            status_code=503,
            detail="No model loaded. Train or upload a model first.",
        )

    try:
        result = predict(artifact, body.features)
    except Exception as exc:
        logger.exception("Prediction failed")
        raise HTTPException(status_code=500, detail=f"Prediction error: {exc}")

    return PredictionResponse(**result)


@app.get("/health")
async def health():
    """Shallow health check."""
    artifact = model_manager.active_model
    return {
        "status": "healthy",
        "model_loaded": artifact is not None,
        "model_version": artifact.version if artifact else None,
        "feature_count": len(artifact.feature_names) if artifact else 0,
        "optimal_threshold": getattr(artifact, "optimal_threshold", 0.5) if artifact else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/model/info", response_model=ModelInfo)
async def model_info():
    """Return metadata and quality metrics for the active model."""
    artifact = model_manager.active_model
    if artifact is None:
        raise HTTPException(status_code=404, detail="No model is currently loaded")

    metrics = artifact.metrics
    return ModelInfo(
        version=artifact.version,
        accuracy=metrics.get("accuracy", 0.0),
        precision=metrics.get("precision", 0.0),
        recall=metrics.get("recall", 0.0),
        f1=metrics.get("f1", 0.0),
        auc_roc=metrics.get("auc_roc", 0.0),
        trained_at=artifact.trained_at or "unknown",
        feature_count=len(artifact.feature_names),
        training_samples=artifact.training_samples,
    )


@app.post("/model/reload")
async def reload_model(version: str | None = None):
    """Hot-reload a model from the ``versions/`` directory.

    If *version* is omitted the latest version is loaded.
    """
    try:
        artifact = model_manager.load_model(version=version)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {
        "message": f"Model {artifact.version} loaded successfully",
        "version": artifact.version,
        "feature_count": len(artifact.feature_names),
    }


@app.post("/train", response_model=TrainingResponse)
async def train_endpoint(body: TrainingRequest | None = None):
    """Trigger a training run using CSV data (DB support when available).

    This is a synchronous endpoint -- for production use, consider pushing
    training to a background worker.
    """
    if body is None:
        body = TrainingRequest()

    csv_path = Path(__file__).resolve().parent / "data" / "training_data.csv"

    try:
        from train import load_data_from_csv, save_trained_model, train_model

        if csv_path.exists():
            df = load_data_from_csv(str(csv_path))
        else:
            # Attempt DB
            from train import load_data_from_db

            df = load_data_from_db()

        model, metrics, feature_names, n_samples = train_model(
            df, test_size=body.test_size, min_samples=body.min_samples,
        )
        version = save_trained_model(model, metrics, feature_names, n_samples)

        # Reload newly trained model as active
        model_manager.load_model(version=version)

        # Feature importances (ensemble-safe)
        try:
            imps = [
                e.feature_importances_
                for e in getattr(model, "estimators_", [])
                if hasattr(e, "feature_importances_")
            ]
            if imps:
                avg_imp = np.mean(imps, axis=0)
            else:
                avg_imp = np.zeros(len(feature_names))
            importances = dict(zip(feature_names, [round(float(v), 4) for v in avg_imp]))
        except Exception:
            importances = {n: 0.0 for n in feature_names}

        return TrainingResponse(
            version=version,
            metrics=metrics,
            feature_count=len(feature_names),
            training_samples=n_samples,
            feature_importances=importances,
        )

    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="No training data found. Generate synthetic data first.",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Training failed")
        raise HTTPException(status_code=500, detail=f"Training error: {exc}")


@app.get("/model/versions")
async def list_model_versions():
    """List all available model versions on disk."""
    versions = model_manager.list_versions()
    return {"versions": versions, "count": len(versions)}


# ---------------------------------------------------------------------------
# Pipeline endpoints
# ---------------------------------------------------------------------------

@app.get("/pipeline/drift-report")
async def drift_report():
    """Return the current drift status by comparing recent predictions against baseline."""
    try:
        from pipeline.drift_detector import DriftDetector

        detector = DriftDetector()
        artifact = model_manager.active_model
        if artifact is None:
            raise HTTPException(status_code=503, detail="No model loaded")

        # Try to load recent data from stored features
        data_dir = Path(__file__).resolve().parent / "data"
        recent_csv = data_dir / "training_data.csv"

        if recent_csv.exists():
            import pandas as pd
            recent_df = pd.read_csv(recent_csv)
            report = detector.check_feature_drift(recent_df, artifact.version)
            return report.to_dict()
        else:
            return {
                "checked_at": datetime.now(timezone.utc).isoformat(),
                "message": "No recent data available for drift check",
                "should_retrain": False,
            }
    except ImportError:
        raise HTTPException(status_code=501, detail="Pipeline modules not available")
    except FileNotFoundError as e:
        return {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "message": str(e),
            "should_retrain": False,
        }


@app.post("/pipeline/check-retrain")
async def check_retrain(trigger_retrain: bool = False):
    """Check if the model should be retrained, optionally trigger retraining."""
    try:
        from pipeline.drift_detector import DriftDetector
        from pipeline.scheduler import RetrainScheduler

        detector = DriftDetector()
        scheduler = RetrainScheduler()

        artifact = model_manager.active_model
        if artifact is None:
            raise HTTPException(status_code=503, detail="No model loaded")

        # Load state
        state = scheduler.load_state()
        last_trained = artifact.trained_at if artifact else state.get("last_trained_at")

        decision = scheduler.should_retrain(
            drift_should_retrain=False,  # simplified — full check needs data
            new_orders_since_last_train=state.get("new_orders", 0),
            last_trained_at=last_trained,
        )

        if trigger_retrain and decision["should_retrain"]:
            # Trigger retraining
            from train import load_data_from_csv, train_model_v2
            import pandas as pd

            csv_path = Path(__file__).resolve().parent / "data" / "training_data.csv"
            if csv_path.exists():
                df = pd.read_csv(str(csv_path))
                model, metrics, features, n_samples, version = train_model_v2(df, min_samples=10)
                model_manager.load_model(version=version)
                decision["retrained"] = True
                decision["new_version"] = version
                decision["metrics"] = metrics

                # Update scheduler state
                scheduler.save_state({
                    "last_trained_at": datetime.now(timezone.utc).isoformat(),
                    "last_version": version,
                    "new_orders": 0,
                })
            else:
                decision["retrained"] = False
                decision["error"] = "No training data available"

        return decision
    except ImportError:
        raise HTTPException(status_code=501, detail="Pipeline modules not available")


@app.get("/pipeline/data-snapshots")
async def list_data_snapshots():
    """List all available training data snapshots."""
    try:
        from pipeline.data_versioner import DataVersioner
        versioner = DataVersioner()
        snapshots = versioner.list_snapshots()
        return {"snapshots": snapshots, "count": len(snapshots)}
    except ImportError:
        raise HTTPException(status_code=501, detail="Pipeline modules not available")


@app.post("/pipeline/export-data")
async def export_data():
    """Export training data from the database."""
    try:
        from pipeline.data_collector import export_training_data
        from pipeline.data_versioner import DataVersioner

        df = export_training_data()
        versioner = DataVersioner()
        version = versioner.save_snapshot(df)

        # Also save as CSV
        data_dir = Path(__file__).resolve().parent / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        csv_path = data_dir / "training_data_real.csv"
        df.to_csv(csv_path, index=False)

        return {
            "message": f"Exported {len(df)} rows",
            "snapshot_version": version,
            "csv_path": str(csv_path),
            "rto_rate": round(float(df["is_rto"].mean()), 4) if "is_rto" in df.columns else None,
        }
    except ImportError:
        raise HTTPException(status_code=501, detail="Pipeline modules not available")
    except EnvironmentError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Main (development convenience)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.getenv("ML_HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", os.getenv("ML_PORT", "8000"))),
        reload=True,
        log_level="info",
    )
