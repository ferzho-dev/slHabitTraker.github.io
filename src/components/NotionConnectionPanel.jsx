import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Link2, LoaderCircle, Unplug } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { hunterApi } from '../services/hunterApi';

export default function NotionConnectionPanel() {
  const { session } = useAuth();
  const [connection, setConnection] = useState(null);
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const finalizeAttempt = useRef('');

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const ticketFromCallback = hash.get('notion_ticket');
    const query = new URLSearchParams(window.location.search);
    const callbackResult = query.get('notion');
    if (ticketFromCallback && /^[A-Za-z0-9_-]{43}$/.test(ticketFromCallback)) {
      setTicket(ticketFromCallback);
      setMessage('Autorización recibida. Finalizando la conexión de forma segura…');
    } else if (callbackResult === 'error') {
      setMessage('Notion no pudo completar la autorización. Puedes volver a intentarlo.');
    }
    if (ticketFromCallback || callbackResult) {
      const clean = `${window.location.pathname}${window.location.search.replace(/([?&])notion=[^&]*&?/, '$1').replace(/[?&]$/, '')}`;
      window.history.replaceState(null, '', clean || window.location.pathname);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const result = await hunterApi('/api/notion/status', session.access_token);
      setConnection(result.connection);
    } catch (error) { setMessage(error.message); }
  }, [session?.access_token]);

  const finalize = useCallback(async (retry = false) => {
    if (!ticket || !session?.access_token || busy) return;
    const attempt = `${session.user.id}:${ticket}`;
    if (!retry && finalizeAttempt.current === attempt) return;
    finalizeAttempt.current = attempt;
    setBusy(true); setMessage('Verificando la sesión y completando Notion…');
    try {
      const result = await hunterApi('/api/notion/oauth/finalize', session.access_token, { ticket });
      setTicket('');
      setMessage(result.status === 'connected'
        ? 'Workspace de Notion conectado.'
        : 'Notion conectado. Falta completar la configuración de sus bases de datos.');
      await loadStatus();
    } catch (error) {
      setMessage(error.code === 'oauth_ticket_invalid_expired_or_used'
        ? 'El ticket expiró, ya fue usado o la sesión no corresponde. Inicia una nueva conexión con la cuenta correcta.'
        : `No se pudo finalizar la conexión: ${error.message}`);
    } finally { setBusy(false); }
  }, [ticket, session, busy, loadStatus]);

  useEffect(() => {
    if (session?.access_token) void loadStatus();
  }, [loadStatus, session?.access_token]);

  useEffect(() => {
    if (ticket && session?.access_token) void finalize();
  }, [ticket, session?.access_token, finalize]);

  async function start() {
    if (!session?.access_token || busy) return;
    setBusy(true); setMessage('Abriendo autorización segura de Notion…');
    try {
      const { authorizationUrl } = await hunterApi('/api/notion/oauth/start', session.access_token, {});
      window.location.assign(authorizationUrl);
    } catch (error) { setMessage(`No se pudo iniciar la conexión: ${error.message}`); setBusy(false); }
  }

  async function disconnect() {
    if (!session?.access_token || busy) return;
    setBusy(true);
    try {
      await hunterApi('/api/notion/disconnect', session.access_token, {});
      setConnection({ status: 'disconnected' });
      setMessage('Workspace de Notion desconectado.');
    } catch (error) { setMessage(`No se pudo desconectar Notion: ${error.message}`); }
    finally { setBusy(false); }
  }

  const connected = ['connected', 'needs_setup'].includes(connection?.status);
  return <section className="notion-connect panel" aria-live="polite">
    <div className="notion-connect-copy"><p className="eyebrow">VÍNCULO DE WORKSPACE</p>
      <strong>{connected ? connection.workspace_name || 'Notion conectado' : 'Notion no conectado'}</strong>
      {message && <span className="notion-message">{message}</span>}
    </div>
    <div className="notion-connect-actions">
      {ticket && !busy && <button className="notion-button" onClick={() => void finalize(true)}><Link2 size={14}/> Reintentar canje</button>}
      {connected
        ? <button className="notion-button" onClick={() => void disconnect()} disabled={busy}><Unplug size={14}/> Desconectar</button>
        : <button className="notion-button" onClick={() => void start()} disabled={busy || !session?.access_token}>{busy ? <LoaderCircle className="notion-spin" size={14}/> : <ExternalLink size={14}/>} Conectar Notion</button>}
    </div>
  </section>;
}
