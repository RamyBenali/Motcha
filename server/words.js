// Dictionnaires : mots acceptés comme proposition + mots secrets possibles.
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

export const LANGS = ['fr', 'en'];
export const MIN_LEN = 4;
export const MAX_LEN = 8;

const dict = {};
const answers = {};

const read = (name) => readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8');

for (const lang of LANGS) {
  const all = read(`${lang}.dict.txt`).split('\n').filter(Boolean);
  dict[lang] = new Set(all);
  const curated = JSON.parse(read(`${lang}.answers.json`));
  answers[lang] = {};
  for (let n = MIN_LEN; n <= MAX_LEN; n++) {
    const list = (curated[n] || []).filter((w) => dict[lang].has(w));
    // Filet de sécurité : sans liste de mots courants, on pioche dans tout le dictionnaire.
    answers[lang][n] = list.length >= 20 ? list : all.filter((w) => w.length === n);
  }
}

/** Majuscules A-Z sans accent ; '' si l'entrée contient autre chose que des lettres. */
export function normalize(input) {
  if (typeof input !== 'string' || input.length > 40) return '';
  const w = input
    .trim()
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  return /^[A-Z]+$/.test(w) ? w : '';
}

export function isWord(lang, word) {
  return dict[lang]?.has(word) ?? false;
}

export function answerCount(lang, length) {
  return answers[lang]?.[length]?.length ?? 0;
}

/** Longueur tirée au sort, avec un peu plus de 5-7 lettres que d'extrêmes. */
export function randomLength() {
  const pool = [4, 5, 5, 6, 6, 7, 7, 8];
  return pool[randomInt(pool.length)];
}

export function randomAnswer(lang, length, exclude) {
  const list = answers[lang][length];
  for (let i = 0; i < 40; i++) {
    const w = list[randomInt(list.length)];
    if (!exclude || !exclude.has(w)) return w;
  }
  return list[randomInt(list.length)];
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau du mot du jour. */
export function dailyKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.DAILY_TZ || 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Même mot pour tout le monde un jour donné : choix déterministe à partir de la date. */
export function dailyWord(lang, key = dailyKey()) {
  const length = [5, 6, 7][fnv1a(`${key}|${lang}|longueur`) % 3];
  const list = answers[lang][length];
  return list[fnv1a(`${key}|${lang}|mot`) % list.length];
}
