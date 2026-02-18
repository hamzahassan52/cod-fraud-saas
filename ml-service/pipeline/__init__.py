"""
ML Pipeline package for COD Fraud Detection.

Modules:
    feature_map       - Single source of truth for feature name mapping
    data_collector    - Export real training data from PostgreSQL
    data_validator    - Clean and validate training data
    data_versioner    - Snapshot and version training datasets
    feature_engineer  - sklearn Pipeline with interaction + seasonal features
    feature_analysis  - Correlation analysis, importance ranking, drift baselines
    drift_detector    - Detect feature drift and performance degradation
    scheduler         - Decide when to retrain the model
"""

from .feature_map import FEATURE_NAMES, BACKEND_TO_ML_MAP
