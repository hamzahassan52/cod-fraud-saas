"""
Data Versioner — save and track training data snapshots.

Each snapshot is saved as a parquet file with metadata (row count, date range,
RTO rate, feature statistics). This lets us know exactly which data was used
to train each model version.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .feature_map import FEATURE_NAMES

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent.parent
SNAPSHOTS_DIR = _BASE_DIR / "data" / "snapshots"


class DataVersioner:
    """Manages versioned training data snapshots."""

    def __init__(self, snapshots_dir: Optional[Path] = None) -> None:
        self.snapshots_dir = snapshots_dir or SNAPSHOTS_DIR
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)

    def save_snapshot(
        self,
        df: pd.DataFrame,
        version: Optional[str] = None,
        extra_metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Save a training data snapshot and return the version string."""
        if version is None:
            version = "data_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

        parquet_path = self.snapshots_dir / f"{version}.parquet"
        meta_path = self.snapshots_dir / f"{version}_meta.json"

        # Save data
        df.to_parquet(parquet_path, index=False)

        # Compute metadata
        feature_stats = {}
        for feat in FEATURE_NAMES:
            if feat in df.columns:
                col = df[feat]
                feature_stats[feat] = {
                    "mean": round(float(col.mean()), 4),
                    "std": round(float(col.std()), 4),
                    "min": round(float(col.min()), 4),
                    "max": round(float(col.max()), 4),
                    "null_count": int(col.isna().sum()),
                }

        metadata = {
            "version": version,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "rows": len(df),
            "features": len(FEATURE_NAMES),
            "rto_rate": round(float(df["is_rto"].mean()), 4) if "is_rto" in df.columns else None,
            "rto_count": int(df["is_rto"].sum()) if "is_rto" in df.columns else None,
            "date_range": {
                "min": str(df["created_at"].min()) if "created_at" in df.columns else None,
                "max": str(df["created_at"].max()) if "created_at" in df.columns else None,
            },
            "feature_stats": feature_stats,
        }
        if extra_metadata:
            metadata.update(extra_metadata)

        with open(meta_path, "w") as f:
            json.dump(metadata, f, indent=2, default=str)

        logger.info(
            "Saved data snapshot %s: %d rows, RTO rate %.1f%%",
            version, len(df),
            (df["is_rto"].mean() * 100) if "is_rto" in df.columns else 0,
        )

        return version

    def load_snapshot(self, version: str) -> pd.DataFrame:
        """Load a previously saved data snapshot."""
        parquet_path = self.snapshots_dir / f"{version}.parquet"
        if not parquet_path.exists():
            raise FileNotFoundError(f"Snapshot not found: {parquet_path}")
        return pd.read_parquet(parquet_path)

    def get_metadata(self, version: str) -> Dict[str, Any]:
        """Read metadata for a snapshot."""
        meta_path = self.snapshots_dir / f"{version}_meta.json"
        if not meta_path.exists():
            raise FileNotFoundError(f"Metadata not found: {meta_path}")
        with open(meta_path) as f:
            return json.load(f)

    def list_snapshots(self) -> List[Dict[str, Any]]:
        """List all available snapshots with summary metadata."""
        snapshots = []
        for meta_file in sorted(self.snapshots_dir.glob("*_meta.json"), reverse=True):
            with open(meta_file) as f:
                meta = json.load(f)
            snapshots.append({
                "version": meta.get("version"),
                "created_at": meta.get("created_at"),
                "rows": meta.get("rows"),
                "rto_rate": meta.get("rto_rate"),
            })
        return snapshots
