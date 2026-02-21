/**
 * Database migration script
 * Runs schema.sql against the database, creating tables if they don't exist.
 * Safe to run multiple times (idempotent).
 * Non-fatal: if migration fails, logs error but exits 0 so server can still start.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://codfraud:codfraud_secret@localhost:5432/codfraud_db';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function migrate() {
  console.log('Starting database migration...');
  console.log('DATABASE_URL host:', DATABASE_URL.replace(/\/\/.*@/, '//***@'));

  const pool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });

  // Retry up to 5 times (DB might still be starting)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      // Check if tables already exist
      const { rows } = await pool.query(`
        SELECT COUNT(*) as count FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenants'
      `);

      if (parseInt(rows[0].count) > 0) {
        console.log('Database tables already exist. Running incremental updates...');

        const alterStatements = [
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS recommendation_reasons JSONB DEFAULT '[]'`,
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS risk_summary TEXT`,
          // Dispatch & delivery tracking
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100)`,
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_status VARCHAR(20) DEFAULT 'pending'`,
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS call_confirmed VARCHAR(20)`,
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMP WITH TIME ZONE`,
          `ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP WITH TIME ZONE`,
          // Unique index for tracking_number (only if not exists)
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_unique ON orders(tracking_number) WHERE tracking_number IS NOT NULL`,
          `CREATE INDEX IF NOT EXISTS idx_orders_final_status ON orders(tenant_id, final_status, created_at DESC)`,
        ];

        for (const stmt of alterStatements) {
          await pool.query(stmt);
        }

        await pool.query(`
          CREATE TABLE IF NOT EXISTS prediction_logs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            order_id UUID NOT NULL REFERENCES orders(id),
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            risk_score DECIMAL(5,2),
            recommendation VARCHAR(20),
            rule_score DECIMAL(5,2),
            statistical_score DECIMAL(5,2),
            ml_score DECIMAL(5,2),
            ml_model_version VARCHAR(50),
            ml_top_factors JSONB DEFAULT '[]',
            recommendation_reasons JSONB DEFAULT '[]',
            risk_summary TEXT,
            confidence DECIMAL(5,4),
            scoring_duration_ms INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS performance_snapshots (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            period_type VARCHAR(20) DEFAULT 'weekly',
            total_orders INTEGER DEFAULT 0,
            total_blocked INTEGER DEFAULT 0,
            total_approved INTEGER DEFAULT 0,
            total_verified INTEGER DEFAULT 0,
            blocked_rto INTEGER DEFAULT 0,
            blocked_delivered INTEGER DEFAULT 0,
            approved_rto INTEGER DEFAULT 0,
            approved_delivered INTEGER DEFAULT 0,
            precision_at_block DECIMAL(5,4),
            recall DECIMAL(5,4),
            f1_score DECIMAL(5,4),
            avg_risk_score DECIMAL(5,2),
            model_version VARCHAR(50),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(tenant_id, period_start, period_type)
          )
        `);

        await pool.query(`
          CREATE TABLE IF NOT EXISTS shopify_connections (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            shop VARCHAR(255) NOT NULL,
            access_token TEXT NOT NULL,
            scopes TEXT,
            webhook_id VARCHAR(255),
            installed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(tenant_id),
            UNIQUE(shop)
          )
        `);

        // ML self-learning: training events (immutable outcome dataset)
        await pool.query(`
          CREATE TABLE IF NOT EXISTS training_events (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            feature_snapshot JSONB NOT NULL,
            final_label SMALLINT NOT NULL CHECK (final_label IN (0, 1)),
            call_confirmed VARCHAR(20),
            model_version VARCHAR(50),
            prediction_score DECIMAL(6,5),
            prediction_correct BOOLEAN,
            outcome_source VARCHAR(20) NOT NULL DEFAULT 'scanner',
            used_in_training BOOLEAN NOT NULL DEFAULT FALSE,
            retrain_job_id UUID,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(order_id)
          )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_events_tenant ON training_events(tenant_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_events_unused ON training_events(tenant_id, used_in_training, created_at) WHERE used_in_training = FALSE`);

        // ML retraining job history
        await pool.query(`
          CREATE TABLE IF NOT EXISTS retrain_jobs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            triggered_by VARCHAR(30) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            total_events INT,
            new_events_count INT,
            class_0_count INT,
            class_1_count INT,
            previous_model_version VARCHAR(50),
            new_model_version VARCHAR(50),
            previous_f1 DECIMAL(6,5),
            new_f1 DECIMAL(6,5),
            previous_auc DECIMAL(6,5),
            new_auc DECIMAL(6,5),
            promoted BOOLEAN,
            promotion_reason TEXT,
            rejection_reason TEXT,
            started_at TIMESTAMP WITH TIME ZONE,
            completed_at TIMESTAMP WITH TIME ZONE,
            error_message TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `);

        console.log('Migration complete (incremental).');
      } else {
        // Fresh database — run full schema
        const schemaPath = join(__dirname, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf-8');
        await pool.query(schema);
        console.log('Full schema applied successfully.');
      }

      await pool.end();
      return; // Success — exit function
    } catch (err: any) {
      console.error(`Migration attempt ${attempt}/5 failed:`, err.message);
      if (attempt < 5) {
        console.log(`Retrying in ${attempt * 3} seconds...`);
        await sleep(attempt * 3000);
      }
    }
  }

  // All retries failed — still exit 0 so server starts
  console.warn('Migration failed after 5 attempts. Server will start without migration.');
  try { await pool.end(); } catch {}
}

migrate();
