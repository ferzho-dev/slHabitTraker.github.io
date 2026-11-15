# Reparar `set_habit_completion` en Supabase

Esta guía corrige tanto la firma RPC como el trigger de XP. El error `PGRST202` significa que PostgREST no pudo resolver la función solicitada en la caché del esquema; el código del navegador por sí solo no puede crearla.

## Proyecto correcto

El último `.env` local revisado apunta al project ref `ypiacgtybnqtpfevabhd`, que coincide con la URL compartida anteriormente. En Supabase Dashboard verifica que el proyecto abierto tenga ese mismo ref en **Project Settings → General** y que la app desplegada se haya compilado con la URL de ese proyecto. La URL pública se incorpora al bundle al compilar Vite. No copies ni compartas la clave pública ni ninguna clave secreta durante esta comprobación.

## Aplicación en SQL Editor

1. Abre el proyecto con el project ref indicado arriba y entra a **SQL Editor**.
2. La función requiere `usuario.auth_user_id`. Si esa columna no existe, ejecuta primero el archivo completo `supabase/migrations/20261114_add_usuario_auth_link.sql`; conserva los perfiles existentes y deja pendiente el vínculo manual de los perfiles antiguos. Si ya existe, no hace falta volver a ejecutar ese paso.
3. Copia y ejecuta **el archivo completo** `supabase/migrations/20261118_atomic_habit_completion_and_xp.sql` de este repositorio. La migración no altera columnas ni tablas: usa las columnas de snapshot y `habito.activo` que confirmaste existentes, reemplaza las funciones y recrea el trigger. La estadística se actualiza solo cuando el hábito tiene `id_estadistica`; la XP se mantiene aunque esa relación sea NULL.
4. Si la ejecución termina sin error, copia y ejecuta **el archivo completo** `supabase/migrations/20261119_refresh_habit_rpc_schema_cache.sql` en el mismo proyecto. El `GRANT` verifica que la firma tipada existe y envía la notificación de recarga de PostgREST; la migración 18 crea el trigger y fija los nombres de argumentos.
5. No ejecutes solo `NOTIFY` antes de la migración 18: recargar caché no crea una función que no exista.

Los dos archivos anteriores contienen el **SQL completo que se debe ejecutar**, sin transcribir versiones distintas aquí. Sus versiones actuales se reproducen abajo para que puedas revisar la instalación junto a esta guía.

### Migración 18 — función y trigger

