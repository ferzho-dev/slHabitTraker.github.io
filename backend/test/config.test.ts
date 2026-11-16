import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { databasePoolOptions } from '../src/config/db.js';
import { ENVIRONMENT_VARIABLES, loadConfig } from '../src/config/env.js';

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'development', PORT: '8787',
  FRONTEND_ORIGIN: 'http://localhost:5173', FRONTEND_SUCCESS_URL: 'http://localhost:5173/?notion=connected',
  FRONTEND_ERROR_URL: 'http://localhost:5173/?notion=error', SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-placeholder', DATABASE_URL: 'postgresql://api:password@db.example.com/postgres',
  DATABASE_SSL_CA_BASE64: '',
  NOTION_CLIENT_ID: 'client-id-placeholder', NOTION_CLIENT_SECRET: 'server-secret-placeholder',
  NOTION_REDIRECT_URI: 'http://localhost:8787/api/notion/oauth/callback', NOTION_AUTH_URL: 'https://api.notion.com/v1/oauth/authorize',
  NOTION_VERSION: '2026-03-11', TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 4).toString('base64'),
  OAUTH_STATE_TTL_SECONDS: '600',
};

test('required backend configuration validates and decodes the encryption key to 32 bytes', () => {
  const config = loadConfig(base);
  assert.equal(config.PORT, 8787);
  assert.equal(Buffer.from(config.TOKEN_ENCRYPTION_KEY_BASE64, 'base64').length, 32);
  assert.throws(() => loadConfig({ ...base, DATABASE_URL: '' }));
  assert.throws(() => loadConfig({ ...base, TOKEN_ENCRYPTION_KEY_BASE64: 'short' }));
});

test('production configuration refuses non-HTTPS browser and OAuth return URLs', () => {
  const caBase64 = Buffer.from(rootCertificates[0]!, 'utf8').toString('base64');
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }));
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://hunter.example',
    FRONTEND_SUCCESS_URL: 'https://hunter.example/?notion=connected', FRONTEND_ERROR_URL: 'https://hunter.example/?notion=error',
    DATABASE_SSL_CA_BASE64: caBase64 }));
  assert.doesNotThrow(() => loadConfig({ ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://hunter.example',
    FRONTEND_SUCCESS_URL: 'https://hunter.example/?notion=connected', FRONTEND_ERROR_URL: 'https://hunter.example/?notion=error',
    NOTION_REDIRECT_URI: 'https://api.hunter.example/api/notion/oauth/callback', DATABASE_SSL_CA_BASE64: caBase64 }));
});

test('production requires a valid CA and passes it to pg TLS with verification enabled', () => {
  const ca = rootCertificates[0]!;
  const validProduction = { ...base, NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://hunter.example',
    FRONTEND_SUCCESS_URL: 'https://hunter.example/', FRONTEND_ERROR_URL: 'https://hunter.example/?notion=error',
    NOTION_REDIRECT_URI: 'https://api.hunter.example/api/notion/oauth/callback',
    DATABASE_SSL_CA_BASE64: Buffer.from(ca, 'utf8').toString('base64') };
  assert.throws(() => loadConfig({ ...validProduction, DATABASE_SSL_CA_BASE64: '' }), /required in production/);
  const config = loadConfig(validProduction);
  const options = databasePoolOptions(config);
  assert.deepEqual(options.ssl, { ca, rejectUnauthorized: true });
  assert.throws(() => loadConfig({ ...validProduction, DATABASE_SSL_CA_BASE64: Buffer.from('not a cert').toString('base64') }), /PEM CA certificate/);
});

test('DATABASE_URL rejects SSL query parameters and .env.example matches the config schema', () => {
  const config = loadConfig(base);
  for (const parameter of ['sslmode=require', 'sslcert=x', 'sslkey=x', 'sslrootcert=x', 'SSLMODE=require']) {
    assert.throws(() => loadConfig({ ...base, DATABASE_URL: `${base.DATABASE_URL}?${parameter}` }), /must not contain SSL parameter/);
  }
  assert.ok(config.DATABASE_URL);
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const keys = example.split(/\r?\n/).map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1]).filter(Boolean).sort();
  assert.deepEqual(keys, ENVIRONMENT_VARIABLES);
});
