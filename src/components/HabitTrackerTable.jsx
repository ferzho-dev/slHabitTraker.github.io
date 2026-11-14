import { Check, ChevronLeft, ChevronRight, Plus, Target } from 'lucide-react';

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

export default function HabitTrackerTable({ dias = [], habitos = [], completados = [], loading = false, onToggle, onCreate, weekOffset = 0, onWeekChange }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay() + weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart); date.setDate(weekStart.getDate() + index); return date; });
  const completedSet = new Set(completados.map((row) => `${row.id_dia}:${row.id_habito}`));
  const daysByDate = new Map(dias.map((day) => [String(day.fecha_exacta).slice(0, 10), day]));
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const range = `${new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(weekStart)} — ${new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(weekEnd)}`;
  return <section className="panel quest-panel">
    <div className="quest-heading"><div><p className="eyebrow"><Target size={13}/> ACTIVE QUESTS</p><h2>Matriz semanal</h2><span className="quest-subtitle">Completa tus objetivos y fortalece tus atributos.</span></div><div className="quest-actions"><button className="create-quest-button" onClick={onCreate}><Plus size={14}/> NUEVA MISIÓN</button>
      <div className="week-nav"><button aria-label="Semana anterior" onClick={() => onWeekChange(-1)}><ChevronLeft size={17}/></button><span>SEMANA · {range}</span><button aria-label="Semana siguiente" onClick={() => onWeekChange(1)} disabled={weekOffset >= 0}><ChevronRight size={17}/></button></div></div>
    </div>
    {loading ? <div className="table-state">SINCRONIZANDO MISIONES...</div> : <div className="quest-scroll"><table className="quest-matrix"><thead><tr><th className="day-head">DÍA</th>{habitos.map((habit) => <th className={`quest-habit-head ${habit.es_mision_diaria ? 'daily-quest' : ''}`} key={habit.id_habito}><span>{habit.nombre_habito}</span>{habit.es_mision_diaria && <small>DAILY QUEST</small>}</th>)}<th className="progress-head">PROGRESO</th></tr></thead><tbody>{weekDays.map((date) => {
      const day = daysByDate.get(dateKey(date));
      const completedForDay = habitos.filter((habit) => day && completedSet.has(`${day.id_dia}:${habit.id_habito}`)).length;
      const percent = day?.porcentaje_completado ?? (habitos.length ? Math.round((completedForDay / habitos.length) * 100) : 0);
      return <tr key={dateKey(date)} className={date.getTime() === today.getTime() ? 'current-day' : ''}>
        <th className="day-cell"><span className="day-name">{dayLabel(date)}</span><span className="day-date">{dayShort(date)} {date.getDate()}</span></th>
        {habitos.length ? habitos.map((habit) => { const done = Boolean(day && completedSet.has(`${day.id_dia}:${habit.id_habito}`)); return <td key={`${dateKey(date)}-${habit.id_habito}`} className={habit.es_mision_diaria ? 'daily-quest-cell' : ''}><button className={`quest-check ${done ? 'checked' : ''}`} aria-label={`${done ? 'Desmarcar' : 'Completar'} ${habit.nombre_habito}, ${dayLabel(date)}`} disabled={!day || date > today || loading} onClick={() => onToggle(day, habit, done)}>{done && <Check size={15} strokeWidth={2.6}/>}</button></td>; }) : <td className="no-quests-cell">AÑADE TU PRIMERA MISIÓN PARA ACTIVAR ESTA MATRIZ</td>}
        <td className="ring-cell"><ProgressRing value={percent}/></td>
      </tr>;
    })}</tbody></table></div>}
    <div className="quest-footer"><span><i className="legend-dot"/> OBJETIVO COMPLETADO</span><span>Los cambios actualizan tu estado en tiempo real</span></div>
  </section>;
}
