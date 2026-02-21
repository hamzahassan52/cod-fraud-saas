"""
Single source of truth for feature names between the Node.js backend and the ML model.

Feature Architecture (v3 — 48 features):
-----------------------------------------
Group A — Static Order Features      (always available from order payload)
Group B — Behavioral/Velocity        (from customer history in DB)
Group C — Contextual/Seasonal        (computed from date, city, product)
Group D — Derived Interaction        (computed from A+B+C)

REQUIRED_FEATURES  — bare minimum; inference is refused without these
OPTIONAL_FEATURES  — filled from DEFAULT_VALUES if missing; inference still works
DEFAULT_VALUES     — sensible Pakistan COD defaults for every optional feature

This ensures real-world orders with partial data still score correctly.
"""

from __future__ import annotations

from typing import Dict, List

# ---------------------------------------------------------------------------
# The canonical 48 features the ML model expects (sorted alphabetically).
# v1: 35 base features
# v2: +7 velocity/account-age features (orders_last_24h, orders_last_7d, etc.)
# v3: +6 seasonal/behavioral features (orders_last_1h, seasonal flags, discount, avg days)
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
    "orders_last_24h",           # orders from same phone in last 24 hours
    "orders_last_7d",            # orders from same phone in last 7 days
    "customer_lifetime_value",   # total PKR spent historically
    "amount_vs_customer_avg",    # current order / historical avg (>2 = suspicious)
    "is_new_account",            # phone first seen < 30 days ago
    "new_account_high_value",    # new account + order > 5000 PKR
    "new_account_cod",           # new account + COD payment
    # v3: seasonal intelligence + behavioral patterns + discount abuse
    "orders_last_1h",            # orders from same phone in last 1 hour (flash fraud)
    "is_eid_period",             # Eid ul-Fitr/Adha season (April, June, July in Pakistan)
    "is_ramadan",                # Ramadan month (March/April) — different shopping patterns
    "is_sale_period",            # 11.11 / 12.12 / Black Friday sale event
    "is_high_discount",          # discount > 40% (combined with COD = abuse signal)
    "avg_days_between_orders",   # avg days between consecutive orders (< 1 = rapid ring)
])

# ---------------------------------------------------------------------------
# Feature categorization — 4 groups
# ---------------------------------------------------------------------------
FEATURE_GROUPS: Dict[str, List[str]] = {
    # A — Static Order Features: always computable from the order payload itself
    "A_static_order": [
        "order_amount",
        "order_item_count",
        "is_cod",
        "is_prepaid",
        "order_hour",
        "is_weekend",
        "is_night_order",
        "is_high_value_order",
        "discount_percentage",
        "is_high_discount",
        "amount_zscore",        # approximated; defaults to 0 if pop stats unavailable
    ],
    # B — Behavioral/Velocity Features: require customer history lookup from DB
    "B_behavioral_velocity": [
        "customer_order_count",
        "customer_rto_rate",
        "customer_cancel_rate",
        "customer_avg_order_value",
        "customer_lifetime_value",
        "customer_account_age_days",
        "customer_distinct_cities",
        "customer_distinct_phones",
        "customer_address_changes",
        "days_since_last_order",
        "orders_last_1h",
        "orders_last_24h",
        "orders_last_7d",
        "avg_days_between_orders",
        "is_first_order",
        "is_repeat_customer",
        "is_new_account",
        "new_account_cod",
        "new_account_high_value",
        "phone_verified",
        "email_verified",
        "address_quality_score",
    ],
    # C — Contextual/Seasonal Features: city stats, product signals, date-based flags
    "C_contextual_seasonal": [
        "city_rto_rate",
        "city_order_volume",
        "city_avg_delivery_days",
        "product_rto_rate",
        "product_category_rto_rate",
        "product_price_vs_avg",
        "shipping_distance_km",
        "same_city_shipping",
        "is_eid_period",
        "is_ramadan",
        "is_sale_period",
    ],
    # D — Derived Interaction Features: computed from the groups above
    "D_derived_interaction": [
        "cod_first_order",
        "high_value_cod_first",
        "phone_risk_score",
        "amount_vs_customer_avg",
    ],
}

