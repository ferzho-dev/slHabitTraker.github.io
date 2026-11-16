import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import type { OAuthStateRepository } from '../repositories/oauth-state-repository.js';
import type { OAuthTicketRepository } from '../repositories/oauth-ticket-repository.js';
import type { ConnectionRepository } from '../repositories/connection-repository.js';
import type { OperationsLedgerRepository } from '../repositories/operations-ledger-repository.js';
import { requireAuth } from '../middleware/require-auth.js';
import type { SupabaseAuthService } from '../services/supabase-auth-service.js';
import { decryptSecret, encryptSecret, hashState, newOAuthState, newOAuthTicket } from '../utils/crypto.js';
import { HttpError } from '../utils/errors.js';
import { NotionOAuthService } from '../services/notion-oauth-service.js';
import { NotionApi } from '../services/notion-api.js';
import { NotionDiscoveryService } from '../services/notion-discovery-service.js';

const emptyBody = z.object({}).strict();
const ticketBody = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const validateBody = z.object({ rootPageId: z.string().uuid().optional() }).strict();
const idempotencyBody = z.object({ idempotencyKey: z.string().min(8).max(200), operationType: z.string().min(1).max(80), payloadHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function createNotionRouter(deps: {
  config: AppConfig; states: OAuthStateRepository; connections: ConnectionRepository;
  tickets: OAuthTicketRepository; ledger: OperationsLedgerRepository; auth: SupabaseAuthService; oauth?: NotionOAuthService; fetcher?: typeof fetch;
}) {
  const { config, states, tickets, connections, ledger } = deps;
  const oauth = deps.oauth ?? new NotionOAuthService(config, deps.fetcher);
  const router = Router();
  const authenticated = requireAuth(deps.auth);

  router.get('/status', authenticated, async (req, res, next) => {
    try { res.json({ connection: await connections.statusForUser(req.authUser!.id) }); }
    catch (error) { next(error); }
  });

  router.get('/roots', authenticated, async (req, res, next) => {
    try {
      const connection = await connections.getForUser(req.authUser!.id);
      if (!connection?.access_token_encrypted || !['connected','needs_setup'].includes(connection.status)) {
        throw new HttpError(409, 'Primero conecta tu workspace de Notion.', 'notion_not_connected');
      }
      const api = new NotionApi(decryptSecret(connection.access_token_encrypted, config.TOKEN_ENCRYPTION_KEY_BASE64), config.NOTION_VERSION, deps.fetcher);
      const roots = await new NotionDiscoveryService(api).findRoots();
      res.json({ roots, duplicatedTemplateId: connection.duplicated_template_id });
    } catch (error) { next(error); }
  });

  router.post('/oauth/start', authenticated, async (req, res, next) => {
    try {
      emptyBody.parse(req.body);
      const state = newOAuthState();
      await states.create(hashState(state), req.authUser!.id, config.OAUTH_STATE_TTL_SECONDS);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ authorizationUrl: oauth.authorizationUrl(state) });
    } catch (error) { next(error); }
  });

  // State is consumed once and maps the provider callback to the initiating
  // Supabase UUID. The short-lived ticket is minted only after code exchange.
  router.get('/oauth/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const providerError = typeof req.query.error === 'string' ? req.query.error : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) {
      res.redirect(303, withResult(config.FRONTEND_ERROR_URL, 'invalid_state'));
      return;
    }
    let userId: string | null = null;
    try { userId = await states.consumeOnce(hashState(state)); }
    catch { res.redirect(303, withResult(config.FRONTEND_ERROR_URL, 'server_error')); return; }
    if (!userId) { res.redirect(303, withResult(config.FRONTEND_ERROR_URL, 'expired_or_reused_state')); return; }
    if (providerError) { res.redirect(303, withResult(config.FRONTEND_ERROR_URL, 'authorization_cancelled')); return; }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || code.length > 4096) { res.redirect(303, withResult(config.FRONTEND_ERROR_URL, 'missing_code')); return; }
    try {
      const token = await oauth.exchangeCode(code);
      const ticket = newOAuthTicket();
      await tickets.create({
        state_hash: hashState(state), supabase_user_id: userId,
        workspace_id: token.workspace_id, workspace_name: token.workspace_name, workspace_icon: token.workspace_icon,
        bot_id: token.bot_id, owner_metadata: (token.owner ?? {}) as Record<string, unknown>,
        duplicated_template_id: token.duplicated_template_id,
        access_token_encrypted: encryptSecret(token.access_token, config.TOKEN_ENCRYPTION_KEY_BASE64),
        refresh_token_encrypted: encryptSecret(token.refresh_token!, config.TOKEN_ENCRYPTION_KEY_BASE64),
      }, hashState(ticket), 180);
      res.redirect(303, withTicket(config.FRONTEND_SUCCESS_URL, ticket));
    } catch {
      res.redirect(303, withResult(config.FRONTEND_ERROR_URL, 'notion_authorization_failed'));
    }
  });

  router.post('/oauth/finalize', authenticated, async (req, res, next) => {
    try {
      const { ticket } = ticketBody.parse(req.body);
      const connectionId = await connections.finalizeOAuthTicket(hashState(ticket), req.authUser!.id);
      try {
        const connection = await connections.getForUser(req.authUser!.id);
        if (!connection?.access_token_encrypted) throw new Error('connection_missing_after_finalize');
        const discovery = new NotionDiscoveryService(new NotionApi(
          decryptSecret(connection.access_token_encrypted, config.TOKEN_ENCRYPTION_KEY_BASE64), config.NOTION_VERSION, deps.fetcher));
        const result = await discovery.discover(connection.duplicated_template_id ?? undefined);
        await connections.saveDataSources(connectionId, result.sources.map((source) => ({ ...source, schemaVersion: config.NOTION_VERSION })));
        const complete = result.errors.length === 0 && result.sources.length === 11;
        await connections.setStatus(connectionId, complete ? 'connected' : 'needs_setup');
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ok: true, status: complete ? 'connected' : 'needs_setup' });
      } catch {
        await connections.setStatus(connectionId, 'needs_setup');
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ok: true, status: 'needs_setup' });
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'oauth_ticket_invalid_expired_or_used') {
        res.status(409).json({ error: 'oauth_ticket_invalid_expired_or_used' }); return;
      }
      next(error);
    }
  });

  router.post('/oauth/refresh', authenticated, async (req, res, next) => {
    try {
      emptyBody.parse(req.body);
      const connection = await refreshConnection(req.authUser!.id, { config, connections, oauth });
      res.json({ ok: true, workspace: { id: connection.workspace_id, name: connection.workspace_name } });
    } catch (error) { next(error); }
  });

  router.post('/disconnect', authenticated, async (req, res, next) => {
    try {
      emptyBody.parse(req.body);
      const existing = await connections.getForUser(req.authUser!.id);
      let revokeFailed = false;
      if (existing?.access_token_encrypted) {
        const token = decryptSecret(existing.access_token_encrypted, config.TOKEN_ENCRYPTION_KEY_BASE64);
        try { await oauth.revoke(token); } catch { revokeFailed = true; }
      }
      await connections.disconnect(req.authUser!.id);
      res.json({ ok: true, providerRevocationRequested: !revokeFailed });
    } catch (error) { next(error); }
  });

  router.post('/validate', authenticated, async (req, res, next) => {
    try {
      const { rootPageId } = validateBody.parse(req.body);
      let connection = await connections.getForUser(req.authUser!.id);
      if (!connection || !['connected','needs_setup'].includes(connection.status) || !connection.access_token_encrypted) {
        throw new HttpError(409, 'No hay una conexión activa de Notion para este usuario.', 'notion_not_connected');
      }
      let discovery;
      try {
        discovery = new NotionDiscoveryService(new NotionApi(
          decryptSecret(connection.access_token_encrypted, config.TOKEN_ENCRYPTION_KEY_BASE64), config.NOTION_VERSION, deps.fetcher));
        var result = await discovery.discover(rootPageId ?? connection.duplicated_template_id ?? undefined);
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('http_401'))) throw error;
        connection = await refreshConnection(req.authUser!.id, { config, connections, oauth });
        discovery = new NotionDiscoveryService(new NotionApi(
          decryptSecret(connection.access_token_encrypted!, config.TOKEN_ENCRYPTION_KEY_BASE64), config.NOTION_VERSION, deps.fetcher));
        result = await discovery.discover(rootPageId ?? connection.duplicated_template_id ?? undefined);
      }
      await connections.saveDataSources(connection.connection_id, result.sources.map((source) => ({ ...source, schemaVersion: config.NOTION_VERSION })));
      const complete = result.errors.length === 0 && result.sources.length === 11;
      await connections.setStatus(connection.connection_id, complete ? 'connected' : 'needs_setup');
      res.json({ complete, rootPageFound: Boolean(result.rootPageId), found: result.sources.map((source) => source.logicalName), issues: result.errors });
    } catch (error) { next(error); }
  });

  // Foundation for upcoming writes: keys are namespaced by the verified user.
  router.post('/operations/reserve', authenticated, async (req, res, next) => {
    try {
      const body = idempotencyBody.parse(req.body);
      const result = await ledger.reserve({ userId: req.authUser!.id, key: body.idempotencyKey,
        operationType: body.operationType, payloadHash: body.payloadHash });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { next(error); }
  });

  return router;
}

