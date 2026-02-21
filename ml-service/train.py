#!/usr/bin/env python3
"""
Training pipeline for the COD Fraud Detection ensemble model.

Can be executed standalone::

    python train.py                       # train from DB
    python train.py --csv data/training_data.csv   # train from CSV

The script will:
  1. Fetch / load labelled order data (48 features).
  2. Engineer interaction + v3 features.
  3. Train XGBoost + LightGBM with hyperparameter search (3-fold CV, 15+10 iter).
  4. Class imbalance handled via scale_pos_weight/class_weight (no SMOTE overhead).
  5. Combine into a soft-voting ensemble for improved accuracy.
  6. Evaluate on held-out test set.
  7. Save the ensemble + metadata under ``versions/``.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from lightgbm import LGBMClassifier
from sklearn.ensemble import VotingClassifier
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split as random_train_test_split
from xgboost import XGBClassifier

# Project imports
sys.path.insert(0, str(Path(__file__).resolve().parent))
from utils.model_manager import ModelManager

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("train")

# ---------------------------------------------------------------------------
# The canonical 48 features — sorted alphabetically for determinism.
# v1: 35 base features
# v2: +7 velocity/account-age features
# v3: +6 seasonal/behavioral/discount features
# ---------------------------------------------------------------------------
FEATURE_NAMES: List[str] = sorted([
    "order_amount",
    "order_item_count",
    "is_cod",
    "is_prepaid",
    "order_hour",
    "is_weekend",
    "is_night_order",
    "customer_order_count",
    "customer_rto_rate",
    "customer_cancel_rate",
    "customer_avg_order_value",
    "customer_account_age_days",
    "customer_distinct_cities",
    "customer_distinct_phones",
    "customer_address_changes",
    "city_rto_rate",
    "city_order_volume",
    "city_avg_delivery_days",
    "product_rto_rate",
    "product_category_rto_rate",
    "product_price_vs_avg",
    "is_high_value_order",
    "amount_zscore",
    "phone_verified",
    "email_verified",
    "address_quality_score",
    "shipping_distance_km",
    "same_city_shipping",
    "discount_percentage",
    "is_first_order",
    "is_repeat_customer",
    "days_since_last_order",
    # Interaction features
    "cod_first_order",
    "high_value_cod_first",
    "phone_risk_score",
    # v2: velocity + value anomaly + account-age signals
    "orders_last_24h",
    "orders_last_7d",
    "customer_lifetime_value",
    "amount_vs_customer_avg",
    "is_new_account",
    "new_account_high_value",
    "new_account_cod",
    # v3: seasonal + behavioral + discount signals
    "orders_last_1h",
    "is_eid_period",
    "is_ramadan",
    "is_sale_period",
    "is_high_discount",
    "avg_days_between_orders",
])


# ---------------------------------------------------------------------------
# Temporal train/test split (avoids data leakage)
# ---------------------------------------------------------------------------

def temporal_train_test_split(
    df: pd.DataFrame,
    time_col: str = "created_at",
    test_size: float = 0.2,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Split a dataframe by time: first (1-test_size) for train, last test_size for test.

    Returns (train_df, test_df) and logs the split boundary date.
    """
    df_sorted = df.sort_values(time_col).reset_index(drop=True)
    split_idx = int(len(df_sorted) * (1 - test_size))
    train_df = df_sorted.iloc[:split_idx]
    test_df = df_sorted.iloc[split_idx:]

    boundary_date = df_sorted[time_col].iloc[split_idx]
    logger.info(
        "Temporal split boundary: %s (train: %d rows up to boundary, test: %d rows after)",
        boundary_date,
        len(train_df),
        len(test_df),
    )
    return train_df, test_df


