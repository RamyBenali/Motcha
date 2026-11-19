// Parties complètes jouées par de faux joueurs connectés en WebSocket à un vrai serveur.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, wrongWords, pause } from './helpers.js';
import { LIMITS } from '../server/room.js';
import { dailyWord, isWord } from '../server/words.js';

LIMITS.countdownMs = 0; // pas de « 3, 2, 1 » pendant les tests

let app;
before(async () => {
  app = await boot();
});
after(async () => {
  await app.stop();
});

const by = (state, name) => state.players.find((p) => p.name === name);

/** Crée un salon avec un hôte et des invités, tous arrivés dans le salon d'attente. */
async function party(names, settings) {
  const players = [];
  for (const name of names) players.push(await app.player(name));
  const [host, ...guests] = players;
  host.send({ t: 'create', secret: host.secret, profile: host.profile, settings });
  const { code } = await host.until((s) => s.phase === 'lobby');
  for (const g of guests) g.send({ t: 'join', secret: g.secret, code, profile: g.profile });
  await Promise.all(players.map((p) => p.until((s) => s.players.length === names.length)));
  return { players, code, room: app.room(code) };
}

/** Vérifie qu'aucun état reçu par un joueur qui cherchait encore (ou regardait) ne contenait le mot secret. */
function assertNoLeak(client, secret) {
  for (const text of client.raw) {
    const m = JSON.parse(text);
    if (m.t !== 'state' || m.phase !== 'playing') continue;
    const me = m.players.find((p) => p.id === m.you);
    if (me.status !== 'playing' && me.status !== 'spectating') continue;
    assert.ok(!text.includes(`"${secret}"`), `${client.name} a reçu le mot secret sans y avoir droit`);
  }
}

test('solo : partie libre du premier essai à la victoire', async () => {
  const a = await app.player('Ana');
  a.send({ t: 'create', secret: a.secret, profile: a.profile, solo: true, kind: 'free', settings: { length: 5, timer: 0 } });
  let s = await a.until((x) => x.phase === 'playing');
  assert.equal(a.raw.filter((text) => JSON.parse(text).t === 'state').length, 1, 'pas de passage par le salon d’attente en solo');
  assert.equal(s.solo, true);
  assert.equal(s.round.word, null);
  assert.equal(s.round.length, 5);
  const secret = app.room(s.code).round.word;

  a.send({ t: 'guess', word: 'ZZZZZ' });
  assert.deepEqual(await a.next((m) => m.t === 'err'), { t: 'err', code: 'unknown', ctx: 'guess' });
  a.send({ t: 'guess', word: 'ABC' });
  assert.equal((await a.next((m) => m.t === 'err')).code, 'length');

  const [wrong] = wrongWords(secret, 1);
  a.send({ t: 'guess', word: wrong.toLowerCase() });
  s = await a.until((x) => x.players[0].guesses.length === 1);
  assert.equal(s.players[0].guesses[0].w, wrong);
  assert.match(s.players[0].guesses[0].f, /^[012]{5}$/);
  a.send({ t: 'guess', word: wrong });
  assert.equal((await a.next((m) => m.t === 'err')).code, 'dup');

  a.send({ t: 'guess', word: secret });
  s = await a.until((x) => x.phase === 'roundEnd');
  assert.equal(a.me().status, 'won');
  assert.equal(s.round.word, secret);
  assert.equal(s.nextAt, null, 'pas de manche suivante automatique en solo');
  assert.ok(a.me().points >= 100 + 4 * 20);
  assert.equal(a.me().score, a.me().points);
  assertNoLeak(a, secret);

  a.send({ t: 'start' });
  s = await a.until((x) => x.phase === 'playing' && x.players[0].guesses.length === 0);
  assert.equal(s.players[0].score, 0);
  assert.notEqual(app.room(s.code).round.word, secret, 'un mot déjà joué ne revient pas');

  // Un salon solo est privé.
  const b = await app.player('Bob');
  b.send({ t: 'join', secret: b.secret, code: s.code, profile: b.profile });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'private');
});

test('solo : survie, le score se cumule tant qu’on trouve', async () => {
  const a = await app.player('Ana');
  a.send({ t: 'create', secret: a.secret, profile: a.profile, solo: true, kind: 'survival', settings: { length: 5, attempts: 4 } });
  let s = await a.until((x) => x.phase === 'playing');
  assert.equal(s.totalRounds, 0, '0 = sans fin');
  const room = app.room(s.code);

  a.send({ t: 'guess', word: room.round.word });
  s = await a.until((x) => x.phase === 'roundEnd');
  const first = a.me().score;
  assert.ok(first > 0);

  a.send({ t: 'start' });
  s = await a.until((x) => x.phase === 'playing' && x.roundIndex === 1);
  assert.equal(a.me().score, first, 'le score est conservé');

  for (const w of wrongWords(room.round.word, 4)) a.send({ t: 'guess', word: w });
  s = await a.until((x) => x.phase === 'roundEnd');
  assert.equal(a.me().status, 'lost');
  assert.equal(s.round.word, room.round.word);

  a.send({ t: 'start' });
  s = await a.until((x) => x.phase === 'playing' && x.roundIndex === 0);
  assert.equal(a.me().score, 0, 'après une défaite, on repart de zéro');
});

