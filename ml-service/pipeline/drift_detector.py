"""
Drift Detector — detect feature drift and performance degradation.

Two types of drift:
    1. Feature drift: incoming data distributions differ from training baseline
    2. Performance drift: model precision/recall degrading over time

Uses Kolmogorov-Smirnov test (scipy) for statistical drift detection.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .feature_map import FEATURE_NAMES
from .feature_analysis import load_baseline

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass
class DriftReport:
    """Result of a drift check."""

    checked_at: str = ""
    feature_drift_detected: bool = False
    performance_drift_detected: bool = False
    drifted_features: List[Dict[str, Any]] = field(default_factory=list)
    performance_metrics: Dict[str, Any] = field(default_factory=dict)
    should_retrain: bool = False
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "checked_at": self.checked_at,
            "feature_drift_detected": self.feature_drift_detected,
            "performance_drift_detected": self.performance_drift_detected,
            "drifted_features": self.drifted_features,
            "performance_metrics": self.performance_metrics,
            "should_retrain": self.should_retrain,
            "reasons": self.reasons,
        }


class DriftDetector:
    """Detects drift in features and model performance."""

    def __init__(
        self,
        ks_threshold: float = 0.1,
        mean_shift_threshold: float = 2.0,
        min_samples: int = 100,
        precision_floor: float = 0.60,
        recall_floor: float = 0.50,
    ):
        self.ks_threshold = ks_threshold
        self.mean_shift_threshold = mean_shift_threshold
        self.min_samples = min_samples
        self.precision_floor = precision_floor
        self.recall_floor = recall_floor

    def check_feature_drift(
        self,
        current_data: pd.DataFrame,
        baseline_version: str,
    ) -> DriftReport:
        """Compare current data distributions against a saved baseline.

        Uses KS test p-value and mean shift (in std units) to detect drift.
        """
        report = DriftReport(
            checked_at=datetime.now(timezone.utc).isoformat(),
        )

        try:
            baseline = load_baseline(baseline_version)
        except FileNotFoundError:
            report.reasons.append(f"No baseline found for version {baseline_version}")
            return report

        if len(current_data) < self.min_samples:
            report.reasons.append(
                f"Not enough current data ({len(current_data)} rows, need {self.min_samples})"
            )
            return report

        try:
            from scipy import stats
        except ImportError:
            report.reasons.append("scipy not installed, skipping KS test")
            return report

        drifted = []
        for feat in FEATURE_NAMES:
            if feat not in current_data.columns or feat not in baseline:
                continue

            current_col = current_data[feat].dropna()
            if len(current_col) < 10:
                continue

            bl = baseline[feat]
            bl_mean = bl["mean"]
            bl_std = bl["std"]

            # Mean shift in standard deviations
            if bl_std > 0:
                mean_shift = abs(current_col.mean() - bl_mean) / bl_std
            else:
                mean_shift = 0.0

            # KS test: compare current distribution against normal approximation of baseline
            baseline_samples = np.random.normal(bl_mean, max(bl_std, 1e-6), size=len(current_col))
            ks_stat, ks_pvalue = stats.ks_2samp(current_col.values, baseline_samples)

            is_drifted = ks_pvalue < self.ks_threshold or mean_shift > self.mean_shift_threshold

            if is_drifted:
                drifted.append({
                    "feature": feat,
                    "ks_statistic": round(ks_stat, 4),
                    "ks_pvalue": round(ks_pvalue, 6),
                    "mean_shift_std": round(mean_shift, 4),
                    "current_mean": round(float(current_col.mean()), 4),
                    "baseline_mean": round(bl_mean, 4),
                })

        report.drifted_features = drifted
        report.feature_drift_detected = len(drifted) > 0

        if len(drifted) >= 3:
            report.should_retrain = True
            report.reasons.append(
                f"{len(drifted)} features have drifted significantly"
            )

        return report

    def check_performance_drift(
        self,
        predictions_df: pd.DataFrame,
    ) -> DriftReport:
        """Check if model performance has degraded.

        Requires a DataFrame with columns: predicted_rto (0/1), actual_rto (0/1).
        """
        report = DriftReport(
            checked_at=datetime.now(timezone.utc).isoformat(),
        )

        required_cols = {"predicted_rto", "actual_rto"}
        if not required_cols.issubset(predictions_df.columns):
            report.reasons.append(f"Missing columns: {required_cols - set(predictions_df.columns)}")
            return report

        if len(predictions_df) < self.min_samples:
            report.reasons.append(
                f"Not enough predictions ({len(predictions_df)}, need {self.min_samples})"
            )
            return report

        y_true = predictions_df["actual_rto"].values
        y_pred = predictions_df["predicted_rto"].values

        # Compute metrics
        tp = int(((y_pred == 1) & (y_true == 1)).sum())
        fp = int(((y_pred == 1) & (y_true == 0)).sum())
        fn = int(((y_pred == 0) & (y_true == 1)).sum())
        tn = int(((y_pred == 0) & (y_true == 0)).sum())

        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        accuracy = (tp + tn) / max(len(y_true), 1)

        report.performance_metrics = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "accuracy": round(accuracy, 4),
            "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "total_predictions": len(y_true),
        }

        if precision < self.precision_floor:
            report.performance_drift_detected = True
            report.should_retrain = True
            report.reasons.append(
                f"Precision ({precision:.2%}) below floor ({self.precision_floor:.2%})"
            )

        if recall < self.recall_floor:
            report.performance_drift_detected = True
            report.should_retrain = True
            report.reasons.append(
                f"Recall ({recall:.2%}) below floor ({self.recall_floor:.2%})"
            )

        return report

    def should_retrain(
        self,
        current_data: Optional[pd.DataFrame] = None,
        predictions_df: Optional[pd.DataFrame] = None,
        baseline_version: Optional[str] = None,
    ) -> DriftReport:
        """Combined drift check: feature + performance.

        Returns a single DriftReport with should_retrain decision.
        """
        combined = DriftReport(
            checked_at=datetime.now(timezone.utc).isoformat(),
        )

        if current_data is not None and baseline_version:
            feat_report = self.check_feature_drift(current_data, baseline_version)
            combined.feature_drift_detected = feat_report.feature_drift_detected
            combined.drifted_features = feat_report.drifted_features
            combined.reasons.extend(feat_report.reasons)
            if feat_report.should_retrain:
                combined.should_retrain = True

        if predictions_df is not None:
            perf_report = self.check_performance_drift(predictions_df)
            combined.performance_drift_detected = perf_report.performance_drift_detected
            combined.performance_metrics = perf_report.performance_metrics
            combined.reasons.extend(perf_report.reasons)
            if perf_report.should_retrain:
                combined.should_retrain = True

        if not combined.reasons:
            combined.reasons.append("No drift detected — model is stable")

        return combined
