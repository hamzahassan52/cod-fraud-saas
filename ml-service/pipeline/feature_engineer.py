"""
Feature Engineer — sklearn Pipeline with interaction and seasonal features.

Includes:
    - Interaction features (COD + first order, high value + COD + first, phone risk)
    - Pakistan seasonal features (Eid = higher RTO, sale periods, Ramadan)
    - Product category risk scoring (clothing > electronics > groceries)
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.pipeline import Pipeline

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pakistan seasonal calendar (approximate date ranges)
# ---------------------------------------------------------------------------

# Eid ul Fitr (approximate — shifts ~11 days earlier each year)
# RTO spikes 1-2 weeks after Eid due to impulse purchases
EID_UL_FITR_MONTHS = [4, 5]  # April-May typically
EID_UL_ADHA_MONTHS = [6, 7]  # June-July typically
RAMADAN_MONTHS = [3, 4]       # March-April typically
SALE_EVENTS = {
    "11_11": (11, 11),  # 11.11 sale
    "12_12": (12, 12),  # 12.12 sale
    "black_friday": (11, 25),  # approx
}

# Product category RTO rates (Pakistan COD-specific)
CATEGORY_RTO_RATES = {
    "clothing": 0.35,
    "fashion": 0.35,
    "shoes": 0.30,
    "accessories": 0.28,
    "electronics": 0.25,
    "mobile": 0.22,
    "beauty": 0.20,
    "home": 0.18,
    "kitchen": 0.15,
    "groceries": 0.10,
    "books": 0.08,
}


class InteractionFeatureTransformer(BaseEstimator, TransformerMixin):
    """Add interaction features if they don't already exist."""

    def fit(self, X: pd.DataFrame, y=None):
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        X = X.copy()

        # COD + first order = risky
        if "cod_first_order" not in X.columns:
            X["cod_first_order"] = X.get("is_cod", 0) * X.get("is_first_order", 0)

        # High value + COD + first order = very risky
        if "high_value_cod_first" not in X.columns:
            X["high_value_cod_first"] = (
                X.get("is_high_value_order", 0)
                * X.get("is_cod", 0)
                * X.get("is_first_order", 0)
            )

        # Phone risk score
        if "phone_risk_score" not in X.columns:
            X["phone_risk_score"] = (
                X.get("customer_rto_rate", 0) * (1.0 - X.get("phone_verified", 0))
            )

        return X


class SeasonalFeatureTransformer(BaseEstimator, TransformerMixin):
    """Add Pakistan-specific seasonal features based on order date.

    Requires a 'created_at' or 'order_month'/'order_day' column.
    If no date info is available, returns data unchanged.
    """

    def fit(self, X: pd.DataFrame, y=None):
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        X = X.copy()

        month = None
        day = None

        if "created_at" in X.columns:
            try:
                dt = pd.to_datetime(X["created_at"])
                month = dt.dt.month
                day = dt.dt.day
            except Exception:
                pass
        elif "order_month" in X.columns:
            month = X["order_month"]
            day = X.get("order_day", 15)  # default mid-month

        if month is None:
            # No date info — add zero columns so model shape stays consistent
            for col in ["is_eid_period", "is_ramadan", "is_sale_period", "seasonal_rto_boost"]:
                if col not in X.columns:
                    X[col] = 0.0
            return X

        # Eid periods (RTO spikes after Eid)
        X["is_eid_period"] = (
            month.isin(EID_UL_FITR_MONTHS) | month.isin(EID_UL_ADHA_MONTHS)
        ).astype(float)

        # Ramadan (slightly different buying patterns)
        X["is_ramadan"] = month.isin(RAMADAN_MONTHS).astype(float)

        # Sale periods (11.11, 12.12, Black Friday)
        is_sale = pd.Series(0.0, index=X.index)
        for event, (m, d) in SALE_EVENTS.items():
            is_sale = is_sale | ((month == m) & (day >= d - 3) & (day <= d + 3))
        X["is_sale_period"] = is_sale.astype(float)

        # Combined seasonal RTO boost
        X["seasonal_rto_boost"] = (
            X["is_eid_period"] * 0.15
            + X["is_ramadan"] * 0.05
            + X["is_sale_period"] * 0.10
        )

        return X


class CategoryRiskTransformer(BaseEstimator, TransformerMixin):
    """Map product category to historical RTO rate.

    Requires a 'product_category' column (string). If not present, no-op.
    """

    def __init__(self, default_rate: float = 0.20):
        self.default_rate = default_rate

    def fit(self, X: pd.DataFrame, y=None):
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        X = X.copy()

        if "product_category" in X.columns:
            X["category_risk_rate"] = (
                X["product_category"]
                .str.lower()
                .str.strip()
                .map(CATEGORY_RTO_RATES)
                .fillna(self.default_rate)
            )
        elif "category_risk_rate" not in X.columns:
            X["category_risk_rate"] = self.default_rate

        return X


def build_feature_pipeline() -> Pipeline:
    """Build the full feature engineering pipeline."""
    return Pipeline([
        ("interactions", InteractionFeatureTransformer()),
        ("seasonal", SeasonalFeatureTransformer()),
        ("category_risk", CategoryRiskTransformer()),
    ])
