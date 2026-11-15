import { useEffect, useState } from 'react';
import { Activity, X } from 'lucide-react';
import IconPicker from './IconPicker';

const names = { STR: 'Fuerza', AGI: 'Agilidad', SEN: 'Sentido', VIT: 'Vitalidad', INT: 'Inteligencia' };

export default function HabitCreateModal({ open, habit = null, statistics = [], onClose, onCreate }) {
  const [name, setName] = useState('');
  const [statId, setStatId] = useState('');
  const [xp, setXp] = useState('10');
  const [points, setPoints] = useState('1');
  const [daily, setDaily] = useState(false);
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(habit?.nombre_habito ?? '');
    setStatId(habit?.id_estadistica == null ? '' : String(habit.id_estadistica));
    setXp(String(habit?.experiencia_base ?? 10));
    setPoints(String(habit?.puntos_estadistica ?? 1));
    setDaily(Boolean(habit?.es_mision_diaria));
    setIcon(habit?.icono ?? '');
    setError('');
  }, [open, habit]);
  if (!open) return null;

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (!statId) throw new Error('Selecciona una estadística para vincular la misión.');
      await onCreate({ nombre: name, idEstadistica: statId, experienciaBase: xp, puntosEstadistica: points, diaria: daily, icono: icon || null });
      setName(''); setStatId(''); setXp('10'); setPoints('1'); setDaily(false); setIcon(''); onClose();
    } catch (saveError) { setError(saveError.message || 'No se pudo guardar la misión.'); }
    finally { setSaving(false); }
  }

  return <div className="level-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className="habit-modal panel" role="dialog" aria-modal="true" aria-labelledby="habit-modal-title">
      <button className="modal-close" aria-label="Cerrar" onClick={onClose} disabled={saving}><X size={17}/></button>
      <p className="eyebrow"><Activity size={13}/> QUEST CONFIGURATION</p><h2 id="habit-modal-title">{habit ? 'Editar misión' : 'Crear una misión'}</h2><p className="modal-description">Toda misión debe entrenar uno de tus cinco parámetros.</p>
      <form onSubmit={submit} className="habit-form">
        <label>Nombre de la misión<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Leer durante 20 minutos"/></label>
        <label>Estadística asociada<select required value={statId} onChange={(event) => setStatId(event.target.value)}><option value="" disabled>Selecciona un atributo</option>{statistics.map((stat) => { const code = String(stat.codigo_corto).toUpperCase(); return <option key={stat.id_estadistica} value={String(stat.id_estadistica)}>{names[code] ?? stat.nombre_estadistica} · {code}</option>; })}</select></label>
        <IconPicker value={icon} onChange={setIcon}/>
        {!statistics.length && <p className="form-error">No se encontró el catálogo de las cinco estadísticas en Supabase.</p>}
        <div className="habit-reward-row"><label>XP por logro<input type="number" min="1" max="10000" required value={xp} onChange={(event) => setXp(event.target.value)}/></label><label>Puntos de atributo<input type="number" min="1" max="1000" required value={points} onChange={(event) => setPoints(event.target.value)}/></label></div>
        <label className="daily-toggle"><input type="checkbox" checked={daily} onChange={(event) => setDaily(event.target.checked)}/><span>Marcar como DAILY QUEST</span></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={saving || !statistics.length}>{saving ? 'GUARDANDO…' : habit ? 'GUARDAR CAMBIOS' : 'CREAR MISIÓN'}</button>
      </form>
    </section>
  </div>;
}
