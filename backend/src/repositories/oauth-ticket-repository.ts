import type { Pool } from 'pg';

export type PendingNotionAuthorization = {
  state_hash: string;
  supabase_user_id: string;
  workspace_id: string;
  workspace_name: string | null;
  workspace_icon: string | null;
  bot_id: string;
  owner_metadata: Record<string, unknown>;
  duplicated_template_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
};

export class OAuthTicketRepository {
  constructor(private readonly db: Pool) {}

  async create(input: PendingNotionAuthorization, ticketHash: string, ttlSeconds = 180) {
    await this.db.query(
      `INSERT INTO app_private.oauth_pending_authorizations
       (ticket_hash,state_hash,supabase_user_id,workspace_id,workspace_name,workspace_icon,bot_id,owner_metadata,
        duplicated_template_id,access_token_encrypted,refresh_token_encrypted,expires_at)
       VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,now()+($12::int*interval '1 second'))`,
      [ticketHash, input.state_hash, input.supabase_user_id, input.workspace_id, input.workspace_name,
        input.workspace_icon, input.bot_id, JSON.stringify(input.owner_metadata ?? {}), input.duplicated_template_id,
        input.access_token_encrypted, input.refresh_token_encrypted, ttlSeconds]);
    await this.db.query(`DELETE FROM app_private.oauth_pending_authorizations WHERE expires_at < now() - interval '1 day'`);
  }
}
