import { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import TablerIcon, { normalizeIconName } from './TablerIcon';
import { requiredTablerIconNames } from './requiredTablerIconNames';

const translations = {
  dumbbell: 'entrenamiento pesas fuerza', run: 'correr carrera ejercicio', book: 'lectura estudiar', brain: 'cerebro inteligencia',
  heart: 'salud corazon bienestar', code: 'programacion desarrollo', target: 'objetivo meta', moon: 'descanso dormir noche',
  droplet: 'hidratacion agua', pencil: 'escritura escribir',
};
const normalizeSearch = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const componentName = (name) => `Icon${name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}`;

export default function IconPicker({ value = '', onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || catalog.length) return;
    let mounted = true;
    setLoading(true);
    fetch(`${import.meta.env.BASE_URL}tabler-icons/catalog.json`).then((response) => {
      if (!response.ok) throw new Error(`No se pudo cargar el catálogo de iconos (${response.status}).`);
      return response.json();
    }).then((entries) => {
      if (!mounted) return;
      const allIcons = entries.map(([name, tags]) => ({ name, tags, exportName: componentName(name), required: false }));
      const byName = new Map(allIcons.map((icon) => [icon.name, icon]));
      const requiredIcons = requiredTablerIconNames.map((name) => ({ ...(byName.get(name) ?? { name, tags: [] }), exportName: componentName(name), required: true }));
      const requiredSet = new Set(requiredTablerIconNames);
      setCatalog([...requiredIcons, ...allIcons.filter((icon) => !requiredSet.has(icon.name))]);
    }).catch(() => { if (mounted) setCatalog(requiredTablerIconNames.map((name) => ({ name, tags: [], exportName: componentName(name), required: true }))); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [open, catalog.length]);
  const results = useMemo(() => {
    const term = normalizeSearch(query.trim());
    const found = term ? catalog.filter(({ name, tags, exportName }) => normalizeSearch(`${name} ${exportName} ${tags.join(' ')} ${translations[name] ?? ''}`).includes(term)) : catalog;
    if (term) return found.slice(0, 120);
    return found.filter((icon) => icon.required);
  }, [catalog, query]);
  const currentName = normalizeIconName(value);

  return <div className="icon-picker">
    <span className="icon-picker-label">ICONO DEL HÁBITO</span>
    <div className="icon-picker-actions"><button type="button" className="icon-picker-trigger" onClick={() => setOpen(true)}><TablerIcon name={currentName} size={19}/><span>{currentName ? currentName.replaceAll('-', ' ') : 'Elegir icono'}</span></button>{value && <button type="button" className="icon-clear-button" onClick={() => onChange('')} aria-label="Quitar icono"><X size={14}/></button>}</div>
    {open && <div className="icon-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section className="icon-picker-dialog panel" role="dialog" aria-modal="true" aria-label="Seleccionar icono Tabler">
      <header><div><p className="eyebrow">TABLER ICONS</p><h3>Elige un icono</h3></div><button type="button" className="modal-close" aria-label="Cerrar selector" onClick={() => setOpen(false)}><X size={17}/></button></header>
      <label className="icon-search"><Search size={15}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar iconos por nombre o tema"/></label>
      <div className="icon-grid" aria-live="polite">{loading ? <p className="icon-picker-empty">CARGANDO CATÁLOGO…</p> : results.map(({ name, exportName, required }) => <button type="button" key={name} className={`icon-choice ${currentName === name ? 'selected' : ''} ${required ? 'required-icon-choice' : ''}`} onClick={() => { onChange(name); setOpen(false); }} title={`${exportName} · ${name}`}><span><TablerIcon name={name} size={20}/></span><small>{name.replaceAll('-', ' ')}</small>{currentName === name && <Check className="icon-choice-check" size={12}/>}</button>)}{!loading && !results.length && <p className="icon-picker-empty">No se encontraron iconos.</p>}</div>
      <footer><button type="button" className="icon-remove-option" onClick={() => { onChange(''); setOpen(false); }}>Quitar icono</button><span>{query ? `${results.length} resultados mostrados` : `${catalog.length} iconos · busca para filtrar`}</span></footer>
    </section></div>}
  </div>;
}
