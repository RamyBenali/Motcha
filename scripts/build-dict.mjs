// Génère les fichiers de mots utilisés par le serveur.
//
//   data/<lang>.dict.txt      tous les mots acceptés comme proposition (4 à 8 lettres)
//   data/<lang>.answers.json  les mots secrets possibles, par longueur
//
// Sources :
//   - dictionnaires complets : paquets npm an-array-of-french-words / an-array-of-english-words
//   - mots secrets           : data/src/<lang>.common.txt (liste de mots courants, relue à la main)
//
// Usage : npm run build:dict
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 4;
const MAX = 8;

/** Majuscules A-Z sans accent ; renvoie null si le mot contient autre chose que des lettres. */
export function normalize(word) {
  const w = String(word)
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  return /^[A-Z]+$/.test(w) ? w : null;
}

const SOURCES = {
  fr: 'an-array-of-french-words',
  en: 'an-array-of-english-words',
};

for (const [lang, pkg] of Object.entries(SOURCES)) {
  const raw = require(`${pkg}/index.json`);
  const dict = new Set();
  for (const word of raw) {
    const w = normalize(word);
    if (w && w.length >= MIN && w.length <= MAX) dict.add(w);
  }

  const answers = {};
  for (let n = MIN; n <= MAX; n++) answers[n] = [];
  const commonPath = path.join(root, 'data', 'src', `${lang}.common.txt`);
  const rejected = [];
  if (existsSync(commonPath)) {
    const seen = new Set();
    for (const line of readFileSync(commonPath, 'utf8').split(/\r?\n/)) {
      const w = normalize(line.trim());
      if (!w || seen.has(w)) continue;
      seen.add(w);
      if (w.length < MIN || w.length > MAX || !dict.has(w)) {
        rejected.push(w);
        continue;
      }
      answers[w.length].push(w);
    }
  } else {
    console.warn(`[${lang}] ${commonPath} introuvable : aucun mot secret généré`);
  }
  for (const n of Object.keys(answers)) answers[n].sort();

  writeFileSync(path.join(root, 'data', `${lang}.dict.txt`), [...dict].sort().join('\n') + '\n');
  writeFileSync(path.join(root, 'data', `${lang}.answers.json`), JSON.stringify(answers) + '\n');

  const counts = Object.entries(answers).map(([n, list]) => `${n}:${list.length}`).join(' ');
  console.log(`[${lang}] dictionnaire ${dict.size} mots · mots secrets ${counts}`);
  if (rejected.length) console.log(`[${lang}] ${rejected.length} mots courants rejetés : ${rejected.slice(0, 20).join(', ')}${rejected.length > 20 ? '…' : ''}`);
}
