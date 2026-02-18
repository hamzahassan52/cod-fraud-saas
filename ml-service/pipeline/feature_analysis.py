"""
Feature Analysis — correlation analysis, importance ranking, drift baselines.

Used to:
    - Drop redundant (highly correlated) features
    - Rank features by importance
    - Save baseline distributions for drift detection
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .feature_map import FEATURE_NAMES

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent.parent
BASELINES_DIR = _BASE_DIR / "data" / "baselines"


def compute_correlation_matrix(
    df: pd.DataFrame,
    features: Optional[List[str]] = None,
    threshold: float = 0.95,
) -> Tuple[pd.DataFrame, List[Tuple[str, str, float]]]:
    """Compute correlation matrix and find highly correlated feature pairs.

    Returns (correlation_matrix, list of (feat_a, feat_b, corr) above threshold).
    """
    features = features or [f for f in FEATURE_NAMES if f in df.columns]
    corr = df[features].corr()

    redundant = []
    for i in range(len(features)):
        for j in range(i + 1, len(features)):
            c = abs(corr.iloc[i, j])
            if c >= threshold:
                redundant.append((features[i], features[j], round(c, 4)))

    if redundant:
        logger.info(
            "Found %d highly correlated pairs (>%.2f): %s",
            len(redundant), threshold,
            ", ".join(f"{a}-{b}" for a, b, _ in redundant[:5]),
        )

    return corr, redundant


def rank_feature_importance(
    model: Any,
    feature_names: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Extract and rank feature importances from a trained model.

    Returns a list of {feature, importance, rank} sorted by importance descending.
    """
    feature_names = feature_names or FEATURE_NAMES
    importances = model.feature_importances_

    ranked = sorted(
        zip(feature_names, importances),
        key=lambda x: x[1],
        reverse=True,
    )

    return [
        {"feature": name, "importance": round(float(imp), 6), "rank": i + 1}
        for i, (name, imp) in enumerate(ranked)
    ]


def save_baseline_distributions(
    df: pd.DataFrame,
    version: str,
    features: Optional[List[str]] = None,
) -> Path:
    """Save feature distribution statistics as a baseline for drift detection.

    Stores mean, std, quantiles (5th, 25th, 50th, 75th, 95th) for each feature.
    """
    BASELINES_DIR.mkdir(parents=True, exist_ok=True)
    features = features or [f for f in FEATURE_NAMES if f in df.columns]

    baselines: Dict[str, Dict[str, float]] = {}
    for feat in features:
        col = df[feat].dropna()
        if len(col) == 0:
            continue
        baselines[feat] = {
            "mean": round(float(col.mean()), 6),
            "std": round(float(col.std()), 6),
            "min": round(float(col.min()), 6),
            "max": round(float(col.max()), 6),
            "p5": round(float(col.quantile(0.05)), 6),
            "p25": round(float(col.quantile(0.25)), 6),
            "p50": round(float(col.quantile(0.50)), 6),
            "p75": round(float(col.quantile(0.75)), 6),
            "p95": round(float(col.quantile(0.95)), 6),
            "n": len(col),
        }

    baseline_path = BASELINES_DIR / f"baseline_{version}.json"
    with open(baseline_path, "w") as f:
        json.dump(baselines, f, indent=2)

    logger.info("Saved baseline distributions for %d features to %s", len(baselines), baseline_path)
    return baseline_path


def load_baseline(version: str) -> Dict[str, Dict[str, float]]:
    """Load saved baseline distributions."""
    baseline_path = BASELINES_DIR / f"baseline_{version}.json"
    if not baseline_path.exists():
        raise FileNotFoundError(f"Baseline not found: {baseline_path}")
    with open(baseline_path) as f:
        return json.load(f)
