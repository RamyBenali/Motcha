import test from 'node:test';
import assert from 'node:assert/strict';
import { feedback, scoreGuesser, scoreMaster, SCORING } from '../server/engine.js';
import { normalize, isWord, randomAnswer, dailyWord, dailyKey } from '../server/words.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../server/room.js';

test('retour : lettres bien placées, mal placées, absentes', () => {
  assert.equal(feedback('TABLE', 'TABLE'), '22222');
  assert.equal(feedback('CHIEN', 'TABLE'), '00010');
  assert.equal(feedback('BLATE', 'TABLE'), '11112');
  assert.equal(feedback('ZZZZZ', 'TABLE'), '00000');
});

test('retour : lettres en double comptées comme dans le mot secret', () => {
  // Un seul E dans le secret : seul le premier E mal placé est signalé.
  assert.equal(feedback('EERIE', 'TIGER'), '10110');
  // Le E bien placé « consomme » le E du secret avant les E mal placés.
  assert.equal(feedback('ELEVE', 'TIGRE'), '00002');
  assert.equal(feedback('ALLEE', 'BELLE'), '01212');
  assert.equal(feedback('LLLLL', 'BELLE'), '00220');
});

test('points du devineur : trouver vite et en peu d’essais rapporte plus', () => {
  const base = { maxAttempts: 6, refMs: 180_000, rank: null };
  const quick = scoreGuesser({ ...base, found: true, attemptsUsed: 2, elapsedMs: 18_000 });
  const slow = scoreGuesser({ ...base, found: true, attemptsUsed: 6, elapsedMs: 170_000 });
  assert.equal(quick.total, 100 + 4 * 20 + 45);
  assert.equal(slow.total, 100 + 3);
  assert.ok(quick.total > slow.total);

  const first = scoreGuesser({ ...base, found: true, attemptsUsed: 3, elapsedMs: 180_000, rank: 0 });
  assert.equal(first.total, 100 + 60 + SCORING.rank[0]);
  const fourth = scoreGuesser({ ...base, found: true, attemptsUsed: 3, elapsedMs: 180_000, rank: 3 });
  assert.equal(fourth.total, 160);
});

test('points du devineur : indices payants, lot de consolation, jamais négatif', () => {
  const base = { maxAttempts: 6, refMs: 180_000, elapsedMs: 180_000 };
  assert.equal(scoreGuesser({ ...base, found: true, attemptsUsed: 6, hintsUsed: 2 }).total, 40);
  assert.equal(scoreGuesser({ ...base, found: false, attemptsUsed: 6, bestGreens: 3 }).total, 24);
  assert.equal(scoreGuesser({ ...base, found: false, attemptsUsed: 6, bestGreens: 7 }).total, SCORING.closeMax);
  assert.equal(scoreGuesser({ ...base, found: false, attemptsUsed: 6, bestGreens: 1, hintsUsed: 2 }).total, 0);
});

test('points du maître : un mot trouvé de justesse rapporte le plus', () => {
  const at = (attemptsUsed, found = true) => scoreMaster([{ found, attemptsUsed }], 6).total;
  assert.equal(at(1), 20);
  assert.equal(at(6), SCORING.masterMax);
  assert.equal(at(6, false), SCORING.masterFail);
  assert.ok(at(6) > at(6, false) && at(6, false) > at(3));
  // Moyenne sur les joueurs ayant joué ; ceux qui n'ont rien proposé ne comptent pas.
  assert.equal(scoreMaster([{ found: true, attemptsUsed: 3 }, { found: false, attemptsUsed: 6 }, { found: false, attemptsUsed: 0 }], 6).total, 65);
  assert.equal(scoreMaster([{ found: false, attemptsUsed: 0 }], 6).total, 0);
});

test('dictionnaire : normalisation et validation', () => {
  assert.equal(normalize('  élève '), 'ELEVE');
  assert.equal(normalize('cœur'), 'COEUR');
  assert.equal(normalize('garçon'), 'GARCON');
  assert.equal(normalize('aujourd’hui'), '');
  assert.equal(normalize('abc1'), '');
  assert.equal(normalize(42), '');
  assert.ok(isWord('fr', 'MAISON'));
  assert.ok(isWord('fr', 'ELEVE'));
  assert.ok(!isWord('fr', 'ZZZZZ'));
  assert.ok(isWord('en', 'HOUSE'));
  assert.ok(!isWord('xx', 'HOUSE'));
});

test('dictionnaire : mots secrets valides et mot du jour stable', () => {
  for (const lang of ['fr', 'en']) {
    for (let n = 4; n <= 8; n++) {
      const w = randomAnswer(lang, n);
      assert.equal(w.length, n);
      assert.ok(isWord(lang, w), `${w} doit être dans le dictionnaire ${lang}`);
    }
    const today = dailyWord(lang, '2026-11-19');
    assert.equal(today, dailyWord(lang, '2026-11-19'));
    assert.ok(isWord(lang, today));
  }
  const days = new Set();
  for (let d = 1; d <= 28; d++) days.add(dailyWord('fr', `2026-02-${String(d).padStart(2, '0')}`));
  assert.ok(days.size > 20, 'le mot du jour doit changer d’un jour à l’autre');
  assert.match(dailyKey(new Date('2026-11-19T12:00:00Z')), /^2026-11-19$/);
});

test('réglages : les valeurs invalides sont ignorées', () => {
  const s = sanitizeSettings({ mode: 'hack', lang: 'xx', length: 12, attempts: 99, rounds: 0, timer: 5, strict: 'non', hints: false });
  assert.deepEqual(s, { ...DEFAULT_SETTINGS, hints: false });
  const t = sanitizeSettings({ mode: 'master', lang: 'en', length: 0, attempts: 8, rounds: 15, tours: 3, timer: 0, sprint: false });
  assert.deepEqual(t, { ...DEFAULT_SETTINGS, mode: 'master', lang: 'en', length: 0, attempts: 8, rounds: 15, tours: 3, timer: 0, sprint: false });
  assert.deepEqual(sanitizeSettings(null), { ...DEFAULT_SETTINGS });
});
