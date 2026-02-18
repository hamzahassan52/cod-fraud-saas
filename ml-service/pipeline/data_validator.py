"""
Data Validator — clean and validate training data before model training.

Handles:
    - Duplicate removal
    - Missing value imputation (column-specific strategies)
    - Outlier clipping
    - Range validation (rates 0-1, scores 0-100)
    - Class balance checking
    - Validation report generation
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .feature_map import FEATURE_NAMES

logger = logging.getLogger(__name__)


@dataclass
class ValidationReport:
    """Summary of data validation and cleaning operations."""

    original_rows: int = 0
    final_rows: int = 0
    duplicates_removed: int = 0
    missing_filled: Dict[str, int] = field(default_factory=dict)
    outliers_clipped: Dict[str, int] = field(default_factory=dict)
    range_violations_fixed: Dict[str, int] = field(default_factory=dict)
    rto_rate: float = 0.0
    class_balance_ok: bool = True
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "original_rows": self.original_rows,
            "final_rows": self.final_rows,
            "duplicates_removed": self.duplicates_removed,
            "missing_filled": self.missing_filled,
            "outliers_clipped": self.outliers_clipped,
            "range_violations_fixed": self.range_violations_fixed,
            "rto_rate": round(self.rto_rate, 4),
            "class_balance_ok": self.class_balance_ok,
            "warnings": self.warnings,
        }


# Column-specific imputation strategies
IMPUTATION_STRATEGIES: Dict[str, Any] = {
    # Numeric features: (strategy, value)
    # strategy: "constant", "median", "mean"
    "order_amount": ("median", None),
    "order_item_count": ("constant", 1.0),
    "is_cod": ("constant", 1.0),  # Pakistan = mostly COD
    "is_prepaid": ("constant", 0.0),
    "order_hour": ("median", None),
    "is_weekend": ("constant", 0.0),
    "is_night_order": ("constant", 0.0),
    "customer_order_count": ("constant", 0.0),
    "customer_rto_rate": ("constant", 0.0),
    "customer_cancel_rate": ("constant", 0.0),
    "customer_avg_order_value": ("median", None),
    "customer_account_age_days": ("constant", 0.0),
    "customer_distinct_cities": ("constant", 1.0),
    "customer_distinct_phones": ("constant", 1.0),
    "customer_address_changes": ("constant", 0.0),
    "city_rto_rate": ("median", None),
    "city_order_volume": ("median", None),
    "city_avg_delivery_days": ("constant", 3.0),
    "product_rto_rate": ("median", None),
    "product_category_rto_rate": ("median", None),
    "product_price_vs_avg": ("constant", 1.0),
    "is_high_value_order": ("constant", 0.0),
    "amount_zscore": ("constant", 0.0),
    "phone_verified": ("constant", 0.0),
    "email_verified": ("constant", 0.0),
    "address_quality_score": ("constant", 0.5),
    "shipping_distance_km": ("median", None),
    "same_city_shipping": ("constant", 0.0),
    "discount_percentage": ("constant", 0.0),
    "is_first_order": ("constant", 1.0),
    "is_repeat_customer": ("constant", 0.0),
    "days_since_last_order": ("constant", 999.0),
    "cod_first_order": ("constant", 0.0),
    "high_value_cod_first": ("constant", 0.0),
    "phone_risk_score": ("constant", 0.0),
}

# Outlier clipping bounds: (min, max)
OUTLIER_BOUNDS: Dict[str, tuple] = {
    "order_amount": (0, 500_000),
    "order_item_count": (1, 50),
    "customer_order_count": (0, 500),
    "customer_avg_order_value": (0, 500_000),
    "customer_account_age_days": (0, 3650),  # 10 years max
    "customer_distinct_cities": (1, 50),
    "customer_distinct_phones": (1, 20),
    "customer_address_changes": (0, 50),
    "city_order_volume": (0, 100_000),
    "city_avg_delivery_days": (0, 30),
    "shipping_distance_km": (0, 5000),
    "discount_percentage": (0, 100),
    "days_since_last_order": (0, 999),
    "amount_zscore": (-5, 5),
}

# Rate features that must be in [0, 1]
RATE_FEATURES = [
    "customer_rto_rate",
    "customer_cancel_rate",
    "city_rto_rate",
    "product_rto_rate",
    "product_category_rto_rate",
    "address_quality_score",
    "phone_risk_score",
]


class DataValidator:
    """Validates and cleans training data before model training."""

    def __init__(
        self,
        min_class_ratio: float = 0.05,
        max_class_ratio: float = 0.95,
    ):
        self.min_class_ratio = min_class_ratio
        self.max_class_ratio = max_class_ratio

    def validate_and_clean(self, df: pd.DataFrame) -> tuple[pd.DataFrame, ValidationReport]:
        """Run all validation and cleaning steps.

        Returns (cleaned_df, report).
        """
        report = ValidationReport(original_rows=len(df))
        df = df.copy()

        # 1. Remove duplicates
        df, n_dupes = self._remove_duplicates(df)
        report.duplicates_removed = n_dupes

        # 2. Fill missing values
        df, missing_counts = self._fill_missing(df)
        report.missing_filled = missing_counts

        # 3. Clip outliers
        df, outlier_counts = self._clip_outliers(df)
        report.outliers_clipped = outlier_counts

        # 4. Validate ranges
        df, range_counts = self._validate_ranges(df)
        report.range_violations_fixed = range_counts

        # 5. Check class balance
        if "is_rto" in df.columns:
            rto_rate = df["is_rto"].mean()
            report.rto_rate = rto_rate
            if rto_rate < self.min_class_ratio:
                report.class_balance_ok = False
                report.warnings.append(
                    f"Very low RTO rate ({rto_rate:.1%}). Model may not learn fraud patterns."
                )
            elif rto_rate > self.max_class_ratio:
                report.class_balance_ok = False
                report.warnings.append(
                    f"Very high RTO rate ({rto_rate:.1%}). Data may be biased."
                )

        # 6. Ensure all feature columns exist
        for feat in FEATURE_NAMES:
            if feat not in df.columns:
                df[feat] = 0.0
                report.warnings.append(f"Feature '{feat}' was missing, filled with 0.0")

        report.final_rows = len(df)

        logger.info(
            "Validation complete: %d -> %d rows | %d dupes removed | RTO rate: %.1f%%",
            report.original_rows,
            report.final_rows,
            report.duplicates_removed,
            report.rto_rate * 100,
        )

        return df, report

    def _remove_duplicates(self, df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
        """Remove duplicate orders by order_id if present."""
        if "order_id" in df.columns:
            before = len(df)
            df = df.drop_duplicates(subset=["order_id"], keep="last")
            return df, before - len(df)
        return df, 0

    def _fill_missing(self, df: pd.DataFrame) -> tuple[pd.DataFrame, Dict[str, int]]:
        """Fill missing values using column-specific strategies."""
        counts: Dict[str, int] = {}

        for col, (strategy, value) in IMPUTATION_STRATEGIES.items():
            if col not in df.columns:
                continue
            n_missing = int(df[col].isna().sum())
            if n_missing == 0:
                continue

            if strategy == "constant":
                df[col] = df[col].fillna(value)
            elif strategy == "median":
                df[col] = df[col].fillna(df[col].median())
            elif strategy == "mean":
                df[col] = df[col].fillna(df[col].mean())

            counts[col] = n_missing

        return df, counts

    def _clip_outliers(self, df: pd.DataFrame) -> tuple[pd.DataFrame, Dict[str, int]]:
        """Clip values outside reasonable bounds."""
        counts: Dict[str, int] = {}

        for col, (lo, hi) in OUTLIER_BOUNDS.items():
            if col not in df.columns:
                continue
            n_outliers = int(((df[col] < lo) | (df[col] > hi)).sum())
            if n_outliers > 0:
                df[col] = df[col].clip(lo, hi)
                counts[col] = n_outliers

        return df, counts

    def _validate_ranges(self, df: pd.DataFrame) -> tuple[pd.DataFrame, Dict[str, int]]:
        """Ensure rate features are in [0, 1]."""
        counts: Dict[str, int] = {}

        for col in RATE_FEATURES:
            if col not in df.columns:
                continue
            n_violations = int(((df[col] < 0) | (df[col] > 1)).sum())
            if n_violations > 0:
                df[col] = df[col].clip(0, 1)
                counts[col] = n_violations

        return df, counts
