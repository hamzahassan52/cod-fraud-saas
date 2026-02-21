# COD Fraud Detection & Risk Scoring SaaS

## Project Owner
- **Owner**: Hamza Hassan (hamzahassan52 on GitHub)
- **Language**: Urdu/Roman Urdu (owner communicates in Roman Urdu)
- **Goal**: Production SaaS product for Pakistan COD fraud detection, later expand to India

## Live Production URLs
- **Frontend**: https://cod-fraud-saas.vercel.app/
- **Backend API**: https://cod-fraud-saas-production.up.railway.app
- **ML Service**: https://cod-fraud-saas-production-9d4a.up.railway.app
- **GitHub**: https://github.com/hamzahassan52/cod-fraud-saas

## Accounts (Production)

| Account | Email | Password | Tenant ID | Plan | Purpose |
|---------|-------|----------|-----------|------|---------|
| Admin | admin@cod.com | fast4400F | 22e38bb9-ec28-45dc-94ac-6db825256f71 | enterprise | Owner's admin account |
| Demo | demo@cod.com | cod4400F | b90f2e04-4e9a-487b-85cc-2dc0823a8c07 | enterprise | Demo/showcase account |

- Demo API Key: `cfr_f90e29815c9d40f6b7b4dd43e5017fe4`
- Demo account has realistic Pakistani COD orders pre-loaded

**To re-seed demo data:** `NODE_PATH=./backend/node_modules node scripts/seed_demo.js`

## Architecture
- **Backend**: Node.js + TypeScript + Fastify + PostgreSQL + Redis + BullMQ
- **ML Service**: Python + FastAPI + XGBoost+LightGBM ensemble (separate microservice)
- **Frontend**: Next.js 14 + Tailwind CSS + Recharts + next-themes (dark mode)
- **Deployment**: Vercel (frontend) + Railway (backend + ML + Postgres + Redis)
- **CI/CD**: Push to `main` branch → auto-deploy everywhere

## Deployment Details

### Railway Services
| Service | Type | Notes |
|---------|------|-------|
| Backend | Dockerfile | Runs migration on startup, then starts Fastify + BullMQ worker |
| ML Service | Dockerfile | Loads pre-trained model from `models/`, instant start — NO training at build time |
| PostgreSQL | Managed | Public URL: `postgresql://postgres:LffCkMqCOGGAIeQJQlHyMYKHuDJvwjbb@shinkansen.proxy.rlwy.net:23453/railway` |
| Redis | Managed | Requires auth (password in URL) |

### Environment Variables
- **Backend (Railway)**: `DATABASE_URL` (Postgres public URL), `REDIS_URL` (Redis public URL), `JWT_SECRET`, `ML_SERVICE_URL` (ML internal or public URL), `CORS_ORIGINS` (Vercel frontend URL), `API_KEY_ENCRYPTION_SECRET`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_SCOPES`
- **ML Service (Railway)**: `PORT` (Railway sets dynamically), `DATABASE_URL`, `CORS_ORIGINS`
- **Frontend (Vercel)**: `NEXT_PUBLIC_API_URL` = `https://cod-fraud-saas-production.up.railway.app/api/v1`

### Important Deployment Notes
- Railway sets PORT dynamically (usually 8080) — never hardcode ports
- BullMQ Redis connection must include password/username parsed from URL (fixed in `scoring-queue.ts`)
- Migration script (`migrate.ts`) is non-fatal — retries 5x then exits 0 so server still starts
- **ML training is OFFLINE** — Dockerfile does NOT train. Workflow: run `python scripts/train_offline.py` locally → commit `models/latest.joblib` + `models/latest_meta.json` → push → Railway COPY loads it instantly
- If no `models/latest.joblib` found at startup, `startup.sh` trains once with 30K synthetic samples as fallback
- Backend CORS uses `CORS_ORIGINS` env var in production, `true` in development
- **DO NOT use Railway internal networking** (`*.railway.internal`) — it's unreliable, use public URLs
- Vercel auto-deploy: project is `cod-fraud-saas`, root directory = `frontend`, GitHub connected via Dashboard (not CLI). If auto-deploy breaks, deploy manually: `npx vercel --prod --yes` from repo root. `.vercel/project.json` must exist at both root AND `frontend/`. If GitHub check shows "Canceled from Vercel Dashboard", go to Vercel Dashboard → Project Settings → Git → disconnect + reconnect repo.

