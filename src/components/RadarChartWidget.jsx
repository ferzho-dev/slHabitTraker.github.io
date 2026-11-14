import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { Brain, Eye, HeartPulse, MoveUpRight, Shield, Zap } from 'lucide-react';

const attributes = [
  { code: 'STR', label: 'Fuerza', match: ['str', 'fuerza'], icon: Shield },
  { code: 'AGI', label: 'Agilidad', match: ['agi', 'agilidad'], icon: Zap },
  { code: 'SEN', label: 'Sentido', match: ['sen', 'sentido'], icon: Eye },
  { code: 'VIT', label: 'Vitalidad', match: ['vit', 'vitalidad'], icon: HeartPulse },
  { code: 'INT', label: 'Inteligencia', match: ['int', 'inteligencia'], icon: Brain },
];

export default function RadarChartWidget({ estadisticas = [] }) {
  const points = attributes.map((attribute) => {
    const found = estadisticas.find((item) => attribute.match.includes(String(item.codigo ?? item.nombre ?? '').toLowerCase()));
    return { ...attribute, value: Number(found?.valor ?? 0) };
  });
  return <section className="panel radar-panel">
    <div className="section-heading"><div><p className="eyebrow">HUNTER ATTRIBUTES</p><h2>Parámetros del cazador</h2></div><span className="heading-mark">05 / 05</span></div>
    <div className="radar-chart"><ResponsiveContainer width="100%" height="100%"><RadarChart data={points} outerRadius="72%"><PolarGrid stroke="#1a3857"/><PolarAngleAxis dataKey="code" tick={{ fill: '#9bc5d4', fontSize: 10, fontFamily: 'DM Mono' }}/><Radar name="Cazador" dataKey="value" stroke="#00e5ff" fill="#1d4ed8" fillOpacity={0.3} strokeWidth={2}/></RadarChart></ResponsiveContainer></div>
    <div className="attribute-list">{points.map(({ code, label, icon: Icon, value }) => <div className="attribute-item" key={code}><Icon size={14}/><span>{code}</span><small>{label}</small><b>{value}</b><MoveUpRight size={11} className="attribute-arrow"/></div>)}</div>
  </section>;
}
