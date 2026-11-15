-- Additive bridge between Supabase Auth (UUID) and the existing integer profile key.
-- Existing rows remain untouched. Link pre-existing profiles manually before relying on them.
ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS usuario_auth_user_id_uidx
  ON public.usuario (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'usuario_auth_user_id_fkey'
      AND conrelid = 'public.usuario'::regclass
  ) THEN
    ALTER TABLE public.usuario
      ADD CONSTRAINT usuario_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- Optional baseline RLS policy for the profile itself. Add equivalent owner policies
-- for related tables after reviewing the project's existing policies.
ALTER TABLE public.usuario ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usuario'
      AND policyname = 'usuario_read_own_profile'
  ) THEN
    CREATE POLICY usuario_read_own_profile ON public.usuario
      FOR SELECT TO authenticated
      USING (auth_user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usuario'
      AND policyname = 'usuario_insert_own_profile'
  ) THEN
    CREATE POLICY usuario_insert_own_profile ON public.usuario
      FOR INSERT TO authenticated
      WITH CHECK (auth_user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usuario'
      AND policyname = 'usuario_update_own_profile'
  ) THEN
    CREATE POLICY usuario_update_own_profile ON public.usuario
      FOR UPDATE TO authenticated
      USING (auth_user_id = (SELECT auth.uid()))
      WITH CHECK (auth_user_id = (SELECT auth.uid()));
  END IF;
END
$$;
