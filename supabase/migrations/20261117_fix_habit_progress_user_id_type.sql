-- Fix the RPG progress trigger: related user IDs are integer profile IDs.
-- The Auth UUID belongs only in usuario.auth_user_id.
CREATE OR REPLACE FUNCTION public.procesar_progreso_habito()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_id_usuario integer;
    v_id_estadistica integer;
    v_xp_base integer;
    v_puntos_est integer;
    v_actual_xp integer;
    v_siguiente_xp integer;
    v_nivel_actual integer;
BEGIN
    IF NEW.completado = TRUE AND (OLD.completado IS NULL OR OLD.completado = FALSE) THEN
        SELECT h.id_usuario, h.id_estadistica, h.experiencia_base, h.puntos_estadistica
        INTO v_id_usuario, v_id_estadistica, v_xp_base, v_puntos_est
        FROM public.habito h
        JOIN public.dia_registro d ON d.id_dia = NEW.id_dia
        WHERE h.id_habito = NEW.id_habito;

        IF v_id_usuario IS NULL THEN
            RAISE EXCEPTION 'No se encontró el hábito % o su perfil de usuario', NEW.id_habito;
        END IF;

        NEW.xp_ganada := v_xp_base;
        NEW.hora_completado := NOW();

        INSERT INTO public.estadistica_usuario AS eu (id_usuario, id_estadistica, puntos_acumulados)
        VALUES (v_id_usuario, v_id_estadistica, v_puntos_est)
        ON CONFLICT (id_usuario, id_estadistica)
        DO UPDATE SET puntos_acumulados = eu.puntos_acumulados + EXCLUDED.puntos_acumulados;

        SELECT u.nivel_actual, u.experiencia_actual, u.experiencia_siguiente_nivel
        INTO v_nivel_actual, v_actual_xp, v_siguiente_xp
        FROM public.usuario u
        WHERE u.id_usuario = v_id_usuario;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se encontró el perfil integer %', v_id_usuario;
        END IF;

        v_actual_xp := v_actual_xp + v_xp_base;
        WHILE v_actual_xp >= v_siguiente_xp LOOP
            v_actual_xp := v_actual_xp - v_siguiente_xp;
            v_nivel_actual := v_nivel_actual + 1;
            v_siguiente_xp := ROUND(v_siguiente_xp * 1.20);
        END LOOP;

        UPDATE public.usuario
        SET experiencia_actual = v_actual_xp,
            nivel_actual = v_nivel_actual,
            experiencia_siguiente_nivel = v_siguiente_xp
        WHERE id_usuario = v_id_usuario;

    ELSIF NEW.completado = FALSE AND OLD.completado = TRUE THEN
        SELECT h.id_usuario, h.id_estadistica, h.puntos_estadistica
        INTO v_id_usuario, v_id_estadistica, v_puntos_est
        FROM public.habito h
        WHERE h.id_habito = NEW.id_habito;

        IF v_id_usuario IS NULL THEN
            RAISE EXCEPTION 'No se encontró el hábito % o su perfil de usuario', NEW.id_habito;
        END IF;

        UPDATE public.estadistica_usuario
        SET puntos_acumulados = GREATEST(0, puntos_acumulados - v_puntos_est)
        WHERE id_usuario = v_id_usuario AND id_estadistica = v_id_estadistica;

        UPDATE public.usuario
        SET experiencia_actual = GREATEST(0, experiencia_actual - OLD.xp_ganada)
        WHERE id_usuario = v_id_usuario;

        NEW.xp_ganada := 0;
        NEW.hora_completado := NULL;
    END IF;

    RETURN NEW;
END;
$function$;

-- Existing trigger_actualizar_progreso_cazador remains attached to this function.
