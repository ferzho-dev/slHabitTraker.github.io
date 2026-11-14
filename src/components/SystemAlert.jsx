import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

const icons = { success: CheckCircle2, error: AlertTriangle, warning: AlertTriangle, info: Info };
export default function SystemAlert({ alert, onClose }) {
  if (!alert) return null;
  const Icon = icons[alert.type] ?? Info;
  return <div className={`system-alert alert-${alert.type ?? 'info'}`} role="status"><Icon size={18}/><span>{alert.message}</span><button aria-label="Cerrar aviso" onClick={onClose}><X size={16}/></button></div>;
}
