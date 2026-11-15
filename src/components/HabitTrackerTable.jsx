import { Check, ChevronLeft, ChevronRight, MoreVertical, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import TablerIcon from './TablerIcon';

const dayLabel = (date) => new Intl.DateTimeFormat('es-CO', { weekday: 'long' }).format(date);
const dayShort = (date) => new Intl.DateTimeFormat('es-CO', { weekday: 'short' }).format(date).replace('.', '');
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function ProgressRing({ value }) {
  const radius = 17; const circumference = 2 * Math.PI * radius;
  return <svg className="daily-ring" viewBox="0 0 44 44" role="img" aria-label={`${value}% completado`}>
    <circle cx="22" cy="22" r={radius} className="ring-track"/>
    <circle cx="22" cy="22" r={radius} className="ring-progress" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)}/>
    <text x="22" y="25" textAnchor="middle">{value}%</text>
  </svg>;
}

export default function HabitTrackerTable({ dias = [], habitos = [], completados = [], loading = false, onToggle, onCreate, onEdit, onArchive, weekOffset = 0, onWeekChange, onGoCurrent }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay() + weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart); date.setDate(weekStart.getDate() + index); return date; });
  const completedSet = new Set(completados.map((row) => `${row.id_dia}:${row.id_habito}`));
  const daysByDate = new Map(dias.map((day) => [String(day.fecha_exacta).slice(0, 10), day]));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const range = `${new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(weekStart)} — ${new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(weekEnd)}`;
  const weekType = weekOffset === 0 ? 'SEMANA ACTUAL' : weekOffset > 0 ? 'SEMANA FUTURA' : 'SEMANA ANTERIOR';
  return <section className="panel quest-panel">
    <div className="quest-heading"><div><p className="eyebrow"><Target size={13}/> ACTIVE QUESTS</p><h2>Matriz semanal</h2><span className="quest-subtitle">Completa tus objetivos y fortalece tus atributos.</span></div><div className="quest-actions"><button className="create-quest-button" onClick={onCreate}><Plus size={14}/> NUEVA MISIÓN</button>
      <div className="week-controls"><div className={`week-nav week-nav-${weekOffset === 0 ? 'current' : weekOffset > 0 ? 'future' : 'past'}`}><button aria-label="Semana anterior" onClick={() => onWeekChange(-1)}><ChevronLeft size={17}/></button><span><small>{weekType}</small>{range}</span><button aria-label="Semana siguiente" onClick={() => onWeekChange(1)}><ChevronRight size={17}/></button>{weekOffset !== 0 && <button type="button" className="week-current-button" onClick={onGoCurrent}>HOY</button>}</div>
        <details className="quest-manage"><summary aria-label="Gestionar misiones" title="Gestionar misiones"><MoreVertical size={17}/></summary><div className="quest-manage-menu"><p>GESTIONAR MISIONES</p>{habitos.length ? habitos.map((habit) => <div className="quest-manage-row" key={habit.id_habito}><span title={habit.nombre_habito}>{habit.nombre_habito}</span><button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; onEdit?.(habit); }} disabled={loading}><Pencil size={12}/> EDITAR</button><button type="button" className="quest-delete-button" onClick={(event) => { event.currentTarget.closest('details').open = false; onArchive?.(habit); }} disabled={loading}><Trash2 size={12}/> ELIMINAR</button></div>) : <span className="quest-manage-empty">No hay misiones activas</span>}</div></details>
      </div></div>
    </div>
    {loading ? <div className="table-state">SINCRONIZANDO MISIONES...</div> : <div className="quest-scroll"><table className="quest-matrix"><colgroup><col className="day-column"/>{habitos.map((habit) => <col className="habit-column" key={habit.id_habito}/>)}<col className="progress-column"/></colgroup><thead><tr><th className="day-head">DÍA</th>{habitos.map((habit) => <th className={`quest-habit-head ${habit.es_mision_diaria ? 'daily-quest' : ''}`} key={habit.id_habito}><span className="habit-heading-icon"><TablerIcon name={habit.icono} size={17}/></span><span className="habit-heading-name" title={habit.nombre_habito}>{habit.nombre_habito}</span>{habit.es_mision_diaria && <small>DAILY QUEST</small>}</th>)}<th className="progress-head">PROGRESO</th></tr></thead><tbody>{weekDays.map((date) => {
      const day = daysByDate.get(dateKey(date));
      const completedForDay = habitos.filter((habit) => day && completedSet.has(`${day.id_dia}:${habit.id_habito}`)).length;
      const percent = day?.porcentaje_completado ?? (habitos.length ? Math.round((completedForDay / habitos.length) * 100) : 0);
      return <tr key={dateKey(date)} className={date.getTime() === today.getTime() ? 'current-day' : ''}>
        <th className="day-cell"><span className="day-name">{dayLabel(date)}</span><span className="day-date">{dayShort(date)} {date.getDate()}</span></th>
        {habitos.length ? habitos.map((habit) => { const done = Boolean(day && completedSet.has(`${day.id_dia}:${habit.id_habito}`)); const readOnlyWeek = weekOffset < 0; return <td key={`${dateKey(date)}-${habit.id_habito}`} className={habit.es_mision_diaria ? 'daily-quest-cell' : ''}><button className={`quest-check ${done ? 'checked' : ''}`} aria-label={`${done ? 'Desmarcar' : 'Completar'} ${habit.nombre_habito}, ${dayLabel(date)}`} disabled={!day || date > today || readOnlyWeek || loading} onClick={() => onToggle(day, habit, done)}>{done && <Check size={15} strokeWidth={2.6}/>}</button></td>; }) : <td className="no-quests-cell">AÑADE TU PRIMERA MISIÓN PARA ACTIVAR ESTA MATRIZ</td>}
        <td className="ring-cell"><ProgressRing value={percent}/></td>
      </tr>;
    })}</tbody></table></div>}
    <div className="quest-footer"><span><i className="legend-dot"/> OBJETIVO COMPLETADO</span><span>Los cambios actualizan tu estado en tiempo real</span></div>
  </section>;
}
