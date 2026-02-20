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
| Test | hamza007g1@gmail.com | fast4400F | f73751a1-00b8-499d-9b33-2d41339b5539 | enterprise | Test account |

- Demo API Key: `cfr_f90e29815c9d40f6b7b4dd43e5017fe4`
- Demo account has 15 realistic Pakistani COD orders pre-loaded

## Architecture
- **Backend**: Node.js + TypeScript + Fastify + PostgreSQL + Redis + BullMQ
- **ML Service**: Python + FastAPI + XGBoost (separate microservice)
- **Frontend**: Next.js 14 + Tailwind CSS + Recharts + next-themes (dark mode)
- **Deployment**: Vercel (frontend) + Railway (backend + ML + Postgres + Redis)
- **CI/CD**: Push to `main` branch → auto-deploy everywhere

## Deployment Details

### Railway Services
| Service | Type | Notes |
|---------|------|-------|
| Backend | Dockerfile | Runs migration on startup, then starts Fastify + BullMQ worker |
| ML Service | Dockerfile | Trains model during Docker build, serves via uvicorn |
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
- ML model trains during Docker build: `RUN python scripts/generate_synthetic_data.py --n 20000 && python train.py --csv data/training_data.csv`
- Backend CORS uses `CORS_ORIGINS` env var in production, `true` in development
- **DO NOT use Railway internal networking** (`*.railway.internal`) — it's unreliable, use public URLs
- Vercel auto-deploy from GitHub can disconnect — if broken, deploy manually: `vercel --prod --yes` from repo root (not frontend dir). `.vercel/project.json` must exist at root.

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
│   │   │   ├── schema.sql     # Full schema (15 tables incl. shopify_connections)
│   │   │   └── migrate.ts     # Auto-migration with 5 retries
│   │   ├── middlewares/    # JWT auth, API key auth, validation, metrics, security
│   │   ├── plugins/       # Platform plugins (Shopify, WooCommerce, Magento, Joomla)
│   │   ├── routes/
│   │   │   ├── webhook.ts         # POST /webhook/:platform — receives orders
│   │   │   ├── orders.routes.ts   # CRUD + override + risk breakdown + external lookup
│   │   │   ├── blacklist.routes.ts # Add/list/remove blacklist entries
│   │   │   ├── analytics.routes.ts # Dashboard analytics + RTO report + feedback + performance
│   │   │   ├── auth.ts            # Register, login, profile, plan, API keys
│   │   │   ├── ml.ts              # ML metrics, confusion matrix, thresholds, versions, health
│   │   │   ├── shopify.routes.ts  # NEW — Shopify OAuth (install/callback/status/disconnect)
│   │   │   ├── settings.ts        # Threshold settings
│   │   │   └── health.ts          # /health, /ready, /live, /metrics
│   │   ├── services/
│   │   │   ├── fraud-engine/
│   │   │   │   ├── engine.ts      # FraudEngine class — orchestrates 3-layer scoring
│   │   │   │   ├── rules.ts       # Rule-based scoring (15+ rules)
│   │   │   │   └── statistical.ts # Statistical scoring (phone history, city rates)
│   │   │   ├── ml-client/
│   │   │   │   └── index.ts       # ML HTTP client + toMLFeatures() — maps 35 features
│   │   │   ├── phone-normalizer/  # Pakistani phone normalization (+92, 03xx)
│   │   │   ├── cache/             # Redis caching service
│   │   │   ├── queue/
│   │   │   │   └── scoring-queue.ts # BullMQ queue + worker (plan-based priority)
│   │   │   └── metrics/           # Prometheus metrics
│   │   └── types/                 # TypeScript interfaces
│   └── .env.example
├── ml-service/            # Python ML microservice
│   ├── Dockerfile         # Railway deployment (trains model at build time)
│   ├── app.py             # FastAPI server + /predict + /health + pipeline endpoints
│   ├── train.py           # XGBoost training (v1 basic + v2 with validation/versioning)
│   ├── requirements.txt   # Python deps (xgboost, fastapi, scikit-learn, etc.)
│   ├── startup.sh         # Fallback startup (trains if no model exists)
│   ├── api/
│   │   ├── predict.py     # Prediction endpoint logic
│   │   └── schemas.py     # Pydantic request/response schemas
│   ├── utils/
│   │   └── model_manager.py # Model versioning, loading, comparison
│   ├── pipeline/          # ML pipeline package
│   │   ├── __init__.py
│   │   ├── feature_map.py      # 35 feature names — SINGLE SOURCE OF TRUTH
│   │   ├── data_collector.py   # Export training data from DB (joins orders+phones+rto)
│   │   ├── data_validator.py   # Clean, validate, impute, check class balance
│   │   ├── data_versioner.py   # Parquet snapshots with metadata tracking
│   │   ├── feature_engineer.py # Interaction + Pakistan seasonal + category features
│   │   ├── feature_analysis.py # Correlation, importance, baseline distributions
│   │   ├── drift_detector.py   # KS test + mean shift drift detection
│   │   └── scheduler.py        # Auto-retrain triggers (drift/performance/scheduled)
│   ├── scripts/
│   │   ├── generate_synthetic_data.py  # 20K Pakistan COD-specific samples
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
│   │   │   ├── ml/page.tsx        # ML metrics, confusion matrix, feature importance, versions
│   │   │   ├── settings/page.tsx  # Account, plan, thresholds, API keys, Platform Integrations
│   │   │   ├── billing/page.tsx   # Billing & plan info
│   │   │   └── login/page.tsx     # Login page
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── dashboard-layout.tsx  # Main layout wrapper (lg:pl-64, p-4 sm:p-6)
│   │   │   │   ├── sidebar.tsx           # Nav sidebar — 7 items: Dashboard, Orders, Analytics, Blacklist, ML Insights, Settings, Billing
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
│   │   │       ├── badge.tsx              # Badge component
│   │   │       ├── stat-card.tsx          # KPI stat card
│   │   │       ├── risk-badge.tsx         # Risk level badge
│   │   │       ├── recommendation-badge.tsx
│   │   │       ├── empty-state.tsx
│   │   │       └── loading.tsx
│   │   ├── context/       # ThemeProvider (next-themes), StoreContext
│   │   ├── hooks/         # useAuth (JWT token management)
│   │   └── lib/
│   │       ├── api.ts     # Axios instance + all API functions
│   │       └── utils.ts   # Utility functions
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
- **35 ML Features**: Aligned between backend `ml-client/index.ts:toMLFeatures()` and ML model via `pipeline/feature_map.py`
- **Plugin System**: Adding new e-commerce platforms = add 1 file in `backend/src/plugins/`
- **Multi-tenant**: Tenant isolation via `tenant_id` FK on all tables
- **Auth**: JWT tokens (dashboard login) + API Keys (webhook/API integration)
- **Queue**: BullMQ for async order scoring — plan-based priority (enterprise=1, free=5)
- **ML Pipeline**: Data collection → validation → versioning → training → drift detection → auto-retrain
- **Cold Start Strategy**: Synthetic 20K samples (82.85% accuracy) → gradually replaced by real data as orders accumulate
- **Shopify OAuth**: Install → HMAC-verified callback → access_token exchange → webhook registration → saved to `shopify_connections` table