## Project Structure
```
cod-fraud-saas/
├── backend/               # Node.js API server
│   ├── Dockerfile         # Railway deployment (multi-stage build)
│   ├── src/
│   │   ├── app.ts         # Fastify app setup (CORS, rate limit, JWT) + shopifyRoutes registered
│   │   ├── server.ts      # Entry point + BullMQ worker startup
│   │   ├── config/        # Environment config (index.ts) — includes shopify: {clientId, clientSecret, scopes}
│   │   ├── db/
│   │   │   ├── connection.ts  # PostgreSQL pool + query helper
│   │   │   ├── schema.sql     # Full schema (17 tables incl. shopify_connections, training_events, retrain_jobs)
│   │   │   └── migrate.ts     # Auto-migration with 5 retries + backfill for new columns
│   │   ├── middlewares/    # JWT auth, API key auth, validation, metrics, security
│   │   ├── plugins/       # Platform plugins (Shopify, WooCommerce, Magento, Joomla)
│   │   ├── routes/
│   │   │   ├── webhook.ts         # POST /webhook/:platform — receives orders
│   │   │   ├── orders.routes.ts   # CRUD + override + dispatch + call-outcome + external lookup
│   │   │   ├── scanner.routes.ts  # Return scanner: POST /scan + GET /lookup/:tracking_number
│   │   │   ├── blacklist.routes.ts # Add/list/remove blacklist entries
│   │   │   ├── analytics.routes.ts # Dashboard analytics + RTO report + feedback + performance
│   │   │   ├── auth.ts            # Register, login, profile, plan, API keys
│   │   │   ├── ml.ts              # ML metrics, confusion matrix, thresholds, versions, health, training-stats, retrain-jobs
│   │   │   ├── shopify.routes.ts  # Shopify OAuth (install/callback/status/disconnect)
│   │   │   ├── settings.ts        # Threshold settings
│   │   │   └── health.ts          # /health, /ready, /live, /metrics
│   │   ├── services/
│   │   │   ├── fraud-engine/
│   │   │   │   ├── engine.ts      # FraudEngine class — orchestrates 3-layer scoring
│   │   │   │   ├── rules.ts       # Rule-based scoring (15+ rules)
│   │   │   │   └── statistical.ts # Statistical scoring (phone history, city rates)
│   │   │   ├── ml-client/
│   │   │   │   └── index.ts       # ML HTTP client + toMLFeatures() — maps 48 features
│   │   │   ├── training/
│   │   │   │   └── training-events.ts # createTrainingEvent, updatePhoneStats, getTrainingStats, shouldTriggerRetrain
│   │   │   ├── cron/
│   │   │   │   └── auto-delivered.ts  # Nightly cron: marks dispatched orders >7 days old as delivered (label=0)
│   │   │   ├── phone-normalizer/  # Pakistani phone normalization (+92, 03xx)
│   │   │   ├── cache/             # Redis caching service
│   │   │   ├── queue/
│   │   │   │   └── scoring-queue.ts # BullMQ queue + worker (plan-based priority)
│   │   │   └── metrics/           # Prometheus metrics
│   │   └── types/                 # TypeScript interfaces
│   └── .env.example
├── ml-service/            # Python ML microservice
│   ├── Dockerfile         # Railway deployment — NO training, just installs deps + copies code
│   ├── app.py             # FastAPI server + /predict + /health + pipeline endpoints
│   ├── train.py           # XGBoost+LightGBM ensemble training (v1 basic + v2 with validation/versioning)
│   ├── requirements.txt   # Python deps (xgboost, lightgbm, fastapi, scikit-learn, etc.)
│   ├── startup.sh         # Copies models/latest.joblib → versions/ on start; trains once as fallback if missing
│   ├── models/            # Pre-trained models committed to git (loaded by Docker at startup)
│   │   ├── .gitkeep       # Ensures dir tracked by git
│   │   ├── latest.joblib  # Latest pre-trained model (committed after running train_offline.py)
│   │   └── latest_meta.json # Model metadata (version, metrics, feature_names, optimal_threshold)
│   ├── api/
│   │   ├── predict.py     # Prediction endpoint logic — returns optimal_threshold in response
│   │   └── schemas.py     # Pydantic request/response schemas (PredictionResponse has optimal_threshold)
│   ├── utils/
│   │   └── model_manager.py # Model versioning, loading, comparison — ModelArtifact has optimal_threshold field
│   ├── pipeline/          # ML pipeline package
│   │   ├── __init__.py
│   │   ├── feature_map.py      # 48 features — SINGLE SOURCE OF TRUTH + FEATURE_GROUPS + REQUIRED_FEATURES
│   │   ├── data_collector.py   # Export training data from DB (joins orders+phones+rto)
│   │   ├── data_validator.py   # Clean, validate, impute, check class balance
│   │   ├── data_versioner.py   # Parquet snapshots with metadata tracking
│   │   ├── feature_engineer.py # Interaction + Pakistan seasonal + category features
│   │   ├── feature_analysis.py # Correlation, importance, baseline distributions
│   │   ├── drift_detector.py   # KS test + mean shift drift detection
│   │   └── scheduler.py        # Auto-retrain triggers (drift/performance/scheduled)
│   ├── scripts/
│   │   ├── train_offline.py            # OFFLINE training pipeline — run locally, commit models/
│   │   ├── retrain_from_outcomes.py    # Self-learning retrain from training_events table in DB
│   │   ├── generate_synthetic_data.py  # 30K Pakistan COD-specific samples (48 features)
│   │   ├── export_training_data.py     # CLI for DB data export
│   │   └── run_drift_check.py          # CLI for drift check
│   └── .env.example
├── frontend/              # Next.js 14 dashboard
│   ├── vercel.json        # Vercel deployment config + security headers
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx           # Dashboard — "Revenue Protection Command Center"
│   │   │   ├── orders/page.tsx    # Orders table + filters + override modal
│   │   │   ├── orders/[id]/page.tsx # Order detail + 3-layer risk breakdown
│   │   │   ├── analytics/page.tsx # "Fraud Intelligence Lab" — 4 sections, Export CSV
│   │   │   ├── blacklist/page.tsx # Blacklist CRUD + reason modals
│   │   │   ├── scanner/page.tsx   # Return Scanner — scan tracking number → mark returned → save ML training event
│   │   │   ├── ml/page.tsx        # ML metrics, confusion matrix, feature importance, versions, self-learning progress
│   │   │   ├── settings/page.tsx  # Account, plan, thresholds, API keys, Platform Integrations
│   │   │   ├── billing/page.tsx   # Billing & plan info
│   │   │   └── login/page.tsx     # Login page
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── dashboard-layout.tsx  # Main layout wrapper (lg:pl-64, p-4 sm:p-6)
│   │   │   │   ├── sidebar.tsx           # Nav sidebar — 8 items: Dashboard, Orders, Analytics, Blacklist, Scanner, ML Insights, Settings, Billing
│   │   │   │   ├── Topbar.tsx            # Sticky top bar with hamburger menu (mobile), theme toggle
│   │   │   │   └── StoreSwitcher.tsx     # Store/tenant switcher in topbar
│   │   │   ├── charts/
│   │   │   │   ├── RiskDistributionChart.tsx  # Pie/donut chart
│   │   │   │   ├── RevenueSavedChart.tsx      # Area chart
│   │   │   │   ├── RiskTrendChart.tsx         # Stacked bar chart
│   │   │   │   └── FraudTriggerChart.tsx      # Horizontal bar chart
│   │   │   └── ui/
│   │   │       ├── card.tsx               # Card component (title, subtitle, action)
│   │   │       ├── modal.tsx              # Reusable modal (sm/md/lg, default/danger/warning)
│   │   │       ├── scan-toast.tsx         # Floating barcode scan result toast (auto-dismiss 2.5s)
│   │   │       ├── badge.tsx              # Badge component
│   │   │       ├── stat-card.tsx          # KPI stat card
│   │   │       ├── risk-badge.tsx         # Risk level badge
│   │   │       ├── recommendation-badge.tsx
│   │   │       ├── empty-state.tsx
│   │   │       └── loading.tsx
│   │   ├── context/
│   │   │   ├── ThemeProvider.tsx          # next-themes dark/light
│   │   │   ├── StoreContext.tsx           # Store/tenant state
│   │   │   └── scan-history-context.tsx   # Global scan history (shared between layout + scanner page)
│   │   ├── hooks/
│   │   │   ├── use-auth.ts                # JWT token management
│   │   │   └── use-global-scanner.ts      # Detects physical barcode scanner input (rapid keystrokes < 50ms + Enter)
│   │   └── lib/
│   │       ├── api.ts         # Axios instance + all API functions
│   │       ├── scanner-beep.ts # Web Audio API beep sounds (success/error/warning) — no library
│   │       └── utils.ts       # Utility functions
│   └── .env.example
├── shopify-extension/     # Shopify Admin Extension (order risk badge)
│   ├── README.md          # Partner account setup guide
│   ├── shopify.app.toml   # App config (CLIENT_ID placeholder)
│   ├── package.json
│   └── extensions/
│       └── order-risk-badge/
│           ├── shopify.extension.toml  # targets admin.order-details.block.render
│           └── src/
│               └── OrderRiskBadge.tsx  # Fetches risk data via API key, shows badge
├── docker/                # Docker Compose for local dev + legacy Dockerfiles
├── .github/workflows/ci.yml  # CI pipeline (backend typecheck+build, ML validation, frontend build)
└── infra/                 # Legacy K8s/Nginx configs (not used in Railway deployment)
```

