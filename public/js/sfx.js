// Bruitages synthétisés à la volée (aucun fichier audio à charger).
import { prefs } from './store.js';

let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Les navigateurs n'autorisent le son qu'après un premier geste de l'utilisateur.
for (const type of ['pointerdown', 'keydown']) {
  window.addEventListener(type, () => prefs.sound && audio(), { once: true, capture: true });
}

function tone(freq, duration, { type = 'sine', gain = 0.08, delay = 0, slide = 0 } = {}) {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

const melody = (notes, step, options) => notes.forEach((f, i) => tone(f, step * 1.6, { ...options, delay: i * step }));

const SOUNDS = {
  key: () => tone(540, 0.05, { type: 'triangle', gain: 0.05 }),
  del: () => tone(300, 0.06, { type: 'triangle', gain: 0.05 }),
  bad: () => {
    tone(170, 0.14, { type: 'sawtooth', gain: 0.06 });
    tone(130, 0.18, { type: 'sawtooth', gain: 0.06, delay: 0.09 });
  },
  r0: () => tone(196, 0.12, { type: 'sine', gain: 0.08 }),
  r1: () => tone(392, 0.12, { type: 'triangle', gain: 0.08 }),
  r2: () => tone(659, 0.16, { type: 'triangle', gain: 0.09 }),
  win: () => melody([523, 659, 784, 1047, 1319], 0.09, { type: 'triangle', gain: 0.1 }),
  lose: () => melody([392, 330, 262, 196], 0.15, { type: 'sine', gain: 0.1 }),
  ping: () => melody([880, 1175], 0.08, { type: 'sine', gain: 0.06 }),
  pop: () => tone(720, 0.07, { type: 'sine', gain: 0.05, slide: 300 }),
  start: () => melody([392, 523, 784], 0.09, { type: 'square', gain: 0.04 }),
  count: () => tone(440, 0.12, { type: 'square', gain: 0.04 }),
  tick: () => tone(1000, 0.04, { type: 'square', gain: 0.03 }),
  hint: () => melody([784, 988, 1175], 0.07, { type: 'sine', gain: 0.07 }),
  attack: () => {
    tone(880, 0.35, { type: 'sawtooth', gain: 0.07, slide: -600 });
    tone(110, 0.3, { type: 'square', gain: 0.05, delay: 0.1 });
  },
  throw: () => tone(300, 0.25, { type: 'sawtooth', gain: 0.05, slide: 700 }),
  join: () => melody([523, 784], 0.08, { type: 'sine', gain: 0.06 }),
  fanfare: () => melody([523, 523, 659, 784, 659, 784, 1047], 0.12, { type: 'triangle', gain: 0.1 }),
};

export function play(name) {
  if (!prefs.sound) return;
  try {
    SOUNDS[name]?.();
  } catch {
    /* le son n'est jamais indispensable */
  }
}

export function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* pas de vibreur */
  }
}