test('abandon : la manche est perdue et le mot est révélé', async () => {
  const a = await app.player('Ana');
  a.send({ t: 'create', secret: a.secret, profile: a.profile, solo: true, kind: 'free', settings: { length: 5 } });
  let s = await a.until((x) => x.phase === 'playing');
  const secret = app.room(s.code).round.word;
  const [wrong] = wrongWords(secret, 1);
  a.send({ t: 'guess', word: wrong });
  await a.until(() => a.me().guesses.length === 1);
  a.send({ t: 'giveup' });
  s = await a.until((x) => x.phase === 'roundEnd');
  assert.equal(a.me().status, 'lost');
  assert.equal(s.round.word, secret);
  assert.ok(a.me().points <= 40, 'seul le lot de consolation est accordé');
  a.send({ t: 'giveup' });
  assert.equal((await a.next((m) => m.t === 'err')).code, 'notPlaying');

  // À plusieurs, pas d'abandon : ce serait un moyen gratuit de connaître le mot pour le souffler.
  const { players } = await party(['Bob', 'Cleo'], { mode: 'race', rounds: 1, length: 5, timer: 0 });
  const [b, c] = players;
  b.send({ t: 'start' });
  await Promise.all(players.map((p) => p.until((x) => x.phase === 'playing')));
  c.send({ t: 'giveup' });
  assert.equal((await c.next((m) => m.t === 'err')).code, 'disabled');
  assert.equal(c.me().status, 'playing');
});

test('solo : mot du jour identique pour tous, sans indice', async () => {
  const a = await app.player('Ana');
  const b = await app.player('Bob');
  for (const c of [a, b]) c.send({ t: 'create', secret: c.secret, profile: c.profile, solo: true, kind: 'daily', settings: { lang: 'fr', hints: true } });
  const sa = await a.until((x) => x.phase === 'playing');
  const sb = await b.until((x) => x.phase === 'playing');
  assert.match(sa.dailyKey, /^\d{4}-\d{2}-\d{2}$/);
  const word = dailyWord('fr', sa.dailyKey);
  assert.equal(app.room(sa.code).round.word, word);
  assert.equal(app.room(sb.code).round.word, word);
  assert.equal(sa.round.length, word.length);
  assert.equal(sa.settings.hints, false);
  a.send({ t: 'hint' });
  assert.equal((await a.next((m) => m.t === 'err')).code, 'disabled');
});