## Key Technical Decisions
- **Fraud Engine**: 3-layer architecture — Rule-based (30%) + Statistical (30%) + ML/XGBoost (40%)
- **48 ML Features**: Aligned between backend `ml-client/index.ts:toMLFeatures()` and ML model via `pipeline/feature_map.py`. 4 groups: A_static_order, B_behavioral_velocity, C_contextual_seasonal, D_derived_interaction
- **REQUIRED_FEATURES**: `[order_amount, is_cod, order_hour]` — inference refused without these
- **ML Ensemble**: XGBoost (30 iter, 5-fold CV, scale_pos_weight) + LightGBM (20 iter, 5-fold CV, class_weight='balanced') + CatBoost (15 iter, 5-fold CV) → soft-voting VotingClassifier
- **Probability Calibration**: `CalibratedClassifierCV(ensemble, cv='prefit', method='isotonic')` on validation set
- **Threshold Optimization**: `find_optimal_threshold()` on val set via precision_recall_curve → maximize F1 (not default 0.5)
- **Offline Training Workflow**: Run `python scripts/train_offline.py` locally → commit `models/latest.joblib` → Railway loads it instantly. MIN_REAL_ORDERS = 3000 before switching to real/hybrid mode.
- **Plugin System**: Adding new e-commerce platforms = add 1 file in `backend/src/plugins/`
- **Multi-tenant**: Tenant isolation via `tenant_id` FK on all tables
- **Auth**: JWT tokens (dashboard login) + API Keys (webhook/API integration)
- **Queue**: BullMQ for async order scoring — plan-based priority (enterprise=1, free=5)
- **ML Pipeline**: Data collection → validation → versioning → training → drift detection → auto-retrain
- **Cold Start Strategy**: Synthetic 30K samples → gradually replaced by real data as orders accumulate (min 3000 real labeled orders needed)
- **Shopify OAuth**: Install → HMAC-verified callback → access_token exchange → webhook registration → saved to `shopify_connections` table

