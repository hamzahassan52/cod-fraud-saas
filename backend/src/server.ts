import { buildApp } from './app';
import { config } from './config';
import { startScoringWorker } from './services/queue/scoring-queue';
import { closePool } from './db/connection';
import { closeRedis } from './services/cache/redis';
import { generateAllSnapshots } from './services/performance-tracker';
import { runAutoDeliveredCron } from './services/cron/auto-delivered';
import { runRecoveryCron } from './services/cron/recovery';

async function main() {
  const app = await buildApp();

  // Start BullMQ scoring worker
  const worker = startScoringWorker();
  console.log(`Scoring worker started (concurrency: ${config.queue.concurrency})`);

  // Start server
  try {
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    });
    console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║   COD Fraud Detection API - v1.0.0               ║
  ║   Running on: http://${config.server.host}:${config.server.port}        ║
  ║   Environment: ${config.server.env.padEnd(33)}║
  ║   ML Service: ${config.ml.serviceUrl.padEnd(34)}║
  ╚═══════════════════════════════════════════════════╝
    `);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Weekly performance snapshot cron (every Sunday at midnight)
  const snapshotInterval = setInterval(async () => {
    const now = new Date();
    if (now.getUTCDay() === 0 && now.getUTCHours() === 0) {
      console.log('Running weekly performance snapshot generation...');
      try {
        await generateAllSnapshots();
        console.log('Weekly snapshots generated successfully');
      } catch (err) {
        console.error('Failed to generate weekly snapshots:', err);
      }
    }
  }, 60 * 60 * 1000); // Check every hour
  console.log('Weekly performance snapshot cron scheduled');

  // Nightly auto-delivered cron (runs at 2:00 AM UTC every day)
  // Orders dispatched 7+ days ago with no return scan → marked as delivered
  const autoDeliveredInterval = setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() === 2 && now.getUTCMinutes() < 5) {
      try {
        await runAutoDeliveredCron();
      } catch (err) {
        console.error('Auto-delivered cron failed:', err);
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
  console.log('Auto-delivered cron scheduled (runs nightly at 2:00 AM UTC)');

  // Recovery cron: re-queue unscored orders every 5 minutes (zero order loss safety net)
  const recoveryInterval = setInterval(async () => {
    try {
      await runRecoveryCron();
    } catch (err) {
      console.error('Recovery cron failed:', err);
    }
  }, 5 * 60 * 1000);
  console.log('Recovery cron scheduled (runs every 5 minutes)');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    clearInterval(snapshotInterval);
    clearInterval(autoDeliveredInterval);
    clearInterval(recoveryInterval);
    await worker.close();
    await app.close();
    await closeRedis();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