test('course à trois : confidentialité, sprint final, indice, coup bas, points, podium', async () => {
  const { players, code, room } = await party(['Ana', 'Bob', 'Cleo'], { mode: 'race', rounds: 2, length: 5, timer: 120 });
  const [a, b, c] = players;

  b.send({ t: 'start' });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'notHost');
  b.send({ t: 'settings', settings: { attempts: 8 } });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'notHost');
  a.send({ t: 'settings', settings: { attempts: 4 } });
  await b.until((s) => s.settings.attempts === 4);

  a.send({ t: 'start' });
  await Promise.all(players.map((p) => p.until((s) => s.phase === 'playing')));
  const secret = room.round.word;
  const wrong = wrongWords(secret, 4);
  assert.equal(a.state.totalRounds, 2);
  assert.equal(a.state.round.endsAt - a.state.round.startedAt, 120_000);

  // Bob propose : Ana ne voit que les couleurs.
  b.send({ t: 'guess', word: wrong[0] });
  let s = await a.until((x) => by(x, 'Bob').guesses.length === 1);
  assert.deepEqual(Object.keys(by(s, 'Bob').guesses[0]), ['f']);
  assert.equal(by(s, 'Bob').hints, undefined);

  // Ana trouve du premier coup : elle voit tout, les autres toujours rien.
  a.send({ t: 'guess', word: secret });
  s = await a.until((x) => by(x, 'Ana').status === 'won');
  assert.equal(s.round.word, secret);
  assert.equal(by(s, 'Bob').guesses[0].w, wrong[0]);
  assert.equal(s.round.sprint, true);
  assert.ok(s.round.endsAt - s.now <= LIMITS.sprintMs + 100, 'le temps restant est raccourci');
  s = await b.until((x) => by(x, 'Ana').status === 'won');
  assert.equal(s.round.word, null);
  assert.deepEqual(Object.keys(by(s, 'Ana').guesses[0]), ['f']);
  assert.equal(by(s, 'Ana').guesses[0].f, '22222');

  // Coup bas : un seul par manche, sur un joueur qui cherche encore.
  a.send({ t: 'attack', type: 'fog', target: by(s, 'Bob').id });
  const fx = await b.next((m) => m.t === 'fx');
  assert.equal(fx.type, 'fog');
  assert.equal(fx.from, by(s, 'Ana').id);
  assert.ok(fx.ms > 0);
  await c.next((m) => m.t === 'attack' && m.to === by(s, 'Bob').id);
  a.send({ t: 'attack', type: 'flip', target: by(s, 'Cleo').id });
  assert.equal((await a.next((m) => m.t === 'err')).code, 'noAttack');
  b.send({ t: 'attack', type: 'fog', target: by(s, 'Ana').id });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'badTarget', 'on ne vise pas un joueur qui a fini');
  b.send({ t: 'attack', type: 'boom', target: by(s, 'Cleo').id });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'badTarget');

  // Indice : une vraie lettre du mot, visible de Bob seulement.
  b.send({ t: 'hint' });
  s = await b.until((x) => b.me().hints.length === 1);
  const hint = b.me().hints[0];
  assert.equal(secret[hint.pos], hint.letter);
  await c.until((x) => by(x, 'Bob').hintsUsed === 1);
  assert.equal(by(c.state, 'Bob').hints, undefined);

  b.send({ t: 'guess', word: secret });
  for (const w of wrong) c.send({ t: 'guess', word: w });
  await Promise.all(players.map((p) => p.until((x) => x.phase === 'roundEnd')));
  s = c.state;
  assert.equal(s.round.word, secret);
  assert.equal(by(s, 'Cleo').status, 'lost');
  assert.equal(by(s, 'Ana').rank, 0);
  assert.equal(by(s, 'Bob').rank, 1);
  const parts = (name) => Object.fromEntries(by(s, name).parts);
  assert.equal(parts('Ana').found, 100);
  assert.equal(parts('Ana').attempts, 60);
  assert.equal(parts('Ana').rank, 30);
  assert.equal(parts('Bob').rank, 15);
  assert.equal(parts('Bob').hints, -30);
  assert.equal(parts('Cleo').found, undefined);
  assert.ok(by(s, 'Ana').points > by(s, 'Bob').points && by(s, 'Bob').points > by(s, 'Cleo').points);
  assert.ok(s.nextAt > s.now);
  for (const p of players) assertNoLeak(p, secret);

  // Manche 2 puis podium.
  c.send({ t: 'next' });
  assert.equal((await c.next((m) => m.t === 'err')).code, 'notHost');
  a.send({ t: 'next' });
  await Promise.all(players.map((p) => p.until((x) => x.phase === 'playing' && x.roundIndex === 1)));
  assert.notEqual(room.round.word, secret);
  assert.equal(by(a.state, 'Ana').guesses.length, 0);
  assert.equal(by(a.state, 'Ana').attackUsed, false, 'le coup bas est rendu à chaque manche');
  for (const p of players) p.send({ t: 'guess', word: room.round.word });
  await a.until((x) => x.phase === 'roundEnd' && x.roundIndex === 1);
  a.send({ t: 'next' });
  s = await b.until((x) => x.phase === 'gameEnd');
  assert.equal(s.history.length, 2);
  assert.equal(s.history[0].word, secret);
  assert.ok(Array.isArray(s.awards) && s.awards.some((w) => w.key === 'fastest'));
  assert.ok(by(s, 'Ana').score > by(s, 'Cleo').score);

  // Revanche : retour au salon, puis nouvelle partie avec les scores à zéro.
  a.send({ t: 'lobby' });
  s = await c.until((x) => x.phase === 'lobby');
  assert.equal(s.round, null);
  a.send({ t: 'start' });
  s = await c.until((x) => x.phase === 'playing');
  assert.ok(s.players.every((p) => p.score === 0));
  assert.equal(code, s.code);
});

