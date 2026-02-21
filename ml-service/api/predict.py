"""
Prediction logic for the COD Fraud Detection ML service.

Responsible for:
  - Accepting a raw feature dictionary from the API layer.
  - Aligning features to the model's expected order.
  - Running inference and returning a structured result.
  - Computing SHAP-based feature explanations.
"""

from __future__ import annotations

import logging
import time
from typing import Dict, List, Optional

import numpy as np

from utils.model_manager import ModelArtifact

logger = logging.getLogger(__name__)

# Lazily initialized SHAP explainer (cached per model version)
_shap_explainer = None
_shap_model_version: Optional[str] = None


def predict(
    artifact: ModelArtifact,
    features: Dict[str, float],
) -> Dict:
    """Run a single prediction and return the result dict.

    Parameters
    ----------
    artifact:
        The currently loaded ``ModelArtifact`` (model + metadata).
    features:
        Raw feature map, e.g. ``{"order_amount": 4500.0, ...}``.

    Returns
    -------
    dict with keys:
        rto_probability, confidence, model_version, prediction_time_ms, top_factors
    """
    start = time.perf_counter()

    # --- 1. Align features to the model's expected order ----------------
    ordered_values = _align_features(artifact.feature_names, features)

    # --- 2. Inference ---------------------------------------------------
    X = np.array([ordered_values], dtype=np.float64)

    try:
        probabilities = artifact.model.predict_proba(X)[0]
        # Class 1 = RTO
        rto_prob = float(probabilities[1]) if len(probabilities) > 1 else float(probabilities[0])
    except AttributeError:
        # Fallback: model only supports .predict (unlikely for XGBoost)
        raw = float(artifact.model.predict(X)[0])
        rto_prob = max(0.0, min(1.0, raw))

    # --- 3. Confidence (relative to model's optimal threshold) ----------
    threshold = getattr(artifact, "optimal_threshold", 0.5)
    confidence = _calculate_confidence(rto_prob, threshold)

    # --- 4. SHAP explanations ------------------------------------------
    top_factors = _compute_shap_factors(artifact, X, ordered_values, features)

    elapsed_ms = (time.perf_counter() - start) * 1000.0

    result = {
        "rto_probability": round(rto_prob, 6),
        "confidence": round(confidence, 6),
        "model_version": artifact.version,
        "prediction_time_ms": round(elapsed_ms, 3),
        "top_factors": top_factors,
        "optimal_threshold": round(threshold, 4),
    }

    logger.debug(
        "Prediction: rto_prob=%.4f confidence=%.4f elapsed=%.2fms version=%s factors=%d",
        rto_prob,
        confidence,
        elapsed_ms,
        artifact.version,
        len(top_factors),
    )
    return result


# -----------------------------------------------------------------------
# Internal helpers
# -----------------------------------------------------------------------

def _align_features(
    expected_names: List[str],
    raw_features: Dict[str, float],
) -> List[float]:
    """Return a list of feature values in the *exact* order the model expects.

    Missing features are filled with ``0.0`` and a warning is logged.
    """
    values: List[float] = []
    missing: List[str] = []
    for name in expected_names:
        if name in raw_features:
            values.append(float(raw_features[name]))
        else:
            values.append(0.0)
            missing.append(name)

    if missing:
        logger.warning(
            "Missing %d feature(s) filled with 0.0: %s",
            len(missing),
            ", ".join(missing[:10]),  # log at most first 10
        )

    # Warn about unexpected (extra) features
    extra = set(raw_features.keys()) - set(expected_names)
    if extra:
        logger.warning(
            "Ignoring %d unexpected feature(s): %s",
            len(extra),
            ", ".join(list(extra)[:10]),
        )

    return values


def _calculate_confidence(probability: float, threshold: float = 0.5) -> float:
    """Derive a [0, 1] confidence score from the predicted probability.

    Confidence is how far the probability is from the model's optimal decision
    threshold (not necessarily 0.5), scaled to [0, 1].

    * probability == threshold  ->  0.0  (maximally uncertain)
    * probability == 0.0 or 1.0 ->  1.0  (maximally certain)
    """
    max_distance = max(threshold, 1.0 - threshold)
    return abs(probability - threshold) / max_distance


def _compute_shap_factors(
    artifact: ModelArtifact,
    X: np.ndarray,
    ordered_values: List[float],
    raw_features: Dict[str, float],
) -> List[Dict]:
    """Compute SHAP values for the prediction and return top factors.

    Returns a list of dicts with keys: feature, value, impact, direction.
    Falls back gracefully if SHAP is unavailable.
    """
    global _shap_explainer, _shap_model_version

    try:
        import shap

        # Create or reuse explainer (cached per model version)
        if _shap_explainer is None or _shap_model_version != artifact.version:
            _shap_explainer = shap.TreeExplainer(artifact.model)
            _shap_model_version = artifact.version
            logger.info("Created SHAP TreeExplainer for model %s", artifact.version)

        shap_values = _shap_explainer.shap_values(X)

        # For binary classification, shap_values may be a list [class0, class1]
        if isinstance(shap_values, list):
            sv = shap_values[1][0]  # class 1 (RTO) SHAP values
        else:
            sv = shap_values[0]

        # Build factor list sorted by absolute impact
        factors = []
        for i, name in enumerate(artifact.feature_names):
            impact = float(sv[i])
            if abs(impact) < 0.01:
                continue
            factors.append({
                "feature": name,
                "value": round(float(ordered_values[i]), 4),
                "impact": round(abs(impact), 4),
                "direction": "increases_risk" if impact > 0 else "decreases_risk",
            })

        # Sort by absolute impact, return top 8
        factors.sort(key=lambda f: f["impact"], reverse=True)
        return factors[:8]

    except ImportError:
        logger.warning("shap package not installed, skipping SHAP explanations")
        return []
    except Exception:
        logger.exception("SHAP computation failed, returning empty factors")
        return []
