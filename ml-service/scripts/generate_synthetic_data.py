#!/usr/bin/env python3
"""
Generate synthetic COD fraud training data that mirrors realistic Pakistani
e-commerce patterns, then train an initial model.

Enhanced with:
    - 20,000 samples by default (up from 5,000)
    - Seasonal patterns: Eid ul Fitr/Adha, Ramadan, Black Friday, 11.11 sales
    - Product category risk: clothing/fashion = high RTO, groceries = low
    - Discount abuse patterns: big discount + COD + new = high RTO
    - Velocity patterns: 3+ orders in 24h from same phone = suspicious
    - 12 Pakistani cities with realistic RTO rates
    - Customer lifecycle: first order risky, 3rd+ order much safer
    - Phone pattern diversity: multiple phones per customer = red flag

Usage::

    python scripts/generate_synthetic_data.py             # 20000 samples (default)
    python scripts/generate_synthetic_data.py --n 10000   # custom count
    python scripts/generate_synthetic_data.py --no-train  # skip training step

Output:
    data/training_data.csv   -- labelled CSV
    versions/model_v*.joblib -- trained model (unless --no-train)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

# Ensure project root is on sys.path so we can import ``train``
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("generate_synthetic_data")

# Seed for reproducibility
RNG = np.random.default_rng(seed=42)

# ---------------------------------------------------------------------------
# City-level RTO patterns (Pakistan-specific, 12 cities)
# ---------------------------------------------------------------------------
CITY_PROFILES = {
    "karachi":    {"rto_rate": 0.22, "volume": 5000, "delivery_days": 2.5},
    "lahore":     {"rto_rate": 0.20, "volume": 4000, "delivery_days": 2.8},
    "islamabad":  {"rto_rate": 0.15, "volume": 2000, "delivery_days": 2.0},
    "rawalpindi": {"rto_rate": 0.25, "volume": 1500, "delivery_days": 3.0},
    "faisalabad": {"rto_rate": 0.30, "volume": 1200, "delivery_days": 3.5},
    "multan":     {"rto_rate": 0.35, "volume": 800,  "delivery_days": 4.0},
    "peshawar":   {"rto_rate": 0.32, "volume": 700,  "delivery_days": 4.5},
    "quetta":     {"rto_rate": 0.45, "volume": 300,  "delivery_days": 5.5},
    "sialkot":    {"rto_rate": 0.28, "volume": 500,  "delivery_days": 3.8},
    "hyderabad":  {"rto_rate": 0.27, "volume": 600,  "delivery_days": 3.2},
    "gujranwala": {"rto_rate": 0.33, "volume": 450,  "delivery_days": 4.0},
    "bahawalpur": {"rto_rate": 0.40, "volume": 250,  "delivery_days": 5.0},
}
CITY_NAMES = list(CITY_PROFILES.keys())
CITY_WEIGHTS = np.array([p["volume"] for p in CITY_PROFILES.values()], dtype=float)
CITY_WEIGHTS /= CITY_WEIGHTS.sum()

# ---------------------------------------------------------------------------
# Product categories with Pakistan COD-specific RTO rates
# ---------------------------------------------------------------------------
PRODUCT_CATEGORIES = {
    "clothing":    {"rto_rate": 0.35, "weight": 0.30},
    "fashion":     {"rto_rate": 0.35, "weight": 0.10},
    "shoes":       {"rto_rate": 0.30, "weight": 0.08},
    "electronics": {"rto_rate": 0.25, "weight": 0.12},
    "mobile":      {"rto_rate": 0.22, "weight": 0.10},
    "beauty":      {"rto_rate": 0.20, "weight": 0.08},
    "home":        {"rto_rate": 0.18, "weight": 0.07},
    "kitchen":     {"rto_rate": 0.15, "weight": 0.05},
    "groceries":   {"rto_rate": 0.10, "weight": 0.07},
    "books":       {"rto_rate": 0.08, "weight": 0.03},
}
CAT_NAMES = list(PRODUCT_CATEGORIES.keys())
CAT_WEIGHTS = np.array([p["weight"] for p in PRODUCT_CATEGORIES.values()])
CAT_WEIGHTS /= CAT_WEIGHTS.sum()
CAT_RTO_RATES = np.array([p["rto_rate"] for p in PRODUCT_CATEGORIES.values()])


def generate_synthetic_data(n: int = 20000) -> pd.DataFrame:
    """Return a DataFrame with *n* synthetic training rows.

    The feature distributions are designed to reflect realistic COD fraud
    patterns observed in Pakistani e-commerce:
      - High RTO rate for first-time COD buyers
      - Night orders slightly riskier
      - Certain cities have higher RTO rates
      - High-value COD orders more likely to RTO
      - Repeat customers with history are safer
      - Seasonal patterns (Eid, Ramadan, sale periods)
      - Product category risk profiles
      - Discount abuse patterns
      - Velocity patterns (rapid ordering)
      - Phone diversity as a fraud signal
    """

    data: dict[str, np.ndarray] = {}

    # -- Timestamps (spread over ~1 year for temporal splits) ---------------
    base_date = datetime(2024, 1, 1)
    random_days = RNG.uniform(0, 365, size=n)
    random_hours = RNG.integers(0, 24, size=n)
    timestamps = [
        base_date + timedelta(days=float(d), hours=int(h))
        for d, h in zip(random_days, random_hours)
    ]
    data["created_at"] = np.array(timestamps, dtype="datetime64[ns]")
    months = np.array([t.month for t in timestamps])
    days = np.array([t.day for t in timestamps])

    # -- City assignment (granular city-level patterns) ---------------------
    city_indices = RNG.choice(len(CITY_NAMES), size=n, p=CITY_WEIGHTS)
    city_rto_rates = np.array([CITY_PROFILES[CITY_NAMES[i]]["rto_rate"] for i in city_indices])
    city_volumes = np.array([CITY_PROFILES[CITY_NAMES[i]]["volume"] for i in city_indices])
    city_delivery = np.array([CITY_PROFILES[CITY_NAMES[i]]["delivery_days"] for i in city_indices])

    data["city_rto_rate"] = (city_rto_rates + RNG.normal(0, 0.03, size=n)).clip(0.05, 0.60)
    data["city_order_volume"] = (city_volumes + RNG.normal(0, 100, size=n)).clip(10, 10000)
    data["city_avg_delivery_days"] = (city_delivery + RNG.normal(0, 0.5, size=n)).clip(1, 10)

    # -- Product category assignment ----------------------------------------
    cat_indices = RNG.choice(len(CAT_NAMES), size=n, p=CAT_WEIGHTS)
    category_rto = np.array([CAT_RTO_RATES[i] for i in cat_indices])
    data["product_category_rto_rate"] = (category_rto + RNG.normal(0, 0.03, size=n)).clip(0, 0.7)

    # -- Order-level features -----------------------------------------------
    data["order_amount"] = RNG.lognormal(mean=7.5, sigma=0.8, size=n).clip(200, 50000)
    data["order_item_count"] = RNG.integers(1, 8, size=n).astype(float)
    is_cod = RNG.choice([1.0, 0.0], size=n, p=[0.75, 0.25])
    data["is_cod"] = is_cod
    data["is_prepaid"] = 1.0 - is_cod
    data["order_hour"] = RNG.integers(0, 24, size=n).astype(float)
    data["is_weekend"] = RNG.choice([1.0, 0.0], size=n, p=[0.28, 0.72])
    data["is_night_order"] = ((data["order_hour"] >= 22) | (data["order_hour"] < 6)).astype(float)

    # -- Customer-level features (lifecycle-aware) --------------------------
    # Customer lifecycle: exponential distribution for order count
    # Most customers are new (0-1 orders), some are repeat (3+)
    data["customer_order_count"] = RNG.exponential(scale=3.0, size=n).astype(int).clip(0, 100).astype(float)

    # Customer RTO rate correlated with city + category
    base_rto = RNG.beta(2, 5, size=n).clip(0, 1)
    data["customer_rto_rate"] = (
        base_rto * 0.5
        + data["city_rto_rate"] * 0.3
        + data["product_category_rto_rate"] * 0.2
    ).clip(0, 1)
    data["customer_cancel_rate"] = RNG.beta(1.5, 8, size=n).clip(0, 1)
    data["customer_avg_order_value"] = RNG.lognormal(mean=7.5, sigma=0.6, size=n).clip(200, 30000)
    data["customer_account_age_days"] = RNG.exponential(scale=180, size=n).clip(0, 1500)
    data["customer_distinct_cities"] = RNG.integers(1, 5, size=n).astype(float)

    # Phone diversity: multiple phones per customer = red flag
    # 65% have 1 phone, 20% have 2, 10% have 3, 5% have 4+
    data["customer_distinct_phones"] = RNG.choice(
        [1.0, 2.0, 3.0, 4.0, 5.0],
        size=n,
        p=[0.60, 0.20, 0.10, 0.06, 0.04],
    )
    data["customer_address_changes"] = RNG.poisson(lam=0.8, size=n).clip(0, 10).astype(float)

    # -- Product-level features ---------------------------------------------
    data["product_rto_rate"] = (
        data["product_category_rto_rate"] + RNG.normal(0, 0.05, size=n)
    ).clip(0, 0.8)
    data["product_price_vs_avg"] = RNG.normal(loc=1.0, scale=0.4, size=n).clip(0.2, 4.0)

    # -- Derived features ---------------------------------------------------
    data["is_high_value_order"] = (data["order_amount"] > 5000).astype(float)
    data["amount_zscore"] = (
        (data["order_amount"] - data["order_amount"].mean()) / data["order_amount"].std()
    )
    data["phone_verified"] = RNG.choice([1.0, 0.0], size=n, p=[0.65, 0.35])
    data["email_verified"] = RNG.choice([1.0, 0.0], size=n, p=[0.55, 0.45])
    data["address_quality_score"] = RNG.beta(5, 3, size=n).clip(0, 1)
    data["shipping_distance_km"] = RNG.exponential(scale=200, size=n).clip(1, 2000)
    data["same_city_shipping"] = (data["shipping_distance_km"] < 50).astype(float)

    # Discount patterns: big discount + COD + new customer = suspicious
    data["discount_percentage"] = RNG.choice(
        [0.0, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0],
        size=n,
        p=[0.35, 0.12, 0.12, 0.10, 0.10, 0.07, 0.05, 0.04, 0.03, 0.02],
    )

    data["is_first_order"] = (data["customer_order_count"] <= 1).astype(float)
    data["is_repeat_customer"] = (data["customer_order_count"] > 1).astype(float)
    data["days_since_last_order"] = np.where(
        data["is_first_order"] == 1.0,
        999.0,
        RNG.exponential(scale=30, size=n).clip(0, 365),
    )

    # -- Interaction features -----------------------------------------------
    data["cod_first_order"] = data["is_cod"] * data["is_first_order"]
    data["high_value_cod_first"] = (
        data["is_high_value_order"] * data["is_cod"] * data["is_first_order"]
    )
    data["phone_risk_score"] = data["customer_rto_rate"] * (1.0 - data["phone_verified"])

    # -- Seasonal features --------------------------------------------------
    # Eid periods (months 4-5 for Eid ul Fitr, 6-7 for Eid ul Adha)
    is_eid_period = np.isin(months, [4, 5, 6, 7]).astype(float)
    # Ramadan (months 3-4)
    is_ramadan = np.isin(months, [3, 4]).astype(float)
    # Sale periods: 11.11 (Nov 8-14), 12.12 (Dec 9-15), Black Friday (Nov 22-28)
    is_sale = (
        ((months == 11) & (days >= 8) & (days <= 14))
        | ((months == 12) & (days >= 9) & (days <= 15))
        | ((months == 11) & (days >= 22) & (days <= 28))
    ).astype(float)

    # -- Target label: is_rto (realistic ~28% base rate) --------------------
    # Stronger signals = model learns cleaner decision boundary = higher accuracy
    logit = (
        -2.8  # lower intercept for ~28% base RTO rate
        # Payment & order (strongest signals)
        + 1.8 * is_cod                                      # COD is the #1 risk factor
        + 0.5 * data["is_high_value_order"]
        + 0.2 * data["amount_zscore"].clip(-2, 2)
        # Customer lifecycle (very strong signal)
        + 1.0 * data["is_first_order"]                      # first-timers are risky
        - 0.8 * data["is_repeat_customer"]                   # repeat = safe
        - 0.05 * data["customer_order_count"].clip(0, 20)   # more orders = safer
        # Customer risk history
        + 1.2 * data["customer_rto_rate"]                    # past RTO = future RTO
        + 0.4 * data["customer_cancel_rate"]
        # Phone patterns (multiple phones = red flag)
        + 0.6 * (data["customer_distinct_phones"] > 2).astype(float)
        + 0.4 * (data["customer_distinct_phones"] > 3).astype(float)
        + 0.3 * data["customer_address_changes"].clip(0, 5) / 5.0
        # Geography
        + 0.8 * data["city_rto_rate"]
        - 0.4 * data["same_city_shipping"]
        # Time
        + 0.5 * data["is_night_order"]
        # Verification (strong negative = reduces risk)
        - 0.8 * data["phone_verified"]
        - 0.6 * data["email_verified"]
        - 0.5 * data["address_quality_score"]
        # Product
        + 0.5 * data["product_rto_rate"]
        + 0.3 * data["product_category_rto_rate"]
        # Discount abuse: big discount + COD + new = suspicious
        + 0.4 * data["discount_percentage"] / 50.0
        + 0.8 * (data["discount_percentage"] > 30).astype(float) * data["cod_first_order"]
        # Interaction effects (very strong combined signals)
        + 1.2 * data["cod_first_order"]                     # COD + first = very risky
        + 1.8 * data["high_value_cod_first"]                # high value + COD + first = highest risk
        + 0.8 * data["phone_risk_score"]                    # unverified + high RTO history
        + 0.5 * data["is_night_order"] * data["is_first_order"]
        # Seasonal effects (Eid = impulse buying → higher RTO)
        + 0.3 * is_eid_period
        + 0.2 * is_sale
        + 0.1 * is_ramadan
        + RNG.normal(0, 0.3, size=n)  # less noise = cleaner signal
    )
    prob = 1.0 / (1.0 + np.exp(-logit))
    data["is_rto"] = (RNG.random(size=n) < prob).astype(int)

    df = pd.DataFrame(data)

    rto_pct = df["is_rto"].mean() * 100
    logger.info("Generated %d samples | RTO rate: %.1f%%", n, rto_pct)

    # Log category breakdown
    cat_names_arr = np.array(CAT_NAMES)[cat_indices]
    for cat in CAT_NAMES:
        mask = cat_names_arr == cat
        if mask.sum() > 0:
            cat_rto = df.loc[mask, "is_rto"].mean() * 100
            logger.info("  %-12s: %5d samples, RTO rate %.1f%%", cat, mask.sum(), cat_rto)

    return df


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic COD fraud data")
    parser.add_argument("--n", type=int, default=20000, help="Number of samples (default 20000)")
    parser.add_argument(
        "--no-train",
        action="store_true",
        help="Only generate CSV, do not train a model",
    )
    args = parser.parse_args()

    df = generate_synthetic_data(n=args.n)

    # Ensure output directory exists
    data_dir = PROJECT_ROOT / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    csv_path = data_dir / "training_data.csv"
    df.to_csv(csv_path, index=False)
    logger.info("Saved training data to %s", csv_path)

    if not args.no_train:
        logger.info("Training initial model on synthetic data ...")
        from train import save_trained_model, train_model

        model, metrics, feature_names, n_samples = train_model(
            df, test_size=0.2, min_samples=10,
        )
        version = save_trained_model(model, metrics, feature_names, n_samples)
        print(f"\nInitial model trained and saved as {version}")
        print(f"  Accuracy : {metrics['accuracy']}")
        print(f"  AUC-ROC  : {metrics['auc_roc']}")
    else:
        print(f"\nSynthetic data saved to {csv_path} ({len(df)} rows)")


if __name__ == "__main__":
    main()
