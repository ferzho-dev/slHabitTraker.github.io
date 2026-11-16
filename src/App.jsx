import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, LogIn, LogOut, RefreshCw, ShieldAlert, Swords, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { isSupabaseConfigured, supabase } from './services/supabaseClient';
import StatusPanel from './components/StatusPanel';
import HabitTrackerTable from './components/HabitTrackerTable';
import SystemAlert from './components/SystemAlert';
import SystemNotificationModal from './components/SystemNotificationModal';
import HabitCreateModal from './components/HabitCreateModal';
import NotionConnectionPanel from './components/NotionConnectionPanel';
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
const configuredProjectRef = (import.meta.env.VITE_SUPABASE_URL ?? '').match(/^https:\/\/([^.]+)\.supabase\.co\/?$/i)?.[1] ?? 'URL personalizada/no identificada';
function canonicalStatCode(stat) {
  const raw = String(stat.codigo_corto ?? '').trim().toUpperCase();
  if (allowedStatCodes.has(raw)) return raw;
  const name = String(stat.nombre_estadistica ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (['STR', 'FUE', 'FUERZA'].includes(raw) || name.includes('FUERZA')) return 'STR';
  if (['AGI', 'AGILIDAD'].includes(raw) || name.includes('AGILIDAD')) return 'AGI';
  if (['SEN', 'PER', 'PERCEPCION'].includes(raw) || name.includes('SENTIDO') || name.includes('PERCEPCION')) return 'SEN';
  if (['VIT', 'VITALIDAD'].includes(raw) || name.includes('VITALIDAD')) return 'VIT';
  if (['INT', 'INTELIGENCIA'].includes(raw) || name.includes('INTELIGENCIA')) return 'INT';
  return '';
}

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
  const [profile, setProfile] = useState(null); const [dbUserId, setDbUserId] = useState(null); const [stats, setStats] = useState([]); const [habits, setHabits] = useState([]); const [classes, setClasses] = useState([]);
  const [statCatalog, setStatCatalog] = useState([]); const [habitModalOpen, setHabitModalOpen] = useState(false); const [editingHabit, setEditingHabit] = useState(null);
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
    let queryStage = 'usuario';
    try {
      // Auth UUID is used only against usuario.auth_user_id. All child-table FKs
      // use the integer usuario.id_usuario returned by this profile query.
      const { data: hunterRow, error: profileError } = await supabase.from('usuario')
        .select('*, rango:rango(nombre_rango, letra_rango), clase_cazador:clase_cazador(nombre_clase)')
        .eq('auth_user_id', authUserId).maybeSingle();
      if (profileError) throw new Error(`usuario.auth_user_id: ${profileError.message}`);
      let hunter = hunterRow;
      if (!hunter) {
        const { error: createProfileError } = await supabase.rpc('ensure_hunter_profile', { p_nombre: user.user_metadata?.name ?? 'Cazador' });
        if (createProfileError) throw createProfileError;
        const { data: createdProfile, error: reloadProfileError } = await supabase.from('usuario')
          .select('*, rango:rango(nombre_rango, letra_rango), clase_cazador:clase_cazador(nombre_clase)')
          .eq('auth_user_id', authUserId).single();
        if (reloadProfileError) throw reloadProfileError;
        hunter = createdProfile;
      }
      if (!Number.isInteger(hunter.id_usuario)) throw new Error('usuario.id_usuario debe ser integer; no se usará el UUID de Auth en las FK.');
      const resolvedUserId = hunter.id_usuario;
      setProfile(hunter);
      setDbUserId(resolvedUserId);
      queryStage = 'semana';
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay() + weekOffset * 7);
      const end = new Date(start); end.setDate(start.getDate() + 7);
      const startDate = localDateKey(start); const endDate = localDateKey(end);
      const { week } = isoWeek(start);
      let { data: weekRow, error: weekError } = await supabase.from('semana').select('id_semana').eq('id_usuario', resolvedUserId).eq('fecha_inicio', startDate).maybeSingle();
      if (weekError) throw weekError;
      if (!weekRow && weekOffset >= 0) {
        const { data, error } = await supabase.from('semana').insert({ id_usuario: resolvedUserId, numero_semana: week, fecha_inicio: startDate, fecha_fin: localDateKey(new Date(end.getTime() - 86400000)) }).select('id_semana').single();
        if (error) throw error;
        weekRow = data;
      }
      let virtualMissingDays = [];
      if (weekRow) {
        const { data: existingDays, error: existingDaysError } = await supabase.from('dia_registro').select('id_dia, fecha_exacta, nombre_dia').eq('id_semana', weekRow.id_semana);
        if (existingDaysError) throw existingDaysError;
        const existingDateSet = new Set((existingDays ?? []).map((day) => String(day.fecha_exacta).slice(0, 10)));
        const missingDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return { id_semana: weekRow.id_semana, nombre_dia: dayNames[date.getDay()], fecha_exacta: localDateKey(date) }; }).filter((day) => !existingDateSet.has(day.fecha_exacta));
        if (missingDays.length && weekOffset >= 0) {
          queryStage = 'dia_registro';
          const { error } = await supabase.from('dia_registro').insert(missingDays);
          if (error) throw error;
        } else if (weekOffset < 0) virtualMissingDays = missingDays.map((day) => ({ ...day, id_dia: null, porcentaje_completado: 0 }));
      } else {
        virtualMissingDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return { id_semana: null, id_dia: null, nombre_dia: dayNames[date.getDay()], fecha_exacta: localDateKey(date), porcentaje_completado: 0 }; });
      }
      const [statsResult, habitsResult, daysResult, catalogResult, classesResult] = await Promise.all([
        supabase.from('estadistica_usuario').select('id_estadistica, puntos_acumulados, estadistica:estadistica(nombre_estadistica, codigo_corto)').eq('id_usuario', resolvedUserId),
        supabase.from('habito').select('*').eq('id_usuario', resolvedUserId).eq('activo', true).order('id_habito'),
        weekRow ? supabase.from('dia_registro').select('id_dia, id_semana, fecha_exacta, nombre_dia, porcentaje_completado').eq('id_semana', weekRow.id_semana).order('fecha_exacta') : Promise.resolve({ data: [], error: null }),
        supabase.from('estadistica').select('id_estadistica, nombre_estadistica, codigo_corto').order('id_estadistica'),
        supabase.from('clase_cazador').select('id_clase, nombre_clase, rol_principal').order('id_clase'),
      ]);
      const failed = [['estadistica_usuario', statsResult], ['habito', habitsResult], ['dia_registro', daysResult], ['estadistica', catalogResult], ['clase_cazador', classesResult]].find(([, result]) => result.error);
      if (failed) throw new Error(`${failed[0]}: ${failed[1].error.message}`);
      const selectedDays = [...(daysResult.data ?? []), ...virtualMissingDays].sort((a, b) => String(a.fecha_exacta).localeCompare(String(b.fecha_exacta)));
      const dayIds = selectedDays.map((day) => day.id_dia).filter(Number.isInteger);
      const normalizedStats = (statsResult.data ?? []).map((item) => ({ ...item, codigo: item.estadistica?.codigo_corto, nombre: item.estadistica?.nombre_estadistica, valor: item.puntos_acumulados }));
      setStatCatalog((catalogResult.data ?? []).map((item) => ({ ...item, codigo_corto: canonicalStatCode(item) })).filter((item) => item.codigo_corto));
      setClasses(classesResult.data ?? []);
      const daysWithProgress = selectedDays.map((day) => ({ ...day, porcentaje_completado: Number(day.porcentaje_completado ?? 0) }));
      setStats(normalizedStats); setHabits(habitsResult.data ?? []); setDays(daysWithProgress);
      if (!dayIds.length) { setCompleted([]); return; }
      queryStage = 'habito_completado';
      const { data: completedRows, error: completionError } = await supabase.from('habito_completado').select('id_dia, id_habito, completado, xp_ganada').in('id_dia', dayIds);
      if (completionError) throw completionError;
      setCompleted((completedRows ?? []).filter((row) => row.completado));
      if (!warnedPending.current && weekOffset === 0) {
        const todayKey = localDateKey(new Date());
        const todayRow = (daysResult.data ?? []).find((day) => String(day.fecha_exacta).slice(0, 10) === todayKey);
        const todaysDone = new Set((completedRows ?? []).filter((row) => row.completado && row.id_dia === todayRow?.id_dia).map((row) => row.id_habito));
        const pendingDaily = (habitsResult.data ?? []).some((habit) => habit.es_mision_diaria && !todaysDone.has(habit.id_habito));
        if (pendingDaily) { notify('Hay misiones diarias pendientes para hoy.', 'warning'); playSystemSound('warning'); }
        warnedPending.current = true;
      }
    } catch (loadError) {
      setError(`${queryStage}: ${loadError.message || 'No se pudieron cargar los datos.'}`);
    } finally { setBusy(false); }
  }, [user, weekOffset]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (!user || !supabase || dbUserId == null) return;
    let timer;
    const dbUserIdText = String(dbUserId);
    const channel = supabase.channel(`hunter-live-${authUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usuario', filter: `id_usuario=eq.${dbUserIdText}` }, () => { clearTimeout(timer); timer = setTimeout(loadData, 250); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'estadistica_usuario', filter: `id_usuario=eq.${dbUserIdText}` }, () => { clearTimeout(timer); timer = setTimeout(loadData, 250); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habito_completado' }, () => { clearTimeout(timer); timer = setTimeout(loadData, 250); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habito', filter: `id_usuario=eq.${dbUserIdText}` }, () => { clearTimeout(timer); timer = setTimeout(loadData, 250); })
      .subscribe();
    return () => { clearTimeout(timer); supabase.removeChannel(channel); };
  }, [user, authUserId, dbUserId, loadData]);
  useEffect(() => {
    if (!profile) return;
    const level = Number(profile.nivel_actual ?? 1);
    if (previousLevel.current === null) previousLevel.current = level;
    else if (level > previousLevel.current) { setLevelAlert(true); playSystemSound('level'); }
    previousLevel.current = level;
  }, [profile]);
  const hunterName = useMemo(() => profile?.nombre_cazador || 'Cazador', [profile]);

  async function toggleHabit(day, habit, isDone) {
    if (!supabase || !day || busy) return;
    if (!Number.isInteger(day.id_dia) || !Number.isInteger(habit.id_habito)) {
      notify('Los identificadores de día y hábito deben ser enteros del esquema de Supabase.', 'error');
      return;
    }
    let shouldRefresh = false;
    setBusy(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota';
      const { data, error: writeError } = await supabase.schema('public').rpc('set_habit_completion', {
        p_id_dia: day.id_dia, p_id_habito: habit.id_habito, p_completado: !isDone, p_timezone: timezone,
      }).single();
      if (writeError) throw writeError;
      setCompleted((current) => [...current.filter((row) => !(row.id_dia === day.id_dia && row.id_habito === habit.id_habito)), ...(data.completado ? [data] : [])]);
      playSystemSound('check');
      notify(isDone ? 'Misión desmarcada; la XP fue revertida.' : `+${data.xp_ganada ?? habit.experiencia_base ?? 0} XP · +${habit.puntos_estadistica ?? 0} PTS ADQUIRIDOS`, isDone ? 'info' : 'success');
      shouldRefresh = true;
    } catch (toggleError) {
      shouldRefresh = true;
      const isMissingRpc = toggleError.code === 'PGRST202' || /could not find the function.*set_habit_completion/i.test(toggleError.message ?? '');
      const originalError = [toggleError.code, toggleError.message, toggleError.details, toggleError.hint].filter(Boolean).join(' · ');
      const message = isMissingRpc
        ? `RPC no disponible en el proyecto ${configuredProjectRef}. Ejecuta las migraciones 20261118 y 20261119 en ese mismo proyecto; error Supabase: ${originalError}`
        : originalError || 'No se pudo guardar el cambio.';
      notify(message, 'error');
    }
    finally { setBusy(false); }
    if (shouldRefresh) loadData();
  }

  async function createHabit({ nombre, idEstadistica, experienciaBase, puntosEstadistica, diaria, icono }) {
    if (!supabase || dbUserId == null) throw new Error('No hay un perfil de cazador activo.');
    const selectedStat = statCatalog.find((stat) => String(stat.id_estadistica) === String(idEstadistica));
    if (!selectedStat || !allowedStatCodes.has(String(selectedStat.codigo_corto).toUpperCase())) {
      throw new Error('El hábito debe vincularse a STR, AGI, SEN, VIT o INT.');
    }
    const { error: createError } = await supabase.from('habito').insert({
      id_usuario: dbUserId,
      id_estadistica: selectedStat.id_estadistica,
      nombre_habito: nombre.trim(),
      experiencia_base: Number(experienciaBase),
      puntos_estadistica: Number(puntosEstadistica),
      es_mision_diaria: Boolean(diaria),
      icono: icono || null,
    });
    if (createError) throw createError;
    notify('Nueva misión agregada al registro del cazador.', 'success');
    playSystemSound('open');
    loadData();
  }

  async function updateHabit(habit, { nombre, idEstadistica, experienciaBase, puntosEstadistica, diaria, icono }) {
    const selectedStat = statCatalog.find((stat) => String(stat.id_estadistica) === String(idEstadistica));
    if (!selectedStat || !allowedStatCodes.has(String(selectedStat.codigo_corto).toUpperCase())) throw new Error('Selecciona una de las cinco estadísticas.');
    const { error: updateError } = await supabase.from('habito').update({
      nombre_habito: nombre.trim(), id_estadistica: selectedStat.id_estadistica,
      experiencia_base: Number(experienciaBase), puntos_estadistica: Number(puntosEstadistica),
      es_mision_diaria: Boolean(diaria),
      icono: icono || null,
    }).eq('id_habito', habit.id_habito).eq('id_usuario', dbUserId);
    if (updateError) throw updateError;
    notify('Misión actualizada.', 'success');
    loadData();
  }

  async function archiveHabit(habit) {
    if (!window.confirm(`¿Retirar “${habit.nombre_habito}” de tus misiones activas? El historial de completados se conservará.`)) return;
    const { error: archiveError } = await supabase.from('habito').update({ activo: false }).eq('id_habito', habit.id_habito).eq('id_usuario', dbUserId);
    if (archiveError) { notify(`No se pudo retirar la misión: ${archiveError.message}`, 'error'); return; }
    notify('Misión retirada de la matriz. Su historial se conserva.', 'success');
    loadData();
  }

  async function saveHunterName(nextName) {
    const nombre = nextName.trim();
    if (!nombre || dbUserId == null) throw new Error('Escribe un nombre para el cazador.');
    const { error: updateError } = await supabase.from('usuario').update({ nombre_cazador: nombre }).eq('id_usuario', dbUserId);
    if (updateError) throw updateError;
    setProfile((current) => ({ ...current, nombre_cazador: nombre }));
    notify('Nombre del cazador actualizado.', 'success');
  }

  async function saveHunterClass(nextClassId) {
    const idClase = nextClassId === '' ? null : Number(nextClassId);
    if (idClase !== null && !classes.some((item) => item.id_clase === idClase)) throw new Error('Selecciona una clase válida.');
    const { error: updateError } = await supabase.from('usuario').update({ id_clase: idClase }).eq('id_usuario', dbUserId);
    if (updateError) throw updateError;
    setProfile((current) => ({ ...current, id_clase: idClase, clase_cazador: classes.find((item) => item.id_clase === idClase) ?? null }));
    notify(idClase === null ? 'Clase retirada.' : 'Clase del cazador actualizada.', 'success');
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
      <NotionConnectionPanel />
      {error && <div className="error-banner"><ShieldAlert size={18}/><div><b>No se pudieron cargar todos los datos</b><span>{error}</span></div><button onClick={loadData}>Reintentar</button></div>}
      <div className="hud-layout"><aside className="profile-column"><StatusPanel nombreCazador={hunterName} onSaveName={saveHunterName} clases={classes} claseId={profile?.id_clase} onSaveClass={saveHunterClass} nivelActual={currentLevel} experienciaActual={currentXp} experienciaSiguienteNivel={nextXp} rachaDias={streak} rango={profile?.rango?.letra_rango ?? profile?.rango?.nombre_rango} claseCazador={profile?.clase_cazador?.nombre_clase}/><Suspense fallback={<section className="panel radar-panel table-state">CARGANDO ATRIBUTOS...</section>}><RadarChartWidget estadisticas={stats}/></Suspense></aside><section className="mission-column"><section className="panel weekly-summary"><p className="eyebrow">WEEKLY QUEST CLEARANCE</p><div className="summary-value">{doneCount}<span> / {habits.length * 7} OBJETIVOS</span></div><div className="summary-line"><span>PROGRESO GLOBAL</span><span>{habits.length ? Math.round((doneCount / (habits.length * 7)) * 100) : 0}%</span></div><div className="summary-track"><div style={{ width: `${habits.length ? Math.min(100, (doneCount / (habits.length * 7)) * 100) : 0}%` }}/></div></section><HabitTrackerTable dias={days} habitos={habits} completados={completed} loading={busy} onToggle={toggleHabit} onCreate={() => setHabitModalOpen(true)} onEdit={(habit) => { setEditingHabit(habit); setHabitModalOpen(true); }} onArchive={archiveHabit} weekOffset={weekOffset} onWeekChange={(delta) => setWeekOffset((current) => current + delta)} onGoCurrent={() => setWeekOffset(0)}/></section></div>
      <footer className="footer-note"><span>HUNTER SYSTEM <i>·</i> PROTOCOLO DE PROGRESO</span><span>Sesión protegida con Supabase Auth</span></footer>
    </main><HabitCreateModal open={habitModalOpen} habit={editingHabit} statistics={statCatalog} onClose={() => { setHabitModalOpen(false); setEditingHabit(null); }} onCreate={editingHabit ? (values) => updateHabit(editingHabit, values) : createHabit}/><SystemAlert alert={alert} onClose={() => setAlert(null)}/><SystemNotificationModal open={levelAlert} title="¡HAS SUBIDO DE NIVEL!" message="El Sistema reconoce tu progreso, cazador." onClose={() => setLevelAlert(false)}/></div>;
}
