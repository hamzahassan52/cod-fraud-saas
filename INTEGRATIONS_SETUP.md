# Platform Integration Setup Guide

## WooCommerce Setup

### Step 1 — Get Your API Key
1. Login to your COD Fraud Shield dashboard: https://cod-fraud-saas.vercel.app
2. Go to **Settings → API Keys**
3. Click **Generate Key** — copy the full key (shown once only), e.g. `cfr_abc123...`

### Step 2 — Generate a Webhook Secret
Create any strong random string (min 8 chars), e.g. `mystore-wh-secret-2024`
- This is NOT your API key — it is a separate HMAC signing secret
- You will enter this in both WooCommerce AND COD Fraud Shield settings

### Step 3 — Save Secret in COD Fraud Shield
1. Go to **Settings → Platform Integrations → WooCommerce**
2. In the **Webhook HMAC Secret** field, enter your secret string
3. Click **Save** — you will see a green "Configured" badge

### Step 4 — Configure WooCommerce Webhook
1. WordPress Admin → **WooCommerce → Settings → Advanced → Webhooks**
2. Click **Add webhook**
3. Fill in:
   - **Name**: COD Fraud Shield
   - **Status**: Active
   - **Topic**: Order created
   - **Delivery URL**: (replace YOUR_API_KEY with your actual key)
     ```
     https://cod-fraud-saas-production.up.railway.app/api/v1/webhook/woocommerce?api_key=YOUR_API_KEY
     ```
   - **Secret**: paste the same secret string from Step 2
   - **API Version**: WP REST API Integration v3
4. Click **Save webhook**

### Step 5 — Test
Place a test order on your WooCommerce store → check COD Fraud Shield Orders page — it should appear within seconds with a risk score.

---

## Shopify Setup

> **Note**: Requires a Shopify Partner account and app credentials. Complete this when ready.

### Step 1 — Create Shopify Partner App
1. Go to https://partners.shopify.com → create account if needed
2. Apps → Create app → Custom app
3. Set **App URL**: `https://cod-fraud-saas-production.up.railway.app`
4. Set **Allowed redirection URL**: `https://cod-fraud-saas-production.up.railway.app/api/v1/shopify/callback`
5. Under **API access** → enable these scopes:
   - `read_orders`
   - `write_orders`
   - `read_customers`
6. Copy **Client ID** and **Client secret**

### Step 2 — Add to Railway Environment Variables
In Railway → Backend service → Variables:
```
SHOPIFY_CLIENT_ID     = your_client_id_here
SHOPIFY_CLIENT_SECRET = shpss_your_secret_here
SHOPIFY_SCOPES        = read_orders,write_orders,read_customers
```
Railway will auto-redeploy after saving.

### Step 3 — Connect Your Shopify Store
1. Go to **Settings → Platform Integrations → Shopify**
2. Click **Connect**
3. Enter your store URL: `yourstore.myshopify.com`
4. You will be redirected to Shopify to authorize the app
5. After authorization, you return to dashboard — store shows as Connected
6. Last 50 orders are automatically backfilled and scored in the background

### Step 4 — Verify Webhook
1. In Settings → Shopify card → click **Test Webhook**
2. Should show green: "Webhook active — https://cod-fraud-saas-production.up.railway.app/..."

---

## Security Architecture

### WooCommerce — Dual Layer Auth
```
Request flow:
WooCommerce → POST /webhook/woocommerce?api_key=cfr_xxx
               └── Header: X-WC-Webhook-Signature: base64(HMAC-SHA256(body, secret))

Backend checks:
1. api_key in URL → finds tenant in DB (who is this?)
2. HMAC signature → verifies request is from WooCommerce (is it real?)
   - If wrong HMAC → 401 Unauthorized (forged request rejected)
   - If no secret configured → signature check skipped (setup mode)
```

### Shopify — HMAC Verification
```
Request flow:
Shopify → POST /webhook/shopify
          └── Header: X-Shopify-HMAC-SHA256: base64(HMAC-SHA256(body, SHOPIFY_CLIENT_SECRET))

Backend checks:
1. X-API-Key header → finds tenant in DB
2. HMAC signature using SHOPIFY_CLIENT_SECRET → mandatory, 401 if invalid
   - Returns 503 if SHOPIFY_CLIENT_SECRET not set in Railway env vars
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Invalid API key` | API key wrong or missing | Check ?api_key= in delivery URL |
| `401 Invalid webhook signature` | HMAC secret mismatch | Check secret is same in WooCommerce + COD Fraud Shield settings |
| `503 SHOPIFY_CLIENT_SECRET not configured` | Railway env var missing | Add SHOPIFY_CLIENT_SECRET to Railway variables |
| `400 Failed to parse order` | Webhook body format wrong | Check WooCommerce API version is v3 |
| Order not appearing | Scoring in queue | Wait 5-10 seconds, refresh Orders page |

---

## Quick Reference

| Platform | Auth Method | Webhook URL Format |
|----------|-------------|-------------------|
| Shopify | `X-API-Key` header + HMAC | `POST /webhook/shopify` |
| WooCommerce | `?api_key=` in URL + HMAC | `POST /webhook/woocommerce?api_key=cfr_xxx` |
| Custom API | `X-API-Key` header | `POST /webhook/api` |

**Backend API base**: `https://cod-fraud-saas-production.up.railway.app/api/v1`
**Dashboard**: `https://cod-fraud-saas.vercel.app`
