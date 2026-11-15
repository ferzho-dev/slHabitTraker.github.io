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
