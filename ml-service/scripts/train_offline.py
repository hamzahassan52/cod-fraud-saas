#!/usr/bin/env python3
"""
Offline Training Pipeline — COD Fraud Detection Model v3
=========================================================

Run this OUTSIDE the Docker container (locally or in CI/CD).
The trained model is committed to git and copied into the image at build time.

Architecture:
    1. Developer runs this script  →  models/latest.joblib + models/latest_meta.json
    2. git commit models/          →  model travels with the codebase
    3. Docker COPY . .             →  model inside image (no build-time training)
    4. Container starts instantly  →  loads model from models/ or versions/

Data Modes:
    synthetic  — 30K generated Pakistan COD orders (default, no DB needed)
    real       — Load from PostgreSQL (requires DATABASE_URL, min 3000 labeled orders)
    hybrid     — Synthetic + real combined (recommended once real data is available)

Key Features:
    - XGBoost + LightGBM soft-voting ensemble (no SMOTE, uses class weights)
    - Probability calibration via CalibratedClassifierCV (isotonic)
    - Threshold optimization: finds optimal decision threshold (not default 0.5)
    - Stratified 60/20/20 train/val/test split
    - Full metrics: AUC-ROC, F1, Precision, Recall, Confusion Matrix
    - Real data readiness check (min 3000 labeled orders before switching)

Usage:
    python scripts/train_offline.py                           # 30K synthetic
    python scripts/train_offline.py --samples 50000          # 50K synthetic
    python scripts/train_offline.py --mode hybrid            # synthetic + real DB
    python scripts/train_offline.py --mode real              # real DB only
    python scripts/train_offline.py --no-calibrate           # faster, skip calibration
    python scripts/train_offline.py --check-real-data        # check DB readiness only
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

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import VotingClassifier
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split
from xgboost import XGBClassifier

# Project root = ml-service/
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from pipeline.feature_map import FEATURE_DEFAULTS, FEATURE_NAMES, REQUIRED_FEATURES
from utils.model_manager import ModelManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("train_offline")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MIN_REAL_ORDERS = 3_000      # Minimum labeled real orders before switching to real data
MIN_AUC_DROP    = 0.05       # Only retrain if AUC drops more than 5% on real holdout
MODELS_DIR      = PROJECT_ROOT / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ===========================================================================
# SECTION 1 — Data Loading
# ===========================================================================

def load_synthetic_data(n: int = 30_000) -> pd.DataFrame:
    """Generate n synthetic Pakistan COD orders using the v3 generator."""
    logger.info("Generating %d synthetic samples ...", n)
    from generate_synthetic_data import generate_synthetic_data
    df = generate_synthetic_data(n=n)
    logger.info(
        "Synthetic data ready: %d rows | RTO rate=%.1f%%",
        len(df), df["is_rto"].mean() * 100,
    )
    return df


def check_real_data_readiness() -> Dict[str, Any]:
    """Query DB and return how many labeled real orders exist."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return {"ready": False, "count": 0, "reason": "DATABASE_URL not set"}
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM orders "
            "WHERE status IN ('delivered','rto','returned','return_to_origin')"
        )
        count = int(cur.fetchone()[0])
        conn.close()
        ready = count >= MIN_REAL_ORDERS
        return {
            "ready": ready,
            "count": count,
            "min_required": MIN_REAL_ORDERS,
            "reason": "sufficient data" if ready
                      else f"need {MIN_REAL_ORDERS - count} more labeled orders",
        }
    except Exception as exc:
        return {"ready": False, "count": 0, "reason": f"DB error: {exc}"}


