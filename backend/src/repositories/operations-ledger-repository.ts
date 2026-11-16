import type { Pool } from 'pg';

export class OperationsLedgerRepository {
  constructor(private readonly db: Pool) {}
  async reserve(input: { userId: string; key: string; operationType: string; payloadHash: string }) {
    const result = await this.db.query(
      `INSERT INTO app_private.operations_ledger
         (supabase_user_id,idempotency_key,operation_type,status,payload_hash)
       VALUES ($1::uuid,$2,$3,'pending',$4)
       ON CONFLICT (supabase_user_id,idempotency_key) DO NOTHING
       RETURNING operation_id,status,payload_hash`,
      [input.userId, input.key, input.operationType, input.payloadHash]);
    if (result.rows[0]) return { created: true, ...result.rows[0] };
    const existing = await this.db.query(
      `SELECT operation_id,status,payload_hash FROM app_private.operations_ledger
       WHERE supabase_user_id=$1::uuid AND idempotency_key=$2`, [input.userId, input.key]);
    const row = existing.rows[0];
    if (row.payload_hash !== input.payloadHash) throw new Error('idempotency_key_payload_conflict');
    return { created: false, ...row };
  }
}
