import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppConfig } from '../src/config/env.js';
import { encryptSecret, decryptSecret, hashState, newOAuthTicket } from '../src/utils/crypto.js';
import { SupabaseAuthService } from '../src/services/supabase-auth-service.js';
import { NotionOAuthService } from '../src/services/notion-oauth-service.js';
import { NotionApi } from '../src/services/notion-api.js';
import { NotionDiscoveryService } from '../src/services/notion-discovery-service.js';
import { OAuthStateRepository } from '../src/repositories/oauth-state-repository.js';
import { ConnectionRepository } from '../src/repositories/connection-repository.js';
import { OperationsLedgerRepository } from '../src/repositories/operations-ledger-repository.js';
import { DATA_BASES, REQUIRED_RELATIONS, REQUIRED_TYPES } from '../src/services/notion-schema-contract.js';
import { createNotionRouter } from '../src/controllers/notion-controller.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const config = {
  NODE_ENV: 'test', PORT: 0, FRONTEND_ORIGIN: 'http://localhost:5173',
  FRONTEND_SUCCESS_URL: 'http://localhost:5173/?notion=connected', FRONTEND_ERROR_URL: 'http://localhost:5173/?notion=error',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-publishable', DATABASE_URL: 'postgresql://unused',
  NOTION_CLIENT_ID: 'client-id', NOTION_CLIENT_SECRET: 'client-secret', NOTION_REDIRECT_URI: 'http://localhost:8787/api/notion/oauth/callback',
  NOTION_AUTH_URL: 'https://api.notion.com/v1/oauth/authorize', NOTION_VERSION: '2026-03-11',
  TOKEN_ENCRYPTION_KEY_BASE64: KEY, OAUTH_STATE_TTL_SECONDS: 600,
} as AppConfig;
const ALICE = '9a9e92da-80e1-4b3d-b2da-64777f1db6e1';
const BOB = '3c128830-4aeb-40b3-83d7-61a790a2c5a9';

test('access and refresh tokens are authenticated encrypted envelopes', () => {
  const encrypted = encryptSecret('notion-token-secret', KEY);
  assert.notEqual(encrypted, 'notion-token-secret');
  assert.equal(decryptSecret(encrypted, KEY), 'notion-token-secret');
  assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 9).toString('base64')));
});

test('Supabase Auth adapter accepts only provider-verified JWTs', async () => {
  const auth = new SupabaseAuthService(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY,
    async (jwt) => jwt === 'valid-signed-session' ? ALICE : null);
  assert.deepEqual(await auth.authenticate('valid-signed-session'), { id: ALICE });
  await assert.rejects(auth.authenticate('forged-or-expired'));
});

test('Notion OAuth exchanges and rotates tokens server-side with Basic credentials', async () => {
  const calls: Array<{ url: string; body: any; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
    return Response.json({ access_token: 'access', refresh_token: 'refresh', bot_id: 'bot', workspace_id: 'workspace',
      workspace_name: 'Private workspace', workspace_icon: null, owner: { type: 'user' }, duplicated_template_id: null });
  };
  const oauth = new NotionOAuthService(config, fetcher);
  await oauth.exchangeCode('one-time-code');
  await oauth.refresh('old-refresh');
  assert.equal(calls[0]!.body.grant_type, 'authorization_code');
  assert.equal(calls[0]!.body.redirect_uri, config.NOTION_REDIRECT_URI);
  assert.equal(calls[1]!.body.grant_type, 'refresh_token');
  assert.match(calls[0]!.headers.get('authorization')!, /^Basic /);
});