def load_real_data() -> Optional[pd.DataFrame]:
    """Load labeled real orders from PostgreSQL."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        logger.warning("DATABASE_URL not set — cannot load real data")
        return None
    try:
        import psycopg2
        logger.info("Loading real labeled data from database ...")
        conn = psycopg2.connect(db_url)
        query = """
            SELECT
                o.total_amount::float                                   AS order_amount,
                COALESCE(o.items_count, 1)::float                       AS order_item_count,
                CASE WHEN LOWER(o.payment_method) = 'cod'
                     THEN 1.0 ELSE 0.0 END                              AS is_cod,
                CASE WHEN LOWER(o.payment_method) != 'cod'
                     THEN 1.0 ELSE 0.0 END                              AS is_prepaid,
                EXTRACT(HOUR FROM o.created_at)::float                  AS order_hour,
                CASE WHEN EXTRACT(DOW FROM o.created_at) IN (0,6)
                     THEN 1.0 ELSE 0.0 END                              AS is_weekend,
                CASE WHEN EXTRACT(HOUR FROM o.created_at) < 6
                  OR EXTRACT(HOUR FROM o.created_at) >= 22
                     THEN 1.0 ELSE 0.0 END                              AS is_night_order,
                CASE WHEN o.total_amount > 8000
                     THEN 1.0 ELSE 0.0 END                              AS is_high_value_order,
                COALESCE(o.discount_percentage, 0)::float               AS discount_percentage,
                CASE WHEN COALESCE(o.discount_percentage, 0) > 40
                     THEN 1.0 ELSE 0.0 END                              AS is_high_discount,
                EXTRACT(MONTH FROM o.created_at)::int                   AS _order_month,
                EXTRACT(DAY   FROM o.created_at)::int                   AS _order_day,
                CASE WHEN o.status IN ('rto','returned','return_to_origin')
                     THEN 1 ELSE 0 END                                  AS is_rto,
                o.created_at
            FROM orders o
            WHERE o.status IN ('delivered','rto','returned','return_to_origin')
              AND o.total_amount > 0
            ORDER BY o.created_at ASC
        """
        df = pd.read_sql(query, conn)
        conn.close()
        logger.info(
            "Loaded %d real orders | RTO=%.1f%%",
            len(df), df["is_rto"].mean() * 100 if len(df) > 0 else 0,
        )
        return df if len(df) >= MIN_REAL_ORDERS else None
    except Exception:
        logger.exception("Failed to load real data — falling back to synthetic only")
        return None


# ===========================================================================
# SECTION 2 — Feature Engineering
# ===========================================================================

def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute any derived / seasonal / interaction features that may be missing.
    Fills all 48 canonical features with defaults if not already present.
    """
    # Seasonal features from _order_month / _order_day helper columns
    if "_order_month" in df.columns and "is_eid_period" not in df.columns:
        months = df["_order_month"].values.astype(int)
        days   = df["_order_day"].values.astype(int) if "_order_day" in df.columns \
                 else np.ones(len(df), dtype=int)
        df["is_eid_period"]  = np.isin(months, [4, 6, 7]).astype(float)
        df["is_ramadan"]     = np.isin(months, [3, 4]).astype(float)
        df["is_sale_period"] = (
            ((months == 11) & (days >= 8)  & (days <= 14))
            | ((months == 11) & (days >= 22) & (days <= 28))
            | ((months == 12) & (days >= 9)  & (days <= 15))
        ).astype(float)

    # Interaction features
    is_cod   = df.get("is_cod",   pd.Series(np.zeros(len(df)))).values
    is_first = df.get("is_first_order",      pd.Series(np.zeros(len(df)))).values
    is_high  = df.get("is_high_value_order", pd.Series(np.zeros(len(df)))).values
    phone_v  = df.get("phone_verified",      pd.Series(np.zeros(len(df)))).values
    cust_rto = df.get("customer_rto_rate",   pd.Series(np.zeros(len(df)))).values

    if "cod_first_order" not in df.columns:
        df["cod_first_order"]      = is_cod * is_first
    if "high_value_cod_first" not in df.columns:
        df["high_value_cod_first"] = is_high * is_cod * is_first
    if "phone_risk_score" not in df.columns:
        df["phone_risk_score"]     = cust_rto * (1.0 - phone_v)

    # Fill all missing canonical features with sensible defaults
    for feat in FEATURE_NAMES:
        if feat not in df.columns:
            df[feat] = FEATURE_DEFAULTS.get(feat, 0.0)

    return df


