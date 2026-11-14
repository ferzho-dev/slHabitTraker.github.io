import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, LogIn, LogOut, RefreshCw, ShieldAlert, Swords, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { isSupabaseConfigured, supabase } from './services/supabaseClient';
import StatusPanel from './components/StatusPanel';
import HabitTrackerTable from './components/HabitTrackerTable';
import SystemAlert from './components/SystemAlert';
import SystemNotificationModal from './components/SystemNotificationModal';
import HabitCreateModal from './components/HabitCreateModal';
import { getAudioMuted, playSystemSound, setAudioMuted } from './utils/systemAudio';

const RadarChartWidget = lazy(() => import('./components/RadarChartWidget'));

const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function isoWeek(date) {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  return { year, week: 1 + Math.round((thursday - firstThursday) / 604800000) };
}
const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const allowedStatCodes = new Set(['STR', 'AGI', 'SEN', 'VIT', 'INT']);

function AuthScreen() {
  const { signIn, signUp, authError } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin'); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  async function submit(event) { event.preventDefault(); setBusy(true); setNotice(''); try { if (mode === 'signup') { await signUp(email, password); setNotice('Cuenta creada. Si Supabase solicita confirmación, revisa tu correo.'); } else await signIn(email, password); } catch {} finally { setBusy(false); } }
  return <main className="auth-screen"><div className="auth-card panel"><div className="brand-mark"><Swords size={23}/></div><p className="eyebrow">HUNTER SYSTEM · ACCESO</p><h1>Entra al sistema</h1><p className="muted">Inicia sesión para sincronizar tu progreso de cazador.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cazador@correo.com"/></label><label>Contraseña<input type="password" required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres"/></label>{authError && <p className="form-error">{authError}</p>}{notice && <p className="form-notice">{notice}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Conectando...' : mode === 'signin' ? <><LogIn size={16}/> Iniciar sesión</> : 'Crear cuenta'}</button></form><button className="text-button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setNotice(''); }}>{mode === 'signin' ? '¿Primera vez? Crear cuenta' : 'Ya tengo una cuenta'}</button></div></main>;
}

export default function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const authUserId = user?.id == null ? '' : String(user.id);
  const [profile, setProfile] = useState(null); const [stats, setStats] = useState([]); const [habits, setHabits] = useState([]);
  const [statCatalog, setStatCatalog] = useState([]); const [habitModalOpen, setHabitModalOpen] = useState(false);
  const [days, setDays] = useState([]); const [completed, setCompleted] = useState([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [weekOffset, setWeekOffset] = useState(0); const [alert, setAlert] = useState(null); const [levelAlert, setLevelAlert] = useState(false);
  const [muted, setMuted] = useState(getAudioMuted); const previousLevel = useRef(null); const warnedPending = useRef(false);
  const notify = useCallback((message, type = 'info') => { setAlert({ message, type }); window.setTimeout(() => setAlert(null), 4500); }, []);

  const loadData = useCallback(async () => {
    if (!user || !supabase) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authUserId)) {
      setError('La sesión no contiene un UUID válido para id_usuario.');
      return;
    }
    setBusy(true); setError('');
    try {
      // Supabase Auth UUID is the profile primary key in the documented schema.
      let { data: hunter, error: profileError } = await supabase.from('usuario')
        .select('*, rango:rango(nombre_rango), clase_cazador:clase_cazador(nombre_clase)')
        .eq('id_usuario', authUserId).maybeSingle();
      if (profileError) throw profileError;
      if (!hunter) {
        const { data: createdProfile, error: createProfileError } = await supabase.from('usuario')
          .insert({ id_usuario: authUserId, nombre_cazador: user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'Cazador' })
          .select('*, rango:rango(nombre_rango), clase_cazador:clase_cazador(nombre_clase)').single();
        if (createProfileError) throw createProfileError;
        hunter = createdProfile;
      }
      setProfile(hunter);
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay() + weekOffset * 7);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      const startDate = localDateKey(start); const endDate = localDateKey(end);
      const { year, week } = isoWeek(start);
      let { data: weekRow, error: weekError } = await supabase.from('semana').select('id_semana').eq('id_usuario', authUserId).eq('fecha_inicio', startDate).maybeSingle();
      if (weekError) throw weekError;
      if (!weekRow) {
        const { data, error } = await supabase.from('semana').insert({ id_usuario: authUserId, anio_iso: year, numero_semana: week, fecha_inicio: startDate, fecha_fin: localDateKey(new Date(end.getTime() - 86400000)) }).select('id_semana').single();
        if (error) throw error;
        weekRow = data;
      }
      const { data: existingDays, error: existingDaysError } = await supabase.from('dia_registro').select('id_dia, fecha_exacta, nombre_dia').eq('id_semana', weekRow.id_semana).eq('id_usuario', authUserId);
      if (existingDaysError) throw existingDaysError;
      const existingDateSet = new Set((existingDays ?? []).map((day) => String(day.fecha_exacta).slice(0, 10)));
      const missingDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return { id_semana: weekRow.id_semana, id_usuario: authUserId, nombre_dia: dayNames[date.getDay()], fecha_exacta: localDateKey(date) }; }).filter((day) => !existingDateSet.has(day.fecha_exacta));
      if (missingDays.length) {
        const { error } = await supabase.from('dia_registro').insert(missingDays);
        if (error) throw error;
      }
      const [statsResult, habitsResult, daysResult, catalogResult] = await Promise.all([
        supabase.from('estadistica_usuario').select('id_estadistica, puntos_acumulados, estadistica:estadistica(nombre_estadistica, codigo_corto)').eq('id_usuario', authUserId),
        supabase.from('habito').select('*').eq('id_usuario', authUserId).eq('activo', true).order('id_habito'),
        supabase.from('dia_registro').select('id_dia, id_usuario, id_semana, fecha_exacta, nombre_dia').eq('id_semana', weekRow.id_semana).eq('id_usuario', authUserId).order('fecha_exacta'),
        supabase.from('estadistica').select('id_estadistica, nombre_estadistica, codigo_corto').order('id_estadistica'),
      ]);
      const failed = [statsResult, habitsResult, daysResult, catalogResult].find((result) => result.error);
      if (failed) throw failed.error;
      const dayIds = (daysResult.data ?? []).map((day) => day.id_dia);
      const progressResult = dayIds.length
        ? await supabase.from('vw_progreso_dia').select('id_dia, porcentaje_completado').in('id_dia', dayIds)
        : { data: [], error: null };
      if (progressResult.error) throw progressResult.error;
      const normalizedStats = (statsResult.data ?? []).map((item) => ({ ...item, codigo: item.estadistica?.codigo_corto, nombre: item.estadistica?.nombre_estadistica, valor: item.puntos_acumulados }));
      setStatCatalog((catalogResult.data ?? []).filter((item) => allowedStatCodes.has(String(item.codigo_corto).toUpperCase())));
      const dailyProgress = new Map((progressResult.data ?? []).map((row) => [row.id_dia, row.porcentaje_completado]));
      const daysWithProgress = (daysResult.data ?? []).map((day) => ({ ...day, porcentaje_completado: Number(dailyProgress.get(day.id_dia) ?? 0) }));
      setStats(normalizedStats); setHabits(habitsResult.data ?? []); setDays(daysWithProgress);
      if (!dayIds.length) { setCompleted([]); return; }
      const { data: completedRows, error: completionError } = await supabase.from('habito_completado').select('id_dia, id_habito, completado, xp_ganada, puntos_ganados').in('id_dia', dayIds);
      if (completionError) throw completionError;
      setCompleted((completedRows ?? []).filter((row) => row.completado));
      if (!warnedPending.current) {
        const todayKey = localDateKey(new Date());
        const todayRow = (daysResult.data ?? []).find((day) => String(day.fecha_exacta).slice(0, 10) === todayKey);
        const todaysDone = new Set((completedRows ?? []).filter((row) => row.completado && row.id_dia === todayRow?.id_dia).map((row) => row.id_habito));
        const pendingDaily = (habitsResult.data ?? []).some((habit) => habit.es_mision_diaria && !todaysDone.has(habit.id_habito));
        if (pendingDaily) { notify('Hay misiones diarias pendientes para hoy.', 'warning'); playSystemSound('warning'); }
        warnedPending.current = true;
      }
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el perfil.');
    } finally { setBusy(false); }
  }, [user, weekOffset]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (!user || !supabase) return;
    let timer;
    const channel = supabase.channel(`hunter-live-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usuario', filter: `id_usuario=eq.${authUserId}` }, () => { clearTimeout(timer); timer = setTimeout(loadData, 250); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estadistica_usuario', filter: `id_usuario=eq.${authUserId}` }, () => { clearTimeout(timer); timer = setTimeout(loadData, 250); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habito_completado', filter: `id_usuario=eq.${authUserId}` }, () => { clearTimeout(timer); timer = setTimeout(loadData, 250); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habito', filter: `id_usuario=eq.${authUserId}` }, () => { clearTimeout(timer); timer = setTimeout(loadData, 250); })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [user, authUserId, loadData]);
  useEffect(() => {
    if (!profile) return;
    const level = Number(profile.nivel_actual ?? 1);
    if (previousLevel.current === null) previousLevel.current = level;
    else if (level > previousLevel.current) { setLevelAlert(true); playSystemSound('level'); }
    previousLevel.current = level;
  }, [profile]);
  const hunterName = useMemo(() => profile?.nombre_cazador ?? user?.user_metadata?.name ?? user?.email?.split('@')[0], [profile, user]);

  async function toggleHabit(day, habit, isDone) {
    if (!supabase || !day || busy) return;
    const applyOptimistic = (checked) => {
      const nextRows = [...completed.filter((row) => !(row.id_dia === day.id_dia && row.id_habito === habit.id_habito)), ...(checked ? [{ id_dia: day.id_dia, id_habito: habit.id_habito, completado: true }] : [])];
      setCompleted(nextRows);
      const countForDay = nextRows.filter((row) => row.id_dia === day.id_dia && row.completado).length;
      setDays((current) => current.map((row) => row.id_dia === day.id_dia ? { ...row, porcentaje_completado: habits.length ? Math.round((countForDay / habits.length) * 100) : 0 } : row));
    };
    let shouldRefresh = false;
    setBusy(true);
    try {
      if (isDone) {
        applyOptimistic(false);
        const { error: updateError } = await supabase.from('habito_completado').update({ completado: false }).eq('id_dia', day.id_dia).eq('id_habito', habit.id_habito);
        if (updateError) throw updateError;
        playSystemSound('check');
        notify('Misión desmarcada.', 'info');
        shouldRefresh = true;
      } else {
        applyOptimistic(true);
        const { data: oldRow, error: findError } = await supabase.from('habito_completado').select('id_dia, id_habito').eq('id_dia', day.id_dia).eq('id_habito', habit.id_habito).maybeSingle();
        if (findError) throw findError;
        const write = oldRow
          ? supabase.from('habito_completado').update({ completado: true }).eq('id_dia', day.id_dia).eq('id_habito', habit.id_habito)
          : supabase.from('habito_completado').insert({ id_dia: day.id_dia, id_habito: habit.id_habito, id_usuario: authUserId, completado: true });
        const { data, error: writeError } = await write.select('id_dia, id_habito, completado, xp_ganada, puntos_ganados').single();
        if (writeError) throw writeError;
        setCompleted((current) => [...current.filter((row) => !(row.id_dia === day.id_dia && row.id_habito === habit.id_habito)), data]);
        playSystemSound('check');
        notify(`+${data.xp_ganada ?? 0} XP · +${data.puntos_ganados ?? 0} PTS ADQUIRIDOS`, 'success');
        shouldRefresh = true;
      }
    } catch (toggleError) { shouldRefresh = true; notify(toggleError.message || 'No se pudo guardar el cambio.', 'error'); }
    finally { setBusy(false); }
    if (shouldRefresh) loadData();
  }

  async function createHabit({ nombre, descripcion, idEstadistica, experienciaBase, puntosEstadistica, diaria }) {
    if (!supabase || !authUserId) throw new Error('No hay una sesión de cazador activa.');
    const selectedStat = statCatalog.find((stat) => String(stat.id_estadistica) === String(idEstadistica));
    if (!selectedStat || !allowedStatCodes.has(String(selectedStat.codigo_corto).toUpperCase())) {
      throw new Error('El hábito debe vincularse a STR, AGI, SEN, VIT o INT.');
    }
    const { error: createError } = await supabase.from('habito').insert({
      id_usuario: authUserId,
      id_estadistica: selectedStat.id_estadistica,
      nombre_habito: nombre.trim(),
      descripcion: descripcion.trim() || null,
      experiencia_base: Number(experienciaBase),
      puntos_estadistica: Number(puntosEstadistica),
      es_mision_diaria: Boolean(diaria),
      activo: true,
    });
    if (createError) throw createError;
    notify('Nueva misión agregada al registro del cazador.', 'success');
    playSystemSound('open');
    loadData();
  }

  if (!isSupabaseConfigured) return <main className="setup-screen"><section className="setup-card panel"><ShieldAlert size={32}/><p className="eyebrow">CONFIGURACIÓN REQUERIDA</p><h1>Conecta tu proyecto Supabase</h1><p>Agrega la URL del proyecto y su clave publicable en <code>.env</code>, usando <code>.env.example</code> como guía. Reinicia el servidor de desarrollo después de guardarlas.</p></section></main>;
  if (authLoading) return <main className="loading-screen"><div className="loader-orbit"/><span>Conectando con el sistema...</span></main>;
  if (!user) return <AuthScreen/>;

  const streak = Number(profile?.racha_dias ?? 0);
  const currentLevel = Number(profile?.nivel_actual ?? 1);
  const currentXp = Number(profile?.experiencia_actual ?? 0);
  const nextXp = Number(profile?.experiencia_siguiente_nivel ?? 100);
  const doneCount = completed.length;
  return <div className="app-shell min-h-screen"><header className="topbar"><a className="brand" href="#top"><span className="brand-mark small"><Swords size={17}/></span><span>SYSTEM INTERFACE <span className="brand-accent">v2.4</span></span></a><div className="topbar-right"><span className="system-status"><i/> SISTEMA EN LÍNEA</span><span className="streak-chip">RACHA <b>{streak}</b></span><span className="user-email">{user.email}</span><button className="icon-button" title={muted ? 'Activar efectos de sonido' : 'Silenciar efectos de sonido'} onClick={() => { const next = !muted; setMuted(next); setAudioMuted(next); if (!next) playSystemSound('open'); }}>{muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button><button className="icon-button" title="Actualizar datos" onClick={loadData} disabled={busy}><RefreshCw size={16}/></button><button className="icon-button" title="Cerrar sesión" onClick={signOut}><LogOut size={16}/></button></div></header>
    <main className="dashboard mx-auto w-full" id="top"><div className="welcome-row"><div><p className="eyebrow"><Activity size={13}/> INTERFAZ DEL CAZADOR</p><h2>HUNTER CONTROL</h2><p className="muted">Estado del cazador · <span className="date-chip">{new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span></p></div></div>
      {error && <div className="error-banner"><ShieldAlert size={18}/><div><b>No se pudieron cargar todos los datos</b><span>{error}</span></div><button onClick={loadData}>Reintentar</button></div>}
      <div className="hud-layout"><aside className="profile-column"><StatusPanel nombreCazador={hunterName} nivelActual={currentLevel} experienciaActual={currentXp} experienciaSiguienteNivel={nextXp} rachaDias={streak} rango={profile?.rango?.letra_rango ?? profile?.rango?.nombre_rango} claseCazador={profile?.clase_cazador?.nombre_clase}/><Suspense fallback={<section className="panel radar-panel table-state">CARGANDO ATRIBUTOS...</section>}><RadarChartWidget estadisticas={stats}/></Suspense></aside><section className="mission-column"><section className="panel weekly-summary"><p className="eyebrow">WEEKLY QUEST CLEARANCE</p><div className="summary-value">{doneCount}<span> / {habits.length * 7} OBJETIVOS</span></div><div className="summary-line"><span>PROGRESO GLOBAL</span><span>{habits.length ? Math.round((doneCount / (habits.length * 7)) * 100) : 0}%</span></div><div className="summary-track"><div style={{ width: `${habits.length ? Math.min(100, (doneCount / (habits.length * 7)) * 100) : 0}%` }}/></div></section><HabitTrackerTable dias={days} habitos={habits} completados={completed} loading={busy} onToggle={toggleHabit} onCreate={() => setHabitModalOpen(true)} weekOffset={weekOffset} onWeekChange={(delta) => setWeekOffset((current) => Math.min(0, current + delta))}/></section></div>
      <footer className="footer-note"><span>HUNTER SYSTEM <i>·</i> PROTOCOLO DE PROGRESO</span><span>Sesión protegida con Supabase Auth</span></footer>
    </main><HabitCreateModal open={habitModalOpen} statistics={statCatalog} onClose={() => setHabitModalOpen(false)} onCreate={createHabit}/><SystemAlert alert={alert} onClose={() => setAlert(null)}/><SystemNotificationModal open={levelAlert} title="¡HAS SUBIDO DE NIVEL!" message="El Sistema reconoce tu progreso, cazador." onClose={() => setLevelAlert(false)}/></div>;
}
