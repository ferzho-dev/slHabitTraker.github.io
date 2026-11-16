# Auditoría previa de Fase 1 — 2026-11-15

Alcance: lectura del repositorio y pruebas locales simuladas. No se ejecutó SQL, no se desplegó, no se conectó a Notion/Supabase reales y no se modificó el esquema RPG.

## Hallazgos críticos

1. **No existe un rol PostgreSQL exclusivo para la API.** La migración 001 revoca los grants web pero no concede acceso a un rol backend. Una conexión no propietaria quedaría bloqueada; usar `postgres` resolvería el acceso omitiendo el mínimo privilegio y puede evitar RLS. Se preparó `migrations/002_backend_role_access.sql` y la guía `ROLE_SETUP.md`; no se aplicaron.
2. **La cookie OAuth depende de cookies de terceros.** La SPA está en `github.io` y el API se propone en `onrender.com`, que son sitios distintos. Aunque CORS usa origen explícito, `credentials: true`, y la cookie de producción es `HttpOnly; Secure; SameSite=None`, navegadores con bloqueo de cookies de terceros pueden ignorar la cookie devuelta por el `POST /oauth/start`. El callback falla cerrado como `invalid_state`, sin perder la protección, pero el inicio de OAuth no será compatible en esos navegadores. `SameSite=None; Secure` no anula el bloqueo general de cookies third-party en navegadores con políticas restrictivas ([MDN](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies), [WebKit](https://webkit.org/tracking-prevention/)). No se debe quitar `state` ni la validación de un solo uso. Solución preferida antes de integrar el frontend: usar dominios propios del mismo sitio (por ejemplo `app.ejemplo.com` y `api.ejemplo.com`). Alternativa: completar OAuth en dos fases con autorización/tokens en estado pendiente y un ticket aleatorio de un solo uso generado en el callback; la finalización debe exigir el JWT del UUID que inició OAuth. No basta con un nonce que el iniciador pueda incluir en un enlace compartido.

## Hallazgos importantes

- La identidad de cada endpoint autenticado proviene de `auth.getUser(jwt)` y comprobaciones de `iss`, `aud` y `exp`; las consultas de conexión usan el UUID verificado. `connection_id` no se recibe como autorización del cliente.
- `oauth_states` tiene TTL, hash de state, consumo condicional atómico y una única tentativa vigente por usuario. El callback intercambia el código en el servidor y redirige solo con un estado genérico; no devuelve tokens.
- La migración 001 es repetible en una instalación intacta por `IF NOT EXISTS`, revocaciones y cambios RLS idempotentes. No es una herramienta de reparación de drift: `CREATE TABLE IF NOT EXISTS` no reconcilia columnas/constraints de una tabla preexistente.
- Los privilegios por defecto de 001 revocan acceso futuro de los roles web, pero no conceden permisos al backend. El SQL 002 añade defaults para objetos creados por `postgres`; no puede activar RLS/políticas automáticamente en tablas futuras.
- `NOTION_CLIENT_SECRET`, el cifrado y `DATABASE_URL` solo se leen en el backend. `.env` está ignorado; `.env.example` solo contiene marcadores. No se encontró secreto Notion en `src/` ni en la configuración Vite.
- El callback local y de producción debe registrarse como URL del backend, no como URL de GitHub Pages.

## Hallazgos menores

- `package-lock.json` está presente. Node 22 es necesario por la versión de `@supabase/supabase-js`; se debe fijar Render a Node 22. El workspace de auditoría usa Node 18, que muestra advertencia de compatibilidad aunque las pruebas simuladas pasen.
- La matriz de tipos de Notion valida categorías de propiedades y destinos de relaciones, pero no puede confirmar la estructura real de las once bases sin una autorización real.
- `npm ci` terminó correctamente con lockfile y cero vulnerabilidades reportadas. Se ejecutó bajo Node 18 del entorno, por lo que mostró advertencias de engine; producción está fijada a Node 22. No hay un runtime Node 22 instalado en este entorno para comprobar el arranque real.
- Render y TLS/Pooler de Supabase siguen sin verificación en vivo.

## Archivos por revisar antes de integrar el frontend

- `backend/migrations/001_notion_oauth_infrastructure.sql`: falta rol/grants/policies; no cambiar las tablas RPG.
- `backend/src/controllers/notion-controller.ts`: ajustar el enlace del state al navegador si se mantiene `github.io` + `onrender.com` y se requiere soportar bloqueo de cookies de terceros. Mantener state y exigir que la finalización use el mismo UUID autenticado.
- `backend/src/app.ts`: origen CORS está explícito y credentials activado; comprobarlo de nuevo con el dominio de producción definitivo.
- `backend/.env.example` y `backend/README.md`: actualizar la URI final cuando Render asigne dominio.

## Pruebas ejecutadas

- `npm test`: 11 pruebas simuladas pasaron: configuración, JWT/Auth seam, cifrado, OAuth token/refresh, state, aislamiento, ledger, desconexión, callback y contrato de bases.
- `npm run build` en `backend/`: pasó.
- `npm run build` en raíz: pasó.
- `git diff --check`: pasó.
- `npm ci`: pasó localmente; no representa un arranque en Node 22 ni una instalación en Render.

Las pruebas usan Supabase, Notion y PostgreSQL simulados. Deben complementarse con pruebas RLS de rol en un proyecto de staging y una sesión real de OAuth antes de habilitar el cliente.
