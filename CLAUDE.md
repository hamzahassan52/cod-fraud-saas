# COD Fraud Detection & Risk Scoring SaaS

## Project Overview
Production-ready multi-tenant SaaS for detecting COD (Cash on Delivery) fraud.
Target market: Pakistan (phase 1), India (phase 2).

## Architecture
- **Backend**: Node.js + TypeScript + Fastify + PostgreSQL + Redis + BullMQ
- **ML Service**: Python + FastAPI + XGBoost (separate microservice)
- **Frontend**: Next.js 14 + Tailwind CSS + Recharts + next-themes
- **Deployment**: Vercel (frontend) + Railway (backend + ML + Postgres + Redis)

## Project Structure
```
cod-fraud-saas/
├── backend/               # Node.js API server
│   ├── Dockerfile         # Railway deployment
│   ├── src/
│   │   ├── app.ts         # Fastify app setup (CORS, rate limit, JWT)
│   │   ├── server.ts      # Entry point + BullMQ worker
│   │   ├── config/        # Environment config
│   │   ├── db/            # PostgreSQL connection + schema.sql + migrate.ts
│   │   ├── middlewares/    # JWT auth, API key auth, validation, metrics, security
│   │   ├── plugins/       # Platform plugins (Shopify, WooCommerce, Magento, Joomla)
│   │   ├── routes/        # API endpoints (webhook, orders, blacklist, analytics, auth, ml, health)
│   │   ├── services/
│   │   │   ├── fraud-engine/  # 3-layer scoring (rules 30% + statistical 30% + ML 40%)
│   │   │   ├── phone-normalizer/  # Pakistani phone normalization
│   │   │   ├── ml-client/     # ML service HTTP client (35 features mapping)
│   │   │   ├── cache/         # Redis caching
│   │   │   ├── queue/         # BullMQ async scoring queue
│   │   │   └── metrics/       # Prometheus metrics
│   │   └── types/             # TypeScript interfaces
│   └── .env.example
├── ml-service/            # Python ML microservice
│   ├── Dockerfile         # Railway deployment (trains model during build)
│   ├── app.py             # FastAPI server + pipeline endpoints
│   ├── train.py           # XGBoost training (v1 + v2 with validation)
│   ├── api/               # Prediction + schemas
│   ├── utils/             # Model versioning + comparison
│   ├── pipeline/          # ML pipeline package
│   │   ├── feature_map.py      # 35 feature names (single source of truth)
│   │   ├── data_collector.py   # Export training data from DB
│   │   ├── data_validator.py   # Clean, validate, impute data
│   │   ├── data_versioner.py   # Parquet snapshots with metadata
│   │   ├── feature_engineer.py # Interaction + seasonal + category features
│   │   ├── feature_analysis.py # Correlation, importance, baseline distributions
│   │   ├── drift_detector.py   # KS test + mean shift drift detection
│   │   └── scheduler.py        # Auto-retrain triggers
│   ├── scripts/
│   │   ├── generate_synthetic_data.py  # 20K Pakistan COD-specific samples
│   │   ├── export_training_data.py     # CLI for DB data export
│   │   └── run_drift_check.py          # CLI for drift check
│   └── .env.example
├── frontend/              # Next.js dashboard
│   ├── vercel.json        # Vercel deployment config
│   ├── src/
│   │   ├── app/           # 10 pages (dashboard, orders, analytics, blacklist, ml, settings, billing, login)
│   │   ├── components/    # layout/, charts/, ui/
│   │   ├── context/       # ThemeProvider, StoreContext
│   │   ├── hooks/         # useAuth
│   │   └── lib/           # api.ts (axios), utils.ts
│   └── .env.example
├── docker/                # Docker Compose (local dev) + legacy Dockerfiles
├── .github/workflows/     # CI pipeline (build + typecheck all services)
└── infra/                 # K8s manifests + Nginx config (legacy)
```

## Key Decisions
- **Fraud Engine**: 3-layer architecture (Rule 30% + Statistical 30% + ML 40%)
- **35 ML Features**: Aligned between backend (TypeScript) and ML model (Python) via `pipeline/feature_map.py`
- **Plugin System**: Adding new e-commerce platforms = add 1 file in `plugins/`
- **Multi-tenant**: Tenant isolation via `tenant_id` FK on all tables
- **Auth**: JWT (dashboard) + API Key (webhooks/API)
- **Queue**: BullMQ for async scoring (non-blocking webhook response)
- **ML Pipeline**: Data collection → validation → versioning → training → drift detection → auto-retrain
- **Cold Start**: Synthetic data (20K samples, 82.85% accuracy) → gradually replaced by real data

