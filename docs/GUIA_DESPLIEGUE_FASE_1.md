# Guía operativa de despliegue — Fase 1

Secuencia de despliegue para React/Vite en GitHub Pages, Node/Express en Render, Supabase Auth/PostgreSQL y OAuth de Notion. No contiene credenciales ni cambia la lógica RPG.

> En el repositorio existen las migraciones 001, 002 y 003; no se presume que estén aplicadas. Las policies RLS actuales permiten al grupo backend las filas de `app_private`; no son políticas individuales por usuario. El filtrado por UUID autenticado depende de la aplicación.

## Fase 0 — Preparación

Necesitas acceso al proyecto Supabase, GitHub, Render y Notion Developer Portal; Node.js 22, npm y Git; URL de GitHub Pages y acceso al repositorio. Revisa `backend/README.md`, `backend/ROLE_SETUP.md`, `backend/.env.example`, las migraciones, `backend/src/config/{env,db}.ts`, `backend/src/app.ts`, el controlador OAuth, `vite.config.js`, `.env.example` y `src/services/supabaseClient.js`.

Genera una clave independiente para cifrar tokens (`openssl rand -base64 32`), guárdala en un gestor de secretos y luego en Render como `TOKEN_ENCRYPTION_KEY_BASE64`. No la incluyas en Git ni en variables `VITE_*`. Conserva copia segura: perderla impide descifrar tokens existentes.

## Fase 1 — Supabase PostgreSQL

### Proyecto, conexión y TLS

1. Entra al Supabase Dashboard y confirma nombre y Project Ref del proyecto correcto.
2. En **Connect**, elige el modo indicado para el host de Render: conexión directa para backend persistente si tiene IPv6 disponible; usa Session pooler si la red es IPv4-only. Copia el host, puerto y usuario que da el panel, sin construirlos de memoria.
3. En **Database → Settings → SSL Configuration**, descarga el CA raíz de ese proyecto. Codifica el PEM entero:

```sh
# Linux
base64 -w0 prod-ca-2021.crt
# macOS
base64 < prod-ca-2021.crt | tr -d '\n'
```

Guarda el resultado para `DATABASE_SSL_CA_BASE64`. En producción el backend lo exige, valida el certificado PEM y configura `ssl: { ca, rejectUnauthorized: true }`. No pongas `sslmode`, `sslcert`, `sslkey` ni `sslrootcert` en `DATABASE_URL`: el esquema rechaza estos parámetros para proteger la configuración TLS.

### Migraciones

En **SQL Editor → New query**, confirma otra vez el Project Ref y ejecuta cada archivo completo, uno a la vez, esperando éxito antes de continuar:

1. `backend/migrations/001_notion_oauth_infrastructure.sql`: crea `app_private`, conexiones Notion, datasources, estados OAuth y ledger; revoca acceso público.
2. `backend/migrations/002_backend_role_access.sql`: depende de 001; crea/configura el grupo `hunter_system_backend`, grants, policies y privilegios por defecto.
3. `backend/migrations/003_oauth_completion_tickets.sql`: depende de `oauth_states` de 001 y del rol de 002; crea tabla de tickets y requiere `SELECT, INSERT, UPDATE, DELETE` explícitos para el grupo. `UPDATE` es necesario para `SELECT ... FOR UPDATE`.

Son sentencias PostgreSQL, no SQL de Logs Explorer. No afectan las tablas RPG.

### Login restringido y comprobación

Después de 002, crea un login miembro del grupo. Sustituye el marcador por una contraseña aleatoria que no guardes en el repo ni en el historial del proyecto:

```sql
CREATE ROLE hunter_system_api
  WITH LOGIN INHERIT PASSWORD '<CONTRASEÑA_ALEATORIA_NUEVA>'
  IN ROLE hunter_system_backend;
```

No concedas `SUPERUSER`, `BYPASSRLS`, `CREATEDB` ni `CREATEROLE`. Render se conecta como `hunter_system_api`, nunca `postgres` o `service_role`.

Consultas de comprobación de solo lectura:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname IN ('hunter_system_backend','hunter_system_api');

SELECT pg_has_role('hunter_system_api','hunter_system_backend','MEMBER') AS api_is_backend_member;

SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,p.policyname,p.roles
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_catalog.pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname
WHERE n.nspname='app_private' ORDER BY c.relname;

SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='app_private'
AND grantee IN ('PUBLIC','anon','authenticated','hunter_system_backend')
ORDER BY grantee,table_name,privilege_type;

