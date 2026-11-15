-- Additive soft-delete support for hunter habits.
-- Keeps habito_completado rows and historical XP records intact.
ALTER TABLE public.habito
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.habito.activo IS
  'Indicates whether this habit is shown as an active quest; false preserves it for history.';
