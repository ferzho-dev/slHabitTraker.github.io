-- Draft additive migration. Review and apply only after the owner-policy migration.
-- The mission reward is granted only by claim_daily_quest(), once per mission.

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS puntos_disponibles integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.mision_diaria (
  id_mision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_usuario integer NOT NULL REFERENCES public.usuario(id_usuario) ON DELETE CASCADE,
  fecha_local date NOT NULL,
  zona_horaria text NOT NULL DEFAULT 'America/Bogota',
  vence_en timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','completada','fallida')),
  recompensa_xp integer NOT NULL DEFAULT 150 CHECK (recompensa_xp >= 0),
  puntos_recompensa integer NOT NULL DEFAULT 3 CHECK (puntos_recompensa >= 0),
  reclamada_en timestamptz,
  creada_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id_usuario, fecha_local)
);

CREATE TABLE IF NOT EXISTS public.mision_diaria_objetivo (
  id_objetivo bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_mision bigint NOT NULL REFERENCES public.mision_diaria(id_mision) ON DELETE CASCADE,
  codigo text NOT NULL CHECK (codigo IN ('flexiones','abdominales','sentadillas','kilometros')),
  nombre text NOT NULL,
  objetivo numeric(8,2) NOT NULL CHECK (objetivo > 0),
  progreso numeric(8,2) NOT NULL DEFAULT 0 CHECK (progreso >= 0),
  unidad text NOT NULL,
  completado_en timestamptz,
  UNIQUE (id_mision, codigo)
);

CREATE TABLE IF NOT EXISTS public.mision_diaria_historial (
  id_evento bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id_mision bigint NOT NULL REFERENCES public.mision_diaria(id_mision) ON DELETE CASCADE,
  id_usuario integer NOT NULL REFERENCES public.usuario(id_usuario) ON DELETE CASCADE,
  evento text NOT NULL CHECK (evento IN ('creada','avance','completada','reclamada','fallida')),
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.mision_diaria, public.mision_diaria_objetivo, public.mision_diaria_historial TO authenticated;

ALTER TABLE public.mision_diaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mision_diaria_objetivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mision_diaria_historial ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_mission_owner_read ON public.mision_diaria FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.usuario u WHERE u.id_usuario = mision_diaria.id_usuario AND u.auth_user_id = (SELECT auth.uid())));
CREATE POLICY daily_objective_owner_read ON public.mision_diaria_objetivo FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.mision_diaria m JOIN public.usuario u ON u.id_usuario=m.id_usuario WHERE m.id_mision=mision_diaria_objetivo.id_mision AND u.auth_user_id=(SELECT auth.uid())));
CREATE POLICY daily_history_owner_read ON public.mision_diaria_historial FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.usuario u WHERE u.id_usuario=mision_diaria_historial.id_usuario AND u.auth_user_id=(SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.get_or_create_daily_quest(p_timezone text DEFAULT 'America/Bogota')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_user_id integer; v_date date; v_deadline timestamptz;
  v_mission public.mision_diaria%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN RAISE EXCEPTION 'Invalid timezone'; END IF;
  SELECT u.id_usuario INTO v_user_id FROM public.usuario u WHERE u.auth_user_id=v_uid;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Hunter profile is not linked'; END IF;
  v_date := (pg_catalog.now() AT TIME ZONE p_timezone)::date;
  v_deadline := ((v_date + 1)::timestamp AT TIME ZONE p_timezone);

  UPDATE public.mision_diaria SET estado='fallida'
    WHERE id_usuario=v_user_id AND estado='activa' AND fecha_local < v_date;
  INSERT INTO public.mision_diaria_historial(id_mision,id_usuario,evento)
    SELECT m.id_mision,m.id_usuario,'fallida' FROM public.mision_diaria m
    WHERE m.id_usuario=v_user_id AND m.estado='fallida' AND m.fecha_local < v_date
      AND NOT EXISTS (SELECT 1 FROM public.mision_diaria_historial h WHERE h.id_mision=m.id_mision AND h.evento='fallida');

  INSERT INTO public.mision_diaria(id_usuario,fecha_local,zona_horaria,vence_en)
    VALUES(v_user_id,v_date,p_timezone,v_deadline)
    ON CONFLICT(id_usuario,fecha_local) DO NOTHING;
  SELECT * INTO v_mission FROM public.mision_diaria m WHERE m.id_usuario=v_user_id AND m.fecha_local=v_date FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.mision_diaria_objetivo o WHERE o.id_mision=v_mission.id_mision) THEN
    INSERT INTO public.mision_diaria_objetivo(id_mision,codigo,nombre,objetivo,unidad) VALUES
      (v_mission.id_mision,'flexiones','Flexiones',100,'repeticiones'),
      (v_mission.id_mision,'abdominales','Abdominales',100,'repeticiones'),
      (v_mission.id_mision,'sentadillas','Sentadillas',100,'repeticiones'),
      (v_mission.id_mision,'kilometros','Correr',10,'km');
    INSERT INTO public.mision_diaria_historial(id_mision,id_usuario,evento) VALUES(v_mission.id_mision,v_user_id,'creada');
  END IF;
  RETURN pg_catalog.to_jsonb(v_mission) || pg_catalog.jsonb_build_object('objetivos',
    (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) ORDER BY o.id_objetivo) FROM public.mision_diaria_objetivo o WHERE o.id_mision=v_mission.id_mision));
