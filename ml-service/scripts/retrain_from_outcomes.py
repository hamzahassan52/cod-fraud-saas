"""
retrain_from_outcomes.py
------------------------
Self-learning retraining pipeline.

Fetches real delivery outcome data from training_events table,
trains a new model, evaluates against current champion,
and promotes if better.

Usage:
  python scripts/retrain_from_outcomes.py --tenant-id <uuid>
  python scripts/retrain_from_outcomes.py --all-tenants
  python scripts/retrain_from_outcomes.py --tenant-id <uuid> --dry-run
"""

import os
import sys
import json
import uuid
import argparse
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from pathlib import Path

# Add parent dir to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import psycopg2
import psycopg2.extras
from pipeline.feature_map import FEATURE_NAMES

DATABASE_URL = os.getenv('DATABASE_URL', '')
MIN_SAMPLES = 100          # Minimum labeled outcomes to attempt retrain
MIN_POSITIVE_RATIO = 0.05  # At least 5% returns needed
MAX_POSITIVE_RATIO = 0.95  # At most 95% returns (sanity check)
RETRAIN_THRESHOLD = 500    # New unused events needed to trigger retrain
PROMOTION_MIN_F1_DELTA = -0.01  # Allow max 1% F1 drop vs champion


def get_db_connection():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL env var not set")
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def fetch_training_data(conn, tenant_id: str) -> pd.DataFrame:
    """Fetch all training events for tenant from DB."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                te.id,
                te.feature_snapshot,
                te.final_label,
                te.call_confirmed,
                te.model_version,
                te.prediction_score,
                te.used_in_training,
                te.created_at
            FROM training_events te
            WHERE te.tenant_id = %s
            ORDER BY te.created_at ASC
        """, (tenant_id,))
        rows = cur.fetchall()

    if not rows:
        return pd.DataFrame()

    records = []
    for row in rows:
        features = row['feature_snapshot']
        if isinstance(features, str):
            features = json.loads(features)

        record = {'_id': str(row['id']), 'final_label': row['final_label']}

        # Map features — fill missing with 0 (handles schema evolution)
        for feat in FEATURE_NAMES:
            record[feat] = features.get(feat, 0)

        # Add call_confirmed as extra feature (encoded)
        call_map = {'yes': 1, 'no': 0, 'no_answer': 0.5, 'not_required': 0}
        record['call_confirmed_encoded'] = call_map.get(row.get('call_confirmed') or '', 0)

        records.append(record)

    return pd.DataFrame(records)