def validate_required_features(df: pd.DataFrame) -> None:
    """Raise ValueError if any REQUIRED_FEATURES are missing from the dataset."""
    missing = [f for f in REQUIRED_FEATURES if f not in df.columns]
    if missing:
        raise ValueError(
            f"Dataset is missing REQUIRED features: {missing}. "
            "Cannot train without these."
        )


# ===========================================================================
# SECTION 3 — Threshold Optimization
# ===========================================================================

def find_optimal_threshold(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    target_recall: float = 0.80,
) -> Dict[str, float]:
    """
    Compute two decision thresholds from the validation set:

    1. f1_optimal_threshold  — maximises F1 score (best precision/recall balance)
    2. recall_targeted_threshold — lowest threshold that achieves `target_recall`
       (useful when catching all fraud matters more than precision)

    Returns a dict with both thresholds and their key metrics.
    """
    precisions, recalls, thresholds = precision_recall_curve(y_true, y_proba)
    # Exclude the last element (sklearn adds a sentinel precision=1, recall=0)
    f1_scores = 2 * (precisions[:-1] * recalls[:-1]) / (
        precisions[:-1] + recalls[:-1] + 1e-9
    )

    best_f1_idx        = int(np.argmax(f1_scores))
    f1_threshold       = float(thresholds[best_f1_idx])
    recall_threshold   = f1_threshold  # fallback

    for r, t in zip(recalls[:-1], thresholds):
        if r >= target_recall:
            recall_threshold = float(t)
            break

    result = {
        "f1_optimal_threshold":       round(f1_threshold, 4),
        "f1_at_optimal":              round(float(f1_scores[best_f1_idx]), 4),
        "precision_at_f1_optimal":    round(float(precisions[best_f1_idx]), 4),
        "recall_at_f1_optimal":       round(float(recalls[best_f1_idx]), 4),
        "recall_targeted_threshold":  round(recall_threshold, 4),
        "target_recall":              target_recall,
    }

    logger.info(
        "Threshold optimization results:\n"
        "  F1-optimal  threshold=%.4f  →  F1=%.4f  Precision=%.4f  Recall=%.4f\n"
        "  Recall≥%.0f%% threshold=%.4f",
        f1_threshold,
        f1_scores[best_f1_idx], precisions[best_f1_idx], recalls[best_f1_idx],
        target_recall * 100, recall_threshold,
    )
    return result


# ===========================================================================
# SECTION 4 — Model Training
# ===========================================================================

