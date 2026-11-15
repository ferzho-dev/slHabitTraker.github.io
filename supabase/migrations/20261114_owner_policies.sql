-- Owner-only access for the integer-keyed tables in the supplied schema.
-- Does not remove existing policies. Review existing policies before applying.

ALTER TABLE public.estadistica_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semana ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dia_registro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habito ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.habito_completado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estadistica ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rango ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clase_cazador ENABLE ROW LEVEL SECURITY;

CREATE POLICY estadistica_usuario_owner_all ON public.estadistica_usuario
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.usuario u WHERE u.id_usuario = estadistica_usuario.id_usuario AND u.auth_user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.usuario u WHERE u.id_usuario = estadistica_usuario.id_usuario AND u.auth_user_id = (SELECT auth.uid())));

CREATE POLICY semana_owner_all ON public.semana
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.usuario u WHERE u.id_usuario = semana.id_usuario AND u.auth_user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.usuario u WHERE u.id_usuario = semana.id_usuario AND u.auth_user_id = (SELECT auth.uid())));

CREATE POLICY dia_registro_owner_all ON public.dia_registro
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.semana s JOIN public.usuario u ON u.id_usuario = s.id_usuario WHERE s.id_semana = dia_registro.id_semana AND u.auth_user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.semana s JOIN public.usuario u ON u.id_usuario = s.id_usuario WHERE s.id_semana = dia_registro.id_semana AND u.auth_user_id = (SELECT auth.uid())));

CREATE POLICY habito_owner_all ON public.habito
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.usuario u WHERE u.id_usuario = habito.id_usuario AND u.auth_user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.usuario u WHERE u.id_usuario = habito.id_usuario AND u.auth_user_id = (SELECT auth.uid())));

CREATE POLICY habito_completado_owner_all ON public.habito_completado
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.dia_registro d JOIN public.semana s ON s.id_semana = d.id_semana JOIN public.usuario u ON u.id_usuario = s.id_usuario WHERE d.id_dia = habito_completado.id_dia AND u.auth_user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.habito h JOIN public.usuario u ON u.id_usuario = h.id_usuario WHERE h.id_habito = habito_completado.id_habito AND u.auth_user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.dia_registro d JOIN public.semana s ON s.id_semana = d.id_semana JOIN public.usuario u ON u.id_usuario = s.id_usuario WHERE d.id_dia = habito_completado.id_dia AND u.auth_user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.habito h JOIN public.usuario u ON u.id_usuario = h.id_usuario WHERE h.id_habito = habito_completado.id_habito AND u.auth_user_id = (SELECT auth.uid()))
  );

CREATE POLICY estadistica_authenticated_read ON public.estadistica
  FOR SELECT TO authenticated USING (true);
CREATE POLICY rango_authenticated_read ON public.rango
  FOR SELECT TO authenticated USING (true);
CREATE POLICY clase_cazador_authenticated_read ON public.clase_cazador
  FOR SELECT TO authenticated USING (true);

-- Creates profiles only after any legacy unlinked profiles have been reviewed.
CREATE OR REPLACE FUNCTION public.ensure_hunter_profile(p_nombre text DEFAULT 'Cazador')
RETURNS public.usuario LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.usuario%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_profile FROM public.usuario WHERE auth_user_id = v_uid;
  IF FOUND THEN RETURN v_profile; END IF;
  IF EXISTS (SELECT 1 FROM public.usuario WHERE auth_user_id IS NULL) THEN
    RAISE EXCEPTION 'Legacy hunter profiles need manual auth_user_id linking before new profile creation';
  END IF;
  INSERT INTO public.usuario(auth_user_id, nombre_cazador)
    VALUES(v_uid, COALESCE(NULLIF(pg_catalog.btrim(p_nombre), ''), 'Cazador'))
    RETURNING * INTO v_profile;
  RETURN v_profile;
END $$;

REVOKE ALL ON FUNCTION public.ensure_hunter_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_hunter_profile(text) TO authenticated;
