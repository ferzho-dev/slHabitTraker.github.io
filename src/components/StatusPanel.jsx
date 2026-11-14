import { ArrowUpRight, Flame, Shield, Sparkles } from 'lucide-react';

export default function StatusPanel({ nombreCazador, nivelActual = 1, experienciaActual = 0, experienciaSiguienteNivel = 100, rachaDias = 0, rango, claseCazador }) {
  const xp = Number(experienciaActual) || 0;
  const next = Number(experienciaSiguienteNivel) || 100;
  const progress = Math.min(100, Math.max(0, next ? (xp / next) * 100 : 0));
  return <section className="panel status-panel hologram-panel">
    <div className="panel-topline"><span><Sparkles size={14}/> HUNTER STATUS</span><span className="live-dot">SYSTEM ONLINE</span></div>
    <div className="hunter-identity"><div className="hunter-emblem"><Shield size={30}/><i/></div><div><p className="eyebrow">AWAKENED HUNTER</p><h1>{nombreCazador || 'Cazador'}</h1><p className="hunter-class">CLASS: <b>{claseCazador || 'UNASSIGNED'}</b></p></div></div>
    <div className="level-row"><div className="level-block"><span className="eyebrow">LEVEL</span><strong className="level-number">{nivelActual}</strong></div><div className="rank-block"><span>RANK</span><b>{rango || 'E'}</b><div className="streak"><Flame size={14}/><span>{rachaDias} DAY STREAK</span></div></div></div>
    <div className="xp-label"><span>EXPERIENCE</span><span>{xp.toLocaleString('es-CO')} <em>/</em> {next.toLocaleString('es-CO')} XP</span></div>
    <div className="xp-track segmented-track"><div style={{ width: `${progress}%` }}/></div>
    <div className="xp-bottom"><span>{Math.max(0, next - xp).toLocaleString('es-CO')} XP TO NEXT LEVEL</span><ArrowUpRight size={15}/></div>
  </section>;
}