def get_unused_count(conn, tenant_id: str) -> int:
    """Count unused training events."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) as cnt FROM training_events WHERE tenant_id = %s AND used_in_training = FALSE",
            (tenant_id,)
        )
        return cur.fetchone()['cnt']


def get_current_model_metrics() -> dict:
    """Load current champion model metrics from metadata file."""
    meta_path = Path(__file__).parent.parent / 'models' / 'latest_meta.json'
    if not meta_path.exists():
        return {}
    with open(meta_path) as f:
        return json.load(f)


def train_model(X_train, y_train, X_val, y_val):
    """Train ensemble model — same architecture as train_offline.py."""
    from sklearn.ensemble import VotingClassifier
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.metrics import f1_score, roc_auc_score, precision_score, recall_score
    from sklearn.model_selection import RandomizedSearchCV
    import xgboost as xgb
    import lightgbm as lgb

    pos_weight = max(1, (y_train == 0).sum() / max((y_train == 1).sum(), 1))

    # XGBoost
    xgb_model = xgb.XGBClassifier(
        n_estimators=100, scale_pos_weight=pos_weight,
        use_label_encoder=False, eval_metric='logloss',
        random_state=42, n_jobs=2, verbosity=0
    )

    # LightGBM
    lgb_model = lgb.LGBMClassifier(
        n_estimators=100, class_weight='balanced',
        random_state=42, n_jobs=2, verbose=-1
    )

    # Ensemble
    ensemble = VotingClassifier(
        estimators=[('xgb', xgb_model), ('lgb', lgb_model)],
        voting='soft'
    )
    ensemble.fit(X_train, y_train)

    # Calibrate
    calibrated = CalibratedClassifierCV(ensemble, cv='prefit', method='isotonic')
    calibrated.fit(X_val, y_val)

    # Find optimal threshold
    from sklearn.metrics import precision_recall_curve
    probs = calibrated.predict_proba(X_val)[:, 1]
    precisions, recalls, thresholds = precision_recall_curve(y_val, probs)
    f1_scores = 2 * precisions * recalls / (precisions + recalls + 1e-8)
    optimal_idx = np.argmax(f1_scores)
    optimal_threshold = float(thresholds[optimal_idx]) if len(thresholds) > optimal_idx else 0.5

    # Evaluate on val set
    y_pred = (probs >= optimal_threshold).astype(int)
    metrics = {
        'f1_score': float(f1_score(y_val, y_pred, zero_division=0)),
        'auc_roc': float(roc_auc_score(y_val, probs)),
        'precision': float(precision_score(y_val, y_pred, zero_division=0)),
        'recall': float(recall_score(y_val, y_pred, zero_division=0)),
        'accuracy': float((y_pred == y_val).mean()),
        'optimal_threshold': optimal_threshold,
    }

    return calibrated, metrics


def save_model(model, metrics: dict, feature_names: list, training_samples: int, tenant_id: str):
    """Save model to models/ directory."""
    import joblib
    from datetime import datetime

    version = f"v_real_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    models_dir = Path(__file__).parent.parent / 'models'
    models_dir.mkdir(exist_ok=True)

    model_path = models_dir / 'latest.joblib'
    joblib.dump(model, model_path)

    meta = {
        'version': version,
        'model_type': 'XGBoost+LightGBM ensemble (real data)',
        'trained_at': datetime.now(timezone.utc).isoformat(),
        'training_samples': training_samples,
        'feature_names': feature_names,
        'feature_count': len(feature_names),
        'tenant_id': tenant_id,
        'data_source': 'real_outcomes',
        **metrics,
    }

    meta_path = models_dir / 'latest_meta.json'
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)

    print(f"  Model saved: {model_path}")
    print(f"  Version: {version}")
    return version, str(model_path)


def mark_events_used(conn, tenant_id: str, retrain_job_id: str):
    """Mark all training events for this tenant as used."""
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE training_events
               SET used_in_training = TRUE, retrain_job_id = %s
               WHERE tenant_id = %s AND used_in_training = FALSE""",
            (retrain_job_id, tenant_id)
        )
    conn.commit()


