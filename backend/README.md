# Hunter System API — Fase 1

Backend independiente para conectar por OAuth el workspace Notion de cada usuario, conservando Supabase Auth. Esta fase agrega infraestructura técnica bajo `app_private`; no migra datos ni modifica tablas o lógica RPG.

## Requisitos

- Node.js 22.
- PostgreSQL de Supabase.
- Backend público con HTTPS (Render en producción).
- Credenciales OAuth de Notion y clave de cifrado configuradas solo en el backend.

## Instalación local

1. Copia `.env.example` a `.env` en `backend/` y completa los valores localmente.
2. Crea/configura el grupo PostgreSQL `hunter_system_backend` y un login restringido `hunter_system_api` siguiendo [ROLE_SETUP.md](./ROLE_SETUP.md). La aplicación usa el login `hunter_system_api` en `DATABASE_URL`, nunca `postgres`, `service_role` ni una cuenta con `BYPASSRLS`.
3. En Supabase Dashboard → SQL Editor aplica las migraciones en este orden:
   1. `migrations/001_notion_oauth_infrastructure.sql` crea el esquema privado y las tablas técnicas iniciales.
   2. `migrations/002_backend_role_access.sql` crea/configura `hunter_system_backend`, le concede permisos y define RLS y privilegios por defecto. Depende de 001.
   3. `migrations/003_oauth_completion_tickets.sql` crea el almacenamiento temporal del ticket. Depende del rol de 002 y de `oauth_states` de 001. Requiere que el grupo tenga `SELECT, INSERT, UPDATE, DELETE` sobre `app_private.oauth_pending_authorizations`; `UPDATE` es necesario para el `SELECT ... FOR UPDATE` del canje.
4. Registra en Notion Developer Portal el valor exacto de `NOTION_REDIRECT_URI`.
5. Ejecuta `npm ci`, `npm test`, `npm run build` y luego `npm run dev`.

Las migraciones crean/modifican solo objetos de `app_private`; no alteran las tablas RPG de `public`.

## TLS de PostgreSQL

En Supabase Dashboard → **Database → Settings → SSL Configuration**, descarga el certificado CA raíz de la base. Codifica el archivo PEM completo en Base64 y configura el resultado como `DATABASE_SSL_CA_BASE64` en el entorno del backend. En Linux, por ejemplo:

```sh
base64 -w0 prod-ca-2021.crt
```

En macOS:

```sh
base64 < prod-ca-2021.crt | tr -d '\n'
```

En Render, agrega el valor como secreto/variable privada `DATABASE_SSL_CA_BASE64`; no lo pongas en el frontend ni en Git. En producción el backend exige la CA, la decodifica y valida como certificado PEM antes de crear el Pool. node-postgres recibe `ssl: { ca, rejectUnauthorized: true }`, que valida la cadena y el hostname. `DATABASE_URL` no debe incluir `sslmode`, `sslcert`, `sslkey` ni `sslrootcert`: el backend rechaza esos parámetros para impedir que reemplacen la configuración TLS explícita. La URL del ejemplo no lleva query SSL.

La URL y el usuario PostgreSQL se copian del panel **Connect** de Supabase para el método elegido. Usa el formato de login restringido `hunter_system_api` y codifica caracteres reservados de la contraseña según corresponda.

## Configurar Render

- Root Directory: `backend`
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Runtime: Node 22
- Establece todas las variables de `.env.example`. `DATABASE_URL`, `DATABASE_SSL_CA_BASE64`, `NOTION_CLIENT_SECRET` y `TOKEN_ENCRYPTION_KEY_BASE64` son privadas.
- Usa `FRONTEND_ORIGIN` como el origen HTTPS exacto (sin la ruta base de GitHub Pages).
- Configura `FRONTEND_SUCCESS_URL` y `FRONTEND_ERROR_URL` con las URLs reales del frontend.
- `NOTION_REDIRECT_URI` debe ser idéntica a la URI registrada en Notion, por ejemplo `https://<servicio-render>/api/notion/oauth/callback`.
- Genera `TOKEN_ENCRYPTION_KEY_BASE64` con `openssl rand -base64 32`, guárdala de forma privada y conserva una copia segura. Rotarla requiere re-cifrar los tokens existentes.

## OAuth y API

Las rutas protegidas requieren `Authorization: Bearer <access_token de Supabase Auth>`. El backend valida la sesión con Supabase Auth y obtiene de ella el UUID propietario; no confía en `user_id` ni `connection_id` enviados por el navegador.

- `GET /health`
- `GET /api/notion/status`
- `GET /api/notion/roots`
- `POST /api/notion/oauth/start` — autenticada; guarda hash de state aleatorio, vencible y de consumo único asociado al UUID autenticado. Devuelve la URL de autorización. No usa cookies.
- `GET /api/notion/oauth/callback` — callback público de Notion. Consume y valida state, intercambia el código en el servidor y crea un ticket temporal. Redirige a la app con el ticket en un fragmento URL, no con credenciales.
- `POST /api/notion/oauth/finalize` — autenticada; canjea `{ "ticket": "..." }` usando el JWT actual de Supabase. El ticket vence a los 180 segundos, es de un solo uso y solo se canjea por el mismo UUID que inició OAuth.
- `POST /api/notion/oauth/refresh` — autenticada; rota tokens con bloqueo transaccional.
- `POST /api/notion/validate` — autenticada; valida raíz, tipos mínimos y relaciones de las once bases.
- `POST /api/notion/disconnect` — autenticada; revoca la conexión y borra tokens y fuentes locales.
- `POST /api/notion/operations/reserve` — reserva idempotencia técnica para fases siguientes.

El frontend retira el ticket de la barra de direcciones y lo guarda solo en memoria. Tokens Notion y el secreto de cliente permanecen en el backend. CORS limita el origen al frontend configurado y no habilita credenciales de cookies.

## Aislamiento y límites actuales

- El rol de login es `hunter_system_api`, miembro de `hunter_system_backend`. La contraseña del login no se incluye en las migraciones y debe configurarse por separado según [ROLE_SETUP.md](./ROLE_SETUP.md).
- Las políticas RLS actuales permiten al grupo `hunter_system_backend` acceder a las filas técnicas de `app_private`. **No son políticas RLS individualizadas por usuario.** El aislamiento multiusuario depende del filtrado en la aplicación usando el UUID verificado de Supabase y el UUID recuperado del state consumido en el callback.
- Tokens Notion se guardan cifrados con AES-256-GCM.
- No se escribe en las tablas RPG ni se migra información a Notion en esta fase.

## Descubrimiento de Notion

El backend busca la raíz `HUNTER SYSTEM — Datos`, recorre sus páginas anidadas y descubre las once bases declaradas en `src/services/notion-schema-contract.ts`. Valida tipos de propiedades requeridos y relaciones internas, sin exigir nombres fijos de propiedad ni cambiar el esquema del usuario. Una estructura incompleta deja el workspace en `needs_setup`.

## Pruebas

`npm test` usa respuestas OAuth/Notion simuladas y no conecta cuentas reales. `npm run build` compila TypeScript a `dist/`.