function mockNotionFetch(): typeof fetch {
  const databaseId = new Map<string, string>();
  const dataSourceId = new Map<string, string>();
  DATA_BASES.forEach((name, index) => { databaseId.set(name, `db-${index}`); dataSourceId.set(name, `ds-${index}`); });
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/oauth/token')) {
      return Response.json({ access_token: 'access-secret', refresh_token: 'refresh-secret', bot_id: 'bot-123',
        workspace_id: 'workspace-123', workspace_name: 'Alice workspace', workspace_icon: null,
        owner: { type: 'user', user: { id: 'notion-user' } }, duplicated_template_id: null });
    }
    if (url.pathname === '/v1/search') return Response.json({ results: [{ object: 'page', id: 'root-page', properties: {
      Name: { type: 'title', title: [{ plain_text: 'HUNTER SYSTEM — Datos' }] },
    } }], has_more: false });
    if (url.pathname === '/v1/pages/template-page') return Response.json({ object: 'page', id: 'template-page', properties: {
      Name: { type: 'title', title: [{ plain_text: 'HUNTER SYSTEM — Datos' }] },
    } });
    if (/^\/v1\/blocks\/(root-page|template-page)\/children$/.test(url.pathname)) {
      return Response.json({ results: DATA_BASES.map((name) => ({ object: 'block', id: databaseId.get(name), type: 'child_database', child_database: { title: name } })), has_more: false });
    }
    const databaseMatch = /^\/v1\/databases\/(db-\d+)$/.exec(url.pathname);
    if (databaseMatch) {
      const index = Number(databaseMatch[1]!.slice(3));
      return Response.json({ object: 'database', id: databaseMatch[1], data_sources: [{ id: `ds-${index}` }] });
    }
    const dataSourceMatch = /^\/v1\/data_sources\/(ds-\d+)$/.exec(url.pathname);
    if (dataSourceMatch) {
      const index = Number(dataSourceMatch[1]!.slice(3));
      const logical = DATA_BASES[index]!;
      const properties: Record<string, any> = { Name: { type: 'title', title: {} } };
      let n = 0;
      for (const type of REQUIRED_TYPES[logical]) if (type !== 'title') properties[`Field ${++n}`] = { type, [type]: {} };
      for (const target of REQUIRED_RELATIONS[logical] ?? []) {
        const targetIndex = DATA_BASES.indexOf(target);
        properties[`Relation ${++n}`] = { type: 'relation', relation: { database_id: `db-${targetIndex}`, data_source_id: `ds-${targetIndex}` } };
      }
      return Response.json({ object: 'data_source', id: dataSourceMatch[1], properties });
    }
    return Response.json({ object: 'error', message: 'not found' }, { status: 404 });
  };
}

test('OAuth state is user-bound, expires, is single-use, and latest attempt wins per user', async () => {
  const rows = new Map<string, { userId: string; expiresAt: number; consumed: boolean }>();
  const execute = async (sql: string, params: any[] = []) => {
    if (sql.includes('UPDATE app_private.oauth_states SET consumed_at=now()')) {
      for (const row of rows.values()) if (row.userId === params[0] && !row.consumed) row.consumed = true;
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO app_private.oauth_states')) {
      rows.set(params[0], { userId: params[1], expiresAt: Date.now() + params[2] * 1000, consumed: false }); return { rows: [] };
    }
    if (sql.includes('UPDATE app_private.oauth_states')) {
      const row = rows.get(params[0]);
      if (!row || row.consumed || row.expiresAt <= Date.now() || (params[1] && row.userId !== params[1])) return { rows: [] };
      row.consumed = true; return { rows: [{ supabase_user_id: row.userId }] };
    }
    return { rows: [] };
  };
  const fakeDb = { async query(sql: string, params: any[]) { return execute(sql, params); }, async connect() {
    return { query: execute, release() {} };
  } } as any;
  const repository = new OAuthStateRepository(fakeDb);
  const first = hashState('browser-state-a');
  const second = hashState('browser-state-b');
  await repository.create(first, ALICE, 600);
  assert.match(newOAuthTicket(), /^[A-Za-z0-9_-]{43}$/);
  await repository.create(second, ALICE, 600);
  assert.equal(await repository.consumeOnce(first), null);
  assert.equal(await repository.consumeOnce(second), ALICE);
  assert.equal(await repository.consumeOnce(second), null);
  const expired = hashState('expired');
  await repository.create(expired, BOB, -1);
  assert.equal(await repository.consumeOnce(expired), null);
});

test('connection lookup is scoped to the authenticated Supabase UUID, never a client supplied connection ID', async () => {
  const users = new Map([[ALICE, { connection_id: 'alice-connection', workspace_name: 'Alice workspace', status: 'connected' }],
    [BOB, { connection_id: 'bob-connection', workspace_name: 'Bob workspace', status: 'connected' }]]);
  const fakeDb = { async query(sql: string, params: string[]) {
    assert.match(sql, /WHERE supabase_user_id = \$1::uuid/);
    return { rows: users.has(params[0]!) ? [users.get(params[0]!)!] : [] };
  } } as any;
  const repository = new ConnectionRepository(fakeDb);
  assert.equal((await repository.getForUser(ALICE))!.workspace_name, 'Alice workspace');
  assert.equal((await repository.getForUser(BOB))!.workspace_name, 'Bob workspace');
  assert.notEqual((await repository.getForUser(ALICE))!.connection_id, (await repository.getForUser(BOB))!.connection_id);
});

