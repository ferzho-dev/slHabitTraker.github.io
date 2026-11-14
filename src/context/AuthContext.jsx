import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setAuthError(error.message);
      setSession(data?.session ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      setAuthError('');
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo(() => ({
    session, user: session?.user ?? null, loading, authError,
    async signIn(email, password) {
      setAuthError('');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setAuthError(error.message); throw error; }
    },
    async signUp(email, password) {
      setAuthError('');
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setAuthError(error.message); throw error; }
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) setAuthError(error.message);
    },
  }), [session, loading, authError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