def _has_time_column(df: pd.DataFrame) -> Optional[str]:
    """Detect a usable time column in the dataframe."""
    for col in ("created_at", "order_date", "date", "timestamp"):
        if col in df.columns:
            try:
                pd.to_datetime(df[col])
                return col
            except Exception:
                continue
    return None


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data_from_db() -> pd.DataFrame:
    """Fetch labelled training data from PostgreSQL.

    Joins ``orders`` with ``fraud_scores`` to produce a single dataframe
    with feature columns and the target label (``is_rto``).
    """
    import psycopg2
    import psycopg2.extras

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise EnvironmentError("DATABASE_URL is not set")

    logger.info("Connecting to database ...")
    conn = psycopg2.connect(db_url)

    query = """
        SELECT
            o.id                             AS order_id,
            o.amount                         AS order_amount,
            o.item_count                     AS order_item_count,
            CASE WHEN o.payment_method = 'cod' THEN 1 ELSE 0 END AS is_cod,
            CASE WHEN o.payment_method != 'cod' THEN 1 ELSE 0 END AS is_prepaid,
            EXTRACT(HOUR FROM o.created_at)  AS order_hour,
            CASE WHEN EXTRACT(DOW FROM o.created_at) IN (0, 6) THEN 1 ELSE 0 END AS is_weekend,
            CASE WHEN EXTRACT(HOUR FROM o.created_at) >= 22
                   OR EXTRACT(HOUR FROM o.created_at) < 6 THEN 1 ELSE 0 END AS is_night_order,
            COALESCE(fs.customer_order_count, 0)      AS customer_order_count,
            COALESCE(fs.customer_rto_rate, 0)          AS customer_rto_rate,
            COALESCE(fs.customer_cancel_rate, 0)       AS customer_cancel_rate,
            COALESCE(fs.customer_avg_order_value, 0)   AS customer_avg_order_value,
            COALESCE(fs.customer_account_age_days, 0)  AS customer_account_age_days,
            COALESCE(fs.customer_distinct_cities, 1)   AS customer_distinct_cities,
            COALESCE(fs.customer_distinct_phones, 1)   AS customer_distinct_phones,
            COALESCE(fs.customer_address_changes, 0)   AS customer_address_changes,
            COALESCE(fs.city_rto_rate, 0)              AS city_rto_rate,
            COALESCE(fs.city_order_volume, 0)          AS city_order_volume,
            COALESCE(fs.city_avg_delivery_days, 0)     AS city_avg_delivery_days,
            COALESCE(fs.product_rto_rate, 0)           AS product_rto_rate,
            COALESCE(fs.product_category_rto_rate, 0)  AS product_category_rto_rate,
            COALESCE(fs.product_price_vs_avg, 1)       AS product_price_vs_avg,
            CASE WHEN o.amount > 5000 THEN 1 ELSE 0 END AS is_high_value_order,
            COALESCE(fs.amount_zscore, 0)              AS amount_zscore,
            COALESCE(fs.phone_verified, 0)::int        AS phone_verified,
            COALESCE(fs.email_verified, 0)::int        AS email_verified,
            COALESCE(fs.address_quality_score, 0.5)    AS address_quality_score,
            COALESCE(fs.shipping_distance_km, 0)       AS shipping_distance_km,
            CASE WHEN fs.shipping_distance_km < 50 THEN 1 ELSE 0 END AS same_city_shipping,
            COALESCE(fs.discount_percentage, 0)        AS discount_percentage,
            CASE WHEN COALESCE(fs.customer_order_count, 0) <= 1 THEN 1 ELSE 0 END AS is_first_order,
            CASE WHEN COALESCE(fs.customer_order_count, 0) > 1 THEN 1 ELSE 0 END AS is_repeat_customer,
            COALESCE(fs.days_since_last_order, 999)    AS days_since_last_order,
            CASE WHEN o.status IN ('rto', 'returned', 'return_to_origin') THEN 1 ELSE 0 END AS is_rto,
            o.created_at
        FROM orders o
        LEFT JOIN fraud_scores fs ON fs.order_id = o.id
        WHERE o.status IS NOT NULL
          AND o.status NOT IN ('pending', 'processing')
        ORDER BY o.created_at ASC
    """

    df = pd.read_sql(query, conn)
    conn.close()
    logger.info("Loaded %d rows from database", len(df))
    return df