SELECT
 has_schema_privilege('hunter_system_api','app_private','USAGE') AS api_usage,
 (has_table_privilege('hunter_system_api','app_private.notion_connections','SELECT')
  AND has_table_privilege('hunter_system_api','app_private.notion_connections','INSERT')
  AND has_table_privilege('hunter_system_api','app_private.notion_connections','UPDATE')) AS api_connections,
 (has_table_privilege('hunter_system_api','app_private.notion_data_sources','SELECT')
  AND has_table_privilege('hunter_system_api','app_private.notion_data_sources','INSERT')
  AND has_table_privilege('hunter_system_api','app_private.notion_data_sources','DELETE')) AS api_datasources,
 (has_table_privilege('hunter_system_api','app_private.oauth_states','SELECT')
  AND has_table_privilege('hunter_system_api','app_private.oauth_states','INSERT')
  AND has_table_privilege('hunter_system_api','app_private.oauth_states','UPDATE')
  AND has_table_privilege('hunter_system_api','app_private.oauth_states','DELETE')) AS api_states,
 (has_table_privilege('hunter_system_api','app_private.operations_ledger','SELECT')
  AND has_table_privilege('hunter_system_api','app_private.operations_ledger','INSERT')) AS api_ledger,
 (has_table_privilege('hunter_system_api','app_private.oauth_pending_authorizations','SELECT')
  AND has_table_privilege('hunter_system_api','app_private.oauth_pending_authorizations','INSERT')
  AND has_table_privilege('hunter_system_api','app_private.oauth_pending_authorizations','UPDATE')
  AND has_table_privilege('hunter_system_api','app_private.oauth_pending_authorizations','DELETE')) AS api_tickets,
 has_schema_privilege('anon','app_private','USAGE') AS anon_usage,
 has_schema_privilege('authenticated','app_private','USAGE') AS authenticated_usage;
```

Esperado: `api_is_backend_member = true`, todos `api_* = true`, `anon_usage = false`, `authenticated_usage = false`. RLS debe estar activo y tener policies para cada tabla privada. Si `permission denied for schema app_private`, confirma proyecto, orden de migraciones, membresía de `hunter_system_api`, `USAGE` y grants; no lo soluciones usando postgres para la API.

## Fase 2 — Notion Developer Portal

1. Crea o abre la integración pública del propietario que dará acceso a workspaces.
2. Obtén OAuth Client ID y Client Secret; el ID se configura como `NOTION_CLIENT_ID`, el secreto solo en Render como `NOTION_CLIENT_SECRET`.
3. Tras obtener el host Render en la siguiente fase, registra la URI exacta `https://<servicio-render>.onrender.com/api/notion/oauth/callback`. Debe coincidir con `NOTION_REDIRECT_URI` carácter por carácter.
4. El callback es URL del **backend**; no es la ruta del frontend. La fase actual necesita lectura de contenido para descubrir páginas, bases y datasources; habilita inserción/actualización solo cuando el backend implemente escritura de datos RPG.
5. Comparte la página raíz/plantilla pertinente con la integración. Prueba la autorización después de terminar las fases 3–5.

## Fase 3 — Render

1. Crea **New → Web Service**, conecta el repositorio GitHub.
2. Configura Root Directory `backend`, Build Command `npm ci && npm run build`, Start Command `npm start`, Runtime Node 22.
3. Añade variables de la tabla siguiente. Usa la conexión Supabase Connect con usuario restringido `hunter_system_api`; si usas pooler, conserva el formato de usuario indicado por Supabase. Codifica caracteres reservados en la contraseña. La URL no lleva parámetros SSL.
4. Completa `DATABASE_SSL_CA_BASE64`, `NOTION_REDIRECT_URI` y credenciales. En Notion registra exactamente el callback resultante.
5. Despliega el Web Service y guarda su URL HTTPS. Visita `https://<servicio-render>.onrender.com/health`; debe responder `{"ok":true}`. Revisa Render → Logs si falla build o arranque; evita registrar valores de secretos.

