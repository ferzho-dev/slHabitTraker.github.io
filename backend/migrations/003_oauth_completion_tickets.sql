-- One-time handoff from the Notion callback to the authenticated SPA.
-- Technical-only: no RPG/public tables are changed. Apply after migrations 001 and 002.
CREATE TABLE IF NOT EXISTS app_private.oauth_pending_authorizations (
  ticket_hash char(64) PRIMARY KEY,
  state_hash char(64) NOT NULL UNIQUE REFERENCES app_private.oauth_states(state_hash) ON DELETE CASCADE,
  supabase_user_id uuid NOT NULL,
  workspace_id text NOT NULL,
  workspace_name text,
  workspace_icon text,
  bot_id text NOT NULL,
  owner_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicated_template_id text,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_pending_authorizations_expiry_idx
  ON app_private.oauth_pending_authorizations(expires_at);

ALTER TABLE app_private.oauth_pending_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.oauth_pending_authorizations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.oauth_pending_authorizations TO hunter_system_backend;
DROP POLICY IF EXISTS hunter_system_backend_access ON app_private.oauth_pending_authorizations;
CREATE POLICY hunter_system_backend_access ON app_private.oauth_pending_authorizations
  FOR ALL TO hunter_system_backend USING (true) WITH CHECK (true);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