def load_data_from_csv(path: str) -> pd.DataFrame:
    """Load pre-built CSV training data."""
    df = pd.read_csv(path)
    logger.info("Loaded %d rows from CSV: %s", len(df), path)
    return df


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def engineer_interaction_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add interaction features if they don't already exist."""
    if "cod_first_order" not in df.columns:
        df["cod_first_order"] = df.get("is_cod", 0) * df.get("is_first_order", 0)

    if "high_value_cod_first" not in df.columns:
        df["high_value_cod_first"] = (
            df.get("is_high_value_order", 0) * df.get("is_cod", 0) * df.get("is_first_order", 0)
        )

    if "phone_risk_score" not in df.columns:
        df["phone_risk_score"] = (
            df.get("customer_rto_rate", 0) * (1.0 - df.get("phone_verified", 0))
        )

    return df


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train_model(
    df: pd.DataFrame,
    test_size: float = 0.2,
    min_samples: int = 100,
    temporal: bool = False,
) -> Tuple[Any, Dict[str, float], List[str], int]:
    """Train an XGBoost + LightGBM soft-voting ensemble and return (model, metrics, feature_names, n_samples).

    Pipeline:
        1. Optional temporal or random train/test split.
        2. SMOTE oversampling to balance RTO vs delivered classes.
        3. XGBoost RandomizedSearchCV (30 iter, 5-fold).
        4. LightGBM RandomizedSearchCV (25 iter, 5-fold).
        5. Soft-voting VotingClassifier fitted on SMOTE'd data.
        6. Evaluation on original (non-SMOTE) test set.

    Parameters
    ----------
    temporal : bool
        If True, split by time (first 80% train, last 20% test) to avoid data leakage.

    Raises
    ------
    ValueError
        If the dataset is smaller than *min_samples*.
    """
    if len(df) < min_samples:
        raise ValueError(
            "Not enough data: got %d rows, need at least %d" % (len(df), min_samples)
        )

    # --- Engineer interaction features -----------------------------------
    df = engineer_interaction_features(df)

    # --- Ensure all 35 features exist (fill with 0) --------------------
    for feat in FEATURE_NAMES:
        if feat not in df.columns:
            df[feat] = 0.0

    n_samples = len(df)
    n_positive = int(df["is_rto"].sum())
    n_negative = n_samples - n_positive
    logger.info(
        "Dataset: %d samples | %d RTO (%.1f%%) | %d Delivered (%.1f%%)",
        n_samples,
        n_positive,
        100.0 * n_positive / n_samples,
        n_negative,
        100.0 * n_negative / n_samples,
    )

    # --- Train / test split --------------------------------------------
    time_col = _has_time_column(df) if temporal else None
    if temporal and time_col:
        logger.info("Using TEMPORAL split on column '%s' (avoids data leakage)", time_col)
        df[time_col] = pd.to_datetime(df[time_col])
        train_df, test_df = temporal_train_test_split(df, time_col=time_col, test_size=test_size)
        X_train = train_df[FEATURE_NAMES].astype(np.float64).values
        y_train = train_df["is_rto"].astype(int).values
        X_test = test_df[FEATURE_NAMES].astype(np.float64).values
        y_test = test_df["is_rto"].astype(int).values
    else:
        if temporal:
            logger.warning("Temporal split requested but no time column found; falling back to random split")
        X = df[FEATURE_NAMES].astype(np.float64).values
        y = df["is_rto"].astype(int).values
        X_train, X_test, y_train, y_test = random_train_test_split(
            X, y, test_size=test_size, random_state=42, stratify=y,
        )
    logger.info("Train: %d | Test: %d", len(X_train), len(X_test))

    # Class imbalance ratio for XGBoost scale_pos_weight
    pos_weight = n_negative / max(n_positive, 1)
    logger.info("Class ratio (neg/pos) for scale_pos_weight: %.2f", pos_weight)

    # --- XGBoost hyperparameter search (15 iter, 3-fold) ----------------
    xgb_base = {
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "use_label_encoder": False,
        "scale_pos_weight": pos_weight,
        "random_state": 42,
        "n_jobs": -1,
    }
    xgb_param_grid = {
        "n_estimators": [100, 200, 300],
        "max_depth": [3, 4, 5, 6],
        "learning_rate": [0.01, 0.05, 0.1],
        "subsample": [0.7, 0.8, 0.9],
        "colsample_bytree": [0.7, 0.8],
        "min_child_weight": [1, 3, 5],
        "gamma": [0, 0.1, 0.2],
        "reg_alpha": [0, 0.1],
        "reg_lambda": [1, 1.5],
    }
    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
    logger.info("XGBoost: RandomizedSearchCV 15 iterations, 3-fold CV ...")
    xgb_search = RandomizedSearchCV(
        estimator=XGBClassifier(**xgb_base),
        param_distributions=xgb_param_grid,
        n_iter=15,
        cv=cv,
        scoring="roc_auc",
        n_jobs=-1,
        verbose=0,
        random_state=42,
    )
    xgb_search.fit(X_train, y_train)
    logger.info(
        "XGBoost best CV AUC-ROC: %.4f | params: %s",
        xgb_search.best_score_, xgb_search.best_params_,
    )

    # --- LightGBM hyperparameter search (10 iter, 3-fold) ---------------
    lgbm_param_grid = {
        "n_estimators": [100, 200, 300],
        "num_leaves": [31, 50, 70],
        "learning_rate": [0.01, 0.05, 0.1],
        "subsample": [0.7, 0.8, 0.9],
        "colsample_bytree": [0.7, 0.8],
        "min_child_samples": [10, 20, 30],
        "reg_alpha": [0, 0.1],
        "reg_lambda": [1, 1.5],
    }
    logger.info("LightGBM: RandomizedSearchCV 10 iterations, 3-fold CV ...")
    lgbm_search = RandomizedSearchCV(
        estimator=LGBMClassifier(
            random_state=42, verbose=-1, n_jobs=-1, class_weight="balanced"
        ),
        param_distributions=lgbm_param_grid,
        n_iter=10,
        cv=cv,
        scoring="roc_auc",
        n_jobs=-1,
        verbose=0,
        random_state=42,
    )
    lgbm_search.fit(X_train, y_train)
    logger.info(
        "LightGBM best CV AUC-ROC: %.4f | params: %s",
        lgbm_search.best_score_, lgbm_search.best_params_,
    )

    # --- Soft-voting ensemble: XGBoost + LightGBM -----------------------
    logger.info("Building soft-voting ensemble (XGBoost + LightGBM) ...")
    best_xgb = XGBClassifier(**{**xgb_base, **xgb_search.best_params_})
    best_lgbm = LGBMClassifier(
        **{
            "random_state": 42, "verbose": -1,
            "n_jobs": -1, "class_weight": "balanced",
            **lgbm_search.best_params_,
        }
    )
    best_model = VotingClassifier(
        estimators=[("xgb", best_xgb), ("lgbm", best_lgbm)],
        voting="soft",
        n_jobs=1,
    )
    best_model.fit(X_train, y_train)
    logger.info("Ensemble fitted on %d training samples.", len(X_train))

    # --- Evaluation on original held-out test set -----------------------
    y_pred = best_model.predict(X_test)
    y_proba = best_model.predict_proba(X_test)[:, 1]

    metrics: Dict[str, float] = {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "precision": round(float(precision_score(y_test, y_pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, y_pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, y_pred, zero_division=0)), 4),
        "auc_roc": round(float(roc_auc_score(y_test, y_proba)), 4),
        "xgb_cv_auc": round(float(xgb_search.best_score_), 4),
        "lgbm_cv_auc": round(float(lgbm_search.best_score_), 4),
    }
    logger.info("Ensemble test metrics: %s", json.dumps(metrics, indent=2))

    # --- Feature importances (average from both models) ----------------
    try:
        xgb_imp  = best_model.estimators_[0].feature_importances_
        lgbm_imp = best_model.estimators_[1].feature_importances_
        importances = (xgb_imp + lgbm_imp) / 2.0
    except (AttributeError, IndexError):
        importances = np.zeros(len(FEATURE_NAMES))

    importance_pairs = sorted(
        zip(FEATURE_NAMES, importances), key=lambda x: x[1], reverse=True,
    )
    logger.info("Top 10 features (ensemble avg importance):")
    for name, imp in importance_pairs[:10]:
        logger.info("  %-35s %.4f", name, imp)

    return best_model, metrics, FEATURE_NAMES, n_samples


