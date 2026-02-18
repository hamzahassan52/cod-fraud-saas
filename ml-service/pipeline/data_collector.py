"""
Data Collector — export real training data from PostgreSQL.

Joins orders + fraud_scores + phones + rto_reports to compute all 35 features
and the target label (is_rto). Only uses orders with known outcomes.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import pandas as pd

from .feature_map import FEATURE_NAMES

logger = logging.getLogger(__name__)


def export_training_data(
    db_url: Optional[str] = None,
    min_outcome_orders: int = 0,
) -> pd.DataFrame:
    """Export labelled training data from the database.

    Only includes orders with a final delivery outcome (delivered or rto).
    Results are sorted by created_at for temporal splitting.

    Parameters
    ----------
    db_url : str, optional
        PostgreSQL connection string. Falls back to DATABASE_URL env var.
    min_outcome_orders : int
        Minimum rows required. Raises ValueError if not met.

    Returns
    -------
    pd.DataFrame with all 35 ML features + ``is_rto`` target + ``created_at``.
    """
    import psycopg2

    db_url = db_url or os.getenv("DATABASE_URL")
    if not db_url:
        raise EnvironmentError("DATABASE_URL is not set")

    logger.info("Connecting to database for training data export...")
    conn = psycopg2.connect(db_url)

    query = """
        SELECT
            o.id                             AS order_id,
            o.tenant_id,
            o.amount                         AS order_amount,
            o.item_count                     AS order_item_count,
            CASE WHEN o.payment_method = 'cod' THEN 1 ELSE 0 END AS is_cod,
            CASE WHEN o.payment_method != 'cod' THEN 1 ELSE 0 END AS is_prepaid,
            EXTRACT(HOUR FROM o.created_at)  AS order_hour,
            CASE WHEN EXTRACT(DOW FROM o.created_at) IN (0, 6) THEN 1 ELSE 0 END AS is_weekend,
            CASE WHEN EXTRACT(HOUR FROM o.created_at) >= 22
                   OR EXTRACT(HOUR FROM o.created_at) < 6 THEN 1 ELSE 0 END AS is_night_order,

            -- Customer features from phones + order history
            COALESCE(p.total_orders, 0)                  AS customer_order_count,
            COALESCE(p.rto_rate, 0)                      AS customer_rto_rate,
            0                                            AS customer_cancel_rate,
            COALESCE(
                (SELECT AVG(o2.amount) FROM orders o2
                 WHERE o2.phone_normalized = o.phone_normalized
                   AND o2.created_at < o.created_at),
                o.amount
            )                                            AS customer_avg_order_value,
            COALESCE(
                EXTRACT(DAY FROM o.created_at - p.first_seen_at), 0
            )                                            AS customer_account_age_days,
            COALESCE(
                (SELECT COUNT(DISTINCT shipping_city) FROM orders o2
                 WHERE o2.phone_normalized = o.phone_normalized
                   AND o2.created_at < o.created_at),
                1
            )                                            AS customer_distinct_cities,
            1                                            AS customer_distinct_phones,
            0                                            AS customer_address_changes,

            -- City features
            COALESCE(
                (SELECT COUNT(*) FILTER (WHERE status IN ('rto','returned','return_to_origin'))::float
                 / NULLIF(COUNT(*)::float, 0)
                 FROM orders o2 WHERE o2.shipping_city = o.shipping_city
                   AND o2.created_at < o.created_at),
                0
            )                                            AS city_rto_rate,
            COALESCE(
                (SELECT COUNT(*) FROM orders o2
                 WHERE o2.shipping_city = o.shipping_city
                   AND o2.created_at < o.created_at),
                0
            )                                            AS city_order_volume,
            0                                            AS city_avg_delivery_days,

            -- Product features (defaults for now)
            0                                            AS product_rto_rate,
            0                                            AS product_category_rto_rate,
            1.0                                          AS product_price_vs_avg,

            -- Derived features
            CASE WHEN o.amount > 5000 THEN 1 ELSE 0 END AS is_high_value_order,
            0                                            AS amount_zscore,
            COALESCE(p.is_verified::int, 0)              AS phone_verified,
            0                                            AS email_verified,
            0.5                                          AS address_quality_score,
            0                                            AS shipping_distance_km,
            0                                            AS same_city_shipping,
            COALESCE(o.discount_percentage, 0)           AS discount_percentage,
            CASE WHEN COALESCE(p.total_orders, 0) <= 1 THEN 1 ELSE 0 END AS is_first_order,
            CASE WHEN COALESCE(p.total_orders, 0) > 1 THEN 1 ELSE 0 END AS is_repeat_customer,
            COALESCE(
                EXTRACT(DAY FROM o.created_at -
                    (SELECT MAX(o2.created_at) FROM orders o2
                     WHERE o2.phone_normalized = o.phone_normalized
                       AND o2.created_at < o.created_at)),
                999
            )                                            AS days_since_last_order,

            -- Target label
            CASE WHEN o.status IN ('rto', 'returned', 'return_to_origin') THEN 1 ELSE 0 END AS is_rto,
            o.created_at

        FROM orders o
        LEFT JOIN phones p ON p.phone_normalized = o.phone_normalized
        WHERE o.status IS NOT NULL
          AND o.status IN ('delivered', 'rto', 'returned', 'return_to_origin')
        ORDER BY o.created_at ASC
    """

    df = pd.read_sql(query, conn)
    conn.close()

    if len(df) < min_outcome_orders:
        raise ValueError(
            f"Only {len(df)} orders with outcomes found, need at least {min_outcome_orders}"
        )

    # Compute interaction features
    df["cod_first_order"] = df["is_cod"] * df["is_first_order"]
    df["high_value_cod_first"] = (
        df["is_high_value_order"] * df["is_cod"] * df["is_first_order"]
    )
    df["phone_risk_score"] = df["customer_rto_rate"] * (1.0 - df["phone_verified"])

    # Compute amount_zscore
    if df["order_amount"].std() > 0:
        df["amount_zscore"] = (
            (df["order_amount"] - df["order_amount"].mean()) / df["order_amount"].std()
        )

    logger.info(
        "Exported %d rows | RTO rate: %.1f%% | Date range: %s to %s",
        len(df),
        df["is_rto"].mean() * 100,
        df["created_at"].min(),
        df["created_at"].max(),
    )

    return df
