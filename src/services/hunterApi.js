const apiBase = (import.meta.env.VITE_HUNTER_API_URL ?? '').replace(/\/+$/, '');

export async function hunterApi(path, accessToken, body) {
  if (!apiBase) throw new Error('Falta configurar VITE_HUNTER_API_URL para conectar Notion.');
  const response = await fetch(`${apiBase}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message ?? payload.error ?? `Error HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload;
}