# ---------------------------------------------------------------------------
# Save model via ModelManager
# ---------------------------------------------------------------------------

def save_trained_model(
    model: XGBClassifier,
    metrics: Dict[str, float],
    feature_names: List[str],
    n_samples: int,
) -> str:
    """Persist model artefacts and return the version string."""
    version = "v" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    manager = ModelManager()
    manager.save_model(
        model=model,
        version=version,
        feature_names=feature_names,
        metrics=metrics,
        training_samples=n_samples,
    )
    logger.info("Model saved as version %s", version)
    return version


# ---------------------------------------------------------------------------
# Optional: write metrics to DB (model_versions table)
# ---------------------------------------------------------------------------

def save_metrics_to_db(version: str, metrics: Dict[str, float], n_samples: int) -> None:
    """Insert a row into the ``model_versions`` table (best-effort)."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        logger.warning("DATABASE_URL not set -- skipping DB metrics write")
        return

    try:
        import psycopg2

        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO model_versions
                (version, accuracy, precision_score, recall, f1, auc_roc,
                 training_samples, trained_at, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), TRUE)
            ON CONFLICT (version) DO NOTHING
            """,
            (
                version,
                metrics["accuracy"],
                metrics["precision"],
                metrics["recall"],
                metrics["f1"],
                metrics["auc_roc"],
                n_samples,
            ),
        )
        # Deactivate previous models
        cur.execute(
            "UPDATE model_versions SET is_active = FALSE WHERE version != %s",
            (version,),
        )
        conn.commit()
        cur.close()
        conn.close()
        logger.info("Metrics written to model_versions table")
    except Exception:
        logger.exception("Failed to write metrics to DB (non-fatal)")


