import { z } from 'zod';
import { createSecureContext } from 'node:tls';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  FRONTEND_ORIGIN: z.string().url(),
  FRONTEND_SUCCESS_URL: z.string().url(),
  FRONTEND_ERROR_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_CA_BASE64: z.preprocess((value) => value === '' ? undefined : value, z.string().optional()),
  NOTION_CLIENT_ID: z.string().min(1),
  NOTION_CLIENT_SECRET: z.string().min(1),
  NOTION_REDIRECT_URI: z.string().url(),
  NOTION_AUTH_URL: z.string().url().default('https://api.notion.com/v1/oauth/authorize'),
  NOTION_VERSION: z.string().default('2026-03-11'),
  TOKEN_ENCRYPTION_KEY_BASE64: z.string().min(1),
  OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
});
export const ENVIRONMENT_VARIABLES = Object.keys(schema.shape).sort();

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = schema.parse(source);
  const key = Buffer.from(config.TOKEN_ENCRYPTION_KEY_BASE64, 'base64');
  if (key.length !== 32 || key.toString('base64') !== config.TOKEN_ENCRYPTION_KEY_BASE64) {
    throw new Error('TOKEN_ENCRYPTION_KEY_BASE64 must be a canonical base64 encoding of exactly 32 bytes');
  }
  if (config.NODE_ENV === 'production' && new URL(config.FRONTEND_ORIGIN).protocol !== 'https:') {
    throw new Error('FRONTEND_ORIGIN must use HTTPS in production');
  }
  if (config.NODE_ENV === 'production' && new URL(config.NOTION_REDIRECT_URI).protocol !== 'https:') {
    throw new Error('NOTION_REDIRECT_URI must use HTTPS in production');
  }
  const databaseUrl = new URL(config.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  const sslParameters = new Set(['sslmode', 'sslcert', 'sslkey', 'sslrootcert']);
  for (const parameter of databaseUrl.searchParams.keys()) {
    if (sslParameters.has(parameter.toLowerCase())) throw new Error(`DATABASE_URL must not contain SSL parameter ${parameter}; configure TLS with DATABASE_SSL_CA_BASE64`);
  }
  if (config.NODE_ENV === 'production' && !config.DATABASE_SSL_CA_BASE64) {
    throw new Error('DATABASE_SSL_CA_BASE64 is required in production');
  }
  if (config.DATABASE_SSL_CA_BASE64) {
    const ca = Buffer.from(config.DATABASE_SSL_CA_BASE64, 'base64');
    if (ca.length === 0 || ca.toString('base64') !== config.DATABASE_SSL_CA_BASE64) {
      throw new Error('DATABASE_SSL_CA_BASE64 must be canonical base64');
    }
    const pem = ca.toString('utf8');
    if (!pem.includes('-----BEGIN CERTIFICATE-----') || !pem.includes('-----END CERTIFICATE-----')) {
      throw new Error('DATABASE_SSL_CA_BASE64 must contain a PEM CA certificate');
    }
    try { createSecureContext({ ca: pem }); }
    catch { throw new Error('DATABASE_SSL_CA_BASE64 is not a valid CA certificate'); }
  }
  return config;
}
