#!/usr/bin/env python3
"""
Export real training data from the database.

Usage::

    python scripts/export_training_data.py
    python scripts/export_training_data.py --min-orders 500
    python scripts/export_training_data.py --output data/real_training.csv

Requires DATABASE_URL environment variable to be set.
"""

from __future__ import annotations

import argparse
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
logger = logging.getLogger("export_training_data")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export real training data from DB")
    parser.add_argument(
        "--min-orders",
        type=int,
        default=0,
        help="Minimum number of orders with outcomes required",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output CSV path (default: data/training_data_real.csv)",
    )
    parser.add_argument(
        "--snapshot",
        action="store_true",
        help="Also save a versioned parquet snapshot",
    )
    args = parser.parse_args()

    from pipeline.data_collector import export_training_data
    from pipeline.data_validator import DataValidator

    try:
        df = export_training_data(min_outcome_orders=args.min_orders)
    except EnvironmentError as e:
        logger.error(str(e))
        sys.exit(1)
    except ValueError as e:
        logger.error(str(e))
        sys.exit(1)

    # Validate
    validator = DataValidator()
    df, report = validator.validate_and_clean(df)

    print(f"\n=== Export Summary ===")
    print(f"  Total rows    : {report.final_rows}")
    print(f"  Duplicates    : {report.duplicates_removed} removed")
    print(f"  RTO rate      : {report.rto_rate:.1%}")
    print(f"  Class balance : {'OK' if report.class_balance_ok else 'WARNING'}")

    if report.warnings:
        print(f"  Warnings:")
        for w in report.warnings:
            print(f"    - {w}")

    # Save CSV
    data_dir = PROJECT_ROOT / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    output_path = Path(args.output) if args.output else data_dir / "training_data_real.csv"
    df.to_csv(output_path, index=False)
    print(f"\n  Saved to: {output_path}")

    # Optionally save snapshot
    if args.snapshot:
        from pipeline.data_versioner import DataVersioner

        versioner = DataVersioner()
        version = versioner.save_snapshot(
            df,
            extra_metadata={"validation_report": report.to_dict()},
        )
        print(f"  Snapshot: {version}")


if __name__ == "__main__":
    main()