# ---------------------------------------------------------------------------
# Enhanced training pipeline (v2)
# ---------------------------------------------------------------------------

def train_model_v2(
    df: pd.DataFrame,
    test_size: float = 0.2,
    min_samples: int = 100,
    temporal: bool = True,
    compare_with_current: bool = True,
) -> Tuple[XGBClassifier, Dict[str, float], List[str], int, str]:
    """Enhanced training pipeline with validation, versioning, and comparison.

    Steps:
        1. Validate and clean data
        2. Save data snapshot
        3. Handle class imbalance (SMOTE or class weights)
        4. Train model
        5. Compare with current model (promote only if better)
        6. Save full metadata

    Returns (model, metrics, feature_names, n_samples, version).
    """
    # Step 1: Validate and clean
    try:
        from pipeline.data_validator import DataValidator
        validator = DataValidator()
        df, val_report = validator.validate_and_clean(df)
        logger.info("Validation report: %s", val_report.to_dict())
    except ImportError:
        logger.warning("Pipeline not available, skipping validation")
        val_report = None

    # Step 2: Save data snapshot
    data_version = None
    try:
        from pipeline.data_versioner import DataVersioner
        versioner = DataVersioner()
        data_version = versioner.save_snapshot(
            df,
            extra_metadata={"validation_report": val_report.to_dict() if val_report else None},
        )
    except ImportError:
        logger.warning("Pipeline not available, skipping data versioning")

    # Step 3: Train the model (uses existing train_model with class weights)
    model, metrics, feature_names, n_samples = train_model(
        df, test_size=test_size, min_samples=min_samples, temporal=temporal,
    )

    # Step 4: Save with extended metadata
    version = "v" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    manager = ModelManager()

    extra_meta = {
        "data_snapshot_version": data_version,
        "temporal_split": temporal,
        "training_config": {
            "test_size": test_size,
            "min_samples": min_samples,
        },
    }
    if val_report:
        extra_meta["validation_report"] = val_report.to_dict()

    # Step 5: Compare with current model
    promoted = True
    if compare_with_current:
        current_version = manager.get_latest_version()
        if current_version:
            # Save new model temporarily to compare
            manager.save_model(
                model=model,
                version=version,
                feature_names=feature_names,
                metrics=metrics,
                training_samples=n_samples,
                extra_metadata=extra_meta,
            )
            try:
                comparison = manager.compare_models(current_version, version)
                if comparison["winner"] == current_version:
                    promoted = False
                    logger.warning(
                        "New model %s is NOT better than current %s. Keeping current.",
                        version, current_version,
                    )
                else:
                    logger.info(
                        "New model %s is better than current %s. Promoting.",
                        version, current_version,
                    )
                extra_meta["comparison"] = comparison
                extra_meta["promoted"] = promoted
            except Exception:
                logger.exception("Model comparison failed, promoting new model by default")
        else:
            manager.save_model(
                model=model,
                version=version,
                feature_names=feature_names,
                metrics=metrics,
                training_samples=n_samples,
                extra_metadata=extra_meta,
            )
    else:
        manager.save_model(
            model=model,
            version=version,
            feature_names=feature_names,
            metrics=metrics,
            training_samples=n_samples,
            extra_metadata=extra_meta,
        )

    # Step 6: Save baseline distributions
    try:
        from pipeline.feature_analysis import save_baseline_distributions
        save_baseline_distributions(df, version, feature_names)
    except ImportError:
        logger.warning("Pipeline not available, skipping baseline save")

    logger.info(
        "Training v2 complete: version=%s promoted=%s metrics=%s",
        version, promoted, metrics,
    )

    return model, metrics, feature_names, n_samples, version