| Variable | Valor/origen | Secreto |
|---|---|---|
| `NODE_ENV` | `production` | No |
| `PORT` | Render; default local 8787 | No |
| `FRONTEND_ORIGIN` | Origin del site, p. ej. `https://<usuario>.github.io`, sin repo path | No |
| `FRONTEND_SUCCESS_URL` | URL completa del frontend, p. ej. `https://<usuario>.github.io/<repo>/` | No |
| `FRONTEND_ERROR_URL` | Frontend + `?notion=error` | No |
| `SUPABASE_URL` | Project URL del mismo proyecto | No |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key del mismo proyecto | Pública, solo backend config |
| `DATABASE_URL` | PostgreSQL Connect usando login `hunter_system_api`, sin SSL query params | Sí |
| `DATABASE_SSL_CA_BASE64` | CA raíz Supabase codificado en Base64 | Sí |
| `NOTION_CLIENT_ID` | OAuth Client ID | No, backend |
| `NOTION_CLIENT_SECRET` | OAuth Client Secret | Sí |
| `NOTION_REDIRECT_URI` | URL callback HTTPS Render | No |
| `NOTION_AUTH_URL` | `https://api.notion.com/v1/oauth/authorize` | No |
| `NOTION_VERSION` | Actual: `2026-03-11` | No |
| `TOKEN_ENCRYPTION_KEY_BASE64` | `openssl rand -base64 32` | Sí |
| `OAUTH_STATE_TTL_SECONDS` | Entero 60–1800; ejemplo 600 | No |

## Fase 4 — GitHub Pages / frontend

1. `vite.config.js` tiene `base: "/slHabitTraker.github.io/"`; confirma que corresponde al nombre de repo publicado. Un dominio raíz requiere ajustar base.
2. Configura en el entorno de build `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y `VITE_HUNTER_API_URL=https://<servicio-render>.onrender.com` (sin `/api`). La app acepta también la clave legacy `VITE_SUPABASE_ANON_KEY`.
3. Todo `VITE_*` se incluye en el bundle público. Nunca pongas allí secretos, `DATABASE_URL`, CA, tokens Notion, `service_role` o clave de cifrado.
4. Compila desde raíz con `npm ci && npm run build`. El script `npm run deploy` compila vía `predeploy` y ejecuta `gh-pages -d dist`.
5. El repo no contiene workflow de Actions. El script requiere push Git autenticado hacia la rama `gh-pages`; configura credenciales Git seguras fuera del código. En GitHub Settings → Pages selecciona rama `gh-pages`, carpeta `/`.
6. Verifica URL, path base y assets en navegador. En Network, confirma Supabase y API Render correctos.

CORS usa `FRONTEND_ORIGIN` exacto, sin path de repo, y `credentials: false`. Para `https://<usuario>.github.io/<repo>/`, el Origin es `https://<usuario>.github.io`. `VITE_HUNTER_API_URL` es origin, no incluye `/api`.

## Fase 5 — Comunicación entre servicios

Ejemplos ilustrativos: frontend `https://<usuario>.github.io/<repo>/`; Origin `https://<usuario>.github.io`; API `https://<servicio-render>.onrender.com`; callback `https://<servicio-render>.onrender.com/api/notion/oauth/callback`; Supabase `https://<project-ref>.supabase.co`. Reemplaza marcadores con los valores reales del panel.

1. **Frontend → Supabase Auth:** inicia sesión; comprueba que hay sesión y proyecto correcto.
2. **Frontend → Render:** `/health` responde; rutas privadas sin Bearer responden 401. CORS permite solo Origin configurado.
3. **Render → PostgreSQL:** `/health` solo comprueba que Express responde; no demuestra conectividad PostgreSQL. Para probar DB, llama `GET https://<servicio-render>.onrender.com/api/notion/status` desde una sesión iniciada y envía `Authorization: Bearer <access_token Supabase>`. En el código esa ruta valida el JWT y ejecuta `connections.statusForUser()`, que consulta `app_private.notion_connections`. Una respuesta 200 con `status: "not_connected"` confirma que la consulta llegó a PostgreSQL; un 401 solo confirma que faltó o falló la autenticación. Si la consulta DB falla, la ruta responde error y Render Logs debe mostrar el fallo. No imprimas la URL de conexión.
4. **Render → Notion:** el intercambio y llamadas a Notion ocurren en backend durante OAuth/descubrimiento.
5. **Frontend → finalize:** `POST /api/notion/oauth/finalize` lleva `Authorization: Bearer <JWT Supabase>` y cuerpo `{ "ticket": "..." }`; no necesita cookies.

## Fase 6 — Primera autorización Notion

