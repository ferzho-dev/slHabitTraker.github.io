# HUNTER SYSTEM

LEVEL UP YOUR LIFE

Aplicación React + Vite + Tailwind para conectar el proyecto Supabase existente y gestionar el progreso semanal del cazador con una interfaz HUD holográfica.

## Arranque

1. Configura `.env` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (se admite también `VITE_SUPABASE_ANON_KEY`; nunca pongas una `service_role` aquí).
2. Ejecuta `npm install` y `npm run dev`.
3. En Supabase, habilita Email Auth y aplica la migración `supabase/migrations/20261114_add_usuario_auth_link.sql`. Asocia manualmente los perfiles existentes mediante `auth_user_id`.

## Mapeo esperado de la base de datos

Esquema confirmado por el SQL compartido en la conversación:

| Tabla | Columnas consultadas |
| --- | --- |
| `usuario` | `id_usuario` (integer), `auth_user_id` (UUID, agregado por migración), `nombre_cazador`, `nivel_actual`, `experiencia_actual`, `experiencia_siguiente_nivel`, `racha_dias`, `id_rango`, `id_clase` |
| `estadistica_usuario` | `id_usuario`, `id_estadistica`, `puntos_acumulados`; FK `estadistica` relacionada con `estadistica(nombre_estadistica, codigo_corto)` |
| `semana` | `id_semana`, `id_usuario` (integer), `numero_semana`, `fecha_inicio`, `fecha_fin` |
| `dia_registro` | `id_dia`, `id_semana`, `nombre_dia`, `fecha_exacta`, `porcentaje_completado` |
| `habito` | `id_habito`, `id_usuario` (integer), `id_estadistica`, `nombre_habito`, `icono`, `experiencia_base`, `puntos_estadistica`, `es_mision_diaria`, `activo` |
| `habito_completado` | PK compuesta `id_dia` + `id_habito`, `completado`, `hora_completado`, `xp_ganada` |

El UUID de Supabase Auth se consulta solo en `usuario.auth_user_id`; el cliente usa el entero devuelto en `usuario.id_usuario` para `semana`, `habito` y `estadistica_usuario`. Las semanas empiezan en domingo. El formulario obliga a elegir una de las cinco estadísticas. Los iconos se guardan como identificadores de texto en `habito.icono`.

La migración de Auth agrega el vínculo UUID y políticas del perfil. Para cuentas antiguas, en Supabase Auth > Users copia el UUID de la cuenta que corresponde al cazador y vincúlalo. Primero revisa las filas:

```sql
SELECT id_usuario, nombre_cazador, auth_user_id FROM public.usuario ORDER BY id_usuario;
```

Después actualiza cada perfil identificado, sustituyendo ambos valores:

```sql
UPDATE public.usuario
SET auth_user_id = 'UUID_DE_AUTH'
WHERE id_usuario = ID_INTEGER_DEL_PERFIL
  AND auth_user_id IS NULL;
```

La restricción UNIQUE evita vincular una cuenta a dos perfiles. No asocies perfiles solo por nombre.

`supabase/migrations/20261114_owner_policies.sql` agrega políticas para las tablas relacionadas y lectura de catálogos. Revísala y aplícala solo si no existen políticas equivalentes. Para Realtime, habilita `usuario`, `estadistica_usuario`, `habito` y `habito_completado`.

`supabase/migrations/20261115_daily_quest.sql` diseña la persistencia de objetivos, historial, progreso acumulable y reclamación única. Revísala antes de aplicarla; no se ejecuta desde la app.

Para conservar el historial al retirar hábitos, `supabase/migrations/20261116_habito_archive.sql` agrega el borrado lógico. Según el esquema confirmado, `habito.activo` y las columnas snapshot de `habito_completado` ya existen; la migración `20261118_atomic_habit_completion_and_xp.sql` no las vuelve a agregar. Esta migración reemplaza el trigger de progreso, publica `set_habit_completion`, evita recompensas de estadísticas cuando el hábito no tiene `id_estadistica` y restringe escrituras directas de `habito_completado` para que la app use la RPC. Ejecuta después `supabase/migrations/20261119_refresh_habit_rpc_schema_cache.sql` en SQL Editor para aplicar permisos y enviar `NOTIFY pgrst, 'reload schema'`. La columna `habito.icono` ya existe en el esquema compartido.

La RPC usa `p_id_dia integer`, `p_id_habito integer`, `p_completado boolean` y `p_timezone text`; los UUID de Auth no se envían como IDs de día/hábito ni reemplazan `usuario.id_usuario` (integer). Para diagnosticar la base conectada en SQL Editor:

```sql
SELECT p.oid::regprocedure AS firma,
       p.proargnames AS nombres_argumentos,
       pg_catalog.pg_get_function_arguments(p.oid) AS argumentos
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'set_habit_completion';

SELECT has_function_privilege(
  'authenticated',
  'public.set_habit_completion(integer,integer,boolean,text)',
  'EXECUTE'
) AS authenticated_puede_ejecutar;
```

La firma esperada es `set_habit_completion(integer,integer,boolean,text)` con nombres `{p_id_dia,p_id_habito,p_completado,p_timezone}` y permiso `true`. Si no aparece, ejecuta primero la migración 18 completa y luego la 19. Si aparece correctamente pero persiste `PGRST202`, ejecuta `NOTIFY pgrst, 'reload schema';` en Supabase SQL Editor y vuelve a probar.

El formulario de registro usa `supabase.auth.signUp`; si el proyecto exige confirmación por correo, el usuario deberá confirmarlo antes de iniciar sesión.

## Qué incluye

- Sesión persistente y acceso/registro con Supabase Auth.
- Perfil, XP, racha y radar de estadísticas.
- Tabla semanal consultada desde Supabase; los checks usan la RPC transaccional `set_habit_completion` y el trigger de PostgreSQL aplica/revierte XP y estadísticas.
- Selector de iconos Tabler en creación/edición y columnas uniformes con desplazamiento horizontal.
- Navegación ilimitada entre semanas. Las semanas futuras muestran planificación sin checks activos; semanas anteriores son de solo lectura y no se crean filas históricas vacías.
- Diseño HUD adaptable con matriz de días por hábitos, misiones diarias, anillos SVG, alerta de subida de nivel y sonidos Web Audio silenciables desde el encabezado.
- Vite utiliza rutas de assets relativas (`base: './'`) para funcionar en GitHub Pages aunque cambie el nombre del repositorio.