# ---------------------------------------------------------------------------
# CLI entry-point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Train COD fraud XGBoost model")
    parser.add_argument(
        "--csv",
        type=str,
        default=None,
        help="Path to CSV training data (skip DB fetch)",
    )
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--min-samples", type=int, default=100)
    parser.add_argument(
        "--temporal-split",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="Use time-based train/test split (default: True for DB, auto-detect for CSV)",
    )
    parser.add_argument(
        "--v2",
        action="store_true",
        help="Use enhanced training pipeline v2 (validation, versioning, comparison)",
    )
    args = parser.parse_args()

    if args.csv:
        df = load_data_from_csv(args.csv)
    else:
        df = load_data_from_db()

    # Determine temporal split: default True for DB, auto-detect for CSV
    if args.temporal_split is not None:
        use_temporal = args.temporal_split
    elif not args.csv:
        use_temporal = True  # DB always has created_at
    else:
        use_temporal = _has_time_column(df) is not None

    logger.info("Temporal split: %s", "enabled" if use_temporal else "disabled")

    if args.v2:
        logger.info("Using enhanced training pipeline v2")
        model, metrics, feature_names, n_samples, version = train_model_v2(
            df, test_size=args.test_size, min_samples=args.min_samples, temporal=use_temporal,
        )
    else:
        model, metrics, feature_names, n_samples = train_model(
            df, test_size=args.test_size, min_samples=args.min_samples, temporal=use_temporal,
        )
        version = save_trained_model(model, metrics, feature_names, n_samples)

    save_metrics_to_db(version, metrics, n_samples)

    print("\n=== Training complete ===")
    print(f"  Version       : {version}")
    print(f"  Samples       : {n_samples}")
    print(f"  Accuracy      : {metrics['accuracy']}")
    print(f"  Precision     : {metrics['precision']}")
    print(f"  Recall        : {metrics['recall']}")
    print(f"  F1            : {metrics['f1']}")
    print(f"  AUC-ROC       : {metrics['auc_roc']}")


if __name__ == "__main__":
    main()
