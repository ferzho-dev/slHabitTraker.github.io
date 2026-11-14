let context;
const STORAGE_KEY = 'hunter-system-sfx-muted';

export function getAudioMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}

export function setAudioMuted(muted) {
  try { localStorage.setItem(STORAGE_KEY, String(muted)); } catch {}
}

function audioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  context ??= new AudioContextClass();
  if (context.state === 'suspended') context.resume();
  return context;
}

export function playSystemSound(kind) {
  if (getAudioMuted() || typeof window === 'undefined') return;
  const ctx = audioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = kind === 'level' ? [523.25, 783.99, 1046.5, 1318.51]
    : kind === 'warning' ? [320, 250]
      : kind === 'open' ? [180, 920]
        : [1200, 1800];
  notes.forEach((frequency, index) => {
    const start = now + (kind === 'level' ? index * 0.12 : kind === 'warning' ? index * 0.17 : kind === 'check' ? index * 0.045 : 0);
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    oscillator.type = kind === 'warning' ? 'square' : kind === 'open' && index === 0 ? 'sawtooth' : 'triangle';
    oscillator.frequency.setValueAtTime(frequency, start);
    if (kind === 'open' && index === 0) oscillator.frequency.exponentialRampToValueAtTime(920, start + 0.22);
    filter.type = 'lowpass'; filter.frequency.value = kind === 'warning' ? 700 : 3800;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(kind === 'level' ? 0.075 : 0.045, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + (kind === 'level' ? 0.62 : kind === 'open' ? 0.23 : 0.09));
    oscillator.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    oscillator.start(start); oscillator.stop(start + (kind === 'level' ? 0.64 : kind === 'open' ? 0.24 : 0.1));
  });
}
