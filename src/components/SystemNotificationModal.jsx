import { BellRing, X } from 'lucide-react';

export default function SystemNotificationModal({ open, title = 'NOTIFICATION', message, onClose }) {
  if (!open) return null;
  return <div className="level-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="level-modal" role="alertdialog" aria-modal="true" aria-labelledby="system-modal-title">
      <button className="modal-close" aria-label="Cerrar notificación" onClick={onClose}><X size={17}/></button>
      <div className="level-emblem"><BellRing size={29}/></div><p className="eyebrow">SYSTEM ALERT</p>
      <h2 id="system-modal-title">{title}</h2><p>{message}</p><button className="primary-button" onClick={onClose}>CONTINUAR</button>
    </section>
  </div>;
}