## Database
- PostgreSQL 16 with 17 tables (full schema: `backend/src/db/schema.sql`)
- Key tables: `tenants`, `users`, `orders`, `fraud_scores`, `phones`, `blacklist`, `model_versions`, `prediction_logs`, `performance_snapshots`, `risk_logs`, `api_keys`, `shopify_connections`, `training_events`, `retrain_jobs`
- Auto-migration on startup via `backend/src/db/migrate.ts` (non-fatal, 5 retries)
- **`orders` table new columns**: `tracking_number VARCHAR(100) UNIQUE`, `final_status VARCHAR(20) DEFAULT 'pending'`, `call_confirmed VARCHAR(20)`, `dispatched_at TIMESTAMPTZ`, `returned_at TIMESTAMPTZ`
  - `final_status` = physical delivery state: `pending` → `dispatched` → `delivered` / `returned`
  - `status` = ML/verification decision: `scored` / `approved` / `blocked` / `verified` / `rto` — these two must NEVER be mixed
- **`training_events` table**: Immutable ML dataset. One row per order (UNIQUE on order_id). Fields: `feature_snapshot JSONB` (features at prediction time), `final_label SMALLINT` (0=delivered, 1=returned), `call_confirmed`, `model_version`, `prediction_score`, `prediction_correct BOOLEAN`, `outcome_source VARCHAR(20)` (scanner/cron), `used_in_training BOOLEAN DEFAULT FALSE`
- **`retrain_jobs` table**: History of every retraining run with before/after F1, AUC, model version, promotion decision and reason

## API Endpoints
### Auth
- `POST /api/v1/auth/register` — Register new tenant + user
- `POST /api/v1/auth/login` — Login, returns JWT
- `GET /api/v1/auth/profile` — User profile
- `GET /api/v1/auth/plan` — Plan & usage info
- `GET /api/v1/auth/api-keys` — List API keys
- `POST /api/v1/auth/api-keys` — Generate new API key

### Webhooks
- `POST /api/v1/webhook/:platform` — Receive orders (shopify, woocommerce, magento, joomla)

### Orders
- `GET /api/v1/orders` — List orders (filters: recommendation, search, status, risk_level, sortBy, sortOrder, page, limit)
- `GET /api/v1/orders/:id` — Order detail
- `GET /api/v1/orders/risk/:orderId` — 3-layer risk score breakdown
- `POST /api/v1/orders/:id/override` — Manual override (APPROVE/BLOCK)
- `POST /api/v1/orders/:id/dispatch` — Mark dispatched (body: `tracking_number`). Sets `final_status = 'dispatched'`, does NOT change `status`
- `POST /api/v1/orders/:id/call-outcome` — Save agent call result (body: `call_confirmed: 'yes'|'no'|'no_answer'`)
- `GET /api/v1/orders/external/:platform/:externalOrderId` — External order lookup by API key (for Shopify Extension)

### Scanner
- `POST /api/v1/scanner/scan` — Scan return (body: `tracking_number`). Sets `final_status = 'returned'`, `status = 'rto'`, creates `training_event(label=1)`, updates phone stats. Returns: `{result: 'marked_returned'|'already_processed'|'not_found'}`
- `GET /api/v1/scanner/lookup/:tracking_number` — Preview order before scan (read-only)

