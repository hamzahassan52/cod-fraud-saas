#!/usr/bin/env python3
"""
Generate synthetic COD fraud training data for Pakistani e-commerce.

v2 — 100K edition:
    - 100,000 samples (5x more than before)
    - 20 Pakistani cities/regions (up from 12)
    - 15 product categories (up from 10)
    - City signals balanced — model works even for unknown/rural areas
    - Cleaner label generation (noise reduced: 0.3 → 0.2) → higher accuracy
    - Better class balance: ~27% RTO rate
    - Strictly uses the 35 canonical features from feature_map.py

Usage::
    python scripts/generate_synthetic_data.py             # 100000 samples
    python scripts/generate_synthetic_data.py --n 50000   # custom count
    python scripts/generate_synthetic_data.py --no-train  # skip training
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("generate_synthetic_data")

RNG = np.random.default_rng(seed=42)

# ---------------------------------------------------------------------------
# 20 cities/regions — including rural "unknown" area
# NOTE: city signals feed city_rto_rate, city_order_volume, city_avg_delivery_days
#       These are 3 of 35 features — model will still work without exact city
# ---------------------------------------------------------------------------
CITY_PROFILES = {
    # Tier 1 — Major metros
    "karachi":        {"rto_rate": 0.22, "volume": 6000, "delivery_days": 2.5},
    "lahore":         {"rto_rate": 0.20, "volume": 5000, "delivery_days": 2.8},
    "islamabad":      {"rto_rate": 0.14, "volume": 2500, "delivery_days": 2.0},
    # Tier 2 — Large cities
    "rawalpindi":     {"rto_rate": 0.25, "volume": 1800, "delivery_days": 3.0},
    "faisalabad":     {"rto_rate": 0.30, "volume": 1500, "delivery_days": 3.5},
    "multan":         {"rto_rate": 0.35, "volume": 1000, "delivery_days": 4.0},
    "peshawar":       {"rto_rate": 0.32, "volume": 900,  "delivery_days": 4.5},
    "sialkot":        {"rto_rate": 0.28, "volume": 700,  "delivery_days": 3.8},
    "gujranwala":     {"rto_rate": 0.33, "volume": 650,  "delivery_days": 4.0},
    "hyderabad":      {"rto_rate": 0.27, "volume": 700,  "delivery_days": 3.2},
    # Tier 3 — Smaller cities
    "quetta":         {"rto_rate": 0.45, "volume": 350,  "delivery_days": 5.5},
    "bahawalpur":     {"rto_rate": 0.40, "volume": 300,  "delivery_days": 5.0},
    "sargodha":       {"rto_rate": 0.38, "volume": 280,  "delivery_days": 4.5},
    "sukkur":         {"rto_rate": 0.42, "volume": 220,  "delivery_days": 5.2},
    "abbottabad":     {"rto_rate": 0.29, "volume": 250,  "delivery_days": 4.2},
    "mardan":         {"rto_rate": 0.36, "volume": 200,  "delivery_days": 4.8},
    "kasur":          {"rto_rate": 0.34, "volume": 160,  "delivery_days": 4.3},
    "sheikhupura":    {"rto_rate": 0.31, "volume": 190,  "delivery_days": 4.1},
    "rahim_yar_khan": {"rto_rate": 0.41, "volume": 150,  "delivery_days": 5.3},
    # Rural / unknown — national average defaults (ensures model works anywhere)
    "other_rural":    {"rto_rate": 0.28, "volume": 400,  "delivery_days": 5.0},
}

CITY_NAMES   = list(CITY_PROFILES.keys())
CITY_WEIGHTS = np.array([p["volume"] for p in CITY_PROFILES.values()], dtype=float)
CITY_WEIGHTS /= CITY_WEIGHTS.sum()
CITY_RTO     = np.array([p["rto_rate"]      for p in CITY_PROFILES.values()])
CITY_DEL     = np.array([p["delivery_days"] for p in CITY_PROFILES.values()])
CITY_VOL     = np.array([p["volume"]        for p in CITY_PROFILES.values()])

# ---------------------------------------------------------------------------
# 15 product categories — Pakistan COD-specific RTO rates
# ---------------------------------------------------------------------------
PRODUCT_CATEGORIES = {
    "clothing":    {"rto_rate": 0.38, "weight": 0.20, "avg_price": 2500},
    "fashion":     {"rto_rate": 0.36, "weight": 0.08, "avg_price": 3000},
    "shoes":       {"rto_rate": 0.32, "weight": 0.08, "avg_price": 3500},
    "electronics": {"rto_rate": 0.20, "weight": 0.10, "avg_price": 15000},
    "mobile":      {"rto_rate": 0.18, "weight": 0.09, "avg_price": 25000},
    "beauty":      {"rto_rate": 0.22, "weight": 0.07, "avg_price": 1800},
    "home":        {"rto_rate": 0.17, "weight": 0.06, "avg_price": 4000},
    "kitchen":     {"rto_rate": 0.14, "weight": 0.05, "avg_price": 2200},
    "groceries":   {"rto_rate": 0.09, "weight": 0.06, "avg_price": 1500},
    "books":       {"rto_rate": 0.07, "weight": 0.03, "avg_price": 800},
    "toys":        {"rto_rate": 0.25, "weight": 0.05, "avg_price": 1500},
    "sports":      {"rto_rate": 0.19, "weight": 0.04, "avg_price": 4500},
    "automotive":  {"rto_rate": 0.16, "weight": 0.03, "avg_price": 6000},
    "health":      {"rto_rate": 0.13, "weight": 0.03, "avg_price": 2000},
    "accessories": {"rto_rate": 0.29, "weight": 0.03, "avg_price": 1200},
}

CAT_NAMES      = list(PRODUCT_CATEGORIES.keys())
CAT_WEIGHTS    = np.array([p["weight"]    for p in PRODUCT_CATEGORIES.values()])
CAT_WEIGHTS   /= CAT_WEIGHTS.sum()
CAT_RTO        = np.array([p["rto_rate"]  for p in PRODUCT_CATEGORIES.values()])
CAT_AVG_PRICE  = np.array([p["avg_price"] for p in PRODUCT_CATEGORIES.values()])


def generate_synthetic_data(n: int = 100000) -> pd.DataFrame:
    """Return a DataFrame with *n* rows using the 35 canonical ML features."""

    data: dict[str, np.ndarray] = {}

    # -- Timestamps (18 months) ---------------------------------------------
    base_date   = datetime(2023, 7, 1)
    random_days = RNG.uniform(0, 548, size=n)
    random_hours= RNG.integers(0, 24, size=n)
    timestamps  = [
        base_date + timedelta(days=float(d), hours=int(h))
        for d, h in zip(random_days, random_hours)
    ]
    months   = np.array([t.month   for t in timestamps])
    days_arr = np.array([t.day     for t in timestamps])
    weekdays = np.array([t.weekday() for t in timestamps])

    # -- City (feeds 3 features: rto_rate, volume, delivery_days) -----------
    city_idx = RNG.choice(len(CITY_NAMES), size=n, p=CITY_WEIGHTS)

    # Add small noise so values are continuous not stepped
    data["city_rto_rate"]          = (CITY_RTO[city_idx] + RNG.normal(0, 0.025, n)).clip(0.05, 0.65)
    data["city_order_volume"]      = (CITY_VOL[city_idx] + RNG.normal(0, 80, n)).clip(10, 10000)
    data["city_avg_delivery_days"] = (CITY_DEL[city_idx] + RNG.normal(0, 0.4, n)).clip(1, 10)

    # -- Product category (feeds 3 features) --------------------------------
    cat_idx   = RNG.choice(len(CAT_NAMES), size=n, p=CAT_WEIGHTS)
    cat_rto   = CAT_RTO[cat_idx]
    cat_price = CAT_AVG_PRICE[cat_idx]

    data["product_category_rto_rate"] = (cat_rto + RNG.normal(0, 0.025, n)).clip(0, 0.75)
    data["product_rto_rate"]          = (data["product_category_rto_rate"] + RNG.normal(0, 0.04, n)).clip(0, 0.85)
    data["product_price_vs_avg"]      = np.abs(RNG.normal(cat_price, cat_price * 0.35, n) / cat_price).clip(0.1, 5.0)

    # -- Order-level features -----------------------------------------------
    data["order_amount"]     = np.abs(RNG.normal(cat_price, cat_price * 0.4, n)).clip(200, 80000)
    data["order_item_count"] = RNG.choice([1,2,3,4,5,6,7,8], size=n,
                                           p=[0.40,0.25,0.14,0.09,0.06,0.03,0.02,0.01]).astype(float)
    data["order_hour"]       = random_hours.astype(float)
    data["is_weekend"]       = (weekdays >= 5).astype(float)
    data["is_night_order"]   = ((random_hours >= 22) | (random_hours < 6)).astype(float)

    # Payment: 70% COD, 30% prepaid (in Pakistan most COD)
    is_cod    = RNG.choice([1.0, 0.0], size=n, p=[0.70, 0.30])
    data["is_cod"]     = is_cod
    data["is_prepaid"] = 1.0 - is_cod

    # -- Customer lifecycle -------------------------------------------------
    data["customer_order_count"]     = RNG.exponential(scale=3.5, size=n).astype(int).clip(0, 150).astype(float)
    data["customer_account_age_days"]= RNG.exponential(scale=200, size=n).clip(0, 2000)
    data["customer_distinct_cities"] = RNG.integers(1, 6, size=n).astype(float)
    data["customer_distinct_phones"] = RNG.choice([1.0,2.0,3.0,4.0,5.0], size=n,
                                                   p=[0.62,0.20,0.10,0.05,0.03])
    data["customer_address_changes"] = RNG.poisson(lam=0.7, size=n).clip(0, 10).astype(float)
    data["customer_avg_order_value"] = RNG.lognormal(mean=7.6, sigma=0.55, size=n).clip(200, 40000)

    # RTO rate correlated with city + category (weighted average)
    base_rto = RNG.beta(1.8, 5.5, size=n).clip(0, 1)
    data["customer_rto_rate"] = (
        base_rto * 0.50
        + data["city_rto_rate"] * 0.25          # city has limited weight
        + data["product_category_rto_rate"] * 0.25
    ).clip(0, 1)
    data["customer_cancel_rate"] = RNG.beta(1.2, 9, size=n).clip(0, 1)

    # -- Derived features ---------------------------------------------------
    data["is_high_value_order"] = (data["order_amount"] > 8000).astype(float)
    order_mean = data["order_amount"].mean()
    order_std  = data["order_amount"].std()
    data["amount_zscore"]       = ((data["order_amount"] - order_mean) / order_std).clip(-3, 3)

    data["phone_verified"]        = RNG.choice([1.0, 0.0], size=n, p=[0.67, 0.33])
    data["email_verified"]        = RNG.choice([1.0, 0.0], size=n, p=[0.57, 0.43])
    data["address_quality_score"] = RNG.beta(5, 2.5, size=n).clip(0, 1)
    data["shipping_distance_km"]  = RNG.exponential(scale=250, size=n).clip(1, 2500)
    data["same_city_shipping"]    = (data["shipping_distance_km"] < 60).astype(float)

    data["discount_percentage"] = RNG.choice(
        [0.0, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0],
        size=n,
        p=[0.33, 0.13, 0.12, 0.10, 0.10, 0.07, 0.06, 0.04, 0.03, 0.02],
    )

    data["is_first_order"]     = (data["customer_order_count"] <= 1).astype(float)
    data["is_repeat_customer"] = (data["customer_order_count"] > 1).astype(float)
    data["days_since_last_order"] = np.where(
        data["is_first_order"] == 1.0,
        999.0,
        RNG.exponential(scale=28, size=n).clip(0, 365),
    )

    # Interaction features (3 canonical ones)
    data["cod_first_order"]      = data["is_cod"] * data["is_first_order"]
    data["high_value_cod_first"] = data["is_high_value_order"] * data["is_cod"] * data["is_first_order"]
    data["phone_risk_score"]     = data["customer_rto_rate"] * (1.0 - data["phone_verified"])

    # -- Seasonal signals ---------------------------------------------------
    is_eid     = np.isin(months, [4, 5, 6, 7]).astype(float)
    is_ramadan = np.isin(months, [3, 4]).astype(float)
    is_sale    = (
        ((months == 11) & (days_arr >= 8)  & (days_arr <= 14))
        | ((months == 12) & (days_arr >= 9)  & (days_arr <= 15))
        | ((months == 11) & (days_arr >= 22) & (days_arr <= 28))
    ).astype(float)

    # -- Target label: is_rto -----------------------------------------------
    # City signals get moderate weight (0.8 vs customer signals 1.4+)
    # so model is useful even for unknown cities
    logit = (
        -3.0                                                        # ~27% base RTO
        # Payment (strongest single signal)
        + 2.0  * data["is_cod"]
        - 1.2  * data["is_prepaid"]
        # Order value
        + 0.6  * data["is_high_value_order"]
        + 0.2  * data["amount_zscore"].clip(-2, 2)
        # Customer lifecycle (strong)
        + 1.1  * data["is_first_order"]
        - 0.9  * data["is_repeat_customer"]
        - 0.04 * data["customer_order_count"].clip(0, 30)
        # Customer risk history (strongest behavioral signals)
        + 1.4  * data["customer_rto_rate"]
        + 0.5  * data["customer_cancel_rate"]
        # Phone/address patterns
        + 0.7  * (data["customer_distinct_phones"] > 2).astype(float)
        + 0.5  * (data["customer_distinct_phones"] > 3).astype(float)
        + 0.3  * data["customer_address_changes"].clip(0, 5) / 5.0
        # Geography (moderate weight — not city-dependent)
        + 0.8  * data["city_rto_rate"]                             # city is helpful but not required
        - 0.4  * data["same_city_shipping"]
        # Time
        + 0.5  * data["is_night_order"]
        # Verification (strong negative signal)
        - 0.9  * data["phone_verified"]
        - 0.6  * data["email_verified"]
        - 0.5  * data["address_quality_score"]
        # Product
        + 0.6  * data["product_rto_rate"]
        + 0.3  * data["product_category_rto_rate"]
        # Discount abuse
        + 0.3  * data["discount_percentage"] / 50.0
        + 0.8  * (data["discount_percentage"] > 30).astype(float) * data["cod_first_order"]
        # Interaction effects (very powerful combined signals)
        + 1.4  * data["cod_first_order"]
        + 2.0  * data["high_value_cod_first"]
        + 0.9  * data["phone_risk_score"]
        + 0.6  * data["is_night_order"] * data["is_first_order"]
        # Seasonal
        + 0.35 * is_eid
        + 0.25 * is_sale
        + 0.15 * is_ramadan
        # Reduced noise → cleaner signal → higher accuracy
        + RNG.normal(0, 0.20, n)
    )

    prob = 1.0 / (1.0 + np.exp(-logit))
    data["is_rto"] = (RNG.random(n) < prob).astype(int)

    df = pd.DataFrame(data)

    rto_pct = df["is_rto"].mean() * 100
    logger.info("Generated %d samples | RTO rate: %.1f%%", n, rto_pct)
    logger.info("Payment: COD %.0f%% | Prepaid %.0f%%",
                df["is_cod"].mean() * 100, df["is_prepaid"].mean() * 100)

    cat_names_arr = np.array(CAT_NAMES)[cat_idx]
    for cat in CAT_NAMES:
        mask = cat_names_arr == cat
        if mask.sum() > 0:
            logger.info("  %-14s: %6d samples, RTO %.1f%%",
                        cat, mask.sum(), df.loc[mask, "is_rto"].mean() * 100)

    return df


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic COD fraud data (v2)")
    parser.add_argument("--n", type=int, default=100000, help="Samples (default 100000)")
    parser.add_argument("--no-train", action="store_true", help="Skip training")
    args = parser.parse_args()

    logger.info("v2 — 20 cities, 15 categories, %d samples", args.n)
    df = generate_synthetic_data(n=args.n)

    data_dir = PROJECT_ROOT / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    csv_path = data_dir / "training_data.csv"
    df.to_csv(csv_path, index=False)
    logger.info("Saved → %s  (%d rows, %d cols)", csv_path, len(df), len(df.columns))

    if not args.no_train:
        logger.info("Training XGBoost on %d samples...", args.n)
        from train import save_trained_model, train_model
        model, metrics, feature_names, n_samples = train_model(df, test_size=0.2, min_samples=10)
        version = save_trained_model(model, metrics, feature_names, n_samples)
        print(f"\nModel: {version}")
        print(f"  Accuracy  : {metrics['accuracy']:.4f}")
        print(f"  AUC-ROC   : {metrics['auc_roc']:.4f}")
        if "f1_score"  in metrics: print(f"  F1 Score  : {metrics['f1_score']:.4f}")
        if "precision" in metrics: print(f"  Precision : {metrics['precision']:.4f}")
        if "recall"    in metrics: print(f"  Recall    : {metrics['recall']:.4f}")
    else:
        print(f"\nData saved → {csv_path}  ({len(df):,} rows)")


if __name__ == "__main__":
    main()