test('operation ledger replays the same key for the same user and rejects payload changes', async () => {
  const rows = new Map<string, any>();
  const fakeDb = { async query(sql: string, params: any[]) {
    const key = `${params[0]}:${params[1]}`;
    if (sql.includes('INSERT INTO app_private.operations_ledger')) {
      if (rows.has(key)) return { rows: [] };
      const row = { operation_id: `op-${rows.size + 1}`, status: 'pending', payload_hash: params[3] };
      rows.set(key, row); return { rows: [row] };
    }
    if (sql.includes('SELECT operation_id')) return { rows: rows.has(key) ? [rows.get(key)] : [] };
    return { rows: [] };
  } } as any;
  const ledger = new OperationsLedgerRepository(fakeDb);
  const base = { userId: ALICE, key: 'weekly-write-001', operationType: 'habit_completion', payloadHash: 'a'.repeat(64) };
  assert.equal((await ledger.reserve(base)).created, true);
  assert.equal((await ledger.reserve(base)).created, false);
  await assert.rejects(ledger.reserve({ ...base, payloadHash: 'b'.repeat(64) }), /idempotency_key_payload_conflict/);
  assert.equal((await ledger.reserve({ ...base, userId: BOB })).created, true);
});

test('disconnect removes per-user discovery records and clears both stored token envelopes', async () => {
  const statements: string[] = [];
  const connection = { connection_id: 'conn-alice', supabase_user_id: ALICE,
    access_token_encrypted: 'ciphertext-a', refresh_token_encrypted: 'ciphertext-r' };
  const fakeDb = { async connect() {
    return { async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT * FROM app_private.notion_connections')) return { rows: [connection] };
      if (sql.includes("status='disconnected'")) { connection.access_token_encrypted = null; connection.refresh_token_encrypted = null; }
      return { rows: [] };
    }, release() {} };
  } } as any;
  const repo = new ConnectionRepository(fakeDb);
  await repo.disconnect(ALICE);
  assert.ok(statements.some((sql) => sql.includes('DELETE FROM app_private.notion_data_sources')));
  assert.ok(statements.some((sql) => sql.includes("status='disconnected'")));
  assert.equal(connection.access_token_encrypted, null);
  assert.equal(connection.refresh_token_encrypted, null);
});