test('maître du mot : un joueur choisit, les autres devinent, chacun son tour', async () => {
  const { players, room } = await party(['Ana', 'Bob', 'Cleo'], { mode: 'master', tours: 1, length: 0, attempts: 6, timer: 0, sprint: false });
  const [a] = players;
  const byId = (id) => players.find((p) => p.state.you === id);

  a.send({ t: 'start' });
  await Promise.all(players.map((p) => p.until((s) => s.phase === 'choosing')));
  assert.equal(a.state.totalRounds, 3);
  const master = byId(a.state.round.masterId);
  const guessers = players.filter((p) => p !== master);
  assert.equal(master.me().status, 'master');
  assert.ok(a.state.round.chooseEndsAt > a.state.now);

  guessers[0].send({ t: 'word', word: 'MAISON' });
  assert.equal((await guessers[0].next((m) => m.t === 'err')).code, 'badPhase');
  master.send({ t: 'word', word: 'ZZZZZZ' });
  assert.equal((await master.next((m) => m.t === 'err')).code, 'unknown');
  master.send({ t: 'word', word: 'ABC' });
  assert.equal((await master.next((m) => m.t === 'err')).code, 'length');
  master.send({ t: 'suggest' });
  const suggestion = await master.next((m) => m.t === 'suggestion');
  assert.ok(isWord('fr', suggestion.word));

  master.send({ t: 'word', word: 'maison' });
  await Promise.all(players.map((p) => p.until((s) => s.phase === 'playing')));
  assert.equal(master.state.round.word, 'MAISON');
  assert.equal(guessers[0].state.round.word, null);
  assert.equal(guessers[0].state.round.length, 6);
  assert.equal(guessers[0].me().status, 'playing');
  master.send({ t: 'guess', word: 'MAISON' });
  assert.equal((await master.next((m) => m.t === 'err')).code, 'notPlaying');

  // Le maître regarde les autres chercher, lettres comprises.
  const wrong = wrongWords('MAISON', 6);
  guessers[0].send({ t: 'guess', word: wrong[0] });
  let s = await master.until((x) => x.players.some((p) => p.guesses.length === 1));
  assert.equal(s.players.find((p) => p.guesses.length === 1).guesses[0].w, wrong[0]);
  guessers[0].send({ t: 'guess', word: 'MAISON' });
  for (const w of wrong) guessers[1].send({ t: 'guess', word: w });
  await Promise.all(players.map((p) => p.until((x) => x.phase === 'roundEnd')));
  // Trouvé en 2 essais sur 6 → 40 ; introuvable → 70 ; moyenne → 55.
  assert.equal(master.me().points, 55);
  assert.deepEqual(master.me().parts, [['master', 55]]);
  assert.equal(guessers[0].me().status, 'won');
  assert.equal(guessers[1].me().status, 'lost');
  for (const g of guessers) assertNoLeak(g, 'MAISON');

  // Les deux manches suivantes : chacun est maître exactement une fois.
  const masters = new Set([master.state.you]);
  for (let round = 1; round < 3; round++) {
    a.send({ t: 'next' });
    await Promise.all(players.map((p) => p.until((x) => x.phase === 'choosing' && x.roundIndex === round)));
    const m = byId(a.state.round.masterId);
    masters.add(m.state.you);
    m.send({ t: 'suggest' });
    const { word } = await m.next((x) => x.t === 'suggestion');
    m.send({ t: 'word', word });
    await Promise.all(players.map((p) => p.until((x) => x.phase === 'playing')));
    assert.equal(room.round.word, word);
    for (const g of players.filter((p) => p !== m)) g.send({ t: 'guess', word });
    await Promise.all(players.map((p) => p.until((x) => x.phase === 'roundEnd' && x.roundIndex === round)));
    assert.equal(m.me().points, 20, 'mot trouvé du premier coup : peu de points pour le maître');
  }
  assert.equal(masters.size, 3);
  a.send({ t: 'next' });
  s = await a.until((x) => x.phase === 'gameEnd');
  assert.equal(s.history.length, 3);
  assert.ok(s.history.every((h) => h.masterId));
});

test('maître du mot : temps écoulé ou maître parti', async () => {
  const { players, room } = await party(['Ana', 'Bob', 'Cleo'], { mode: 'master', tours: 2, length: 6 });
  const [a] = players;
  const byId = (id) => players.find((p) => p.state.you === id);

  // Il faut être au moins deux.
  const lone = await app.player('Solo');
  lone.send({ t: 'create', secret: lone.secret, profile: lone.profile, settings: { mode: 'master' } });
  await lone.until((s) => s.phase === 'lobby');
  lone.send({ t: 'start' });
  assert.equal((await lone.next((m) => m.t === 'err')).code, 'needPlayers');

  a.send({ t: 'start' });
  await Promise.all(players.map((p) => p.until((s) => s.phase === 'choosing')));
  assert.equal(a.state.totalRounds, 6);
  const first = byId(a.state.round.masterId);
  first.send({ t: 'word', word: 'CHAT' });
  assert.equal((await first.next((m) => m.t === 'err')).code, 'length', 'la longueur imposée est respectée');

  // Le maître ne choisit pas à temps : un mot est tiré au sort et il le voit.
  room.round.chooseEndsAt = Date.now();
  await Promise.all(players.map((p) => p.until((s) => s.phase === 'playing')));
  assert.equal(room.round.word.length, 6);
  assert.equal(first.state.round.word, room.round.word);
  for (const g of players.filter((p) => p !== first)) g.send({ t: 'guess', word: room.round.word });
  await a.until((s) => s.phase === 'roundEnd');

  // Le maître suivant quitte la partie avant de choisir : on passe au suivant.
  room.nextAt = Date.now();
  await Promise.all(players.map((p) => p.until((s) => s.phase === 'choosing' && s.roundIndex === 1)));
  const second = byId(a.state.round.masterId);
  const others = players.filter((p) => p !== second);
  second.send({ t: 'leave' });
  await second.next((m) => m.t === 'left');
  const s = await others[0].until((x) => x.phase === 'choosing' && x.players.length === 2);
  assert.notEqual(s.round.masterId, second.state.you);
  assert.equal(s.roundIndex, 1);
  assert.equal(s.totalRounds, 4, 'les deux tours du joueur parti sont retirés');
});

