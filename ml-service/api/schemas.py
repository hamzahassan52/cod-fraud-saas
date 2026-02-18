"""
Pydantic models for COD Fraud Detection ML Service API.
"""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------

class PredictionRequest(BaseModel):
    """Incoming prediction request carrying extracted features."""

    features: Dict[str, float] = Field(
        ...,
        description="Feature name -> value map produced by the Node.js FeatureExtractor",
        examples=[{
            "order_amount": 4500.0,
            "customer_order_count": 2.0,
            "customer_rto_rate": 0.5,
            "city_rto_rate": 0.32,
            "is_cod": 1.0,
        }],
    )


class TopFactor(BaseModel):
    """A single SHAP-based feature explanation."""

    feature: str = Field(..., description="Feature name")
    value: float = Field(..., description="Feature value for this prediction")
    impact: float = Field(..., description="SHAP impact magnitude (absolute)")
    direction: str = Field(
        ...,
        description="Whether this feature increases or decreases risk",
        examples=["increases_risk", "decreases_risk"],
    )


class PredictionResponse(BaseModel):
    """Prediction result returned to the caller."""

    rto_probability: float = Field(
        ..., ge=0.0, le=1.0,
        description="Probability that the order will be returned (RTO)",
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0,
        description="Model confidence (distance of probability from decision boundary 0.5)",
    )
    model_version: str = Field(
        ...,
        description="Semantic version string of the model that produced this prediction",
    )
    prediction_time_ms: float = Field(
        ..., ge=0.0,
        description="Wall-clock time taken for the prediction in milliseconds",
    )
    top_factors: List[TopFactor] = Field(
        default_factory=list,
        description="Top SHAP-based feature explanations ranked by impact",
    )


# ---------------------------------------------------------------------------
# Model info
# ---------------------------------------------------------------------------

class ModelInfo(BaseModel):
    """Metadata and quality metrics for the currently-loaded model."""

    version: str
    accuracy: float = Field(..., ge=0.0, le=1.0)
    precision: float = Field(..., ge=0.0, le=1.0)
    recall: float = Field(..., ge=0.0, le=1.0)
    f1: float = Field(..., ge=0.0, le=1.0)
    auc_roc: float = Field(..., ge=0.0, le=1.0)
    trained_at: str
    feature_count: int = Field(..., ge=0)
    training_samples: int = Field(..., ge=0)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    """Shallow health-check response."""

    status: str = Field(..., examples=["healthy"])
    model_loaded: bool
    model_version: Optional[str] = None
    timestamp: str


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

class TrainingRequest(BaseModel):
    """Parameters for a training run triggered via the API."""

    min_samples: int = Field(
        default=100,
        ge=10,
        description="Minimum number of labelled samples required to start training",
    )
    test_size: float = Field(
        default=0.2,
        gt=0.0,
        lt=1.0,
        description="Fraction of data held out for evaluation",
    )


class TrainingResponse(BaseModel):
    """Summary returned after a successful training run."""

    version: str
    metrics: Dict[str, float] = Field(
        ...,
        description="Evaluation metrics (accuracy, precision, recall, f1, auc_roc)",
    )
    feature_count: int
    training_samples: int
    feature_importances: Optional[Dict[str, float]] = None
