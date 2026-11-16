import type { RequestHandler } from 'express';
import type { SupabaseAuthService } from '../services/supabase-auth-service.js';

export function requireAuth(auth: SupabaseAuthService): RequestHandler {
  return async (req, res, next) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+([^\s]+)$/i.exec(header);
    if (!match) { res.status(401).json({ error: 'unauthorized' }); return; }
    try { req.authUser = await auth.authenticate(match[1]!); next(); }
    catch { res.status(401).json({ error: 'invalid_or_expired_session' }); }
  };
}
