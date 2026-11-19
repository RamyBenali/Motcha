// Tout ce qui est gardé dans le navigateur : identité, profil, préférences, statistiques.
import { AVATARS, randomName } from './consts.js';

// ?profil=2 dans l'adresse crée une identité séparée : pratique pour tester seul avec plusieurs onglets.
const space = new URLSearchParams(location.search).get('profil');
const PREFIX = space ? `motcha:${space.slice(0, 12)}:` : 'motcha:';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Lit une valeur enregistrée ; si elle est absente, illisible ou du mauvais type, rend la valeur par défaut. */
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const value = JSON.parse(raw);
    if (isObject(fallback)) return isObject(value) ? value : fallback;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* navigation privée ou stockage plein : on joue quand même */
  }
}

function newSecret() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Identifiant privé de ce navigateur : il permet de retrouver sa place après une coupure. */
export const secret = (() => {
  let value = load('secret', null);
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(value)) {
    value = newSecret();
    save('secret', value);
  }
  return value;
})();

export const profile = {
  name: randomName(),
  avatar: Math.floor(Math.random() * AVATARS.length),
  ...load('profile', {}),
};
if (typeof profile.name !== 'string' || !profile.name.trim()) profile.name = randomName();
if (!Number.isInteger(profile.avatar) || profile.avatar < 0 || profile.avatar >= AVATARS.length) profile.avatar = 0;
export const saveProfile = () => save('profile', profile);
saveProfile();

const DEFAULT_PREFS = {
  sound: true,
  theme: 'night', // night | day
  colorblind: false,
  layout: 'auto', // auto | azerty | qwerty
  lang: 'fr',
  solo: { length: 5, attempts: 6, timer: 0, hints: true, firstLetter: false },
  multi: {},
};
const storedPrefs = load('prefs', {});
export const prefs = { ...DEFAULT_PREFS, ...storedPrefs, solo: { ...DEFAULT_PREFS.solo, ...(isObject(storedPrefs.solo) ? storedPrefs.solo : {}) } };
// Une valeur enregistrée du mauvais type (ancienne version, fichier abîmé) retombe sur le réglage par défaut.
for (const key of ['sound', 'colorblind']) if (typeof prefs[key] !== 'boolean') prefs[key] = DEFAULT_PREFS[key];
if (!['night', 'day'].includes(prefs.theme)) prefs.theme = DEFAULT_PREFS.theme;
if (!['auto', 'azerty', 'qwerty'].includes(prefs.layout)) prefs.layout = DEFAULT_PREFS.layout;
if (!['fr', 'en'].includes(prefs.lang)) prefs.lang = DEFAULT_PREFS.lang;
if (!isObject(prefs.multi)) prefs.multi = {};
export const savePrefs = () => save('prefs', prefs);

export function applyPrefs() {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme === 'day' ? 'day' : 'night';
  root.dataset.cb = prefs.colorblind ? '1' : '0';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', prefs.theme === 'day' ? '#f3efff' : '#100e24');
}

/** Statistiques lues dans le navigateur, remises d'aplomb si quelque chose y manque ou y est abîmé. */
function readStats() {
  const raw = load('stats', {});
  const obj = (v) => (isObject(v) ? v : {});
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const solo = obj(raw.solo);
  const survival = obj(raw.survival);
  const daily = obj(raw.daily);
  const multi = obj(raw.multi);
  return {
    solo: { played: num(solo.played), wins: num(solo.wins), streak: num(solo.streak), maxStreak: num(solo.maxStreak), dist: obj(solo.dist) },
    survival: { best: num(survival.best), bestWords: num(survival.bestWords) },
    // days["fr|2026-11-19"] = { found, attempts, max, rows, word }
    daily: { streak: num(daily.streak), maxStreak: num(daily.maxStreak), last: typeof daily.last === 'string' ? daily.last : null, days: obj(daily.days) },
    multi: { games: num(multi.games), wins: num(multi.wins) },
    counted: Array.isArray(raw.counted) ? raw.counted.filter((id) => typeof id === 'string').slice(-30) : [],
  };
}

export const stats = readStats();
export const saveStats = () => save('stats', stats);

/** À appeler avant de modifier les statistiques : un autre onglet a pu les faire évoluer entre-temps. */
export function refreshStats() {
  Object.assign(stats, readStats());
}

/** Vrai la première fois qu'un résultat est présenté : évite de compter deux fois la même partie. */
export function countOnce(id) {
  if (stats.counted.includes(id)) return false;
  stats.counted.push(id);
  if (stats.counted.length > 30) stats.counted.shift();
  return true;
}

/** Mémoire de session (propre à l'onglet) : salon en cours, résultats déjà comptés. */
export const session = {
  get(key) {
    try {
      return sessionStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(PREFIX + key);
      else sessionStorage.setItem(PREFIX + key, value);
    } catch {
      /* sans importance */
    }
  },
};

export const dailyId = (lang, key) => `${lang}|${key}`;

/** Série de jours encore valable aujourd'hui : elle retombe à zéro dès qu'un jour est sauté. */
export function liveDailyStreak(todayKey) {
  const { last, streak } = stats.daily;
  return last === todayKey || last === dayBefore(todayKey) ? streak : 0;
}

/** La veille d'une date AAAA-MM-JJ. */
export function dayBefore(key) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
