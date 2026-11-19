// Effets visuels : messages éphémères, confettis, réactions qui s'envolent.
import { h } from './dom.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ───────────── messages éphémères ─────────────

export function toast(text, { kind = 'info', icon = null, ms = 2600 } = {}) {
  const root = document.getElementById('toasts');
  const el = h('div.toast', { data: { kind } }, icon && h('span.toast-ico', icon), h('span', text));
  root.append(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

// ───────────── réactions ─────────────

/** Fait s'envoler un émoji depuis un élément (ou depuis le bas de l'écran). */
export function floatEmote(emoji, from) {
  const layer = document.getElementById('emotes');
  const rect = from?.isConnected ? from.getBoundingClientRect() : null;
  const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
  const x = visible ? rect.left + rect.width / 2 : innerWidth * (0.3 + Math.random() * 0.4);
  const y = visible ? rect.top + rect.height / 2 : innerHeight - 90;
  const el = h('span.emote-fly', { vars: { '--x': `${x}px`, '--y': `${y}px`, '--dx': `${Math.round((Math.random() - 0.5) * 90)}px`, '--rot': `${Math.round((Math.random() - 0.5) * 50)}deg` } }, emoji);
  layer.append(el);
  setTimeout(() => el.remove(), 2000);
}

// ───────────── confettis ─────────────

const COLORS = ['#b8f32b', '#ff5aa5', '#7b5cff', '#ffd33d', '#48d2ff', '#ffffff'];
let canvas = null;
let g = null;
let bits = [];
let running = false;
let lastFrame = 0;

function resize() {
  const ratio = Math.min(2, devicePixelRatio || 1);
  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function frame(now) {
  // Le mouvement suit le temps réel : même si l'affichage ralentit, les confettis ne traînent pas.
  const dt = Math.min(6, (now - lastFrame) / 16.67);
  lastFrame = now;
  g.clearRect(0, 0, innerWidth, innerHeight);
  bits = bits.filter((b) => now < b.dies && b.y < innerHeight + 40);
  for (const b of bits) {
    b.vy += 0.22 * dt;
    b.vx *= 0.992 ** dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.spin += b.vspin * dt;
    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.spin);
    g.globalAlpha = Math.min(1, (b.dies - now) / 500);
    g.fillStyle = b.color;
    if (b.round) {
      g.beginPath();
      g.arc(0, 0, b.size / 2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillRect(-b.size / 2, -b.size / 3, b.size, b.size * 0.66);
    }
    g.restore();
  }
  if (bits.length) requestAnimationFrame(frame);
  else {
    running = false;
    g.clearRect(0, 0, innerWidth, innerHeight);
  }
}

/**
 * confetti()                      pluie depuis le haut de l'écran
 * confetti({ from: element })     explosion depuis un élément
 */
export function confetti({ from = null, count = 120 } = {}) {
  if (reduced()) return;
  if (!canvas) {
    canvas = document.getElementById('confetti');
    g = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    resize();
  }
  const rect = from?.isConnected ? from.getBoundingClientRect() : null;
  for (let i = 0; i < count; i++) {
    const burst = !!rect;
    const angle = burst ? -Math.PI / 2 + (Math.random() - 0.5) * 2.2 : Math.PI / 2 + (Math.random() - 0.5) * 0.8;
    const speed = burst ? 5 + Math.random() * 9 : 2 + Math.random() * 4;
    bits.push({
      x: burst ? rect.left + rect.width / 2 + (Math.random() - 0.5) * rect.width * 0.6 : Math.random() * innerWidth,
      y: burst ? rect.top + rect.height / 2 : -20 - Math.random() * innerHeight * 0.3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 7,
      spin: Math.random() * Math.PI,
      vspin: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      round: Math.random() < 0.3,
      dies: performance.now() + 2600 + Math.random() * 1600,
    });
  }
  if (bits.length > 700) bits.splice(0, bits.length - 700);
  if (!running) {
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }
}
