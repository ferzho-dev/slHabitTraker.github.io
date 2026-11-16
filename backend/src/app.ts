import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from './config/env.js';
import type { Pool } from 'pg';
import { SupabaseAuthService } from './services/supabase-auth-service.js';
import { OAuthStateRepository } from './repositories/oauth-state-repository.js';
import { OAuthTicketRepository } from './repositories/oauth-ticket-repository.js';
import { ConnectionRepository } from './repositories/connection-repository.js';
import { OperationsLedgerRepository } from './repositories/operations-ledger-repository.js';
import { createNotionRouter } from './controllers/notion-controller.js';
import { HttpError } from './utils/errors.js';

export function createApp(config: AppConfig, db: Pool, overrides: {
  auth?: SupabaseAuthService; states?: OAuthStateRepository; tickets?: OAuthTicketRepository; connections?: ConnectionRepository;
  ledger?: OperationsLedgerRepository; fetcher?: typeof fetch;
} = {}) {
  const auth = overrides.auth ?? new SupabaseAuthService(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.NODE_ENV === 'production' ? 1 : false);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use((_req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
  app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: false, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Authorization','Content-Type','Idempotency-Key'] }));
  app.use(express.json({ limit: '32kb', strict: true }));
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const oauthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'rate_limit_exceeded' } });
  const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'rate_limit_exceeded' } });
  app.use('/api/notion', apiLimiter);
  app.use('/api/notion/oauth', oauthLimiter);
  app.use('/api/notion', createNotionRouter({ config,
    states: overrides.states ?? new OAuthStateRepository(db),
    tickets: overrides.tickets ?? new OAuthTicketRepository(db),
    connections: overrides.connections ?? new ConnectionRepository(db),
    ledger: overrides.ledger ?? new OperationsLedgerRepository(db), auth,
    ...(overrides.fetcher ? { fetcher: overrides.fetcher } : {}),
  }));

  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
    if (error?.name === 'ZodError') { res.status(400).json({ error: 'invalid_request' }); return; }
    console.error('Request failed', error instanceof Error ? error.name : 'unknown_error');
    res.status(500).json({ error: 'internal_server_error' });
  };
  app.use(errors);
  return app;
}
