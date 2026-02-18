"""
ModelManager -- handles model persistence, versioning, and lifecycle.

Models are stored as joblib files under the ``versions/`` directory with the
naming convention ``model_<version>.joblib``.  A companion JSON sidecar
(``model_<version>_meta.json``) stores metrics and training metadata.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib

logger = logging.getLogger(__name__)

# Base directory that contains the ``versions/`` folder.
_BASE_DIR = Path(__file__).resolve().parent.parent
VERSIONS_DIR = _BASE_DIR / "versions"


@dataclass
class ModelArtifact:
    """In-memory representation of a loaded model + metadata."""

    model: Any
    version: str
    feature_names: List[str]
    metrics: Dict[str, float] = field(default_factory=dict)
    trained_at: str = ""
    training_samples: int = 0


class ModelManager:
    """Manages loading, saving, and listing model versions on disk."""

    def __init__(self, versions_dir: Optional[Path] = None) -> None:
        self.versions_dir = versions_dir or VERSIONS_DIR
        self.versions_dir.mkdir(parents=True, exist_ok=True)
        self._active: Optional[ModelArtifact] = None
        logger.info("ModelManager initialised. versions_dir=%s", self.versions_dir)

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    @property
    def active_model(self) -> Optional[ModelArtifact]:
        """Return the currently loaded model artifact (may be ``None``)."""
        return self._active

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def load_model(self, version: Optional[str] = None) -> ModelArtifact:
        """Load a model from disk and set it as the active model.

        If *version* is ``None`` the latest available version is loaded.
        """
        if version is None:
            version = self.get_latest_version()
            if version is None:
                raise FileNotFoundError("No model versions found in %s" % self.versions_dir)

        model_path = self._model_path(version)
        meta_path = self._meta_path(version)

        if not model_path.exists():
            raise FileNotFoundError("Model file not found: %s" % model_path)

        model = joblib.load(model_path)
        logger.info("Model loaded from %s", model_path)

        # Load metadata
        metrics: Dict[str, float] = {}
        feature_names: List[str] = []
        trained_at = ""
        training_samples = 0

        if meta_path.exists():
            with open(meta_path, "r") as fh:
                meta = json.load(fh)
            metrics = meta.get("metrics", {})
            feature_names = meta.get("feature_names", [])
            trained_at = meta.get("trained_at", "")
            training_samples = meta.get("training_samples", 0)
        else:
            logger.warning("Metadata file missing for version %s", version)

        artifact = ModelArtifact(
            model=model,
            version=version,
            feature_names=feature_names,
            metrics=metrics,
            trained_at=trained_at,
            training_samples=training_samples,
        )
        self._active = artifact
        logger.info(
            "Active model set to version %s (features=%d, samples=%d)",
            version,
            len(feature_names),
            training_samples,
        )
        return artifact

    # ------------------------------------------------------------------
    # Listing / querying
    # ------------------------------------------------------------------

    def list_versions(self) -> List[str]:
        """Return all available model versions sorted newest-first."""
        versions: List[str] = []
        for p in self.versions_dir.glob("model_v*.joblib"):
            # Extract version from filename: model_v20240101_120000.joblib -> v20240101_120000
            stem = p.stem  # model_v20240101_120000
            version = stem.replace("model_", "", 1)
            versions.append(version)
        versions.sort(reverse=True)
        return versions

    def get_latest_version(self) -> Optional[str]:
        """Return the latest version string or ``None``."""
        versions = self.list_versions()
        return versions[0] if versions else None

    def get_model_metadata(self, version: str) -> Dict[str, Any]:
        """Read the JSON sidecar for the given version."""
        meta_path = self._meta_path(version)
        if not meta_path.exists():
            raise FileNotFoundError("Metadata not found for version %s" % version)
        with open(meta_path, "r") as fh:
            return json.load(fh)

    # ------------------------------------------------------------------
    # Model comparison
    # ------------------------------------------------------------------

    def compare_models(
        self,
        version_a: str,
        version_b: str,
        primary_metric: str = "auc_roc",
    ) -> Dict[str, Any]:
        """Compare two model versions on their metrics.

        Returns a dict with comparison results and which version is better.
        """
        meta_a = self.get_model_metadata(version_a)
        meta_b = self.get_model_metadata(version_b)

        metrics_a = meta_a.get("metrics", {})
        metrics_b = meta_b.get("metrics", {})

        comparison: Dict[str, Any] = {
            "version_a": version_a,
            "version_b": version_b,
            "primary_metric": primary_metric,
            "metrics": {},
        }

        all_metrics = set(list(metrics_a.keys()) + list(metrics_b.keys()))
        for metric in sorted(all_metrics):
            val_a = metrics_a.get(metric, 0.0)
            val_b = metrics_b.get(metric, 0.0)
            comparison["metrics"][metric] = {
                "version_a": val_a,
                "version_b": val_b,
                "diff": round(val_b - val_a, 6),
                "better": "b" if val_b > val_a else ("a" if val_a > val_b else "tie"),
            }

        # Determine winner by primary metric
        pa = metrics_a.get(primary_metric, 0.0)
        pb = metrics_b.get(primary_metric, 0.0)
        comparison["winner"] = version_b if pb >= pa else version_a
        comparison["winner_reason"] = (
            f"{comparison['winner']} has better {primary_metric}: "
            f"{max(pa, pb):.4f} vs {min(pa, pb):.4f}"
        )

        # Include training info
        comparison["training_info"] = {
            "version_a": {
                "samples": meta_a.get("training_samples", 0),
                "trained_at": meta_a.get("trained_at", "unknown"),
            },
            "version_b": {
                "samples": meta_b.get("training_samples", 0),
                "trained_at": meta_b.get("trained_at", "unknown"),
            },
        }

        logger.info(
            "Model comparison: %s vs %s -> winner=%s (%s)",
            version_a, version_b, comparison["winner"], comparison["winner_reason"],
        )
        return comparison

    def save_model(
        self,
        model: Any,
        version: str,
        feature_names: List[str],
        metrics: Dict[str, float],
        training_samples: int = 0,
        extra_metadata: Optional[Dict[str, Any]] = None,
    ) -> Path:
        """Persist a trained model and its metadata to disk.

        Returns the path to the saved ``.joblib`` file.
        """
        model_path = self._model_path(version)
        meta_path = self._meta_path(version)

        trained_at = datetime.now(timezone.utc).isoformat()

        # Save model binary
        joblib.dump(model, model_path)
        logger.info("Model saved to %s", model_path)

        # Save metadata sidecar
        meta: Dict[str, Any] = {
            "version": version,
            "feature_names": feature_names,
            "metrics": metrics,
            "trained_at": trained_at,
            "training_samples": training_samples,
            "feature_count": len(feature_names),
        }
        if extra_metadata:
            meta.update(extra_metadata)

        with open(meta_path, "w") as fh:
            json.dump(meta, fh, indent=2)
        logger.info("Metadata saved to %s", meta_path)

        return model_path

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _model_path(self, version: str) -> Path:
        return self.versions_dir / f"model_{version}.joblib"

    def _meta_path(self, version: str) -> Path:
        return self.versions_dir / f"model_{version}_meta.json"
