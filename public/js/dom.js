// Petits outils pour construire l'interface sans framework.
// Le texte passe toujours par des nœuds texte : rien de ce que tape un joueur n'est interprété comme du HTML.
import { AVATARS, avatarColor } from './consts.js';

/**
 * h('button.btn.primary', { onclick, disabled }, 'Jouer')
 * Options spéciales : class (ajoutée), data { cle: valeur }, vars { '--x': valeur }.
 */
export function h(spec, ...args) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  let start = 0;
  const first = args[0];
  if (first && typeof first === 'object' && !(first instanceof Node) && !Array.isArray(first)) {
    start = 1;
    for (const [key, value] of Object.entries(first)) {
      if (key === 'spellcheck') {
        el.setAttribute('spellcheck', String(!!value));
        continue;
      }
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = `${el.className} ${value}`.trim();
      else if (key === 'data') for (const [k, v] of Object.entries(value)) (v ?? null) !== null && (el.dataset[k] = v);
      else if (key === 'vars') for (const [k, v] of Object.entries(value)) el.style.setProperty(k, v);
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  for (let i = start; i < args.length; i++) add(el, args[i]);
  return el;
}

function add(el, child) {
  if (child === null || child === undefined || child === false || child === '') return;
  if (Array.isArray(child)) child.forEach((c) => add(el, c));
  else el.append(child instanceof Node ? child : String(child));
}

export function clear(el, ...children) {
  el.replaceChildren();
  add(el, children);
  return el;
}

/**
 * Reconstruit un bloc sans faire perdre le focus clavier :
 * après `paint()`, le focus revient sur le contrôle situé au même rang.
 */
export function keepFocus(container, paint) {
  const active = document.activeElement;
  const index = active && container.contains(active) ? [...container.querySelectorAll('button, input')].indexOf(active) : -1;
  paint();
  if (index >= 0) container.querySelectorAll('button, input')[index]?.focus({ preventScroll: true });
}

export function avatarEl(index, extra = '') {
  return h('span.av', { class: extra, vars: { '--av': avatarColor(index ?? 0) }, 'aria-hidden': 'true' }, AVATARS[index] ?? '🙂');
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.8 2.8 0 115 1.7c-.9.9-2.3 1.4-2.3 3"/><path d="M12 17.2v.1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M5.5 15.5v-9a2 2 0 012-2h9"/>',
  share: '<path d="M12 15V4M8 7.5L12 3.5l4 4"/><path d="M5 12v6.5a2 2 0 002 2h10a2 2 0 002-2V12"/>',
  send: '<path d="M4 12l16-8-6 16-3-6.5L4 12z"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  chat: '<path d="M4.5 6.5a2 2 0 012-2h11a2 2 0 012 2v8a2 2 0 01-2 2H11l-4.5 3.5v-3.5a2 2 0 01-2-2v-8z"/>',
  exit: '<path d="M10 4.5H6.5a2 2 0 00-2 2v11a2 2 0 002 2H10"/><path d="M14.5 8l4 4-4 4M18.5 12H9"/>',
};

export function icon(name) {
  const span = h('span.ico', { 'aria-hidden': 'true' });
  // Contenu statique défini ci-dessus, jamais de donnée venant d'un joueur.
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

/** 95 000 ms → « 1:35 » */
export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 12 345 ms → « 12,3 s » ; au-delà d'une minute → « 1 min 05 » */
export function fmtDuration(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')}`;
}

export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Les lettres d'un mot sous forme de petites tuiles colorées (logo, mot révélé, exemples). */
export function wordTiles(word, states, extra = '') {
  return h(
    'span.wt',
    { class: extra, 'aria-label': word },
    [...word].map((ch, i) => h('span.wt-l', { data: { s: states ? states[i] : '2' }, vars: { '--i': i } }, ch)),
  );
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { value: text, readOnly: true });
    area.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
