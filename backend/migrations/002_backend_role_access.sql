-- Run only after 001_notion_oauth_infrastructure.sql, as the Supabase postgres role.
-- Creates a NOLOGIN permission group. Create a separate LOGIN member as described
-- in ROLE_SETUP.md; never connect the application as postgres or service_role.

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'hunter_system_backend'
  ) THEN
    EXECUTE 'CREATE ROLE hunter_system_backend NOLOGIN INHERIT';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$role$;

ALTER ROLE hunter_system_backend
  NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- The web/API roles must not reach this schema through Supabase Data API.
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA app_private TO hunter_system_backend;

-- Minimum privileges needed by the current repositories.
GRANT SELECT, INSERT, UPDATE ON TABLE app_private.notion_connections TO hunter_system_backend;
GRANT SELECT, INSERT, DELETE ON TABLE app_private.notion_data_sources TO hunter_system_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app_private.oauth_states TO hunter_system_backend;
GRANT SELECT, INSERT ON TABLE app_private.operations_ledger TO hunter_system_backend;

-- RLS is the second gate for the restricted backend login. This trusted role can
-- access all rows in this private technical schema; application queries still
-- scope every lookup to the UUID verified from the Supabase JWT.
ALTER TABLE app_private.notion_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.notion_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.operations_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hunter_system_backend_access ON app_private.notion_connections;
CREATE POLICY hunter_system_backend_access ON app_private.notion_connections
  FOR ALL TO hunter_system_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hunter_system_backend_access ON app_private.notion_data_sources;
CREATE POLICY hunter_system_backend_access ON app_private.notion_data_sources
  FOR ALL TO hunter_system_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hunter_system_backend_access ON app_private.oauth_states;
CREATE POLICY hunter_system_backend_access ON app_private.oauth_states
  FOR ALL TO hunter_system_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS hunter_system_backend_access ON app_private.operations_ledger;
CREATE POLICY hunter_system_backend_access ON app_private.operations_ledger
  FOR ALL TO hunter_system_backend USING (true) WITH CHECK (true);

-- 001 revokes default browser-role grants. These defaults also explicitly grant
-- future technical tables to the private backend group. New tables still need
-- RLS enabled and a policy before the non-owner backend login can use them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hunter_system_backend;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private
  GRANT USAGE, SELECT ON SEQUENCES TO hunter_system_backend;

-- Safe to rerun: role creation is conditional, GRANTs are additive/idempotent,
-- and each policy is replaced by the same definition.
