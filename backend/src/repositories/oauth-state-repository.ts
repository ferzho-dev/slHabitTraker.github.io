import type { Pool } from 'pg';

export class OAuthStateRepository {
  constructor(private readonly db: Pool) {}
  async create(stateHash: string, userId: string, ttlSeconds: number) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Serialize attempts per user so a second browser tab cannot leave two
      // callbacks able to race and overwrite different Notion workspaces.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
      await client.query(`UPDATE app_private.oauth_states SET consumed_at=now()
        WHERE supabase_user_id=$1::uuid AND consumed_at IS NULL`, [userId]);
      await client.query(
        `INSERT INTO app_private.oauth_states(state_hash, supabase_user_id, expires_at)
         VALUES ($1, $2::uuid, now() + ($3::int * interval '1 second'))`,
        [stateHash, userId, ttlSeconds],
      );
      await client.query(`DELETE FROM app_private.oauth_states WHERE expires_at < now() - interval '1 day'`);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async consumeOnce(stateHash: string, expectedUserId?: string): Promise<string | null> {
    const result = await this.db.query<{ supabase_user_id: string }>(
      `UPDATE app_private.oauth_states
          SET consumed_at = now()
        WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
          AND ($2::uuid IS NULL OR supabase_user_id = $2::uuid)
      RETURNING supabase_user_id`,
      [stateHash, expectedUserId ?? null],
    );
    return result.rows[0]?.supabase_user_id ?? null;
  }
}
