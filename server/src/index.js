import { getPool, runMigrations, closePool } from './db.js';
import { createApp } from './app.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

async function main() {
  const pool = getPool();
  await runMigrations(pool);
  console.log('[db] migrations OK');

  const app = createApp({ pool });
  const server = app.listen(PORT, () => {
    console.log(`kaupangr-server listening on http://localhost:${PORT}`);
    console.log(`database: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@') || '(unset)'}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[server] fatal:', e.message);
  process.exit(1);
});