test('reconnexion : on retrouve sa partie, sa grille et son score', async () => {
  const { players, code, room } = await party(['Ana', 'Bob'], { mode: 'race', rounds: 3, length: 5 });
  const [a, b] = players;
  a.send({ t: 'start' });
  await Promise.all(players.map((p) => p.until((s) => s.phase === 'playing')));
  const [wrong] = wrongWords(room.round.word, 1);
  b.send({ t: 'guess', word: wrong });
  await b.until(() => b.me().guesses.length === 1);

  await b.close();
  let s = await a.until((x) => by(x, 'Bob').connected === false);
  assert.equal(s.phase, 'playing', 'la manche continue pendant le délai de grâce');

  const b2 = await app.player('Bob', b.secret);
  b2.send({ t: 'resume', code, secret: b.secret });
  s = await b2.until((x) => x.phase === 'playing');
  assert.equal(b2.me().guesses.length, 1);
  assert.equal(b2.me().guesses[0].w, wrong);
  assert.equal(s.round.word, null);
  await a.until((x) => by(x, 'Bob').connected === true);
  assert.equal(a.state.players.length, 2);

  // Deuxième onglet avec la même identité : il remplace le premier.
  const b3 = await app.player('Bob', b.secret);
  b3.send({ t: 'join', code, secret: b.secret, profile: { name: 'Autre', avatar: 2 } });
  await b2.next((m) => m.t === 'replaced');
  s = await b3.until((x) => x.phase === 'playing');
  assert.equal(b3.me().name, 'Bob', 'le profil d’origine est conservé');
  assert.equal(s.players.length, 2);

  // Un inconnu qui ouvre le lien reçoit un aperçu du salon ; un mauvais code, un salon inexistant.
  const z = await app.player('Zoe');
  z.send({ t: 'resume', code, secret: z.secret });
  const info = await z.next((m) => m.t === 'roomInfo');
  assert.equal(info.exists, true);
  assert.equal(info.count, 2);
  assert.equal(info.phase, 'playing');
  assert.equal(info.players, undefined, 'les pseudos ne sont pas donnés à qui n’est pas dans le salon');
  z.send({ t: 'resume', code: 'QQQQ', secret: z.secret });
  assert.equal((await z.next((m) => m.t === 'roomInfo')).exists, false);
  z.send({ t: 'join', code: 'QQQQ', secret: z.secret, profile: z.profile });
  assert.equal((await z.next((m) => m.t === 'err')).code, 'noRoom');

  // Arrivée en cours de manche : spectatrice (elle ne voit que les couleurs), puis joueuse à la manche suivante.
  z.send({ t: 'join', code, secret: z.secret, profile: z.profile });
  s = await z.until((x) => x.phase === 'playing');
  assert.equal(z.me().status, 'spectating');
  assert.equal(s.round.word, null, 'un spectateur ne reçoit pas le mot');
  assert.deepEqual(Object.keys(by(s, 'Bob').guesses[0]), ['f'], 'ni les lettres des autres');
  z.send({ t: 'guess', word: room.round.word });
  assert.equal((await z.next((m) => m.t === 'err')).code, 'notPlaying');
  z.send({ t: 'attack', type: 'fog', target: by(s, 'Ana').id });
  assert.equal((await z.next((m) => m.t === 'err')).code, 'notPlaying');
  a.send({ t: 'guess', word: room.round.word });
  b3.send({ t: 'guess', word: room.round.word });
  await a.until((x) => x.phase === 'roundEnd');
  assertNoLeak(z, room.round.word);
  a.send({ t: 'next' });
  await z.until((x) => x.phase === 'playing' && x.roundIndex === 1);
  assert.equal(z.me().status, 'playing');
});