### Blacklist
- `POST /api/v1/blacklist` — Add entry (type: phone/email/ip/address/name)
- `GET /api/v1/blacklist` — List entries (filter by type)
- `DELETE /api/v1/blacklist/:id` — Remove entry

### Analytics
- `GET /api/v1/analytics` — Dashboard data (summary, dailyOrders, topFraudSignals, riskDistribution, topRtoCities, platformBreakdown)
- `GET /api/v1/analytics/rto-report` — RTO report
- `POST /api/v1/analytics/rto-feedback` — Delivery outcome feedback
- `GET /api/v1/analytics/performance` — AI performance metrics (falseNegativeRate, falsePositiveRate, overrideRate, repeatOffenderOrders, avgConfidence, fraudVelocityIndex)
- `GET /api/v1/analytics/override-stats` — Override statistics by type + accuracy + reasons

### ML
- `GET /api/v1/ml/metrics` — Model performance (accuracy, precision, recall, F1, AUC-ROC, feature importance)
- `GET /api/v1/ml/confusion-matrix` — Confusion matrix (accepts ?days= param)
- `POST /api/v1/ml/threshold` — Update scoring thresholds (block_threshold, verify_threshold)
- `GET /api/v1/ml/versions` — List model versions
- `GET /api/v1/ml/health` — ML service health status
- `GET /api/v1/ml/performance-history` — Historical performance snapshots
- `POST /api/v1/ml/generate-snapshot` — Trigger performance snapshot
- `GET /api/v1/ml/training-stats` — Self-learning stats: total/unused/label0/label1 outcomes, readyToRetrain flag, last retrain job info
- `GET /api/v1/ml/retrain-jobs` — Last 20 retraining job records (triggered_by, status, F1 before/after, promoted, reason)

### Shopify OAuth
- `GET /api/v1/shopify/install` — Redirect to Shopify OAuth (params: shop, tenant_id)
- `GET /api/v1/shopify/callback` — OAuth callback, HMAC verify, token exchange, webhook registration
- `GET /api/v1/shopify/status` — Connection status (JWT auth)
- `DELETE /api/v1/shopify/disconnect` — Remove connection (JWT auth)

### Settings
- `GET /api/v1/settings/thresholds` — Get current thresholds

### ML Pipeline (on ML service directly, not via backend)
- `GET /pipeline/drift-report` — Feature drift status
- `POST /pipeline/check-retrain` — Check & optionally trigger retrain
- `GET /pipeline/data-snapshots` — Training data versions
- `POST /pipeline/export-data` — Export training data from DB

### Health
- `GET /health` — Basic health check
- `GET /ready` — Readiness probe (DB, Redis, Queue)
- `GET /live` — Liveness probe
- `GET /metrics` — Prometheus metrics

## ML Model
- **Algorithm**: XGBoost + LightGBM + CatBoost soft-voting ensemble with RandomizedSearchCV (30 iter XGB + 20 iter LGB + 15 iter CatBoost, 5-fold CV each), then `CalibratedClassifierCV(isotonic)` on validation set
- **Current metrics**: Accuracy 85.7%, F1 83.3%, AUC-ROC 93.1%, Optimal Threshold 0.4333
- **Training samples**: 50K synthetic (stratified 60/20/20 train/val/test split)
- **Features**: 48 features in 4 groups — A_static_order (order/discount/timing), B_behavioral_velocity (customer history/velocity/account age), C_contextual_seasonal (city rates, Eid/Ramadan/sale periods), D_derived_interaction (combined signals)
- **Pakistan-specific signals**: `is_eid_period` (months 4,6,7), `is_ramadan` (months 3,4), `is_sale_period` (11.11/12.12/Black Friday), `orders_last_1h` (flash fraud detection)
- **Threshold**: Optimized via `precision_recall_curve` on validation set (maximize F1) — stored as `optimal_threshold` in model metadata, not hardcoded 0.5
- **Training data**: 50K synthetic samples (Pakistan COD-specific patterns) — real data transition at 3000+ labeled orders
- **Training workflow**: OFFLINE — run `scripts/train_offline.py` locally, commit `models/latest.joblib`, Railway loads it at startup
- **Drift detection**: KS test + mean shift on feature distributions
- **Feature name alignment**: Backend `toMLFeatures()` MUST match `pipeline/feature_map.py` EXACTLY — both have 48 features
- **Class imbalance**: No SMOTE — uses `scale_pos_weight` (XGBoost), `class_weight='balanced'` (LightGBM), `auto_class_weights='Balanced'` (CatBoost)
- **Memory safety**: `n_jobs=2` for training, `--workers 1` for uvicorn (Railway memory limits)