def train_ensemble(
    X_train: np.ndarray,
    y_train: np.ndarray,
    n_positive: int,
    n_negative: int,
) -> VotingClassifier:
    """
    Train XGBoost + LightGBM soft-voting ensemble.

    Class imbalance handled via:
      - XGBoost: scale_pos_weight = n_negative / n_positive
      - LightGBM: class_weight='balanced'
    No SMOTE — avoids memory duplication on Railway.

    Hyperparameter search: 15 iter (XGB) + 10 iter (LGB), 3-fold StratifiedKFold.
    n_jobs=2 for memory safety on Railway containers.
    """
    pos_weight = n_negative / max(n_positive, 1)
    logger.info(
        "Class imbalance — scale_pos_weight=%.2f  (%d RTO vs %d delivered)",
        pos_weight, n_positive, n_negative,
    )

    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)

    # ── XGBoost ────────────────────────────────────────────────────────
    xgb_base = {
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "use_label_encoder": False,
        "scale_pos_weight": pos_weight,
        "random_state": 42,
        "n_jobs": 2,
    }
    xgb_grid = {
        "n_estimators":    [100, 200, 300],
        "max_depth":       [3, 4, 5, 6],
        "learning_rate":   [0.01, 0.05, 0.1],
        "subsample":       [0.7, 0.8, 0.9],
        "colsample_bytree":[0.7, 0.8],
        "min_child_weight":[1, 3, 5],
        "gamma":           [0, 0.1, 0.2],
        "reg_alpha":       [0, 0.1],
        "reg_lambda":      [1, 1.5],
    }
    logger.info("XGBoost: RandomizedSearchCV 15 iter × 3-fold CV ...")
    xgb_search = RandomizedSearchCV(
        XGBClassifier(**xgb_base), xgb_grid,
        n_iter=15, cv=cv, scoring="roc_auc",
        n_jobs=2, random_state=42, verbose=0,
    )
    xgb_search.fit(X_train, y_train)
    logger.info(
        "XGBoost  best CV AUC=%.4f  params=%s",
        xgb_search.best_score_, xgb_search.best_params_,
    )

    # ── LightGBM ───────────────────────────────────────────────────────
    lgbm_grid = {
        "n_estimators":     [100, 200, 300],
        "num_leaves":       [31, 50, 70],
        "learning_rate":    [0.01, 0.05, 0.1],
        "subsample":        [0.7, 0.8, 0.9],
        "colsample_bytree": [0.7, 0.8],
        "min_child_samples":[10, 20, 30],
        "reg_alpha":        [0, 0.1],
        "reg_lambda":       [1, 1.5],
    }
    logger.info("LightGBM: RandomizedSearchCV 10 iter × 3-fold CV ...")
    lgbm_search = RandomizedSearchCV(
        LGBMClassifier(
            random_state=42, verbose=-1, n_jobs=2, class_weight="balanced"
        ),
        lgbm_grid,
        n_iter=10, cv=cv, scoring="roc_auc",
        n_jobs=2, random_state=42, verbose=0,
    )
    lgbm_search.fit(X_train, y_train)
    logger.info(
        "LightGBM best CV AUC=%.4f  params=%s",
        lgbm_search.best_score_, lgbm_search.best_params_,
    )

    # ── Soft-voting ensemble ───────────────────────────────────────────
    logger.info("Building soft-voting ensemble (XGBoost + LightGBM) ...")
    best_xgb  = XGBClassifier(**{**xgb_base, **xgb_search.best_params_})
    best_lgbm = LGBMClassifier(**{
        "random_state": 42, "verbose": -1,
        "n_jobs": 2, "class_weight": "balanced",
        **lgbm_search.best_params_,
    })
    ensemble = VotingClassifier(
        estimators=[("xgb", best_xgb), ("lgbm", best_lgbm)],
        voting="soft", n_jobs=1,
    )
    ensemble.fit(X_train, y_train)
    logger.info("Ensemble fitted on %d training samples.", len(X_train))
    return ensemble


# ===========================================================================
# SECTION 5 — Main Training Pipeline
# ===========================================================================

