#!/bin/bash
# =============================================================================
# ML Service Startup Script
# =============================================================================
# Normal flow (production):
#   1. Pre-trained model is in models/latest.joblib (committed to git)
#   2. Copy to versions/ so ModelManager can find it
#   3. Start uvicorn instantly
#
# First-deploy fallback (if no model committed yet):
#   1. Run train_offline.py --mode synthetic --samples 30000
#   2. This is a ONE-TIME operation — after this, commit the model to git
#   3. Future deploys will use the committed model (instant start)
# =============================================================================

set -e

echo "=== COD Fraud Shield — ML Service ==="
echo "Checking for pre-trained model ..."

VERSIONS_COUNT=$(ls -1 /app/versions/model_v*.joblib 2>/dev/null | wc -l)
LATEST_EXISTS=0
[ -f "/app/models/latest.joblib" ] && LATEST_EXISTS=1

if [ "$LATEST_EXISTS" -eq "1" ]; then
    echo "Pre-trained model found in models/latest.joblib"

    # Extract version from metadata and copy to versions/ so ModelManager finds it
    VERSION=$(python3 -c "
import json, sys
try:
    meta = json.load(open('/app/models/latest_meta.json'))
    print(meta.get('version', 'v_prebuilt'))
except:
    print('v_prebuilt')
" 2>/dev/null)

    TARGET="/app/versions/model_${VERSION}.joblib"
    if [ ! -f "$TARGET" ]; then
        cp /app/models/latest.joblib "$TARGET"
        cp /app/models/latest_meta.json "/app/versions/model_${VERSION}_meta.json"
        echo "Model ${VERSION} copied to versions/ — ready."
    else
        echo "Model ${VERSION} already in versions/."
    fi

elif [ "$VERSIONS_COUNT" -gt "0" ]; then
    echo "Found $VERSIONS_COUNT model(s) in versions/ — ready."

else
    echo ""
    echo "WARNING: No pre-trained model found."
    echo "Running one-time synthetic training (30K samples, no calibration) ..."
    echo "This will take ~3-5 minutes. After this, commit models/ to git for instant starts."
    echo ""
    python3 scripts/train_offline.py --mode synthetic --samples 30000 --no-calibrate
    echo "One-time training complete. Model saved to models/ and versions/."
    echo ""
    echo "IMPORTANT: Run the following to avoid retraining on next deploy:"
    echo "  git add ml-service/models/latest.joblib ml-service/models/latest_meta.json"
    echo "  git commit -m 'Add pre-trained ML model v3'"
    echo "  git push"
    echo ""
fi

echo "Starting inference server (workers=1 for memory safety) ..."
exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
