import pg, { type PoolConfig } from 'pg';
import type { AppConfig } from './env.js';

const { Pool } = pg;

export function databasePoolOptions(config: AppConfig): PoolConfig {
  return {
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL_CA_BASE64
      ? { ca: Buffer.from(config.DATABASE_SSL_CA_BASE64, 'base64').toString('utf8'), rejectUnauthorized: true }
      : undefined,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };
}

export function createDatabasePool(config: AppConfig) {
  const pool = new Pool(databasePoolOptions(config));
  pool.on('error', () => console.error('Unexpected idle PostgreSQL connection error'));
  return pool;
}
