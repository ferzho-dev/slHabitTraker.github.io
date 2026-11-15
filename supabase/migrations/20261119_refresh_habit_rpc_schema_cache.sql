-- Apply after 20261118_atomic_habit_completion_and_xp.sql.
-- GRANT fails if the expected function signature is absent.
REVOKE ALL ON FUNCTION public.set_habit_completion(integer, integer, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_habit_completion(integer, integer, boolean, text) TO authenticated;

-- Refresh PostgREST after the function signature changes.
NOTIFY pgrst, 'reload schema';