1. Inicia sesión con usuario Supabase de prueba y pulsa **Conectar Notion**.
2. Frontend llama `POST /api/notion/oauth/start` con Bearer; backend guarda hash del state de un solo uso ligado al UUID y devuelve URL Notion.
3. Autoriza el workspace. Notion vuelve al callback backend con `code` y `state`.
4. Backend consume state, intercambia code server-side, cifra tokens y redirige al frontend con ticket temporal en fragmento URL (TTL 180 s).
5. Frontend borra el fragmento y manda ticket + JWT actual a `POST /api/notion/oauth/finalize`. El backend verifica propietario, vencimiento y consumo único.
6. Backend descubre raíz `HUNTER SYSTEM — Datos`, valida las once bases y guarda IDs de database/data source asociados a la conexión del usuario. `GET /api/notion/status` debe indicar `connected`; `needs_setup` señala que OAuth pasó pero la plantilla requiere revisión.
7. Prueba `POST /api/notion/disconnect` y una reconexión.
8. Repite con cuentas y workspaces de prueba A y B en perfiles de navegador separados. Verifica los cruces así:
   - **Conexiones:** llama `GET /api/notion/status` con Bearer A y Bearer B; cada respuesta debe mostrar únicamente el workspace asociado a esa sesión. La ruta no acepta un `user_id` de cliente.
   - **Tickets:** inicia otra autorización como A y conserva el ticket solo localmente. Un intento de `POST /api/notion/oauth/finalize` con ticket A y JWT B debe rechazarse; luego A debe poder canjearlo antes del vencimiento, confirmando que el intento B no lo consumió.
   - **Desconexión:** `POST /api/notion/disconnect` usa la identidad JWT y no acepta ID de conexión; envía `{}` con Bearer B en cuentas de prueba. B debe desconectarse mientras A permanece conectado al volver a consultar ambos estados. Reconecta B si quieres dejar ambos workspaces activos. Esta prueba desconecta intencionalmente el workspace B de prueba.
   - La policy RLS del grupo backend sigue siendo grupal, no individual por usuario; estas pruebas verifican los filtros de aplicación.

## Fase 7 — Validación y seguridad

| Prueba | Resultado esperado |
|---|---|
| JWT válido / inválido / ausente | Ruta privada permite solo JWT vigente; otros 401 |
| Ticket vencido, repetido o de otra identidad | Canje rechazado, sin conectar usuario ajeno |
| OAuth cancelado / state inválido, expirado o repetido | Error de retorno al frontend; no crear conexión |
| Notion sin bases/relaciones requeridas | `needs_setup` con problemas de esquema, sin secretos |
| Workspaces distintos para dos usuarios | Cada sesión ve solamente su conexión por filtro aplicación |
| Refresh y desconectar | Rotación serializada; desconexión limpia credenciales locales |
| Grants y RLS | Backend tiene grants requeridos; `anon`/`authenticated` sin `USAGE` |
| TLS | CA válida, conexión verificada; no usar `rejectUnauthorized:false` |
| CORS/logs | Origin exacto; logs sin URL DB, client secret, tokens o ticket |

Haz la primera validación real en staging con cuentas de prueba. Las pruebas automatizadas usan mocks; no validan credenciales reales ni políticas efectivas de tu proyecto.

## Fase 8 — Resolución de errores

| Error | Causa / solución |
|---|---|
| `permission denied for schema app_private` | Verifica Project Ref, 001→002→003, `USAGE`, membresía `hunter_system_api` y grants; no uses postgres en Render. |
| Permission denied al canjear ticket o `FOR UPDATE` | Confirma `SELECT, INSERT, UPDATE, DELETE` explícitos sobre pending tickets y membresía heredada. |
| CA requerida / TLS handshake | Configura CA del mismo proyecto en Base64; revisa truncamiento, hostname y URL Connect. No desactives verificación. |
| `DATABASE_URL` rechaza SSL param | Quita `sslmode`, `sslcert`, `sslkey`, `sslrootcert`; TLS usa variable CA. |
| 401 o usuario no cargado | Verifica Supabase URL/publishable key de frontend y backend, vuelve a iniciar sesión. |
| CORS | Corrige Origin Render (sin repo path) y `VITE_HUNTER_API_URL`; recompila frontend. |
| Redirect mismatch | Alinea URI exacta Notion y `NOTION_REDIRECT_URI`; debe ser callback Render. |
| `invalid_state` / `expired_or_reused_state` | Reinicia OAuth desde usuario correcto; no deshabilites state. |
| `oauth_ticket_invalid_expired_or_used` | Inicia una autorización nueva; ticket es efímero, de un uso y ligado al UUID. |
| `needs_setup` | Comparte raíz con integración y completa bases/tipos/relaciones según contrato del backend. |
| Render no arranca | Revisa Node 22, build/start commands, variables requeridas y logs sin revelar valores. |

## Límites conocidos

No hay workflow GitHub Actions en el repositorio; deploy frontend usa `gh-pages` y requiere Git push autenticado. RLS backend no es individual por usuario; el aislamiento depende del código que filtra por UUID. Fase 1 solo conecta y descubre metadatos Notion; no migra datos RPG ni implementa escritura de juego en Notion.
