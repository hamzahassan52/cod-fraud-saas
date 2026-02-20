import dotenv from 'dotenv';
dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  db: {
    url: process.env.DATABASE_URL || 'postgresql://codfraud:codfraud_secret@localhost:5432/codfraud_db',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  ml: {
    serviceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  },
  webhookSecrets: {
    shopify: process.env.SHOPIFY_WEBHOOK_SECRET || '',
    woocommerce: process.env.WOOCOMMERCE_WEBHOOK_SECRET || '',
    magento: process.env.MAGENTO_WEBHOOK_SECRET || '',
  },
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    window: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
  },
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
  },
  encryption: {
    apiKeySecret: process.env.API_KEY_ENCRYPTION_SECRET || 'dev-encryption-key-32-bytes-long!',
  },
  shopify: {
    clientId: process.env.SHOPIFY_CLIENT_ID || '',
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
    scopes: process.env.SHOPIFY_SCOPES || 'read_orders',
  },
} as const;
