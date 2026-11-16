import { createClient } from '@supabase/supabase-js';

type Claims = { sub?: unknown; iss?: unknown; aud?: unknown; exp?: unknown };
function decodeClaims(jwt: string): Claims {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('invalid_jwt');
  try { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Claims; }
  catch { throw new Error('invalid_jwt'); }
}

export class SupabaseAuthService {
  private readonly client: ReturnType<typeof createClient> | null;
  private readonly issuer: string;
  constructor(private readonly url: string, key: string, private readonly verifyUser: ((jwt: string) => Promise<string | null>) | null = null) {
    this.client = verifyUser ? null : createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    this.issuer = `${url.replace(/\/$/, '')}/auth/v1`;
  }
  async authenticate(jwt: string): Promise<{ id: string }> {
    if (this.verifyUser) {
      const id = await this.verifyUser(jwt);
      if (!id) throw new Error('invalid_jwt');
      return { id };
    }
    const claims = decodeClaims(jwt);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== this.issuer || !aud.includes('authenticated') || typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) {
      throw new Error('invalid_jwt');
    }
    const { data, error } = await this.client!.auth.getUser(jwt);
    if (error || !data.user || data.user.id !== claims.sub) throw new Error('invalid_jwt');
    return { id: data.user.id };
  }
}
