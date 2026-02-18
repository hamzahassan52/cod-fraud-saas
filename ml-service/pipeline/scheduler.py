"""
Retrain Scheduler — decides when the model should be retrained.

Triggers:
    1. Performance drop (precision/recall below floor)
    2. Feature drift (incoming data differs from training distribution)
    3. Scheduled weekly retrain (when enough new data exists)
    4. Manual trigger via API
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_BASE_DIR = Path(__file__).resolve().parent.parent
SCHEDULER_STATE_PATH = _BASE_DIR / "data" / "scheduler_state.json"


class RetrainScheduler:
    """Determines when the model should be retrained."""

    def __init__(
        self,
        retrain_interval_days: int = 7,
        min_new_orders: int = 200,
    ):
        self.retrain_interval_days = retrain_interval_days
        self.min_new_orders = min_new_orders

    def should_retrain(
        self,
        drift_should_retrain: bool = False,
        drift_reasons: Optional[List[str]] = None,
        new_orders_since_last_train: int = 0,
        last_trained_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Evaluate all retrain triggers and return a decision.

        Returns dict with:
            should_retrain: bool
            trigger: str (which trigger fired)
            reasons: list of str
        """
        reasons: List[str] = []
        trigger = None

        # 1. Drift-based trigger (highest priority)
        if drift_should_retrain:
            trigger = "drift"
            reasons.extend(drift_reasons or ["Drift detected"])

        # 2. Scheduled retrain (weekly by default)
        if last_trained_at and not trigger:
            try:
                last_dt = datetime.fromisoformat(last_trained_at)
                days_since = (datetime.now(timezone.utc) - last_dt).days
                if days_since >= self.retrain_interval_days:
                    if new_orders_since_last_train >= self.min_new_orders:
                        trigger = "scheduled"
                        reasons.append(
                            f"{days_since} days since last training, "
                            f"{new_orders_since_last_train} new orders available"
                        )
                    else:
                        reasons.append(
                            f"Scheduled retrain due ({days_since} days) but only "
                            f"{new_orders_since_last_train}/{self.min_new_orders} new orders"
                        )
            except (ValueError, TypeError):
                pass

        # 3. Volume-based trigger (lots of new data)
        if not trigger and new_orders_since_last_train >= self.min_new_orders * 5:
            trigger = "volume"
            reasons.append(
                f"Large volume of new data: {new_orders_since_last_train} orders"
            )

        if not reasons:
            reasons.append("No retrain triggers fired")

        result = {
            "should_retrain": trigger is not None,
            "trigger": trigger,
            "reasons": reasons,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "new_orders": new_orders_since_last_train,
        }

        logger.info(
            "Retrain check: should_retrain=%s trigger=%s",
            result["should_retrain"], trigger,
        )
        return result

    def save_state(self, state: Dict[str, Any]) -> None:
        """Persist scheduler state to disk."""
        SCHEDULER_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(SCHEDULER_STATE_PATH, "w") as f:
            json.dump(state, f, indent=2, default=str)

    def load_state(self) -> Dict[str, Any]:
        """Load scheduler state from disk."""
        if not SCHEDULER_STATE_PATH.exists():
            return {}
        with open(SCHEDULER_STATE_PATH) as f:
            return json.load(f)