def create_retrain_job(conn, triggered_by: str) -> str:
    """Create retrain_jobs record and return its ID."""
    job_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO retrain_jobs (id, triggered_by, status, started_at)
               VALUES (%s, %s, 'running', NOW())""",
            (job_id, triggered_by)
        )
    conn.commit()
    return job_id


def update_retrain_job(conn, job_id: str, **kwargs):
    """Update retrain_jobs record with results."""
    fields = ', '.join(f"{k} = %s" for k in kwargs.keys())
    values = list(kwargs.values()) + [job_id]
    with conn.cursor() as cur:
        cur.execute(f"UPDATE retrain_jobs SET {fields} WHERE id = %s", values)
    conn.commit()


def run_retrain(tenant_id: str, dry_run: bool = False, triggered_by: str = 'manual'):
    from sklearn.model_selection import train_test_split

    print(f"\n{'='*60}")
    print(f"Retraining for tenant: {tenant_id}")
    print(f"Dry run: {dry_run}")
    print(f"{'='*60}")

    conn = get_db_connection()

    try:
        # Check unused events count
        unused = get_unused_count(conn, tenant_id)
        print(f"Unused training events: {unused}")

        if unused < RETRAIN_THRESHOLD and triggered_by != 'manual':
            print(f"Not enough new data ({unused} < {RETRAIN_THRESHOLD}). Skipping.")
            return

        # Fetch all training data
        print("Fetching training data from DB...")
        df = fetch_training_data(conn, tenant_id)

        if df.empty:
            print("No training data found.")
            return

        total = len(df)
        label1 = (df['final_label'] == 1).sum()
        label0 = (df['final_label'] == 0).sum()
        pos_ratio = label1 / total

        print(f"Total samples: {total} (delivered: {label0}, returned: {label1}, ratio: {pos_ratio:.2%})")

        # Sanity checks
        if total < MIN_SAMPLES:
            print(f"Too few samples ({total} < {MIN_SAMPLES}). Skipping.")
            return

        if pos_ratio < MIN_POSITIVE_RATIO or pos_ratio > MAX_POSITIVE_RATIO:
            print(f"Class imbalance too severe ({pos_ratio:.2%}). Skipping.")
            return

        # Get current champion metrics
        current_meta = get_current_model_metrics()
        current_f1 = current_meta.get('f1_score', 0)
        current_auc = current_meta.get('auc_roc', 0)
        print(f"Current champion — F1: {current_f1:.4f}, AUC: {current_auc:.4f}")

        if dry_run:
            print("[DRY RUN] Would train model here. Exiting.")
            return

        # Create retrain job record
        job_id = create_retrain_job(conn, triggered_by)

        try:
            # Prepare features
            feature_cols = FEATURE_NAMES + ['call_confirmed_encoded']
            X = df[feature_cols].fillna(0).values
            y = df['final_label'].values

            # Stratified split: 70/15/15
            X_train, X_temp, y_train, y_temp = train_test_split(
                X, y, test_size=0.30, stratify=y, random_state=42
            )
            X_val, X_test, y_val, y_test = train_test_split(
                X_temp, y_temp, test_size=0.50, stratify=y_temp, random_state=42
            )

            print(f"Training: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")
            print("Training model...")

            model, val_metrics = train_model(X_train, y_train, X_val, y_val)

            # Evaluate on test set
            from sklearn.metrics import f1_score, roc_auc_score
            test_probs = model.predict_proba(X_test)[:, 1]
            threshold = val_metrics['optimal_threshold']
            test_preds = (test_probs >= threshold).astype(int)
            test_f1 = float(f1_score(y_test, test_preds, zero_division=0))
            test_auc = float(roc_auc_score(y_test, test_probs))

            print(f"\nChallenger results:")
            print(f"  Val  F1: {val_metrics['f1_score']:.4f} | AUC: {val_metrics['auc_roc']:.4f}")
            print(f"  Test F1: {test_f1:.4f} | AUC: {test_auc:.4f}")

            # Champion vs Challenger decision
            promoted = test_f1 >= current_f1 + PROMOTION_MIN_F1_DELTA
            promotion_reason = None
            rejection_reason = None

            if promoted:
                promotion_reason = (
                    f"F1 {current_f1:.4f} → {test_f1:.4f}, "
                    f"AUC {current_auc:.4f} → {test_auc:.4f}, "
                    f"trained on {total} real outcomes"
                )
                version, model_path = save_model(
                    model, {**val_metrics, 'f1_score': test_f1, 'auc_roc': test_auc},
                    feature_cols, total, tenant_id
                )
                mark_events_used(conn, tenant_id, job_id)
                print(f"\n✅ PROMOTED: {promotion_reason}")
            else:
                rejection_reason = (
                    f"New F1 {test_f1:.4f} below champion {current_f1:.4f} "
                    f"(threshold: {current_f1 + PROMOTION_MIN_F1_DELTA:.4f})"
                )
                version = None
                print(f"\n❌ REJECTED: {rejection_reason}")

            update_retrain_job(
                conn, job_id,
                status='completed',
                total_events=total,
                new_events_count=unused,
                class_0_count=int(label0),
                class_1_count=int(label1),
                previous_model_version=current_meta.get('version'),
                new_model_version=version,
                previous_f1=current_f1,
                new_f1=test_f1,
                previous_auc=current_auc,
                new_auc=test_auc,
                promoted=promoted,
                promotion_reason=promotion_reason,
                rejection_reason=rejection_reason,
                completed_at=datetime.now(timezone.utc).isoformat()
            )

        except Exception as e:
            update_retrain_job(conn, job_id, status='failed', error_message=str(e))
            raise

    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Retrain ML model from real delivery outcomes')
    parser.add_argument('--tenant-id', help='Single tenant UUID to retrain for')
    parser.add_argument('--all-tenants', action='store_true', help='Retrain for all tenants with enough data')
    parser.add_argument('--dry-run', action='store_true', help='Check data without training')
    parser.add_argument('--triggered-by', default='manual', help='Trigger source for audit log')
    args = parser.parse_args()

    if args.tenant_id:
        run_retrain(args.tenant_id, dry_run=args.dry_run, triggered_by=args.triggered_by)

    elif args.all_tenants:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT DISTINCT tenant_id FROM training_events WHERE used_in_training = FALSE")
                tenants = [str(r['tenant_id']) for r in cur.fetchall()]
        finally:
            conn.close()

        print(f"Found {len(tenants)} tenant(s) with unused training data")
        for tid in tenants:
            try:
                run_retrain(tid, dry_run=args.dry_run, triggered_by=args.triggered_by)
            except Exception as e:
                print(f"Failed for tenant {tid}: {e}")

    else:
        print("Usage: --tenant-id <uuid> OR --all-tenants")
        sys.exit(1)