```sql
-- Atomic habit completion and reversible XP/stat rewards.
-- The existing integer profile IDs remain unchanged; Auth UUIDs are used only
-- through usuario.auth_user_id.

-- Preserve all existing profile data. For older completed rows, snapshot the
-- current habit stat values only when a completion is next transitioned.
CREATE OR REPLACE FUNCTION public.procesar_progreso_habito()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_id_usuario integer;
    v_id_estadistica integer;
    v_puntos_est integer;
    v_xp_base integer;
    v_delta_xp bigint;
    v_total_xp bigint;
    v_nivel integer;
    v_xp_actual integer;
    v_xp_siguiente integer;
    v_level_cursor integer;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT COALESCE(NEW.completado, false) THEN
            NEW.xp_ganada := 0;
            NEW.hora_completado := NULL;
            RETURN NEW;
        END IF;
        v_delta_xp := 0;
    ELSE
        IF COALESCE(NEW.completado, false) IS NOT DISTINCT FROM COALESCE(OLD.completado, false) THEN
            RETURN NEW;
        END IF;
        v_delta_xp := 0;
    END IF;

    SELECT h.id_usuario, h.id_estadistica, h.puntos_estadistica, h.experiencia_base
      INTO v_id_usuario, v_id_estadistica, v_puntos_est, v_xp_base
      FROM public.habito h
      JOIN public.dia_registro d ON d.id_dia = NEW.id_dia
      JOIN public.semana s ON s.id_semana = d.id_semana
     WHERE h.id_habito = NEW.id_habito;

    IF v_id_usuario IS NULL THEN
        RAISE EXCEPTION 'No se encontró el hábito % y su semana', NEW.id_habito;
    END IF;

    -- Serialize reward changes for this profile, including completions on
    -- different days arriving at the same time.
    SELECT u.nivel_actual, u.experiencia_actual
      INTO v_nivel, v_xp_actual
      FROM public.usuario u
     WHERE u.id_usuario = v_id_usuario
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró el perfil integer %', v_id_usuario;
    END IF;

    IF NEW.completado THEN
        NEW.xp_ganada := GREATEST(0, COALESCE(v_xp_base, 0));
        NEW.hora_completado := pg_catalog.now();
        NEW.id_estadistica_ganada := v_id_estadistica;
        NEW.puntos_estadistica_ganados := CASE
            WHEN v_id_estadistica IS NULL THEN 0
            ELSE GREATEST(0, COALESCE(v_puntos_est, 0))
        END;
        v_delta_xp := NEW.xp_ganada;

        IF v_id_estadistica IS NOT NULL THEN
            INSERT INTO public.estadistica_usuario AS eu (id_usuario, id_estadistica, puntos_acumulados)
            VALUES (v_id_usuario, v_id_estadistica, NEW.puntos_estadistica_ganados)
            ON CONFLICT (id_usuario, id_estadistica)
            DO UPDATE SET puntos_acumulados = eu.puntos_acumulados + EXCLUDED.puntos_acumulados;
        END IF;
    ELSE
        v_delta_xp := -GREATEST(0, COALESCE(OLD.xp_ganada, 0));
        v_id_estadistica := COALESCE(OLD.id_estadistica_ganada, v_id_estadistica);
        v_puntos_est := COALESCE(OLD.puntos_estadistica_ganados, v_puntos_est, 0);

        IF v_id_estadistica IS NOT NULL THEN
            UPDATE public.estadistica_usuario
               SET puntos_acumulados = GREATEST(0, puntos_acumulados - GREATEST(0, v_puntos_est))
             WHERE id_usuario = v_id_usuario AND id_estadistica = v_id_estadistica;
        END IF;

        NEW.xp_ganada := 0;
        NEW.hora_completado := NULL;
    END IF;

    -- Reconstruct total XP from the persisted level + in-level XP, apply only
    -- this transition's delta, then normalize level/progress from level 1.
    -- This supports exact reversals even when the completion crossed a level.
    v_total_xp := GREATEST(0, COALESCE(v_xp_actual, 0));
    v_xp_siguiente := 100;
    FOR v_level_cursor IN 1..(GREATEST(1, COALESCE(v_nivel, 1)) - 1) LOOP
        v_total_xp := v_total_xp + v_xp_siguiente;
        v_xp_siguiente := pg_catalog.round(v_xp_siguiente * 1.20)::integer;
    END LOOP;
    v_total_xp := GREATEST(0, v_total_xp + v_delta_xp);

    v_nivel := 1;
    v_xp_actual := v_total_xp::integer;
    v_xp_siguiente := 100;
    WHILE v_xp_siguiente > 0 AND v_xp_actual >= v_xp_siguiente LOOP
        v_xp_actual := v_xp_actual - v_xp_siguiente;
        v_nivel := v_nivel + 1;
        v_xp_siguiente := pg_catalog.round(v_xp_siguiente * 1.20)::integer;
    END LOOP;

    UPDATE public.usuario
       SET experiencia_actual = v_xp_actual,
           nivel_actual = v_nivel,
           experiencia_siguiente_nivel = v_xp_siguiente
     WHERE id_usuario = v_id_usuario;

    RETURN NEW;
END;
$function$;

DROP FUNCTION IF EXISTS public.set_habit_completion(integer, integer, boolean, text);

CREATE FUNCTION public.set_habit_completion(
    p_id_dia integer,
    p_id_habito integer,
    p_completado boolean,
    p_timezone text DEFAULT 'America/Bogota'
)
RETURNS SETOF public.habito_completado
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id integer;
    v_day_date date;
    v_today date;
    v_week_start date;
    v_active_count integer;
    v_done_count integer;
    v_existing_completed boolean;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION 'Invalid timezone';
    END IF;

    SELECT u.id_usuario INTO v_user_id
      FROM public.usuario u
     WHERE u.auth_user_id = auth.uid();
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Hunter profile is not linked'; END IF;

    SELECT d.fecha_exacta INTO v_day_date
      FROM public.dia_registro d
      JOIN public.semana s ON s.id_semana = d.id_semana
      JOIN public.habito h ON h.id_habito = p_id_habito AND h.id_usuario = s.id_usuario AND COALESCE(h.activo, true)
     WHERE d.id_dia = p_id_dia AND s.id_usuario = v_user_id
     FOR UPDATE OF d;
    IF v_day_date IS NULL THEN RAISE EXCEPTION 'Day or habit does not belong to this hunter'; END IF;

    v_today := (pg_catalog.now() AT TIME ZONE p_timezone)::date;
    v_week_start := v_today - EXTRACT(DOW FROM v_today)::integer;
    IF v_day_date < v_week_start OR v_day_date > v_today THEN
        RAISE EXCEPTION 'Only dates in the current week up to today can be changed';
    END IF;

    SELECT hc.completado INTO v_existing_completed
      FROM public.habito_completado hc
     WHERE hc.id_dia = p_id_dia AND hc.id_habito = p_id_habito
     FOR UPDATE;
    IF FOUND AND v_existing_completed IS NOT DISTINCT FROM COALESCE(p_completado, false) THEN
        RETURN QUERY SELECT hc.* FROM public.habito_completado hc
         WHERE hc.id_dia = p_id_dia AND hc.id_habito = p_id_habito;
        RETURN;
    ELSIF FOUND THEN
        UPDATE public.habito_completado
           SET completado = COALESCE(p_completado, false)
         WHERE id_dia = p_id_dia AND id_habito = p_id_habito;
    ELSE
        INSERT INTO public.habito_completado (id_dia, id_habito, completado)
        VALUES (p_id_dia, p_id_habito, COALESCE(p_completado, false));
    END IF;

    SELECT count(*) INTO v_active_count
      FROM public.habito h WHERE h.id_usuario = v_user_id AND COALESCE(h.activo, true);
    SELECT count(*) INTO v_done_count
      FROM public.habito_completado hc
      JOIN public.habito h ON h.id_habito = hc.id_habito
     WHERE hc.id_dia = p_id_dia AND hc.completado = true AND h.id_usuario = v_user_id AND COALESCE(h.activo, true);
    UPDATE public.dia_registro
       SET porcentaje_completado = CASE WHEN v_active_count = 0 THEN 0 ELSE ROUND(100.0 * v_done_count / v_active_count, 2) END
     WHERE id_dia = p_id_dia;

    RETURN QUERY SELECT hc.* FROM public.habito_completado hc
     WHERE hc.id_dia = p_id_dia AND hc.id_habito = p_id_habito;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_habit_completion(integer, integer, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_habit_completion(integer, integer, boolean, text) TO authenticated;

-- Ensure the XP/stat trigger is attached to the completion table. Replacing a
-- function alone does not create or repair its trigger attachment.
DROP TRIGGER IF EXISTS trigger_actualizar_progreso_cazador
  ON public.habito_completado;
CREATE TRIGGER trigger_actualizar_progreso_cazador
  BEFORE INSERT OR UPDATE ON public.habito_completado
  FOR EACH ROW
  EXECUTE FUNCTION public.procesar_progreso_habito();

REVOKE ALL ON FUNCTION public.procesar_progreso_habito()
  FROM PUBLIC, anon, authenticated;

-- Restrict updates through the app to the RPC so state transitions cannot
-- bypass the row lock and ownership/date checks.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.habito_completado FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.habito_completado TO authenticated;
```

