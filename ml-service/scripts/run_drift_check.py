#!/usr/bin/env python3
"""
Check if the ML model needs retraining.

Runs drift detection (feature drift + performance degradation) and the
retrain scheduler to produce a recommendation.

Usage::

    python scripts/run_drift_check.py
    python scripts/run_drift_check.py --retrain   # auto-retrain if recommended
    python scripts/run_drift_check.py --verbose    # detailed output

"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("drift_check")


def main() -> None:
    parser = argparse.ArgumentParser(description="Check if ML model needs retraining")
    parser.add_argument(
        "--retrain",
        action="store_true",
        help="Automatically retrain if recommended",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print detailed drift report",
    )
    args = parser.parse_args()

    from pipeline.drift_detector import DriftDetector
    from pipeline.scheduler import RetrainScheduler
    from utils.model_manager import ModelManager

    manager = ModelManager()
    detector = DriftDetector()
    scheduler = RetrainScheduler()

    # Load current model
    try:
        artifact = manager.load_model()
    except FileNotFoundError:
        logger.error("No model found. Train a model first.")
        sys.exit(1)

    print(f"\n=== Drift Check ===")
    print(f"  Current model : {artifact.version}")
    print(f"  Trained at    : {artifact.trained_at}")
    print(f"  Features      : {len(artifact.feature_names)}")

    # Try feature drift check
    import pandas as pd

    data_dir = PROJECT_ROOT / "data"
    csv_path = data_dir / "training_data.csv"

    drift_report = None
    if csv_path.exists():
        try:
            df = pd.read_csv(csv_path)
            drift_report = detector.check_feature_drift(df, artifact.version)
            print(f"\n  Feature drift  : {'DETECTED' if drift_report.feature_drift_detected else 'None'}")
            if drift_report.drifted_features:
                print(f"  Drifted features ({len(drift_report.drifted_features)}):")
                for feat in drift_report.drifted_features[:5]:
                    print(f"    - {feat['feature']}: mean shift {feat['mean_shift_std']:.2f} std")
        except FileNotFoundError:
            print(f"\n  Feature drift  : No baseline found (first training?)")
    else:
        print(f"\n  Feature drift  : No training data found for comparison")

    # Scheduler decision
    state = scheduler.load_state()
    decision = scheduler.should_retrain(
        drift_should_retrain=drift_report.should_retrain if drift_report else False,
        drift_reasons=drift_report.reasons if drift_report else None,
        new_orders_since_last_train=state.get("new_orders", 0),
        last_trained_at=artifact.trained_at,
    )

    print(f"\n  Should retrain : {'YES' if decision['should_retrain'] else 'No'}")
    print(f"  Trigger        : {decision.get('trigger', 'none')}")
    print(f"  Reasons:")
    for r in decision["reasons"]:
        print(f"    - {r}")

    if args.verbose and drift_report:
        print(f"\n  Full drift report:")
        print(json.dumps(drift_report.to_dict(), indent=2))

    # Auto-retrain if requested
    if args.retrain and decision["should_retrain"]:
        print(f"\n  Triggering retraining...")
        if csv_path.exists():
            from train import train_model_v2

            df = pd.read_csv(str(csv_path))
            model, metrics, features, n_samples, version = train_model_v2(
                df, min_samples=10,
            )
            manager.load_model(version=version)

            print(f"\n=== Retrained ===")
            print(f"  New version   : {version}")
            print(f"  Samples       : {n_samples}")
            print(f"  Accuracy      : {metrics['accuracy']}")
            print(f"  AUC-ROC       : {metrics['auc_roc']}")

            # Update scheduler state
            from datetime import datetime, timezone

            scheduler.save_state({
                "last_trained_at": datetime.now(timezone.utc).isoformat(),
                "last_version": version,
                "new_orders": 0,
            })
        else:
            print(f"  ERROR: No training data found at {csv_path}")

    print()


if __name__ == "__main__":
    main()