## Database
- PostgreSQL 16 with 15 tables (full schema: `backend/src/db/schema.sql`)
- Key tables: `tenants`, `users`, `orders`, `fraud_scores`, `phones`, `blacklist`, `model_versions`, `prediction_logs`, `performance_snapshots`, `risk_logs`, `api_keys`, `shopify_connections`
- Auto-migration on startup via `backend/src/db/migrate.ts` (non-fatal, 5 retries)

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
- `GET /api/v1/orders/external/:platform/:externalOrderId` — External order lookup by API key (for Shopify Extension)

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
- **Algorithm**: XGBoost binary classifier with RandomizedSearchCV (100 iterations, 10-fold CV)
- **Features**: 35 features covering order, customer, phone, city, product, and interaction signals
- **Current accuracy**: 82.85% (AUC-ROC: 89.26%) on synthetic Pakistan COD data
- **Training data**: 20K synthetic samples with Pakistan-specific patterns (Eid, Ramadan, city RTO rates, product categories)
- **Drift detection**: KS test + mean shift on feature distributions
- **Feature name alignment**: Backend `toMLFeatures()` must match `pipeline/feature_map.py` exactly

## Frontend Pages (Navigation Order)
1. **Dashboard** (`/`) — "Revenue Protection Command Center". 5 parallel API calls. Sections: Financial Impact (Capital Protected, Est. Loss Prevented, Net Revenue Saved, Protection ROI with sparklines + prior period delta), Risk Overview (Total Orders, Blocked, Under Review, RTO Rate with color coding), Urgent Review Banner, Trends (Capital Protected trend chart + RTO Rate Comparison), Risk & Intelligence (donut + fraud triggers), Operational Action (urgent orders table + high-risk cities), AI Engine Status (Model Accuracy, F1, Avg Confidence, False Positive Rate, Model Age + Repeat Offenders, Override Rate, Fraud Velocity Index). Period selector: 24h / 7d.
2. **Orders** (`/orders`) — Filterable table (search, risk level, decision, status, sortBy). Override actions use professional modal. Risk summary truncates with info icon. Table wrapped in overflow-x-auto for mobile.
3. **Analytics** (`/analytics`) — "Fraud Intelligence Lab". 4 sections: Performance Metrics (8 KPIs: 4 analytics + 4 ML), Trend Analysis (3 charts + 7/30/90d selector), Fraud Intelligence (signals + platform breakdown + cities table), Advanced (collapsible, 3 Coming Soon cards). Export CSV button.
4. **Blacklist** (`/blacklist`) — CRUD table with type tabs (all/phone/email/ip/address/name). Add form. Reason column shows info icon for long reasons → opens modal.
5. **ML Insights** (`/ml`) — Model info, 5 performance metrics, confusion matrix (7d/30d/90d), top 10 feature importance bars, model versions table, service health.
6. **Settings** (`/settings`) — Account info, plan & usage bar, scoring threshold sliders (visual gradient bar), API key management, Platform Integrations (Shopify OAuth card + WooCommerce/Magento/Joomla/Custom webhook cards with copy URL + expandable instructions).
7. **Billing** (`/billing`) — Full-width. Current plan as a large gradient card with usage bar and days remaining. Plans grid (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`) with bigger cards, popular badge, current plan ring. Improved invoice history table with hover states.
8. **Login** (`/login`) — Split-screen: left dark panel (hidden on mobile) with custom SVG shield logo + feature list; right white panel with form. Show/hide password, labels above inputs, responsive tab switcher.

## UI Components
- **Modal** (`components/ui/modal.tsx`) — Reusable: sizes (sm/md/lg), variants (default/danger/warning), ESC to close, backdrop click to close
- **Card** (`components/ui/card.tsx`) — Has title, subtitle, action props
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
authApi    — login, register
ordersApi  — list, get, getRisk, override
blacklistApi — list, add, remove
mlApi      — metrics, confusionMatrix, threshold, versions, health, performanceHistory, generateSnapshot
analyticsApi — dashboard, rtoReport, submitFeedback, overrideStats, performance
shopifyApi — status, disconnect
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
python scripts/generate_synthetic_data.py --n 20000    # Generate data
python train.py --csv data/training_data.csv           # Train model
python train.py --v2                                    # Train with validation
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

## Known Fixed Issues (Don't Re-Introduce)
- BullMQ Redis must include password from URL (`scoring-queue.ts` line 13-18)
- ML Dockerfile must use `--csv` flag: `python train.py --csv data/training_data.csv` (no DB at build time)
- Migration must be non-fatal (exits 0 even on failure, 5 retries)
- Backend CORS must use `CORS_ORIGINS` env var in production
- `shap` package commented out in requirements.txt (requires cmake, fails in CI)
- External order lookup (`/orders/external/:platform/:id`) uses `o.risk_score, o.risk_level, o.recommendation` from orders table — NOT from fraud_scores table (those columns don't exist on fraud_scores)
- Fraud signal field from analytics API is `signal_name` (not `signal` or `signal_type`)
- Vercel deploy must be run from repo root with `.vercel/project.json` present — not from `frontend/` directory

## Shopify Extension Setup (Pending)
The `shopify-extension/` directory is ready but needs:
1. Create Shopify Partner account at partners.shopify.com
2. Create new app → get Client ID + Secret
3. Set Redirect URI to `https://cod-fraud-saas-production.up.railway.app/api/v1/shopify/callback`
4. Add `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` to Railway backend env vars
5. Run `npm run dev` in `shopify-extension/` with Shopify CLI to test on dev store