### Migración 19 — permisos y caché

```sql
-- Apply after 20261118_atomic_habit_completion_and_xp.sql.
-- GRANT fails if the expected function signature is absent.
REVOKE ALL ON FUNCTION public.set_habit_completion(integer, integer, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_habit_completion(integer, integer, boolean, text) TO authenticated;

-- Refresh PostgREST after the function signature changes.
NOTIFY pgrst, 'reload schema';
```

## Verificar la instalación sin extensiones ni herramientas externas

Estas consultas se ejecutan en el SQL Editor normal de Supabase. No requieren acceso a `pg_catalog` desde el navegador de la app:

```sql
SELECT p.oid::regprocedure AS firma,
       p.proargnames AS nombres_argumentos,
       pg_catalog.pg_get_function_arguments(p.oid) AS argumentos,
       p.prosecdef AS security_definer
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'set_habit_completion';

SELECT has_function_privilege(
  'authenticated',
  'public.set_habit_completion(integer,integer,boolean,text)',
  'EXECUTE'
) AS authenticated_puede_ejecutar;

SELECT t.tgname, t.tgenabled, p.proname AS funcion_trigger,
       pg_catalog.pg_get_triggerdef(t.oid) AS definicion
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'habito_completado'
  AND NOT t.tgisinternal;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('usuario','id_usuario'), ('usuario','auth_user_id'),
    ('dia_registro','id_dia'), ('habito','id_habito'),
    ('habito','id_usuario'), ('habito_completado','id_dia'),
    ('habito_completado','id_habito')
  )
ORDER BY table_name, column_name;

SELECT auth_user_id, count(*) AS perfiles_vinculados
FROM public.usuario
WHERE auth_user_id IS NOT NULL
GROUP BY auth_user_id
HAVING count(*) > 1;

SELECT indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'usuario'
  AND indexname = 'usuario_auth_user_id_uidx';
```