test('two-phase OAuth binds a one-time ticket to its owner without callback cookies', async () => {
  const stateOwners = new Map<string, { userId: string; consumed: boolean }>();
  const connections = new Map<string, any>();
  const savedSources = new Map<string, any[]>();
  const pendingTickets = new Map<string, any>();
  const states = {
    async create(hash: string, userId: string) { stateOwners.set(hash, { userId, consumed: false }); },
    async consumeOnce(hash: string) {
      const row = stateOwners.get(hash);
      if (!row || row.consumed) return null;
      row.consumed = true;
      return row.userId;
    },
  };
  const tickets = { async create(row: any, ticketHash: string) { pendingTickets.set(ticketHash, { ...row, expiresAt: Date.now() + 180_000 }); } };
  const connectionRepo = {
    async finalizeOAuthTicket(ticketHash: string, userId: string) {
      const row = pendingTickets.get(ticketHash);
      if (!row || row.supabase_user_id !== userId || row.expiresAt <= Date.now()) throw new Error('oauth_ticket_invalid_expired_or_used');
      pendingTickets.delete(ticketHash);
      const id = `conn-${userId}`;
      connections.set(userId, { connection_id: id, supabase_user_id: userId, status: 'needs_setup',
        workspace_id: row.workspace_id, workspace_name: row.workspace_name, duplicated_template_id: row.duplicated_template_id,
        access_token_encrypted: row.access_token_encrypted, refresh_token_encrypted: row.refresh_token_encrypted });
      return id;
    },
    async getForUser(userId: string) { return connections.get(userId) ?? null; },
    async saveDataSources(id: string, rows: any[]) { savedSources.set(id, rows); },
    async setStatus(id: string, status: string) { for (const row of connections.values()) if (row.connection_id === id) row.status = status; },
  };
  const oauth = {
    async exchangeCode(code: string) {
      const suffix = code === 'alice-code' ? 'alice' : 'bob';
      return { access_token: `access-${suffix}`, refresh_token: `refresh-${suffix}`, bot_id: `bot-${suffix}`,
        workspace_id: `workspace-${suffix}`, workspace_name: `${suffix} workspace`, workspace_icon: null,
        owner: { type: 'user', id: `notion-${suffix}` }, duplicated_template_id: suffix === 'alice' ? 'template-page' : null };
    },
    authorizationUrl: (state: string) => state,
    async refresh() { throw new Error('not-used'); }, async revoke() {},
  } as any;
  const auth = { async authenticate(jwt: string) { return { id: jwt === 'alice' ? ALICE : BOB }; } } as any;
  const router = createNotionRouter({ config, states: states as any, tickets: tickets as any, connections: connectionRepo as any,
    ledger: {} as any, auth, oauth, fetcher: mockNotionFetch() });
  const callbackLayer = (router as any).stack.find((layer: any) => layer.route?.path === '/oauth/callback');
  const callback = callbackLayer.route.stack.at(-1).handle;
  async function invoke(state: string, code: string) {
    const output: any = { headers: {} };
    const req: any = { query: { state, code }, headers: {} };
    const res: any = { setHeader(name: string, value: string) { output.headers[name] = value; }, redirect(status: number, url: string) { output.status = status; output.location = url; } };
    await callback(req, res, () => {});
    return output;
  }
  const aliceState = 'a'.repeat(43);
  const bobState = 'b'.repeat(43);
  await states.create(hashState(aliceState), ALICE);
  await states.create(hashState(bobState), BOB);
  const [alice, bob] = await Promise.all([invoke(aliceState, 'alice-code'), invoke(bobState, 'bob-code')]);
  assert.match(alice.location, /#notion_ticket=[A-Za-z0-9_-]{43}$/);
  assert.match(bob.location, /#notion_ticket=[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(alice.location, /alice-code|access-alice|refresh-alice/);
  assert.equal(alice.headers['Set-Cookie'], undefined, 'callback does not depend on or issue cookies');
  assert.equal(connections.has(ALICE), false);
  assert.equal(connections.has(BOB), false);
  const ticket = new URL(alice.location).hash.slice('#notion_ticket='.length);
  const finalizeLayer = (router as any).stack.find((layer: any) => layer.route?.path === '/oauth/finalize');
  const authMiddleware = finalizeLayer.route.stack[0].handle;
  const unauthenticated: any = {};
  await authMiddleware({ header: () => undefined }, { status(code: number) { unauthenticated.status = code; return this; }, json(body: any) { unauthenticated.body = body; } }, () => {});
  assert.equal(unauthenticated.status, 401, 'ticket exchange requires a valid Supabase bearer session');
  const finalize = finalizeLayer.route.stack.at(-1).handle;
  async function finish(userId: string, selectedTicket = ticket) {
    const out: any = {};
    const req: any = { body: { ticket: selectedTicket }, authUser: { id: userId } };
    const res: any = { setHeader() {}, status(status: number) { out.status = status; return this; }, json(payload: any) { out.payload = payload; return this; } };
    await finalize(req, res, (error: any) => { out.error = error; });
    return out;
  }
  assert.equal((await finish(BOB)).payload.error, 'oauth_ticket_invalid_expired_or_used');
  assert.equal(pendingTickets.size, 2, 'wrong user does not consume ticket');
  const bobTicket = new URL(bob.location).hash.slice('#notion_ticket='.length);
  pendingTickets.get(hashState(bobTicket)).expiresAt = Date.now() - 1;
  assert.equal((await finish(BOB, bobTicket)).payload.error, 'oauth_ticket_invalid_expired_or_used');
  assert.equal(connections.has(BOB), false, 'expired ticket does not create a connection');
  assert.deepEqual((await finish(ALICE)).payload, { ok: true, status: 'connected' });
  assert.equal(connections.get(ALICE).workspace_id, 'workspace-alice');
  assert.equal(connections.has(BOB), false);
  assert.equal(savedSources.get(`conn-${ALICE}`)!.length, 11);
  assert.equal((await finish(ALICE)).payload.error, 'oauth_ticket_invalid_expired_or_used');
  assert.match((await invoke('bad-state', 'alice-code')).location, /notion=invalid_state/);
  assert.match((await invoke(aliceState, 'alice-code')).location, /expired_or_reused_state/);
});

test('discovery reports missing required property types and unresolved relationships', async () => {
  const completeFetch = mockNotionFetch();
  const incompleteFetch: typeof fetch = async (input, init) => {
    const response = await completeFetch(input, init);
    if (String(input).endsWith('/data_sources/ds-5')) {
      const body = await response.json() as any;
      delete body.properties['Field 1'];
      return Response.json(body);
    }
    if (String(input).endsWith('/data_sources/ds-3')) {
      const body = await response.json() as any;
      const relation = Object.values(body.properties).find((property: any) => property.type === 'relation' && property.relation?.database_id === 'db-1') as any;
      relation.relation.database_id = 'outside-database';
      relation.relation.data_source_id = 'outside-data-source';
      return Response.json(body);
    }
    return response;
  };
  const result = await new NotionDiscoveryService(new NotionApi('fake-token', config.NOTION_VERSION, incompleteFetch)).discover();
  assert.equal(result.sources.length, 11);
  assert.ok(result.errors.includes('missing_property_type:Habits:number'));
  assert.ok(result.errors.includes('missing_relation:Hunters->Hunter Ranks'));
  assert.ok(result.errors.includes('relation_target_not_in_selected_template:Hunters'));
  assert.equal(DATA_BASES.length, 11);
});