test('déconnexion : la manche se termine sans attendre indéfiniment', async () => {
  const grace = LIMITS.graceMs;
  LIMITS.graceMs = 300;
  try {
    const { players, room } = await party(['Ana', 'Bob'], { mode: 'race', rounds: 2, length: 5, timer: 0 });
    const [a, b] = players;
    a.send({ t: 'start' });
    await Promise.all(players.map((p) => p.until((s) => s.phase === 'playing')));
    a.send({ t: 'guess', word: room.round.word });
    await a.until(() => a.me().status === 'won');
    await b.close();
    const s = await a.until((x) => x.phase === 'roundEnd');
    assert.equal(by(s, 'Bob').status, 'lost');
    assert.equal(by(s, 'Bob').points, 0);
  } finally {
    LIMITS.graceMs = grace;
  }
});

test('temps écoulé et manche suivante automatique', async () => {
  const { players, room } = await party(['Ana', 'Bob'], { mode: 'race', rounds: 2, length: 5, timer: 60 });
  const [a, b] = players;
  a.send({ t: 'start' });
  await Promise.all(players.map((p) => p.until((s) => s.phase === 'playing')));
  const secret = room.round.word;
  const [wrong] = wrongWords(secret, 1);
  b.send({ t: 'guess', word: wrong });
  await b.until(() => b.me().guesses.length === 1);

  room.round.endsAt = Date.now() + 50;
  let s = await a.until((x) => x.phase === 'roundEnd');
  assert.equal(by(s, 'Ana').status, 'lost');
  assert.equal(by(s, 'Bob').status, 'lost');
  assert.equal(s.round.word, secret);

  room.nextAt = Date.now() + 50;
  s = await b.until((x) => x.phase === 'playing' && x.roundIndex === 1);
  assert.equal(s.round.word, null);
});

test('salon : expulsion, départ de l’hôte, salon plein, discussion', async () => {
  const { players, code, room } = await party(['Ana', 'Bob', 'Cleo'], { mode: 'race', length: 6 });
  const [a, b, c] = players;

  // Deux joueurs avec le même prénom : le second est renommé.
  const twin = await app.player('ana');
  twin.send({ t: 'join', code, secret: twin.secret, profile: { name: '  ana ', avatar: 999 } });
  let s = await twin.until((x) => x.players.length === 4);
  assert.equal(twin.me().name, 'ana 2');
  assert.ok(twin.me().avatar >= 0 && twin.me().avatar < LIMITS.avatars);
  twin.send({ t: 'leave' });
  await a.until((x) => x.players.length === 3);

  // Discussion : texte nettoyé, réactions filtrées.
  b.send({ t: 'chat', text: '  salut   tout le monde  ' });
  const msg = await a.next((m) => m.t === 'chat');
  assert.equal(msg.text, 'salut tout le monde');
  assert.equal(msg.name, 'Bob');
  b.send({ t: 'emote', e: '🔥' });
  assert.equal((await c.next((m) => m.t === 'emote')).e, '🔥');
  b.send({ t: 'emote', e: '<script>' });

  a.send({ t: 'start' });
  await Promise.all(players.map((p) => p.until((x) => x.phase === 'playing')));
  assert.equal(c.inbox.filter((m) => m.t === 'emote').length, 0, 'une réaction inconnue est ignorée');
  const secret = room.round.word;
  const spaced = secret.toLowerCase().split('').join(' ');

  // Un joueur qui cherche encore n'est pas filtré : masquer son message lui confirmerait le mot.
  await pause(450);
  b.send({ t: 'chat', text: `je tente ${secret} ?` });
  let line = await a.next((m) => m.t === 'chat');
  assert.equal(line.hidden, false);
  b.send({ t: 'chat', text: { toString: 1 } });

  // Un joueur qui connaît le mot ne peut pas l'écrire, même noyé dans une longue phrase ou épelé.
  a.send({ t: 'guess', word: secret });
  await a.until(() => a.me().status === 'won');
  a.send({ t: 'chat', text: `Bob, le mot secret de cette manche est ${secret}, vas-y vite avant la fin du chrono` });
  line = await b.next((m) => m.t === 'chat' && m.name === 'Ana');
  assert.equal(line.hidden, true);
  assert.equal(line.text, '');
  await pause(450);
  a.send({ t: 'chat', text: `${spaced} ω` });
  line = await b.next((m) => m.t === 'chat' && m.name === 'Ana');
  assert.equal(line.hidden, true);
  await pause(450);
  a.send({ t: 'chat', text: 'allez, courage !' });
  line = await b.next((m) => m.t === 'chat' && m.name === 'Ana');
  assert.equal(line.text, 'allez, courage !');

  // Expulsion : le joueur sort et ne peut plus revenir.
  b.send({ t: 'kick', id: by(a.state, 'Cleo').id });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'notHost');
  a.send({ t: 'kick', id: by(a.state, 'Bob').id });
  await b.next((m) => m.t === 'kicked');
  await a.until((x) => x.players.length === 2);
  b.send({ t: 'join', code, secret: b.secret, profile: b.profile });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'banned');
  b.send({ t: 'join', code, secret: 'nouvelle-identite-0123456789', profile: b.profile });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'banned', 'changer d’identité sur la même connexion ne suffit pas');

  // L'hôte s'en va : le suivant prend le relais ; le dernier parti, le salon disparaît.
  a.send({ t: 'leave' });
  s = await c.until((x) => x.players.length === 1);
  assert.equal(s.hostId, s.you);
  c.send({ t: 'leave' });
  await c.next((m) => m.t === 'left');
  assert.equal(app.room(code), undefined);
});