Esperado: una firma `set_habit_completion(integer,integer,boolean,text)`, nombres `{p_id_dia,p_id_habito,p_completado,p_timezone}`, `security_definer = true`, permiso `true`, y un trigger `trigger_actualizar_progreso_cazador` habilitado (`tgenabled = 'O'`) sobre `habito_completado` para `procesar_progreso_habito`. `usuario.id_usuario` y las FK deben ser `integer`; `usuario.auth_user_id` debe ser UUID.

La consulta de duplicados debe devolver cero filas. La migración `20261114_add_usuario_auth_link.sql` crea el índice único parcial `usuario_auth_user_id_uidx`; la última consulta confirma que está presente.

Si función y trigger salen correctos pero la app aún muestra `PGRST202`, ejecuta de nuevo esta instrucción desde SQL Editor:

```sql
NOTIFY pgrst, 'reload schema';
```

Luego cierra/recarga la aplicación. Si el error no cambia, compara el project ref del mensaje mostrado por la app con el project ref del Dashboard. Si difiere, el bundle desplegado apunta a otro proyecto: vuelve a compilar y publicar con la URL de Supabase correcta. Si coincide y continúa, confirma que `public` aparece en **Project Settings → API → Exposed schemas**.

## Probar desde la aplicación

1. Inicia sesión con el cazador cuyo perfil tenga `auth_user_id = auth.users.id`. La RPC usa ese UUID solo para localizar el perfil; los IDs enviados son los enteros `id_dia` e `id_habito`.
2. En la semana actual, marca una misión de hoy. Debe aparecer la confirmación de XP solo después de que la RPC responda sin error.
3. Desmárcala. La respuesta debe confirmar la reversión; la app refresca el perfil y las estadísticas desde Supabase.
4. Márcala otra vez. Debe otorgar XP una sola vez. Si la RPC falla, el checkbox no se adelanta visualmente y la notificación muestra el código y mensaje original de Supabase.
5. Las fechas pasadas/futuras y los hábitos ajenos son rechazados por la función incluso si se intenta llamar sin usar la interfaz.

Para contrastar XP sin editar valores, antes y después de cada paso consulta en SQL Editor el `id_usuario` entero del perfil de prueba:

```sql
SELECT id_usuario, nivel_actual, experiencia_actual, experiencia_siguiente_nivel
FROM public.usuario
WHERE id_usuario = ID_INTEGER_DEL_PERFIL;

SELECT id_estadistica, puntos_acumulados
FROM public.estadistica_usuario
WHERE id_usuario = ID_INTEGER_DEL_PERFIL
ORDER BY id_estadistica;
```

Guarda los resultados del estado inicial, marca, desmarca y marca de nuevo. Primer marcado: +`habito.experiencia_base` (normalizado si cruza nivel) y +`habito.puntos_estadistica`; desmarcado: vuelve al estado inicial; segundo marcado: vuelve al estado posterior al primer marcado, sin suma extra por la misma transición.

## Alcance y límite de verificación

La función valida `auth.uid()`, encuentra el perfil por `usuario.auth_user_id`, verifica dueño del día/hábito y fecha editable, y bloquea las filas de día/perfil para serializar cambios. El trigger revierte usando `xp_ganada` y los snapshots guardados en cada completado. La RPC es `SECURITY DEFINER`; los clientes autenticados solo tienen permiso de ejecutarla y no tienen `INSERT`/`UPDATE`/`DELETE` directo en `habito_completado`.

No tengo una sesión SQL ni conectividad de red desde este entorno al servidor Supabase, por lo que no puedo afirmar que estas consultas ya se ejecutaron en la instancia remota ni certificar el cambio de XP en sus datos. La aplicación debe considerarse verificada en vivo cuando las consultas anteriores muestren la firma/trigger esperados y el ciclo de prueba complete sin error.