function withResult(base: string, result: string): string {
  const url = new URL(base); url.searchParams.set('notion', result); return url.toString();
}

function withTicket(base: string, ticket: string): string {
  const url = new URL(base);
  url.hash = new URLSearchParams({ notion_ticket: ticket }).toString();
  return url.toString();
}

async function refreshConnection(userId: string, deps: {
  config: AppConfig; connections: ConnectionRepository; oauth: NotionOAuthService;
}) {
  return deps.connections.withConnectionLock(userId, async (client, connection) => {
    if (!connection.refresh_token_encrypted) throw new HttpError(409, 'Vuelve a autorizar Notion.', 'reauthorization_required');
    const oldRefreshToken = decryptSecret(connection.refresh_token_encrypted, deps.config.TOKEN_ENCRYPTION_KEY_BASE64);
    let token;
    try { token = await deps.oauth.refresh(oldRefreshToken); }
    catch (error) {
      if (error instanceof Error && /notion_oauth_http_(400|401)/.test(error.message)) {
        await client.query(`UPDATE app_private.notion_connections SET status='reauthorization_required',updated_at=now() WHERE connection_id=$1::uuid`, [connection.connection_id]);
        throw new HttpError(401, 'Notion requiere volver a autorizar la conexión.', 'reauthorization_required');
      }
      throw error;
    }
    await client.query(
      `UPDATE app_private.notion_connections SET access_token_encrypted=$2, refresh_token_encrypted=$3,
       status=$4, updated_at=now() WHERE connection_id=$1::uuid`,
      [connection.connection_id, encryptSecret(token.access_token, deps.config.TOKEN_ENCRYPTION_KEY_BASE64),
        encryptSecret(token.refresh_token!, deps.config.TOKEN_ENCRYPTION_KEY_BASE64),
        connection.status === 'needs_setup' ? 'needs_setup' : 'connected']);
    return { ...connection, access_token_encrypted: encryptSecret(token.access_token, deps.config.TOKEN_ENCRYPTION_KEY_BASE64),
      refresh_token_encrypted: encryptSecret(token.refresh_token!, deps.config.TOKEN_ENCRYPTION_KEY_BASE64),
      status: connection.status === 'needs_setup' ? 'needs_setup' : 'connected' };
  });
}
