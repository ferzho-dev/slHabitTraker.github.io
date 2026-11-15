import { useState } from 'react';
import { ArrowUpRight, Check, Flame, Pencil, Shield, Sparkles, X } from 'lucide-react';

export default function StatusPanel({ nombreCazador, onSaveName, nivelActual = 1, experienciaActual = 0, experienciaSiguienteNivel = 100, rachaDias = 0, rango, claseCazador, clases = [], claseId, onSaveClass }) {
  const [editing, setEditing] = useState(false); const [nameDraft, setNameDraft] = useState(nombreCazador || ''); const [nameError, setNameError] = useState(''); const [savingName, setSavingName] = useState(false);
  const xp = Number(experienciaActual) || 0;
  const next = Number(experienciaSiguienteNivel) || 100;
  const progress = Math.min(100, Math.max(0, next ? (xp / next) * 100 : 0));
  return <section className="panel status-panel hologram-panel">
    <div className="panel-topline"><span><Sparkles size={14}/> HUNTER STATUS</span><span className="live-dot">SYSTEM ONLINE</span></div>
    <div className="hunter-identity"><div className="hunter-emblem"><Shield size={30}/><i/></div><div className="hunter-name-block"><p className="eyebrow">HUNTER NAME</p>{editing ? <form className="name-edit-form" onSubmit={async (event) => { event.preventDefault(); setSavingName(true); setNameError(''); try { await onSaveName(nameDraft); setEditing(false); } catch (error) { setNameError(error.message); } finally { setSavingName(false); } }}><input aria-label="Nombre del cazador" maxLength={100} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} autoFocus/><button aria-label="Guardar nombre" disabled={savingName}><Check size={14}/></button><button type="button" aria-label="Cancelar" onClick={() => { setNameDraft(nombreCazador || ''); setEditing(false); }}><X size={14}/></button></form> : <div className="hunter-name-row"><h1>{nombreCazador || 'Cazador'}</h1><button className="edit-name-button" aria-label="Editar nombre del cazador" onClick={() => { setNameDraft(nombreCazador || ''); setEditing(true); }}><Pencil size={12}/></button></div>}{nameError && <small className="name-edit-error">{nameError}</small>}<label className="class-select-label">CLASS <select value={claseId ?? ''} onChange={async (event) => { try { await onSaveClass(event.target.value); setNameError(''); } catch (error) { setNameError(error.message); } }} aria-label="Seleccionar clase de cazador"><option value="">UNASSIGNED</option>{clases.map((item) => <option key={item.id_clase} value={item.id_clase}>{item.nombre_clase}</option>)}</select></label></div></div>
    <div className="level-row"><div className="level-block"><span className="eyebrow">LEVEL</span><strong className="level-number">{nivelActual}</strong></div><div className="rank-block"><span>RANK</span><b>{rango || 'E'}</b><div className="streak"><Flame size={14}/><span>{rachaDias} DAY STREAK</span></div></div></div>
    <div className="xp-label"><span>EXPERIENCE</span><span>{xp.toLocaleString('es-CO')} <em>/</em> {next.toLocaleString('es-CO')} XP</span></div>
    <div className="xp-track segmented-track"><div style={{ width: `${progress}%` }}/></div>
    <div className="xp-bottom"><span>{Math.max(0, next - xp).toLocaleString('es-CO')} XP TO NEXT LEVEL</span><ArrowUpRight size={15}/></div>
  </section>;
}