## Frontend Pages (Navigation Order)
1. **Dashboard** (`/`) — "Revenue Protection Command Center". 5 parallel API calls. Sections: Financial Impact (Capital Protected, Est. Loss Prevented, Net Revenue Saved, Protection ROI with sparklines + prior period delta), Risk Overview (Total Orders, Blocked, Under Review, RTO Rate with color coding), Urgent Review Banner, Trends (Capital Protected trend chart + RTO Rate Comparison), Risk & Intelligence (donut + fraud triggers), Operational Action (urgent orders table + high-risk cities), AI Engine Status (Model Accuracy, F1, Avg Confidence, False Positive Rate, Model Age + Repeat Offenders, Override Rate, Fraud Velocity Index). Period selector: 24h / 7d.
2. **Orders** (`/orders`) — Filterable table (search, risk level, decision, status, sortBy). Override actions use professional modal. Risk summary truncates with info icon. Table wrapped in overflow-x-auto for mobile.
3. **Analytics** (`/analytics`) — "Fraud Intelligence Lab". 4 sections: Performance Metrics (8 KPIs: 4 analytics + 4 ML), Trend Analysis (3 charts + 7/30/90d selector), Fraud Intelligence (signals + platform breakdown + cities table), Advanced (collapsible, 3 Coming Soon cards). Export CSV button.
4. **Blacklist** (`/blacklist`) — CRUD table with type tabs (all/phone/email/ip/address/name). Add form. Reason column shows info icon for long reasons → opens modal.
5. **Scanner** (`/scanner`) — Return scanner status + history page. NO manual input field on the page itself — scanning happens globally from ANY page via `useGlobalScanner` hook in `DashboardLayout`. Physical USB/Bluetooth barcode scanner auto-submits when parcel scanned. Page shows: today's stats (scanned/returns/ML progress), "Manual Entry" collapsible section (fallback for damaged barcodes only), scan history list (tracking number, customer name, risk score, time, status). Audio beep feedback on every scan.
6. **ML Insights** (`/ml`) — Model info, 5 performance metrics, confusion matrix (7d/30d/90d), top 10 feature importance bars, model versions table, service health, **Self-Learning Progress card** (progress bar showing unused outcomes vs 500 threshold, stats: total/delivered/returned/unused, last retrain info).
7. **Settings** (`/settings`) — Account info, plan & usage bar, scoring threshold sliders (visual gradient bar), API key management, Platform Integrations (Shopify OAuth card + WooCommerce/Magento/Joomla/Custom webhook cards with copy URL + expandable instructions).
8. **Billing** (`/billing`) — Full-width. Current plan as a large gradient card with usage bar and days remaining. Plans grid (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`) with bigger cards, popular badge, current plan ring. Improved invoice history table with hover states.
8. **Login** (`/login`) — Split-screen: left dark panel (hidden on mobile) with custom SVG shield logo + feature list; right white panel with form. Show/hide password, labels above inputs, responsive tab switcher.

## UI Components
- **Modal** (`components/ui/modal.tsx`) — Reusable: sizes (sm/md/lg), variants (default/danger/warning), ESC to close, backdrop click to close
- **Card** (`components/ui/card.tsx`) — Has title, subtitle, action props
- **ScanToast** (`components/ui/scan-toast.tsx`) — Floating toast for barcode scan results. Top-right corner, auto-dismisses after 2.5s. States: loading (spinner), returned (red), already_done (yellow), not_found (gray). Shows customer name + risk score on success.
- All pages use full width (no max-w constraints)
- **Fully responsive**: all pages work on mobile/tablet/desktop. Grids use `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` pattern. Headers stack on mobile (`flex-col sm:flex-row`). Sidebar slides in from left on mobile (hamburger in Topbar).

## Sidebar Behavior
- **Desktop collapsed**: `w-[68px]` — shows icons only. Content area uses `lg:pl-[68px]`
- **Desktop expanded**: `w-64` — shows icons + labels. Content area uses `lg:pl-64`
- **Hover-expand**: when collapsed, hovering over sidebar temporarily shows full width (floating, no content shift), with `shadow-2xl`. Leaving collapses back.
- **Toggle button**: at bottom of sidebar — circular arrow button. Left arrow = collapse, Right arrow = expand. Shows "Collapse sidebar" text when open.
- **Mobile**: sidebar slides in from left (hamburger in Topbar), always full width, overlay backdrop
- `collapsed` state lives in `DashboardLayout` and is passed as props to `Sidebar`
- Active nav item: shows blue dot indicator on the right

## api.ts — All Exported API Objects
```typescript
authApi      — login, register
ordersApi    — list, get, getRisk, override, dispatch(id, tracking_number), callOutcome(id, call_confirmed, notes?)
blacklistApi — list, add, remove
mlApi        — metrics, confusionMatrix, threshold, versions, health, performanceHistory, generateSnapshot, trainingStats(), retrainJobs()
analyticsApi — dashboard, rtoReport, submitFeedback, overrideStats, performance
scannerApi   — scan(tracking_number), lookup(tracking_number)
shopifyApi   — status, disconnect
```

## Common Commands
```bash
# Frontend
cd frontend && npm run dev          # Dev server
cd frontend && npm run build        # Build (also validates types)

# Backend
cd backend && npm run dev           # Dev server
cd backend && npm run build         # Compile TypeScript
cd backend && npm run typecheck     # Type check only

# ML Service
cd ml-service && uvicorn app:app --port 8000           # Run server

# Offline training (run locally, then commit models/)
python scripts/train_offline.py --mode synthetic --samples 50000  # Train on 50K synthetic data (recommended)
python scripts/train_offline.py --mode real                       # Train on real DB data (needs 3000+ orders)
python scripts/train_offline.py --mode hybrid                     # Train on synthetic + real combined
python scripts/train_offline.py --check-real-data                 # Check if enough real data exists
python scripts/train_offline.py --no-calibrate                    # Skip probability calibration
python scripts/train_offline.py --target-recall 0.85              # Set recall target for threshold

# After training, commit the model:
git add ml-service/models/latest.joblib ml-service/models/latest_meta.json
git commit -m "Update pre-trained model"
git push origin main  # Railway will load new model on next startup

# Self-learning retrain from real delivery outcomes (run from ml-service/)
python scripts/retrain_from_outcomes.py --tenant-id <uuid>   # Retrain for one tenant
python scripts/retrain_from_outcomes.py --all-tenants         # Retrain all tenants with 100+ events
python scripts/retrain_from_outcomes.py --tenant-id <uuid> --dry-run  # Check data without training

# Other ML commands
python scripts/generate_synthetic_data.py --n 30000    # Generate synthetic training data
python train.py --csv data/training_data.csv           # Legacy train (v1)
python scripts/run_drift_check.py                       # Check drift
python scripts/export_training_data.py                  # Export from DB

# Git (all changes auto-deploy)
git add <files> && git commit -m "message" && git push origin main

# Vercel manual deploy (when auto-deploy broken)
vercel --prod --yes   # run from repo root (not frontend dir)
```

## Important Rules for Claude
1. **All changes go through GitHub push** — Owner tests on production (Railway/Vercel), not locally
2. **Never add Co-Authored-By** in commit messages — owner explicitly rejected this
3. **Respond in English** but understand owner speaks Roman Urdu
4. **Build before pushing** — Always run `npm run build` (frontend or backend) to verify before git push
5. **Do not run local Docker** — Owner said "localy run kernay ki zarot nhi hy"
6. **Professional quality** — Owner explicitly said "please act a professional" — demo-ready product
7. **Never use `-uall` flag** with git status (can cause memory issues on large repos)
8. **Mobile first** — All frontend changes must be responsive (mobile/tablet/laptop/large screen)
9. **Minimize comments** — Owner said no unnecessary comments or explanations in code, just code

## Global Barcode Scanner Architecture
Physical USB/Bluetooth barcode scanners work as **keyboard emulators** — OS treats them as keyboards. When a barcode is scanned, the device types the value + Enter into whatever is focused.

**Implementation** (zero dependencies, no library):
- `hooks/use-global-scanner.ts` — attaches `document.addEventListener('keydown', ...)` at layout level
- Detects scanner pattern: characters arriving < 50ms apart = scanner input; > 100ms gap = human typing
- Only fires when no `INPUT`/`TEXTAREA`/`SELECT` is focused (avoids intercepting manual form input)
- Minimum 6 chars required to be treated as a valid tracking number
- On Enter → calls `scannerApi.scan(trackingNumber)` → updates DB, creates training_event

**Audio feedback** (`lib/scanner-beep.ts`) — Web Audio API oscillator, no npm package:
- `beepSuccess()` — high-pitch short beep (return recorded ✓)
- `beepWarning()` — medium beep (already processed ⚠)
- `beepError()` — two low beeps (not found ✗)

**Scan history** — `context/scan-history-context.tsx` React context (in-memory, session only):
- `DashboardLayout` writes to context on every scan
- `/scanner` page reads from context to display today's history

**Manual fallback** on `/scanner` page — collapsible section for damaged barcodes. Calls same `scannerApi.scan()` endpoint.

**Staff workflow**: Open any dashboard page → scanner auto-captures from anywhere → toast appears 2.5s → beeps → done. No `/scanner` page visit required.

## Self-Learning ML Feedback Loop
The system collects real delivery outcomes to continuously improve the ML model:

**Flow**: Order scored → `POST /orders/:id/dispatch` (sets `final_status = 'dispatched'`) → returned parcel scanned → `POST /scanner/scan` (sets `final_status = 'returned'`, `status = 'rto'`, creates `training_event(label=1)`) OR nightly cron auto-marks as delivered after 7 days (creates `training_event(label=0)`). When 500 unused outcomes accumulate → run `retrain_from_outcomes.py`.

**Key rules**:
- Blocked orders are NEVER dispatched → never enter training_events (avoids label leakage)
- `final_label`: 0 = delivered (customer kept order), 1 = returned/RTO (fraud signal)
- `call_confirmed` is a FEATURE passed to ML, NOT the ground truth label
- `feature_snapshot` from `fraud_scores.ml_features` is saved at prediction time (prevents training/serving skew)
- Scanner uses tracking_number (unique per order) as the lookup key
- `ON CONFLICT (order_id) DO NOTHING` on training_events insert — exactly-once guarantee

**Retraining** (`ml-service/scripts/retrain_from_outcomes.py`):
- Reads `training_events` from PostgreSQL for a tenant
- Min checks: 100 samples, 5-95% class balance
- Trains XGBoost+LightGBM VotingClassifier with calibration
- Champion/Challenger: promotes if `new_f1 >= current_f1 - 0.01`
- CLI: `--tenant-id <uuid>`, `--all-tenants`, `--dry-run`

**Nightly cron** (`backend/src/services/cron/auto-delivered.ts`):
- Runs at 2AM UTC via `setInterval` checking every 5 min if UTC hour == 2
- Finds orders with `final_status = 'dispatched'` AND `dispatched_at < NOW() - 7 days`
- Creates `training_event(label=0, outcome_source='cron')` + updates phone stats

## Known Fixed Issues (Don't Re-Introduce)
- BullMQ Redis must include password from URL (`scoring-queue.ts` line 13-18)
- **ML Dockerfile must NOT train** — training was removed to avoid build timeouts. Training is now done offline via `scripts/train_offline.py`, model committed to `models/`
- **No SMOTE** — removed because it caused build timeouts and memory issues. Use `scale_pos_weight` (XGB) + `class_weight='balanced'` (LGB) + `auto_class_weights='Balanced'` (CatBoost) instead
- Migration must be non-fatal (exits 0 even on failure, 5 retries)
- Backend CORS must use `CORS_ORIGINS` env var in production
- `shap` package commented out in requirements.txt (requires cmake, fails in CI)
- External order lookup (`/orders/external/:platform/:id`) uses `o.risk_score, o.risk_level, o.recommendation` from orders table — NOT from fraud_scores table (those columns don't exist on fraud_scores)
- Fraud signal field from analytics API is `signal_name` (not `signal` or `signal_type`)
- Vercel deploy must be run from repo root with `.vercel/project.json` present — not from `frontend/` directory
- VotingClassifier does NOT have `feature_importances_` directly — must average across `model.estimators_` (np.mean of all estimators' feature_importances_)
- **CI feature count assertion is 48** (not 35) — `assert len(FEATURE_NAMES) == 48` in `.github/workflows/ci.yml`
- **`/api/v1/ml/metrics` response structure**: returns `{ active, model_info: {version, model_type, trained_at, training_samples, feature_count}, performance: {accuracy, precision, recall, f1_score, auc_roc}, feature_importance: [{feature, importance}] }`. Frontend reads `mlMetrics.performance.accuracy`, `mlMetrics.model_info.version` etc. — NOT flat top-level keys
- **`/api/v1/ml/metrics` DB fallback**: if `model_versions` table is empty, falls back to calling ML service `/model/info` directly — so metrics always show even without DB entry
- **`/api/v1/ml/confusion-matrix` response**: flat fields `{true_positives, true_negatives, false_positives, false_negatives, total}` — not nested under `confusionMatrix` object
- **Dispatch endpoint must NOT set `status`** — `POST /orders/:id/dispatch` only sets `tracking_number`, `final_status = 'dispatched'`, `dispatched_at`. Never change `status` (ML/verification decision) here — they are orthogonal fields
- **`final_status` backfill** — `ALTER TABLE ADD COLUMN DEFAULT 'pending'` sets NULL for existing rows (no NOT NULL constraint). Migration includes `UPDATE orders SET final_status = 'pending' WHERE final_status IS NULL` to fix this
- **Scanner does NOT need its own input field** — `useGlobalScanner` in `DashboardLayout` captures from any page. The `/scanner` page is for history + manual fallback only, not for primary scanning
- **Do not add input auto-focus to scanner page** — focus should stay free so global scanner can always capture barcode input from any page
- **Physical barcode scanner = keyboard emulator** — no library (ZXing, QuaggaJS, etc.) needed for hardware scanners. Libraries are only for camera-based scanning which is less reliable in warehouse settings

## Shopify Extension Setup (Pending)
The `shopify-extension/` directory is ready but needs:
1. Create Shopify Partner account at partners.shopify.com
2. Create new app → get Client ID + Secret
3. Set Redirect URI to `https://cod-fraud-saas-production.up.railway.app/api/v1/shopify/callback`
4. Add `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` to Railway backend env vars
5. Run `npm run dev` in `shopify-extension/` with Shopify CLI to test on dev store
