# Rol PostgreSQL privado del backend

## Hallazgo

La migración `001_notion_oauth_infrastructure.sql` crea `app_private`, activa RLS y revoca acceso a `PUBLIC`, `anon` y `authenticated`, pero no crea un rol del backend, no concede `USAGE`/DML a ese rol ni crea políticas RLS para él. Con esos grants, una conexión no propietaria no puede usar las tablas. Conectar como `postgres` sí puede evitar RLS por ser administrador/propietario, pero no es un permiso mínimo y no debe usarse desde Render. Supabase describe `postgres` como rol administrativo y `service_role` como rol que evita RLS; ninguno es apropiado como credencial ordinaria de la API. Consulte [roles PostgreSQL en Supabase](https://supabase.com/docs/guides/database/postgres/roles).

## Aplicación manual de la corrección

No se ejecutó este SQL. En Supabase Dashboard → SQL Editor, conectado al proyecto correcto y después de la migración `001`, ejecuta `migrations/002_backend_role_access.sql`. Es PostgreSQL y debe ejecutarse en SQL Editor, no en Logs Explorer.

La corrección crea el grupo `hunter_system_backend` sin login, otorga solo los permisos que usan actualmente los repositorios, agrega políticas RLS para ese grupo y mantiene explícitamente sin acceso a `PUBLIC`, `anon` y `authenticated`. Configura privilegios predeterminados para tablas/secuencias futuras creadas por `postgres`; las nuevas tablas todavía necesitarán `ENABLE ROW LEVEL SECURITY` y una política dedicada.

## Crear la credencial de conexión

Después de crear el grupo, crea un rol de login separado, miembro de `hunter_system_backend`, con una contraseña aleatoria larga. Puede hacerse desde el gestor de roles de la base o, si se usa SQL Editor, sustituye el marcador por un secreto nuevo y no guardes esa consulta en un repositorio:

```sql
CREATE ROLE hunter_system_api
  WITH LOGIN INHERIT PASSWORD '<CONTRASEÑA_ALEATORIA>'
  IN ROLE hunter_system_backend;
```

No asignes `SUPERUSER`, `BYPASSRLS`, `CREATEDB` ni `CREATEROLE`. Usa esta cuenta en `DATABASE_URL` de Render y guarda allí la contraseña como secreto. No uses la conexión `postgres` ni la clave `service_role` para el servidor de aplicación. La cadena debe usar TLS y el formato de usuario que indique Supabase para el modo de conexión elegido.

## Comprobaciones posteriores (no ejecutadas)

Desde SQL Editor, un administrador puede verificar que existen el rol y las políticas:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname IN ('hunter_system_backend', 'hunter_system_api');

SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity,
       p.policyname, p.roles
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'app_private'
ORDER BY c.relname;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'app_private'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'hunter_system_backend')
ORDER BY grantee, table_name, privilege_type;

SELECT
  has_schema_privilege('hunter_system_api', 'app_private', 'USAGE') AS backend_schema_usage,
  (has_table_privilege('hunter_system_api', 'app_private.notion_connections', 'SELECT') AND has_table_privilege('hunter_system_api', 'app_private.notion_connections', 'INSERT') AND has_table_privilege('hunter_system_api', 'app_private.notion_connections', 'UPDATE')) AS backend_connections,
  (has_table_privilege('hunter_system_api', 'app_private.notion_data_sources', 'SELECT') AND has_table_privilege('hunter_system_api', 'app_private.notion_data_sources', 'INSERT') AND has_table_privilege('hunter_system_api', 'app_private.notion_data_sources', 'DELETE')) AS backend_data_sources,
  (has_table_privilege('hunter_system_api', 'app_private.oauth_states', 'SELECT') AND has_table_privilege('hunter_system_api', 'app_private.oauth_states', 'INSERT') AND has_table_privilege('hunter_system_api', 'app_private.oauth_states', 'UPDATE') AND has_table_privilege('hunter_system_api', 'app_private.oauth_states', 'DELETE')) AS backend_oauth_states,
  (has_table_privilege('hunter_system_api', 'app_private.operations_ledger', 'SELECT') AND has_table_privilege('hunter_system_api', 'app_private.operations_ledger', 'INSERT')) AS backend_ledger,
  has_schema_privilege('anon', 'app_private', 'USAGE') AS anon_schema_usage,
  has_schema_privilege('authenticated', 'app_private', 'USAGE') AS authenticated_schema_usage;
```

`backend_*` debe ser `true`; `anon_schema_usage` y `authenticated_schema_usage` deben ser `false`.

También prueba con el rol `hunter_system_api` que `SELECT`/escritura permitida en `app_private` funciona y que `anon`/`authenticated` reciben `permission denied`. No uses `SET ROLE postgres` al hacer esa prueba.
