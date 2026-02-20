# COD Fraud Shield — Shopify Admin Extension

Shows real-time COD fraud risk scores on Shopify order detail pages.

## Setup

### 1. Create Shopify Partner Account
Go to https://partners.shopify.com and sign up or log in.

### 2. Create a New App
- Dashboard → Apps → Create app → Custom app
- Name: "COD Fraud Shield"
- App URL: `https://cod-fraud-saas-production.up.railway.app`
- Redirect URL: `https://cod-fraud-saas-production.up.railway.app/api/v1/shopify/callback`
- Copy the **Client ID** and **Client Secret**

### 3. Add Environment Variables to Railway
In Railway backend service → Variables:
```
SHOPIFY_CLIENT_ID=your_client_id_here
SHOPIFY_CLIENT_SECRET=your_client_secret_here
SHOPIFY_SCOPES=read_orders
```

### 4. Update shopify.app.toml
Replace `YOUR_SHOPIFY_CLIENT_ID` with your actual client ID.

### 5. Install Shopify CLI
```bash
npm install -g @shopify/cli
```

### 6. Run Locally (Dev Store)
```bash
cd shopify-extension
npm install
shopify app dev
```

### 7. Deploy Extension
```bash
shopify app deploy
```

## How It Works
1. Merchant connects their Shopify store via Settings → Integrations → Connect Shopify
2. This triggers OAuth → our backend saves the access token + registers an `orders/create` webhook
3. When a new order is placed on Shopify, it hits our webhook, gets scored by the fraud engine
4. Merchant opens the order in Shopify Admin → the extension displays the risk score, level, and recommendation
5. Merchant clicks "View Full Analysis" to see the full 3-layer breakdown on the COD Fraud Shield dashboard

## Extension Settings (per merchant)
- **COD Fraud Shield API Key**: from Settings → API Keys on the dashboard
- **API Base URL**: `https://cod-fraud-saas-production.up.railway.app` (default)
