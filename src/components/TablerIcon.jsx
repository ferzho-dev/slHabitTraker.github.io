import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { requiredTablerIconNames } from './requiredTablerIconNames';

const nodeShardRequests = new Map();
function getNode(iconName) {
  const first = iconName[0]?.toLowerCase() ?? 'other';
  const shard = /^[a-z0-9]$/.test(first) ? first : 'other';
  if (!nodeShardRequests.has(shard)) {
    const url = `${import.meta.env.BASE_URL}tabler-icons/nodes/${shard}.json`;
    nodeShardRequests.set(shard, fetch(url).then((response) => {
      if (!response.ok) throw new Error(`No se pudieron cargar iconos Tabler (${response.status}).`);
      return response.json();
    }));
  }
  return nodeShardRequests.get(shard).then((icons) => icons[iconName] ?? null);
}

const reactAttribute = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export function normalizeIconName(value) {
  if (!value) return '';
  const stripped = String(value).replace(/^Icon/, '');
  return stripped.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
}

export default function TablerIcon({ name, size = 18, className = '' }) {
  const iconName = normalizeIconName(name);
  const hasOfficialVueIcon = requiredTablerIconNames.includes(iconName);
  const vueMount = useRef(null);
  const vueApp = useRef(null);
  const [iconNodes, setIconNodes] = useState(null);
  useEffect(() => {
    let mounted = true;
    if (!iconName || hasOfficialVueIcon) { setIconNodes(null); return () => { mounted = false; }; }
    setIconNodes(null);
    getNode(iconName).then((nodes) => { if (mounted) setIconNodes(nodes); }).catch(() => { if (mounted) setIconNodes(null); });
    return () => { mounted = false; };
  }, [iconName, hasOfficialVueIcon]);
  useEffect(() => {
    if (!hasOfficialVueIcon || !vueMount.current) return undefined;
    let mounted = true;
    Promise.all([import('vue'), import('./requiredTablerVueIcons')]).then(([vue, registry]) => {
      if (!mounted || !vueMount.current) return;
      const officialVueIcon = registry.requiredTablerVueIcons[iconName];
      const app = vue.createApp({ render: () => vue.h(officialVueIcon, { size, stroke: 2, color: 'currentColor' }) });
      app.mount(vueMount.current);
      vueApp.current = app;
    });
    return () => { mounted = false; vueApp.current?.unmount(); vueApp.current = null; };
  }, [hasOfficialVueIcon, iconName, size]);
  if (hasOfficialVueIcon) return <span ref={vueMount} className={`tabler-vue-icon ${className}`} style={{ width: size, height: size }} aria-hidden="true"/>;
  if (!iconNodes) return <Activity size={size} className={className} aria-hidden="true"/>;
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {iconNodes.map(([tag, attributes], index) => {
      const props = Object.fromEntries(Object.entries(attributes).map(([key, value]) => [reactAttribute(key), value]));
      return tag === 'circle' ? <circle key={index} {...props}/> : tag === 'rect' ? <rect key={index} {...props}/> : tag === 'line' ? <line key={index} {...props}/> : <path key={index} {...props}/>;
    })}
  </svg>;
}
