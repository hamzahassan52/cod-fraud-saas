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