def run_training(
    mode: str = "synthetic",
    n_synthetic: int = 30_000,
    calibrate: bool = True,
    target_recall: float = 0.80,
) -> Dict[str, Any]:
    """
    Full offline training pipeline. Steps:
      1. Load data  (synthetic / real / hybrid)
      2. Feature engineering + validation
      3. Stratified 60/20/20 split (train / val / test)
      4. Train XGBoost + LightGBM ensemble
      5. Calibrate probabilities (CalibratedClassifierCV, isotonic)
      6. Find optimal decision threshold on val set
      7. Evaluate on unseen test set
      8. Save to versions/ + models/latest  (Docker COPY target)

    Returns: dict with version, metrics, optimal_threshold, paths.
    """
    logger.info(
        "=== COD Fraud Detection — Offline Training Pipeline v3 ===\n"
        "    Mode: %s | Samples: %d | Calibration: %s | Target-recall: %.0f%%",
        mode, n_synthetic, calibrate, target_recall * 100,
    )

    # ── Step 1: Data loading ───────────────────────────────────────────
    real_readiness = check_real_data_readiness()
    logger.info("Real data readiness: %s", real_readiness)

    if mode == "synthetic":
        df = load_synthetic_data(n=n_synthetic)

    elif mode == "real":
        if not real_readiness["ready"]:
            raise ValueError(
                f"Real mode requires {MIN_REAL_ORDERS} labeled orders. "
                f"Currently only {real_readiness['count']} available. "
                "Use --mode synthetic or collect more real data."
            )
        df = load_real_data()
        if df is None:
            raise RuntimeError("Failed to load real data from database.")

    elif mode == "hybrid":
        synthetic_df = load_synthetic_data(n=n_synthetic)
        real_df = load_real_data()
        if real_df is not None and len(real_df) >= MIN_REAL_ORDERS:
            df = pd.concat([synthetic_df, real_df], ignore_index=True)
            logger.info(
                "Hybrid dataset: %d synthetic + %d real = %d total",
                len(synthetic_df), len(real_df), len(df),
            )
        else:
            logger.warning(
                "Real data not ready (%d orders, need %d). "
                "Falling back to synthetic-only for this run.",
                real_readiness["count"], MIN_REAL_ORDERS,
            )
            df = synthetic_df
    else:
        raise ValueError(f"Unknown mode '{mode}'. Use: synthetic / real / hybrid")

    # ── Step 2: Feature engineering + validation ───────────────────────
    df = engineer_features(df)
    validate_required_features(df)

    if "is_rto" not in df.columns:
        raise ValueError("Dataset missing 'is_rto' target column.")

    X = df[FEATURE_NAMES].astype(np.float64).values
    y = df["is_rto"].astype(int).values
    n_samples  = len(y)
    n_positive = int(y.sum())
    n_negative = n_samples - n_positive

    logger.info(
        "Dataset: %d samples | %d RTO (%.1f%%) | %d Delivered (%.1f%%)",
        n_samples, n_positive, 100.0 * n_positive / n_samples,
        n_negative, 100.0 * n_negative / n_samples,
    )

    # ── Step 3: Stratified 60/20/20 split ─────────────────────────────
    # First split off 20% test
    X_tv, X_test, y_tv, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y,
    )
    # Split remaining 80% into 60% train + 20% val  (0.25 × 0.80 = 0.20)
    X_train, X_val, y_train, y_val = train_test_split(
        X_tv, y_tv, test_size=0.25, random_state=42, stratify=y_tv,
    )
    logger.info(
        "Stratified split — train: %d | val: %d | test: %d",
        len(X_train), len(X_val), len(X_test),
    )

    n_pos_train = int(y_train.sum())
    n_neg_train = len(y_train) - n_pos_train

    # ── Step 4: Train ensemble ─────────────────────────────────────────
    ensemble = train_ensemble(X_train, y_train, n_pos_train, n_neg_train)

    # ── Step 5: Probability calibration ───────────────────────────────
    if calibrate:
        logger.info("Calibrating probabilities on val set (isotonic regression) ...")
        final_model = CalibratedClassifierCV(
            ensemble, cv="prefit", method="isotonic"
        )
        final_model.fit(X_val, y_val)
        logger.info("Calibration complete.")
    else:
        final_model = ensemble
        logger.info("Calibration skipped (--no-calibrate).")

    # ── Step 6: Threshold optimization on val set ──────────────────────
    val_proba      = final_model.predict_proba(X_val)[:, 1]
    threshold_info = find_optimal_threshold(y_val, val_proba, target_recall)
    optimal_threshold = threshold_info["f1_optimal_threshold"]

    # ── Step 7: Evaluate on test set ───────────────────────────────────
    test_proba       = final_model.predict_proba(X_test)[:, 1]
    pred_at_default  = (test_proba >= 0.5).astype(int)
    pred_at_optimal  = (test_proba >= optimal_threshold).astype(int)

    def _metrics(y_true, y_pred, y_prob) -> Dict[str, float]:
        return {
            "accuracy":  round(float(accuracy_score(y_true, y_pred)), 4),
            "precision": round(float(precision_score(y_true, y_pred, zero_division=0)), 4),
            "recall":    round(float(recall_score(y_true, y_pred, zero_division=0)), 4),
            "f1":        round(float(f1_score(y_true, y_pred, zero_division=0)), 4),
            "auc_roc":   round(float(roc_auc_score(y_true, y_prob)), 4),
            "avg_precision": round(float(average_precision_score(y_true, y_prob)), 4),
        }

    m_default = _metrics(y_test, pred_at_default, test_proba)
    m_optimal = _metrics(y_test, pred_at_optimal, test_proba)

    cm = confusion_matrix(y_test, pred_at_optimal)
    tn, fp, fn, tp = cm.ravel() if cm.shape == (2, 2) else (0, 0, 0, int(y_test.sum()))

    logger.info(
        "\n%s\n  TEST SET RESULTS\n%s\n"
        "  Threshold 0.50 (default) :\n"
        "    AUC-ROC   : %.4f\n"
        "    Accuracy  : %.4f\n"
        "    Precision : %.4f\n"
        "    Recall    : %.4f\n"
        "    F1 Score  : %.4f\n"
        "  Threshold %.4f (optimal) :\n"
        "    Accuracy  : %.4f\n"
        "    Precision : %.4f\n"
        "    Recall    : %.4f\n"
        "    F1 Score  : %.4f\n"
        "  Confusion Matrix (optimal threshold) :\n"
        "    TN=%-6d  FP=%-6d\n"
        "    FN=%-6d  TP=%-6d",
        "=" * 55, "=" * 55,
        m_default["auc_roc"],
        m_default["accuracy"], m_default["precision"],
        m_default["recall"], m_default["f1"],
        optimal_threshold,
        m_optimal["accuracy"], m_optimal["precision"],
        m_optimal["recall"], m_optimal["f1"],
        tn, fp, fn, tp,
    )

    # Feature importances (averaged across ensemble estimators)
    try:
        xgb_imp  = ensemble.estimators_[0].feature_importances_
        lgbm_imp = ensemble.estimators_[1].feature_importances_
        avg_imp  = (xgb_imp + lgbm_imp) / 2.0
        feature_importances = {
            name: round(float(imp), 6)
            for name, imp in sorted(zip(FEATURE_NAMES, avg_imp),
                                    key=lambda x: x[1], reverse=True)
        }
        logger.info("Top 10 features by importance:")
        for name, imp in list(feature_importances.items())[:10]:
            logger.info("  %-35s %.4f", name, imp)
    except (AttributeError, IndexError):
        feature_importances = {}

    # ── Step 8: Save model ─────────────────────────────────────────────
    version = "v" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    manager = ModelManager()

    # Primary metrics use optimal threshold values
    final_metrics: Dict[str, Any] = {
        **m_optimal,
        "auc_roc":          m_default["auc_roc"],
        "avg_precision":    m_default["avg_precision"],
        "optimal_threshold": optimal_threshold,
        "metrics_at_default_threshold": m_default,
    }

    extra_meta: Dict[str, Any] = {
        "model_type":         "XGBoost+LightGBM SoftVoting",
        "training_mode":      mode,
        "calibrated":         calibrate,
        "calibration_method": "isotonic" if calibrate else None,
        "optimal_threshold":  optimal_threshold,
        "threshold_info":     threshold_info,
        "feature_count":      len(FEATURE_NAMES),
        "split_strategy":     "stratified_60_20_20",
        "split_sizes":        {"train": len(X_train), "val": len(X_val), "test": len(X_test)},
        "class_distribution": {
            "rto_rate":   round(float(n_positive / n_samples), 4),
            "total":      n_samples, "rto": n_positive, "delivered": n_negative,
        },
        "confusion_matrix":   {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "feature_importances": feature_importances,
        "real_data_readiness": real_readiness,
    }

    # Save versioned copy (backup in versions/)
    manager.save_model(
        model=final_model,
        version=version,
        feature_names=FEATURE_NAMES,
        metrics=final_metrics,
        training_samples=n_samples,
        extra_metadata=extra_meta,
    )

    # Save Docker COPY target (models/latest.joblib)
    latest_model_path = MODELS_DIR / "latest.joblib"
    latest_meta_path  = MODELS_DIR / "latest_meta.json"
    joblib.dump(final_model, latest_model_path)
    with open(latest_meta_path, "w") as fh:
        json.dump(
            {
                "version": version,
                "feature_names": FEATURE_NAMES,
                "metrics": final_metrics,
                "trained_at": datetime.now(timezone.utc).isoformat(),
                "training_samples": n_samples,
                **extra_meta,
            },
            fh,
            indent=2,
        )
    logger.info("Model saved:")
    logger.info("  Versioned : versions/model_%s.joblib", version)
    logger.info("  Latest    : models/latest.joblib  ← commit this to git")

    # ── Real data transition guidance ──────────────────────────────────
    if not real_readiness["ready"]:
        still_needed = MIN_REAL_ORDERS - real_readiness["count"]
        logger.info(
            "\n--- Real Data Transition Status ---\n"
            "  Real labeled orders : %d / %d\n"
            "  Still needed        : %d more orders\n"
            "  Action              : Continue with synthetic model.\n"
            "  When ready          : python scripts/train_offline.py --mode hybrid",
            real_readiness["count"], MIN_REAL_ORDERS, still_needed,
        )
    else:
        logger.info(
            "\n--- Real Data Ready ---\n"
            "  %d labeled real orders available.\n"
            "  Switch to hybrid: python scripts/train_offline.py --mode hybrid",
            real_readiness["count"],
        )

    return {
        "version":            version,
        "metrics":            final_metrics,
        "optimal_threshold":  optimal_threshold,
        "model_path":         str(latest_model_path),
        "meta_path":          str(latest_meta_path),
        "real_data_readiness": real_readiness,
    }


# ===========================================================================
# CLI
# ===========================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Offline training pipeline — COD Fraud Detection Model v3",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/train_offline.py                          # 30K synthetic (default)
  python scripts/train_offline.py --samples 50000          # 50K synthetic
  python scripts/train_offline.py --mode hybrid            # synthetic + real DB
  python scripts/train_offline.py --mode real              # real DB only
  python scripts/train_offline.py --no-calibrate           # skip calibration (faster)
  python scripts/train_offline.py --check-real-data        # check DB readiness only
  python scripts/train_offline.py --target-recall 0.85     # recall-focused threshold

After training:
  git add ml-service/models/latest.joblib ml-service/models/latest_meta.json
  git commit -m "Update pre-trained ML model"
  git push  →  Railway auto-deploys (instant start, no training delay)
        """,
    )
    parser.add_argument(
        "--mode", choices=["synthetic", "real", "hybrid"],
        default="synthetic", help="Data source (default: synthetic)",
    )
    parser.add_argument(
        "--samples", type=int, default=30_000,
        help="Synthetic sample count (default: 30000)",
    )
    parser.add_argument(
        "--no-calibrate", action="store_true",
        help="Skip probability calibration (faster, less accurate)",
    )
    parser.add_argument(
        "--target-recall", type=float, default=0.80,
        help="Target recall for threshold optimization (default: 0.80)",
    )
    parser.add_argument(
        "--check-real-data", action="store_true",
        help="Only check real data readiness, do not train",
    )
    args = parser.parse_args()

    if args.check_real_data:
        readiness = check_real_data_readiness()
        print(json.dumps(readiness, indent=2))
        sys.exit(0 if readiness["ready"] else 1)

    result = run_training(
        mode=args.mode,
        n_synthetic=args.samples,
        calibrate=not args.no_calibrate,
        target_recall=args.target_recall,
    )

    print("\n" + "=" * 60)
    print("  TRAINING COMPLETE")
    print("=" * 60)
    print(f"  Version           : {result['version']}")
    print(f"  AUC-ROC           : {result['metrics']['auc_roc']}")
    print(f"  Accuracy          : {result['metrics']['accuracy']}")
    print(f"  Precision         : {result['metrics']['precision']}")
    print(f"  Recall            : {result['metrics']['recall']}")
    print(f"  F1 Score          : {result['metrics']['f1']}")
    print(f"  Optimal Threshold : {result['optimal_threshold']}")
    print(f"  Model saved       : {result['model_path']}")
    print("=" * 60)
    print("\nNext steps:")
    print("  git add ml-service/models/latest.joblib ml-service/models/latest_meta.json")
    print("  git commit -m 'Update pre-trained ML model v3'")
    print("  git push  →  Railway auto-deploys (instant start)")


if __name__ == "__main__":
    main()
