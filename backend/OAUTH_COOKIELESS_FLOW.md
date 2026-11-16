# OAuth Notion sin cookies de terceros

## Alternativas

**A. Dominios personalizados same-site.** Publicar frontend y API en subdominios HTTPS del mismo dominio registrable, por ejemplo `app.midominio.com` y `api.midominio.com`. Conserva una cookie `HttpOnly; Secure` y evita el contexto de cookie de terceros. Es el flujo más simple si ya se controla un dominio, pero exige DNS, dominio personalizado en GitHub Pages y Render, certificados y mantener los dominios alineados.

**B. Ticket de finalización de un solo uso (implementada).** Mantiene GitHub Pages y Render en sus dominios actuales y usa un ticket aleatorio temporal canjeado con el JWT de Supabase. Requiere la migración técnica 003, pero no depende de cookies cross-site. Esta opción se recomienda para el despliegue actual porque no exige dominio propio y sobrevive al bloqueo de cookies de terceros.

## Flujo

```mermaid
sequenceDiagram
  actor U as Usuario
  participant FE as React en GitHub Pages
  participant API as API en Render
  participant DB as PostgreSQL privado
  participant N as Notion OAuth
  U->>FE: Conectar Notion (sesión Supabase)
  FE->>API: POST /oauth/start + Bearer JWT
  API->>DB: Guardar hash(state), UUID y expiración
  API-->>FE: URL de autorización (state aleatorio)
  FE->>N: Navegación a Notion
  N->>API: Callback con code + state
  API->>DB: Consumir state una sola vez; recuperar UUID propietario
  API->>N: Intercambiar code en servidor
  N-->>API: Tokens Notion
  API->>DB: Guardar hash(ticket) y tokens cifrados, TTL 180 s
  API-->>FE: Redirect con ticket temporal en fragmento URL
  FE->>FE: Leer fragmento y borrarlo inmediatamente del historial
  FE->>API: POST /oauth/finalize + JWT Supabase + ticket
  API->>DB: Verificar mismo UUID, caducidad y uso único; guardar conexión atómicamente
  API-->>FE: Estado de conexión
```

El fragmento `#notion_ticket=...` no se envía al servidor web de GitHub Pages ni en el encabezado `Referer`; React lo retira inmediatamente con `history.replaceState`. El frontend conserva el ticket solo en memoria. Los tokens de Notion nunca salen de Render y se guardan cifrados.

## Cambios y despliegue manual pendiente

1. Ejecutar `migrations/003_oauth_completion_tickets.sql` en PostgreSQL después de 001 y 002, con el propietario que administra `app_private`. Esta migración no toca tablas RPG. No se ejecutó durante esta tarea.
2. En el backend Render, establecer `FRONTEND_SUCCESS_URL` como URL base del frontend sin query `notion=connected` (p. ej. `https://<usuario>.github.io/<repo>/`). Mantener `FRONTEND_ORIGIN` igual al origen exacto del frontend.
3. En GitHub Pages Actions/build, establecer `VITE_HUNTER_API_URL` con la URL HTTPS de Render y rebuild/redeploy del frontend cuando se autorice un despliegue.
4. Mantener `NOTION_REDIRECT_URI` igual, carácter por carácter, en el backend y configuración de la integración de Notion.
5. La app usa `Authorization: Bearer <sesión Supabase>` y `credentials: omit`; CORS permite solo `FRONTEND_ORIGIN` y no habilita credenciales de cookies.

## Verificación de seguridad

- CSRF/state: callback sin state válido, state desconocido, vencido o ya consumido debe redirigir con error sin intercambiar el código.
- Repetición: canjear un ticket válido una vez; repetirlo debe responder 409 y no reescribir conexión.
- Expiración: después de 180 segundos, canje debe responder 409.
- Cambio de usuario: JWT de B intentando canjear ticket de A debe responder 409 y no consumirlo; A aún puede canjear dentro del plazo.
- Sin sesión: `/oauth/finalize` sin bearer válido debe responder 401.
- Filtración: callback puede contener temporalmente `code` solo en la URL servidor-servidor del redirect del proveedor; el redirect al frontend solo contiene ticket fragmentado. Ningún access/refresh token o client secret debe aparecer en URL o frontend.
- Navegador: probar Firefox con protección estricta, Safari con prevención de seguimiento y Chrome con bloqueo de cookies de terceros. El flujo no usa cookies para la transacción OAuth.

Estos son casos previstos por la implementación y sus pruebas automatizadas; para confirmar el comportamiento con Notion, Supabase Auth y Render reales se necesita aplicar la 003 y probar una autorización real en entorno de staging.