test('salon plein et messages invalides', async () => {
  const names = Array.from({ length: LIMITS.maxPlayers }, (_, i) => `J${i + 1}`);
  const { players, code } = await party(names, { mode: 'race' });
  const extra = await app.player('Trop');
  extra.send({ t: 'join', code, secret: extra.secret, profile: extra.profile });
  assert.equal((await extra.next((m) => m.t === 'err')).code, 'full');

  // Rien de tout cela ne doit faire tomber le serveur.
  const [a] = players;
  a.ws.send('pas du json');
  a.ws.send('null');
  a.ws.send('[]');
  a.send({ t: 42 });
  a.send({ t: 'toString' });
  a.send({ t: '__proto__' });
  a.send({ t: 'guess', word: { length: 5 } });
  a.send({ t: 'settings', settings: 'x' });
  a.send({ t: 'kick', id: 'p999' });
  a.send({ t: 'create', secret: 'court' });
  const errors = [];
  for (let i = 0; i < 3; i++) errors.push((await a.next((m) => m.t === 'err')).code);
  assert.deepEqual(errors.sort(), ['badRequest', 'badTarget', 'notPlaying']);
  a.send({ t: 'ping' });
  assert.equal((await a.next((m) => m.t === 'pong')).t, 'pong');
  const health = await fetch(`http://127.0.0.1:${app.port}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.ok(health.rooms >= 1);
});

test('entrer dans un autre salon : on ne quitte le sien que si l’entrée réussit', async () => {
  const names = Array.from({ length: LIMITS.maxPlayers }, (_, i) => `P${i + 1}`);
  const full = await party(names, { mode: 'race' });
  const mine = await party(['Ana', 'Bob'], { mode: 'race' });
  const [a, b] = mine.players;

  b.send({ t: 'join', code: full.code, secret: b.secret, profile: b.profile });
  assert.equal((await b.next((m) => m.t === 'err')).code, 'full');
  b.send({ t: 'chat', text: 'toujours là' });
  assert.equal((await a.next((m) => m.t === 'chat')).text, 'toujours là');
  assert.equal(mine.room.players.size, 2);

  // Même salon, autre identité sur la même connexion : refusé, le salon reste intact.
  a.send({ t: 'join', code: mine.code, secret: 'une-autre-identite-0123456789', profile: a.profile });
  assert.equal((await a.next((m) => m.t === 'err')).code, 'badRequest');
  assert.equal(app.room(mine.code), mine.room);
  assert.equal(mine.room.hostId, a.state.you);

  // Trop de codes inexistants : la connexion est coupée (contre le balayage des codes).
  const z = await app.player('Zoe');
  let closed = false;
  z.ws.once('close', () => {
    closed = true;
  });
  // Par petites salves, pour rester sous le plafond de l'anti-spam.
  for (let i = 0; i < 40 && !closed; i++) {
    for (let k = 0; k < 5 && !closed; k++) z.send({ t: 'resume', code: 'QQQQ', secret: z.secret });
    await pause(60);
  }
  assert.ok(closed, 'la connexion aurait dû être coupée');
});

test('personne en ligne : la partie se fige au lieu de défiler toute seule', async () => {
  const grace = LIMITS.graceMs;
  LIMITS.graceMs = 100;
  try {
    // Solo : une coupure, même longue, ne fait pas perdre la manche.
    const a = await app.player('Ana');
    a.send({ t: 'create', secret: a.secret, profile: a.profile, solo: true, kind: 'daily', settings: { lang: 'fr' } });
    let s = await a.until((x) => x.phase === 'playing');
    const soloRoom = app.room(s.code);
    await a.close();
    await pause(900);
    assert.equal(soloRoom.phase, 'playing');
    const a2 = await app.player('Ana', a.secret);
    a2.send({ t: 'resume', code: s.code, secret: a.secret });
    s = await a2.until((x) => x.phase === 'playing');
    assert.equal(a2.me().status, 'playing');

    // À plusieurs : tout le monde hors ligne, aucune manche n'est « jouée » sans personne.
    const { players, room } = await party(['Bob', 'Cleo'], { mode: 'race', rounds: 3, length: 5, timer: 0 });
    const [b, c] = players;
    b.send({ t: 'start' });
    await Promise.all(players.map((p) => p.until((x) => x.phase === 'playing')));
    await Promise.all([b.close(), c.close()]);
    await pause(900);
    assert.equal(room.phase, 'playing');
    assert.equal(room.roundIndex, 0);
  } finally {
    LIMITS.graceMs = grace;
  }
});

test('pas de proposition après la fin du chrono, coup bas mal formé refusé', async () => {
  const { players, room } = await party(['Ana', 'Bob'], { mode: 'race', rounds: 2, length: 5, timer: 60 });
  const [a, b] = players;
  a.send({ t: 'start' });
  await Promise.all(players.map((p) => p.until((x) => x.phase === 'playing')));

  a.send({ t: 'attack', type: [['fog']], target: b.state.you });
  assert.equal((await a.next((m) => m.t === 'err')).code, 'badTarget');

  // Le chrono vient d'expirer mais l'horloge du serveur n'a pas encore battu : la bonne réponse arrive trop tard.
  room.round.endsAt = Date.now() - 1;
  a.send({ t: 'guess', word: room.round.word });
  const s = await a.until((x) => x.phase === 'roundEnd');
  assert.equal(by(s, 'Ana').status, 'lost');
  assert.equal(by(s, 'Ana').guesses.length, 0);
});

test('revanche : les absents libèrent leur place, la file des maîtres repart de zéro', async () => {
  const gone = LIMITS.lobbyGoneMs;
  try {
    const { players, room } = await party(['Ana', 'Bob', 'Cleo'], { mode: 'master', tours: 2, length: 5 });
    const [a, b, c] = players;
    a.send({ t: 'start' });
    await Promise.all(players.map((p) => p.until((x) => x.phase === 'choosing')));
    assert.equal(room.masterQueue.length, 5);

    // La partie est écourtée, puis l'hôte passe en mode course depuis le podium.
    room.endGame();
    await a.until((x) => x.phase === 'gameEnd');
    await c.close();
    await a.until((x) => by(x, 'Cleo').connected === false);
    LIMITS.lobbyGoneMs = 0;
    await pause(20);
    a.send({ t: 'settings', settings: { mode: 'race', rounds: 4 } });
    a.send({ t: 'start' });
    const s = await b.until((x) => x.phase === 'playing');
    assert.equal(s.totalRounds, 4);
    assert.equal(room.masterQueue.length, 0);
    assert.deepEqual(s.players.map((p) => p.name), ['Ana', 'Bob'], 'la joueuse partie ne garde pas sa place');
  } finally {
    LIMITS.lobbyGoneMs = gone;
  }
});

test('salon d’attente : il survit quand tout le monde est momentanément hors ligne', async () => {
  const gone = LIMITS.lobbyGoneMs;
  LIMITS.lobbyGoneMs = 100;
  try {
    // L'hôte crée le salon puis passe dans une autre application pour envoyer le lien : sa connexion tombe.
    const a = await app.player('Ana');
    a.send({ t: 'create', secret: a.secret, profile: a.profile, settings: { mode: 'race' } });
    const { code } = await a.until((s) => s.phase === 'lobby');
    await a.close();
    await pause(900);
    assert.ok(app.room(code), 'le salon existe toujours');
    assert.equal(app.room(code).players.size, 1, 'l’hôte garde sa place');

    // L'invité arrive avant lui, puis l'hôte revient et retrouve son rôle.
    const b = await app.player('Bob');
    b.send({ t: 'resume', code, secret: b.secret });
    assert.equal((await b.next((m) => m.t === 'roomInfo')).exists, true);
    const a2 = await app.player('Ana', a.secret);
    a2.send({ t: 'resume', code, secret: a.secret });
    const s = await a2.until((x) => x.phase === 'lobby');
    assert.equal(s.hostId, s.you);

    // En revanche, un absent finit par libérer sa place quand d'autres sont là.
    b.send({ t: 'join', code, secret: b.secret, profile: b.profile });
    await a2.until((x) => x.players.length === 2);
    await b.close();
    await a2.until((x) => x.players.length === 1);
  } finally {
    LIMITS.lobbyGoneMs = gone;
  }
});
