-- Backend-only metadata. This does not modify the existing public RPG tables.
-- Apply only after reviewing the schema name and backend PostgreSQL role.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS app_private.notion_connections (
  connection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id uuid NOT NULL UNIQUE,
  workspace_id text,
  workspace_name text,
  workspace_icon text,
  bot_id text,
  owner_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicated_template_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','needs_setup','disconnected','reauthorization_required')),
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notion_connections_token_pair CHECK (
    (status IN ('connected','needs_setup') AND access_token_encrypted IS NOT NULL AND refresh_token_encrypted IS NOT NULL)
    OR status IN ('pending','disconnected','reauthorization_required')
  )
);
CREATE INDEX IF NOT EXISTS notion_connections_status_updated_idx
  ON app_private.notion_connections(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS app_private.notion_data_sources (
  connection_id uuid NOT NULL REFERENCES app_private.notion_connections(connection_id) ON DELETE CASCADE,
  logical_name text NOT NULL CHECK (logical_name IN (
    'Hunter Stats','Hunter Ranks','Hunter Classes','Hunters','Weeks','Habits',
    'Habit Days','Habit Completions','Daily Quests','Mission Objectives','Mission History'
  )),
  database_id text NOT NULL,
  data_source_id text NOT NULL,
  last_validated_at timestamptz,
  schema_version text NOT NULL DEFAULT '2026-03-11',
  validation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(connection_id, logical_name),
  UNIQUE(connection_id, database_id, data_source_id)
);

CREATE TABLE IF NOT EXISTS app_private.oauth_states (
  state_hash char(64) PRIMARY KEY,
  supabase_user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON app_private.oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS app_private.operations_ledger (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  operation_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','succeeded','failed','needs_reconciliation')),
  payload_hash char(64) NOT NULL,
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(supabase_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS operations_ledger_status_idx
  ON app_private.operations_ledger(status, updated_at);

ALTER TABLE app_private.notion_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.notion_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.operations_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

-- Access is exclusively through the private backend's PostgreSQL connection.
-- Do not grant the Supabase browser roles access to this schema or these tables.