# ---------------------------------------------------------------------------
# Required vs Optional features
# ---------------------------------------------------------------------------

# REQUIRED: absolute minimum for a meaningful prediction.
# Inference is refused if these are missing AND cannot be defaulted.
REQUIRED_FEATURES: List[str] = [
    "order_amount",   # can't score an order without its value
    "is_cod",         # single strongest fraud signal
    "order_hour",     # time context
]

# OPTIONAL: can be missing; filled from DEFAULT_VALUES below.
# Real-world orders with partial data will still score correctly.
OPTIONAL_FEATURES: List[str] = [f for f in FEATURE_NAMES if f not in REQUIRED_FEATURES]

# ---------------------------------------------------------------------------
# Mapping from backend field names to ML feature names.
# Keys = what the backend sends, Values = what the ML model expects.
# Features not in this map are computed server-side or have the same name.
# ---------------------------------------------------------------------------
BACKEND_TO_ML_MAP: Dict[str, str] = {
    # Backend name           -> ML model name
    "phone_valid":            "phone_verified",
    "phone_order_count":      "customer_order_count",
    "phone_rto_rate":         "customer_rto_rate",
    "phone_age_days":         "customer_account_age_days",
    "phone_unique_addresses": "customer_distinct_cities",
    "items_count":            "order_item_count",
    "is_high_value":          "is_high_value_order",
    "previous_order_count":   "customer_order_count",
    "address_order_count":    "city_order_volume",
}

# Default values for features not available from the backend
FEATURE_DEFAULTS: Dict[str, float] = {
    "customer_cancel_rate": 0.0,
    "customer_avg_order_value": 0.0,
    "customer_distinct_phones": 1.0,
    "customer_address_changes": 0.0,
    # City defaults: Pakistan national averages (so unknown cities still score correctly)
    "city_rto_rate": 0.28,           # Pakistan national average RTO
    "city_order_volume": 400.0,      # medium-sized area
    "city_avg_delivery_days": 3.5,   # average delivery time
    "product_rto_rate": 0.25,
    "product_category_rto_rate": 0.25,
    "product_price_vs_avg": 1.0,
    "amount_zscore": 0.0,
    "email_verified": 0.0,
    "address_quality_score": 0.5,
    "shipping_distance_km": 200.0,   # assume moderate distance if unknown
    "same_city_shipping": 0.0,
    "discount_percentage": 0.0,
    "is_prepaid": 0.0,
    # v2 feature defaults
    "orders_last_24h": 0.0,
    "orders_last_7d": 0.0,
    "customer_lifetime_value": 0.0,
    "amount_vs_customer_avg": 1.0,   # neutral: same as historical avg
    "is_new_account": 0.0,
    "new_account_high_value": 0.0,
    "new_account_cod": 0.0,
    # v3 feature defaults
    "orders_last_1h": 0.0,
    "is_eid_period": 0.0,
    "is_ramadan": 0.0,
    "is_sale_period": 0.0,
    "is_high_discount": 0.0,
    "avg_days_between_orders": 999.0,  # unknown history = treat as first order
}


def map_backend_features(backend_features: Dict[str, float]) -> Dict[str, float]:
    """Convert a backend feature dict to ML model feature dict.

    Applies the BACKEND_TO_ML_MAP renaming and fills in defaults
    for any features the backend cannot provide.
    """
    ml_features: Dict[str, float] = {}

    for backend_name, value in backend_features.items():
        ml_name = BACKEND_TO_ML_MAP.get(backend_name, backend_name)
        ml_features[ml_name] = value

    # Fill defaults for missing features
    for feat in FEATURE_NAMES:
        if feat not in ml_features:
            ml_features[feat] = FEATURE_DEFAULTS.get(feat, 0.0)

    return ml_features
