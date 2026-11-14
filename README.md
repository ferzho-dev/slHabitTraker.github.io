# El Sistema · Hunter Interface

Aplicación React + Vite + Tailwind para conectar el proyecto Supabase existente y gestionar el progreso semanal del cazador con una interfaz HUD holográfica.

## Arranque

1. Configura `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (se admite también `VITE_SUPABASE_ANON_KEY`; nunca pongas una `service_role` aquí).
2. Ejecuta `npm install` y `npm run dev`.
3. En Supabase, habilita Email Auth y crea/vincula una fila de `usuario` para cada cuenta autenticada.

## Mapeo esperado de la base de datos

El esquema SQL del proyecto no estaba disponible en el repositorio. Las consultas actuales esperan estos nombres:

| Tabla | Columnas consultadas |
| --- | --- |
| `usuario` | `id_usuario` (UUID vinculado a `auth.users.id`), `nombre_cazador`, `nivel_actual`, `experiencia_actual`, `experiencia_siguiente_nivel`, `experiencia_total`, `racha_dias`, `id_rango`, `id_clase` |
| `estadistica_usuario` | `id_usuario`, `id_estadistica`, `puntos_acumulados`; FK `estadistica` relacionada con `estadistica(nombre_estadistica, codigo_corto)` |
| `semana` | `id_semana`, `id_usuario`, `anio_iso`, `numero_semana`, `fecha_inicio`, `fecha_fin` |
| `dia_registro` | `id_dia`, `id_semana`, `id_usuario`, `nombre_dia`, `fecha_exacta` |
| `habito` | `id_habito`, `id_usuario`, `id_estadistica`, `nombre_habito`, `experiencia_base`, `puntos_estadistica`, `activo` |
| `habito_completado` | PK compuesta `id_dia` + `id_habito`, más `id_usuario`, `completado`, `xp_ganada`, `puntos_ganados` |

El cliente crea la fila de usuario para el UUID de la sesión si todavía no existe. También busca/crea la semana ISO y sus siete días. Los campos derivados de progreso solo se leen desde PostgreSQL; el frontend no concede XP ni puntos. El porcentaje por día se consulta desde `vw_progreso_dia`.

El documento de datos propone `perfil_usuario`, pero la configuración confirmada para este proyecto usa `usuario` con `id_usuario` UUID vinculado a Supabase Auth. Las consultas frontend siguen esa confirmación. La app requiere RLS que permita a cada usuario acceder únicamente a su perfil, semanas, días, hábitos, completados y estadísticas. Las tablas `usuario`, `estadistica_usuario` y `habito_completado` deben tener Realtime habilitado para refrescar los cambios del trigger automáticamente.

El SQL instalado no está en el workspace, así que no se pudo contrastar con las columnas y políticas reales de Supabase. El frontend realiza transición fila inexistente/`false` → `true` y `true` → `false`, preservando la fila para que el trigger revierta correctamente.

El formulario de registro usa `supabase.auth.signUp`; si el proyecto exige confirmación por correo, el usuario deberá confirmarlo antes de iniciar sesión.

## Qué incluye

- Sesión persistente y acceso/registro con Supabase Auth.
- Perfil, XP, racha y radar de estadísticas.
- Tabla semanal de hábitos y guardado en `habito_completado`; insertar una fila activa los triggers configurados en PostgreSQL.
- Diseño HUD adaptable con matriz de días por hábitos, misiones diarias, anillos SVG, alerta de subida de nivel y sonidos Web Audio silenciables desde el encabezado.