END $$;

CREATE OR REPLACE FUNCTION public.add_daily_quest_progress(p_codigo text,p_cantidad numeric,p_timezone text DEFAULT 'America/Bogota')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_user_id integer; v_date date; v_mission public.mision_diaria%ROWTYPE;
  v_objective public.mision_diaria_objetivo%ROWTYPE; v_completed boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'Progress must be positive'; END IF;
  IF p_codigo NOT IN ('flexiones','abdominales','sentadillas','kilometros') THEN RAISE EXCEPTION 'Invalid objective'; END IF;
  SELECT u.id_usuario INTO v_user_id FROM public.usuario u WHERE u.auth_user_id=v_uid;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Hunter profile is not linked'; END IF;
  v_date := (pg_catalog.now() AT TIME ZONE p_timezone)::date;
  SELECT * INTO v_mission FROM public.mision_diaria m WHERE m.id_usuario=v_user_id AND m.fecha_local=v_date FOR UPDATE;
  IF v_mission.id_mision IS NULL OR v_mission.estado <> 'activa' OR pg_catalog.now() >= v_mission.vence_en THEN RAISE EXCEPTION 'Daily mission is not active'; END IF;
  UPDATE public.mision_diaria_objetivo o SET progreso=LEAST(o.objetivo,o.progreso+p_cantidad),
    completado_en=CASE WHEN LEAST(o.objetivo,o.progreso+p_cantidad)>=o.objetivo THEN COALESCE(o.completado_en,pg_catalog.now()) ELSE NULL END
    WHERE o.id_mision=v_mission.id_mision AND o.codigo=p_codigo RETURNING * INTO v_objective;
  IF v_objective.id_objetivo IS NULL THEN RAISE EXCEPTION 'Objective not found'; END IF;
  INSERT INTO public.mision_diaria_historial(id_mision,id_usuario,evento,datos)
    VALUES(v_mission.id_mision,v_user_id,'avance',pg_catalog.jsonb_build_object('codigo',p_codigo,'cantidad',p_cantidad,'progreso',v_objective.progreso));
  SELECT pg_catalog.bool_and(o.progreso>=o.objetivo) INTO v_completed FROM public.mision_diaria_objetivo o WHERE o.id_mision=v_mission.id_mision;
  IF v_completed THEN
    UPDATE public.mision_diaria SET estado='completada' WHERE id_mision=v_mission.id_mision;
    INSERT INTO public.mision_diaria_historial(id_mision,id_usuario,evento) VALUES(v_mission.id_mision,v_user_id,'completada');
  END IF;
  RETURN pg_catalog.to_jsonb(v_objective);
END $$;

CREATE OR REPLACE FUNCTION public.claim_daily_quest(p_timezone text DEFAULT 'America/Bogota')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_user_id integer; v_date date; v_mission public.mision_diaria%ROWTYPE;
  v_level integer; v_xp integer; v_next integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT u.id_usuario INTO v_user_id FROM public.usuario u WHERE u.auth_user_id=v_uid;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Hunter profile is not linked'; END IF;
  v_date := (pg_catalog.now() AT TIME ZONE p_timezone)::date;
  SELECT * INTO v_mission FROM public.mision_diaria m WHERE m.id_usuario=v_user_id AND m.estado='completada' AND m.reclamada_en IS NULL AND m.fecha_local<=v_date ORDER BY m.fecha_local DESC LIMIT 1 FOR UPDATE;
  IF v_mission.id_mision IS NULL OR v_mission.estado <> 'completada' OR v_mission.reclamada_en IS NOT NULL THEN RAISE EXCEPTION 'Reward unavailable or already claimed'; END IF;
  SELECT u.nivel_actual,u.experiencia_actual,u.experiencia_siguiente_nivel INTO v_level,v_xp,v_next FROM public.usuario u WHERE u.id_usuario=v_user_id FOR UPDATE;
  v_xp := v_xp + v_mission.recompensa_xp;
  WHILE v_next > 0 AND v_xp >= v_next LOOP v_xp := v_xp-v_next; v_level := v_level+1; v_next := pg_catalog.round(v_next*1.20); END LOOP;
  UPDATE public.usuario SET experiencia_actual=v_xp,nivel_actual=v_level,experiencia_siguiente_nivel=v_next,puntos_disponibles=puntos_disponibles+v_mission.puntos_recompensa WHERE id_usuario=v_user_id;
  UPDATE public.mision_diaria SET reclamada_en=pg_catalog.now() WHERE id_mision=v_mission.id_mision;
  INSERT INTO public.mision_diaria_historial(id_mision,id_usuario,evento,datos) VALUES(v_mission.id_mision,v_user_id,'reclamada',pg_catalog.jsonb_build_object('xp',v_mission.recompensa_xp,'puntos',v_mission.puntos_recompensa));
  RETURN pg_catalog.jsonb_build_object('xp',v_mission.recompensa_xp,'puntos',v_mission.puntos_recompensa,'nivel',v_level,'experiencia_actual',v_xp,'experiencia_siguiente_nivel',v_next);
END $$;

REVOKE ALL ON FUNCTION public.get_or_create_daily_quest(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_daily_quest_progress(text,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_daily_quest(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_daily_quest(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_daily_quest_progress(text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_quest(text) TO authenticated;