## Database
- PostgreSQL 16 with 14 tables (schema in `backend/src/db/schema.sql`)
- Key tables: tenants, orders, fraud_scores, phones, blacklist, model_versions, prediction_logs, performance_snapshots
- Auto-migration on startup via `backend/src/db/migrate.ts`

## API Endpoints
### Auth & Webhooks
- `POST /api/v1/auth/register` / `login` - Authentication
- `POST /api/v1/webhook/:platform` - Receive orders (Shopify, WooCommerce, Magento, Joomla)

### Orders
- `GET /api/v1/orders` - List orders (filtered, paginated)
- `GET /api/v1/orders/:id` - Order detail
- `GET /api/v1/orders/risk/:orderId` - Risk score breakdown (3-layer)
- `POST /api/v1/orders/:id/override` - Manual override

### Blacklist
- `POST /api/v1/blacklist` - Add to blacklist
- `GET /api/v1/blacklist` - List blacklist entries
- `DELETE /api/v1/blacklist/:id` - Remove from blacklist

### Analytics
- `GET /api/v1/analytics` - Dashboard analytics
- `GET /api/v1/analytics/rto-report` - RTO report
- `POST /api/v1/analytics/rto-feedback` - Delivery outcome feedback

### ML
- `GET /api/v1/ml/metrics` - ML model performance
- `GET /api/v1/ml/confusion-matrix` - Confusion matrix
- `POST /api/v1/ml/threshold` - Update scoring thresholds
- `GET /api/v1/ml/versions` - List model versions
- `GET /api/v1/ml/health` - ML service health

### ML Pipeline (on ML service directly)
- `GET /pipeline/drift-report` - Feature drift status
- `POST /pipeline/check-retrain` - Check & optionally trigger retrain
- `GET /pipeline/data-snapshots` - Training data versions
- `POST /pipeline/export-data` - Export training data from DB

### Health
- `GET /health` - Basic health check
- `GET /ready` - Readiness probe (DB, Redis, Queue)
- `GET /live` - Liveness probe
- `GET /metrics` - Prometheus metrics

## ML Model
- **Algorithm**: XGBoost binary classifier with RandomizedSearchCV (100 iterations, 10-fold CV)
- **Features**: 35 features covering order, customer, phone, city, product, and interaction signals
- **Current accuracy**: 82.85% (AUC-ROC: 89.26%) on synthetic Pakistan COD data
- **Training data**: 20K synthetic samples with Pakistan-specific patterns (Eid, Ramadan, city RTO rates)
- **Drift detection**: KS test + mean shift on feature distributions

## Deployment

### Architecture
```
GitHub repo
  ├── push to main → Vercel auto-deploys frontend
  ├── push to main → Railway auto-deploys backend
  └── push to main → Railway auto-deploys ML service

Railway Project:
  ├── Backend Service (Dockerfile)
  ├── ML Service (Dockerfile)
  ├── PostgreSQL (managed)
  └── Redis (managed)

Vercel:
  └── Frontend (Next.js)
```

### Environment Variables
- Backend: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ML_SERVICE_URL`, `CORS_ORIGINS`, `API_KEY_ENCRYPTION_SECRET`
- ML Service: `PORT`, `DATABASE_URL`, `CORS_ORIGINS`
- Frontend: `NEXT_PUBLIC_API_URL`

### Railway Internal Networking
- Backend → ML Service: `http://ml-service.railway.internal:PORT`
- Backend → Postgres: Railway provides `DATABASE_URL` automatically
- Backend → Redis: Railway provides `REDIS_URL` automatically

## Running Locally
```bash
# 1. Start DB + Redis
cd docker && docker-compose -f docker-compose.local.yml up -d

# 2. ML Service (port 8000)
cd ml-service && pip install -r requirements.txt
python scripts/generate_synthetic_data.py  # generate training data
python train.py                             # train model
uvicorn app:app --port 8000

# 3. Backend (port 3000)
cd backend && npm install && npm run dev

# 4. Frontend (port 3000)
cd frontend && npm install && npm run dev
```

## Ports (Local Dev)
- Frontend: 3000
- Backend: 3000 (or 3001 if 3000 is taken)
- ML Service: 8000
- PostgreSQL: 5433 (mapped from container 5432)
- Redis: 6379

## Commands
- `npm run dev` - Dev server (backend or frontend)
- `npm run build` - Build (backend TypeScript or frontend Next.js)
- `npm run typecheck` - TypeScript type checking (backend)
- `python train.py` - Train ML model (v1)
- `python train.py --v2` - Train with validation + data versioning
- `python scripts/generate_synthetic_data.py --n 20000` - Generate synthetic data
- `python scripts/run_drift_check.py` - Check model drift
- `python scripts/export_training_data.py` - Export real data from DB
