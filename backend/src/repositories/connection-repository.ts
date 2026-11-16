import type { Pool, PoolClient } from 'pg';

export type StoredConnection = {
  connection_id: string; supabase_user_id: string; workspace_id: string | null;
  workspace_name: string | null; workspace_icon: string | null; bot_id: string | null;
  owner_metadata: Record<string, unknown>; duplicated_template_id: string | null;
  access_token_encrypted: string | null; refresh_token_encrypted: string | null; status: string;
};

export class ConnectionRepository {
  constructor(private readonly db: Pool) {}
  async finalizeOAuthTicket(ticketHash: string, userId: string): Promise<string> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query<StoredConnection & { state_hash: string; expires_at: Date | string; consumed_at: Date | null }>(
        `SELECT * FROM app_private.oauth_pending_authorizations
          WHERE ticket_hash=$1 AND supabase_user_id=$2::uuid AND consumed_at IS NULL AND expires_at>now()
          FOR UPDATE`, [ticketHash, userId]);
      const authorization = pending.rows[0];
      if (!authorization) throw new Error('oauth_ticket_invalid_expired_or_used');
      const saved = await client.query<{ connection_id: string }>(
        `INSERT INTO app_private.notion_connections
          (supabase_user_id,workspace_id,workspace_name,workspace_icon,bot_id,owner_metadata,
           duplicated_template_id,access_token_encrypted,refresh_token_encrypted,status,connected_at,updated_at)
         VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'needs_setup',now(),now())
         ON CONFLICT (supabase_user_id) DO UPDATE SET
           workspace_id=EXCLUDED.workspace_id,workspace_name=EXCLUDED.workspace_name,
           workspace_icon=EXCLUDED.workspace_icon,bot_id=EXCLUDED.bot_id,owner_metadata=EXCLUDED.owner_metadata,
           duplicated_template_id=EXCLUDED.duplicated_template_id,access_token_encrypted=EXCLUDED.access_token_encrypted,
           refresh_token_encrypted=EXCLUDED.refresh_token_encrypted,status='needs_setup',connected_at=now(),updated_at=now()
         RETURNING connection_id`, [userId, authorization.workspace_id, authorization.workspace_name,
          authorization.workspace_icon, authorization.bot_id, JSON.stringify(authorization.owner_metadata ?? {}),
          authorization.duplicated_template_id, authorization.access_token_encrypted, authorization.refresh_token_encrypted]);
      await client.query('DELETE FROM app_private.oauth_pending_authorizations WHERE ticket_hash=$1', [ticketHash]);
      await client.query('COMMIT');
      return saved.rows[0]!.connection_id;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async getForUser(userId: string): Promise<StoredConnection | null> {
    const result = await this.db.query<StoredConnection>(
      `SELECT * FROM app_private.notion_connections WHERE supabase_user_id = $1::uuid`, [userId]);
    return result.rows[0] ?? null;
  }
  async statusForUser(userId: string) {
    const result = await this.db.query(
      `SELECT workspace_name, workspace_icon, status, connected_at, updated_at
         FROM app_private.notion_connections WHERE supabase_user_id = $1::uuid`, [userId]);
    return result.rows[0] ?? { status: 'not_connected' };
  }
  async saveOAuth(userId: string, token: {
    accessTokenEncrypted: string; refreshTokenEncrypted: string;
    workspaceId: string; workspaceName: string | null; workspaceIcon: string | null;
    botId: string; owner: unknown; duplicatedTemplateId: string | null; status: 'connected' | 'needs_setup';
  }) {
    const result = await this.db.query<{ connection_id: string }>(
      `INSERT INTO app_private.notion_connections
        (supabase_user_id, workspace_id, workspace_name, workspace_icon, bot_id, owner_metadata,
         duplicated_template_id, access_token_encrypted, refresh_token_encrypted, status, connected_at, updated_at)
       VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,now(),now())
       ON CONFLICT (supabase_user_id) DO UPDATE SET
         workspace_id=EXCLUDED.workspace_id, workspace_name=EXCLUDED.workspace_name,
         workspace_icon=EXCLUDED.workspace_icon, bot_id=EXCLUDED.bot_id, owner_metadata=EXCLUDED.owner_metadata,
         duplicated_template_id=EXCLUDED.duplicated_template_id, access_token_encrypted=EXCLUDED.access_token_encrypted,
         refresh_token_encrypted=EXCLUDED.refresh_token_encrypted, status=EXCLUDED.status,
         connected_at=now(), updated_at=now()
       RETURNING connection_id`,
      [userId, token.workspaceId, token.workspaceName, token.workspaceIcon, token.botId,
        JSON.stringify(token.owner ?? {}), token.duplicatedTemplateId, token.accessTokenEncrypted,
        token.refreshTokenEncrypted, token.status]);
    return result.rows[0]!.connection_id;
  }
  async saveDataSources(connectionId: string, sources: Array<{
    logicalName: string; databaseId: string; dataSourceId: string;
    metadata: Record<string, unknown>; schemaVersion: string;
  }>) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM app_private.notion_data_sources WHERE connection_id=$1::uuid', [connectionId]);
      for (const source of sources) {
        await client.query(
          `INSERT INTO app_private.notion_data_sources
             (connection_id,logical_name,database_id,data_source_id,last_validated_at,schema_version,validation_metadata)
           VALUES ($1::uuid,$2,$3,$4,now(),$5,$6::jsonb)`,
          [connectionId, source.logicalName, source.databaseId, source.dataSourceId,
            source.schemaVersion, JSON.stringify(source.metadata)]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async setStatus(connectionId: string, status: string) {
    await this.db.query(`UPDATE app_private.notion_connections SET status=$2, updated_at=now() WHERE connection_id=$1::uuid`, [connectionId, status]);
  }
  async disconnect(userId: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query<StoredConnection>(`SELECT * FROM app_private.notion_connections WHERE supabase_user_id=$1::uuid FOR UPDATE`, [userId]);
      if (row.rows[0]) {
        await client.query(`DELETE FROM app_private.notion_data_sources WHERE connection_id=$1::uuid`, [row.rows[0].connection_id]);
        await client.query(
          `UPDATE app_private.notion_connections SET status='disconnected', access_token_encrypted=NULL,
           refresh_token_encrypted=NULL, updated_at=now() WHERE connection_id=$1::uuid`, [row.rows[0].connection_id]);
      }
      await client.query('COMMIT');
      return row.rows[0] ?? null;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async withConnectionLock<T>(userId: string, callback: (client: PoolClient, connection: StoredConnection) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<StoredConnection>(
        `SELECT * FROM app_private.notion_connections WHERE supabase_user_id=$1::uuid FOR UPDATE`, [userId]);
      const connection = result.rows[0];
      if (!connection) throw new Error('notion_connection_not_found');
      const value = await callback(client, connection);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
