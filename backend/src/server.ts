import { loadConfig } from './config/env.js';
import { createDatabasePool } from './config/db.js';
import { createApp } from './app.js';

const config = loadConfig();
const pool = createDatabasePool(config);
const app = createApp(config, pool);
const server = app.listen(config.PORT, () => console.log(`Hunter System API listening on ${config.PORT}`));

async function shutdown() {
  server.close();
  await pool.end();
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
