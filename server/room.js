// Un salon de jeu : joueurs, réglages et déroulé des manches.
// Le serveur fait autorité : tant qu'un joueur n'a pas terminé sa manche (ou n'y participe pas),
// il ne reçoit ni le mot secret ni les lettres proposées par les autres, seulement leurs couleurs.
import { randomInt } from 'node:crypto';
import { feedback, scoreGuesser, scoreMaster } from './engine.js';
import { LANGS, MIN_LEN, MAX_LEN, normalize, isWord, randomAnswer, randomLength, dailyWord, dailyKey } from './words.js';

export const LIMITS = {
  maxPlayers: 8,
  nameMax: 16,
  chatMax: 160,
  avatars: 40, // nombre d'avatars proposés côté client
  maxHints: 2,
  chooseMs: 75_000, // temps laissé au maître du mot pour choisir
  countdownMs: 3_500, // « 3, 2, 1 » avant une manche multijoueur
  nextMs: 20_000, // pause entre deux manches
  sprintMs: 60_000, // temps restant après la première bonne réponse
  graceMs: 20_000, // en multijoueur, on attend ce délai un joueur déconnecté avant de finir la manche sans lui
  returnMs: 60_000, // délai laissé à un joueur déconnecté quand la partie ne peut pas continuer sans lui
  hostGraceMs: 12_000, // puis l'hôte est remplacé
  lobbyGoneMs: 90_000, // un déconnecté est retiré du salon d'attente (tant qu'il y reste quelqu'un)
  emptyMs: 5 * 60_000, // partie solo sans personne connectée
  unusedMs: 45_000, // idem, si rien n'y a encore été joué
  // Salon multijoueur vide : on attend longtemps, car sur téléphone la connexion tombe
  // dès qu'on passe dans une autre application pour envoyer le lien d'invitation.
  emptyRoomMs: 15 * 60_000,
  maxBans: 200,
  idleMs: 6 * 60 * 60_000,
};

/** Coups bas : nom → durée de l'effet chez la victime. */
export const ATTACKS = { fog: 9_000, shuffle: 12_000, flip: 9_000 };

export const EMOTES = ['😂', '🔥', '😱', '👏', '💀', '🧠', '😭', '🥶', '🤡', '❤️', '👀', '🫡'];

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'race', // race = même mot pour tous · master = un joueur choisit le mot
  lang: 'fr',
  length: 5, // 0 = aléatoire (course) ou libre (maître du mot)
  attempts: 6,
  rounds: 5, // course : nombre de manches
  tours: 1, // maître du mot : nombre de fois où chacun choisit
  timer: 180, // secondes par manche, 0 = sans limite
  strict: true, // les propositions doivent exister dans le dictionnaire
  hints: true,
  attacks: true,
  firstLetter: false,
  sprint: true, // dès qu'un joueur trouve, le temps restant est raccourci
});

export class GameError extends Error {
  constructor(code, data) {
    super(code);
    this.code = code;
    this.data = data;
  }
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

export function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const s = { ...base };
  if (!input || typeof input !== 'object') return s;
  if (input.mode === 'race' || input.mode === 'master') s.mode = input.mode;
  if (LANGS.includes(input.lang)) s.lang = input.lang;
  if (input.length === 0 || isInt(input.length, MIN_LEN, MAX_LEN)) s.length = input.length;
  if (isInt(input.attempts, 4, 8)) s.attempts = input.attempts;
  if (isInt(input.rounds, 1, 15)) s.rounds = input.rounds;
  if (isInt(input.tours, 1, 3)) s.tours = input.tours;
  if (input.timer === 0 || isInt(input.timer, 30, 600)) s.timer = input.timer;
  for (const key of ['strict', 'hints', 'attacks', 'firstLetter', 'sprint']) {
    if (typeof input[key] === 'boolean') s[key] = input[key];
  }
  return s;
}

function cleanName(raw) {
  const name = (typeof raw === 'string' ? raw : '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...name].slice(0, LIMITS.nameMax).join('').trim() || 'Joueur';
}

const cleanAvatar = (raw) => (isInt(raw, 0, LIMITS.avatars - 1) ? raw : randomInt(LIMITS.avatars));

const freshRound = (status = 'idle') => ({
  status, // idle | playing | won | lost | master | spectating
  guesses: [], // { w: mot, f: retour }
  hints: [], // { pos, letter }
  finishedAt: null,
  rank: null, // ordre d'arrivée parmi ceux qui ont trouvé
  attackUsed: false,
  points: null,
  parts: null,
});

const freshStats = () => ({ found: 0, failed: 0, attemptsSum: 0, fastestMs: null, firsts: 0, attacks: 0, hints: 0, genius: 0 });

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function send(ws, message) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
}

export class Room {
  constructor(code, { solo = false, kind = 'multi', settings } = {}) {
    this.code = code;
    this.solo = solo;
    this.kind = solo ? kind : 'multi'; // multi | free | daily | survival
    this.settings = sanitizeSettings(settings);
    if (solo) Object.assign(this.settings, { mode: 'race', attacks: false, sprint: false });
    if (this.kind === 'daily') {
      Object.assign(this.settings, { length: 0, attempts: 6, timer: 0, strict: true, hints: false, firstLetter: false });
    }
    this.phase = 'lobby'; // lobby | choosing | playing | roundEnd | gameEnd
    this.players = new Map(); // id public → joueur
    this.bySecret = new Map(); // identifiant privé du navigateur → joueur
    this.banned = new Set();
    this.hostId = null;
    this.seq = 0;
    this.roundIndex = -1;
    this.totalRounds = 0;
    this.round = null;
    this.nextAt = null;
    this.masterQueue = [];
    this.deferred = new Set();
    this.usedWords = new Set();
    this.history = [];
    this.awards = [];
    this.dailyKey = null;
    this.used = false; // quelque chose s'y est-il déjà joué ? (sinon il est nettoyé très vite une fois vide)
    this.lastActivity = Date.now();
    this.emptySince = Date.now();
  }

  // ───────────────────────── joueurs ─────────────────────────

  get connected() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  uniqueName(name) {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${[...name].slice(0, LIMITS.nameMax - 2).join('')} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /** Lève une erreur si ce joueur ne peut pas entrer (un joueur déjà membre peut toujours revenir). */
  assertCanJoin(secret) {
    if (this.bySecret.has(secret)) return;
    if (this.banned.has(secret)) throw new GameError('banned');
    if (this.solo && this.players.size > 0) throw new GameError('private');
    if (this.players.size >= LIMITS.maxPlayers) throw new GameError('full');
  }

  /** Entrée d'un nouveau joueur, ou retour d'un joueur déjà connu (même identifiant privé). */
  join(secret, profile, ws, { quiet = false } = {}) {
    let p = this.bySecret.get(secret);
    if (!p) {
      this.assertCanJoin(secret);
      p = {
        id: `p${++this.seq}`,
        secret,
        name: this.uniqueName(cleanName(profile?.name)),
        avatar: cleanAvatar(profile?.avatar),
        ws: null,
        connected: false,
        disconnectedAt: Date.now(),
        score: 0,
        r: freshRound(this.phase === 'playing' ? 'spectating' : 'idle'),
        stats: freshStats(),
        lastChat: 0,
        lastEmote: 0,
      };
      this.players.set(p.id, p);
      this.bySecret.set(secret, p);
      if (!this.hostId) this.hostId = p.id;
      if (this.players.size > 1) this.used = true;
      const inGame = this.phase === 'choosing' || this.phase === 'playing' || this.phase === 'roundEnd';
      if (inGame && this.settings.mode === 'master') {
        // Arrivé en cours de partie : il choisira un mot à son tour, en dernier.
        this.masterQueue.push(p.id);
        this.totalRounds++;
      }
    }
    this.attach(p, ws, quiet);
    return p;
  }

  /** `quiet` : ne pas diffuser l'état tout de suite (l'appelant le fera lui-même). */
  attach(p, ws, quiet = false) {
    if (p.ws && p.ws !== ws) {
      const old = p.ws;
      if (old.ctx) old.ctx.room = old.ctx.player = null;
      send(old, { t: 'replaced' });
      old.close(4001, 'replaced');
    }
    p.ws = ws;
    p.connected = true;
    p.disconnectedAt = null;
    ws.ctx.room = this;
    ws.ctx.player = p;
    this.emptySince = null;
    this.touch();
    if (!quiet) this.sync();
  }

  /** Connexion perdue : le joueur garde sa place et peut revenir. */
  detach(p, ws) {
    if (p.ws !== ws) return;
    p.ws = null;
    p.connected = false;
    p.disconnectedAt = Date.now();
    if (this.connected.length === 0) this.emptySince = Date.now();
    this.sync();
  }

  leave(p) {
    this.removePlayer(p);
  }

  kick(by, id) {
    this.requireHost(by);
    const target = this.players.get(id);
    if (!target || target === by) throw new GameError('badTarget');
    this.banned.add(target.secret);
    if (this.banned.size > LIMITS.maxBans) this.banned.delete(this.banned.values().next().value);
    target.ws?.ctx?.kickedFrom.add(this.code);
    send(target.ws, { t: 'kicked' });
    this.removePlayer(target);
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this.bySecret.delete(p.secret);
    const before = this.masterQueue.length;
    this.masterQueue = this.masterQueue.filter((id) => id !== p.id);
    this.totalRounds -= before - this.masterQueue.length;
    if (p.ws?.ctx) p.ws.ctx.room = p.ws.ctx.player = null;
    p.ws = null;
    p.connected = false;
    if (this.players.size === 0) return;
    if (this.connected.length === 0 && this.emptySince === null) this.emptySince = Date.now();
    if (this.hostId === p.id) this.pickNewHost();
    if (this.phase === 'choosing' && this.round.masterId === p.id) this.skipMaster();
    else if (this.phase === 'playing') this.checkRoundEnd(Date.now());
    this.sync();
  }

  pickNewHost() {
    const next = this.connected[0] ?? [...this.players.values()][0];
    this.hostId = next ? next.id : null;
  }

  requireHost(p) {
    if (p.id !== this.hostId) throw new GameError('notHost');
  }

  touch() {
    this.lastActivity = Date.now();
  }

  isDead(now) {
    if (this.players.size === 0) return true;
    const patience = !this.solo ? LIMITS.emptyRoomMs : this.used ? LIMITS.emptyMs : LIMITS.unusedMs;
    if (this.emptySince !== null && now - this.emptySince > patience) return true;
    return now - this.lastActivity > LIMITS.idleMs;
  }

  // ───────────────────────── réglages et lancement ─────────────────────────

  updateSettings(by, input) {
    this.requireHost(by);
    if (this.solo || (this.phase !== 'lobby' && this.phase !== 'gameEnd')) throw new GameError('badPhase');
    this.settings = sanitizeSettings(input, this.settings);
    this.sync();
  }

  start(by) {
    this.requireHost(by);
    if (this.solo && this.phase === 'roundEnd') {
      // Survie : tant qu'on trouve, on enchaîne en gardant son score.
      if (this.kind === 'survival' && by.r.status === 'won') return this.nextRound();
    } else if (this.phase !== 'lobby' && this.phase !== 'gameEnd') {
      throw new GameError('badPhase');
    }
    const active = this.connected;
    if (!this.solo && this.settings.mode === 'master' && active.length < 2) throw new GameError('needPlayers');

    // Nouvelle partie : ceux qui sont partis depuis longtemps libèrent leur place.
    const now = Date.now();
    for (const p of [...this.players.values()]) {
      if (!p.connected && p !== by && now - p.disconnectedAt > LIMITS.lobbyGoneMs) this.removePlayer(p);
    }
    for (const p of this.players.values()) {
      p.score = 0;
      p.stats = freshStats();
    }
    this.masterQueue = [];
    if (!this.solo) this.used = true;
    this.history = [];
    this.awards = [];
    this.roundIndex = -1;
    this.deferred.clear();
    if (this.usedWords.size > 400) this.usedWords.clear();

    if (this.solo) {
      this.totalRounds = this.kind === 'survival' ? Infinity : 1;
    } else if (this.settings.mode === 'master') {
      const order = shuffle(active.map((p) => p.id));
      for (let i = 0; i < this.settings.tours; i++) this.masterQueue.push(...order);
      this.totalRounds = this.masterQueue.length;
    } else {
      this.totalRounds = this.settings.rounds;
    }
    this.nextRound();
  }

  /** Retour au salon d'attente (fin de partie, ou arrêt décidé par l'hôte). */
  toLobby(by) {
    this.requireHost(by);
    if (this.solo) throw new GameError('badPhase');
    this.phase = 'lobby';
    this.round = null;
    this.nextAt = null;
    this.roundIndex = -1;
    this.totalRounds = 0;
    this.masterQueue = [];
    for (const p of this.players.values()) p.r = freshRound();
    this.sync();
  }

  // ───────────────────────── déroulé d'une manche ─────────────────────────

  nextRound() {
    this.roundIndex++;
    const s = this.settings;
    const masterMode = !this.solo && s.mode === 'master';
    if (this.roundIndex >= this.totalRounds || (masterMode && this.connected.length < 2)) return this.endGame();

    for (const p of this.players.values()) p.r = freshRound();
    this.nextAt = null;
    this.round = {
      word: null,
      length: s.length,
      attempts: s.attempts,
      masterId: null,
      startedAt: 0,
      endsAt: null,
      chooseEndsAt: null,
      firstLetter: null,
      finished: 0,
      sprint: false,
    };

    if (masterMode) {
      let master = null;
      while (this.masterQueue.length) {
        const candidate = this.players.get(this.masterQueue.shift());
        if (candidate?.connected) {
          master = candidate;
          break;
        }
        // Déconnecté au moment de choisir : son tour est repoussé une fois en fin de file
        // (s'il reste quelqu'un derrière lui), puis perdu.
        if (candidate && !this.deferred.has(candidate.id) && this.masterQueue.length) {
          this.deferred.add(candidate.id);
          this.masterQueue.push(candidate.id);
        } else {
          this.totalRounds--;
        }
      }
      if (!master) return this.endGame();
      this.round.masterId = master.id;
      master.r.status = 'master';
      this.phase = 'choosing';
      this.round.chooseEndsAt = Date.now() + LIMITS.chooseMs;
      this.sync();
    } else {
      this.beginPlaying(this.pickWord());
    }
  }

  pickWord() {
    const s = this.settings;
    if (this.kind === 'daily') {
      this.dailyKey = dailyKey();
      return dailyWord(s.lang, this.dailyKey);
    }
    return randomAnswer(s.lang, s.length || randomLength(), this.usedWords);
  }

  beginPlaying(word) {
    const s = this.settings;
    const r = this.round;
    const now = Date.now();
    r.word = word;
    r.length = word.length;
    r.startedAt = this.solo ? now : now + LIMITS.countdownMs;
    r.endsAt = s.timer ? r.startedAt + s.timer * 1000 : null;
    r.firstLetter = s.firstLetter ? word[0] : null;
    this.usedWords.add(word);
    for (const p of this.players.values()) if (p.r.status !== 'master') p.r.status = 'playing';
    this.phase = 'playing';
    this.sync();
  }

  /** Le maître du mot est parti avant de choisir : on passe au suivant sans compter la manche. */
  skipMaster() {
    this.totalRounds--;
    this.roundIndex--;
    this.nextRound();
  }

  requireMaster(p) {
    if (this.phase !== 'choosing' || this.round.masterId !== p.id) throw new GameError('badPhase');
  }

  setWord(p, raw) {
    this.requireMaster(p);
    const s = this.settings;
    const word = normalize(raw);
    const wanted = s.length;
    if (!word || (wanted ? word.length !== wanted : word.length < MIN_LEN || word.length > MAX_LEN)) {
      throw new GameError('length');
    }
    if (s.strict && !isWord(s.lang, word)) throw new GameError('unknown');
    this.beginPlaying(word);
  }

  suggest(p) {
    this.requireMaster(p);
    const s = this.settings;
    send(p.ws, { t: 'suggestion', word: randomAnswer(s.lang, s.length || randomLength(), this.usedWords) });
  }

  guess(p, raw) {
    const r = this.round;
    if (this.phase !== 'playing' || p.r.status !== 'playing') throw new GameError('notPlaying');
    const now = Date.now();
    if (now < r.startedAt) throw new GameError('notStarted');
    if (r.endsAt && now >= r.endsAt) {
      // Temps écoulé : la manche se termine ici, sans attendre le prochain battement d'horloge.
      this.endRound(now);
      return;
    }
    const word = normalize(raw);
    if (!word || word.length !== r.length) throw new GameError('length');
    if (p.r.guesses.some((g) => g.w === word)) throw new GameError('dup');
    if (this.settings.strict && word !== r.word && !isWord(this.settings.lang, word)) throw new GameError('unknown');

    p.r.guesses.push({ w: word, f: feedback(word, r.word) });
    this.used = true;
    if (word === r.word) {
      p.r.status = 'won';
      p.r.finishedAt = now;
      p.r.rank = r.finished++;
      // Sprint final : la première bonne réponse raccourcit le temps des autres.
      const others = [...this.players.values()].some((q) => q.r.status === 'playing');
      if (this.settings.sprint && !this.solo && p.r.rank === 0 && others) {
        const cap = now + LIMITS.sprintMs;
        if (!r.endsAt || r.endsAt > cap) {
          r.endsAt = cap;
          r.sprint = true;
        }
      }
    } else if (p.r.guesses.length >= r.attempts) {
      p.r.status = 'lost';
      p.r.finishedAt = now;
    }
    if (!this.checkRoundEnd(now)) this.sync();
  }

  /**
   * Le joueur jette l'éponge : sa manche est perdue et il découvre le mot.
   * En solo seulement : à plusieurs, ce serait un moyen gratuit de connaître le mot pour le souffler.
   */
  giveUp(p) {
    if (!this.solo) throw new GameError('disabled');
    if (this.phase !== 'playing' || p.r.status !== 'playing') throw new GameError('notPlaying');
    const now = Date.now();
    if (now < this.round.startedAt) throw new GameError('notStarted');
    p.r.status = 'lost';
    p.r.finishedAt = now;
    if (!this.checkRoundEnd(now)) this.sync();
  }

  hint(p) {
    const r = this.round;
    if (this.phase !== 'playing' || p.r.status !== 'playing') throw new GameError('notPlaying');
    if (!this.settings.hints) throw new GameError('disabled');
    if (Date.now() < r.startedAt) throw new GameError('notStarted');
    if (p.r.hints.length >= LIMITS.maxHints) throw new GameError('noHints');
    const known = new Set(p.r.hints.map((h) => h.pos));
    if (r.firstLetter) known.add(0);
    for (const g of p.r.guesses) {
      for (let i = 0; i < g.f.length; i++) if (g.f[i] === '2') known.add(i);
    }
    const free = [];
    for (let i = 0; i < r.length; i++) if (!known.has(i)) free.push(i);
    // On ne donne jamais la toute dernière lettre manquante.
    if (free.length <= 1) throw new GameError('noHints');
    const pos = free[randomInt(free.length)];
    p.r.hints.push({ pos, letter: r.word[pos] });
    p.stats.hints++;
    this.sync();
  }

  attack(p, type, targetId) {
    if (this.phase !== 'playing' || this.solo) throw new GameError('notPlaying');
    if (!this.settings.attacks) throw new GameError('disabled');
    if (typeof type !== 'string' || !Object.hasOwn(ATTACKS, type)) throw new GameError('badTarget');
    if (!['playing', 'won', 'lost', 'master'].includes(p.r.status)) throw new GameError('notPlaying');
    if (p.r.attackUsed) throw new GameError('noAttack');
    if (Date.now() < this.round.startedAt) throw new GameError('notStarted');
    const target = this.players.get(targetId);
    if (!target || target === p || target.r.status !== 'playing' || !target.connected) throw new GameError('badTarget');
    p.r.attackUsed = true;
    p.stats.attacks++;
    send(target.ws, { t: 'fx', type, from: p.id, ms: ATTACKS[type] });
    this.broadcast({ t: 'attack', type, from: p.id, to: target.id });
    this.sync();
  }

  /** Termine la manche s'il ne reste plus personne à attendre. Renvoie true si elle est terminée. */
  checkRoundEnd(now) {
    const waiting = [...this.players.values()].some(
      (p) => p.r.status === 'playing' && (this.solo || p.connected || now - p.disconnectedAt < LIMITS.graceMs),
    );
    if (waiting) return false;
    this.endRound(now);
    return true;
  }

  endRound(now = Date.now()) {
    const r = this.round;
    const s = this.settings;
    const refMs = (s.timer || 180) * 1000;
    const guessers = [...this.players.values()].filter((p) => ['playing', 'won', 'lost'].includes(p.r.status));
    const multi = !this.solo && guessers.length > 1;
    const results = [];

    for (const p of guessers) {
      const found = p.r.status === 'won';
      if (!found) p.r.status = 'lost';
      const attemptsUsed = p.r.guesses.length;
      const elapsedMs = Math.max(0, (p.r.finishedAt ?? now) - r.startedAt);
      const bestGreens = Math.max(0, ...p.r.guesses.map((g) => g.f.split('2').length - 1));
      const sc = scoreGuesser({
        found,
        attemptsUsed,
        maxAttempts: r.attempts,
        elapsedMs,
        refMs,
        rank: multi ? p.r.rank : null,
        hintsUsed: p.r.hints.length,
        bestGreens,
      });
      p.r.points = sc.total;
      p.r.parts = sc.parts;
      p.score += sc.total;
      if (found) {
        p.stats.found++;
        p.stats.attemptsSum += attemptsUsed;
        if (p.stats.fastestMs === null || elapsedMs < p.stats.fastestMs) p.stats.fastestMs = elapsedMs;
        if (multi && p.r.rank === 0) p.stats.firsts++;
        if (attemptsUsed <= 2) p.stats.genius++;
      } else if (attemptsUsed > 0) {
        p.stats.failed++;
      }
      results.push({ id: p.id, found, attemptsUsed, points: sc.total });
    }

    const master = r.masterId ? this.players.get(r.masterId) : null;
    if (master) {
      const sc = scoreMaster(results, r.attempts);
      master.r.points = sc.total;
      master.r.parts = sc.parts;
      master.score += sc.total;
    }

    this.history.push({
      word: r.word,
      masterId: r.masterId,
      results: results.map((x) => ({ id: x.id, found: x.found, attempts: x.attemptsUsed, points: x.points })),
    });
    if (this.history.length > 60) this.history.shift();
    this.phase = 'roundEnd';
    this.nextAt = this.solo ? null : now + LIMITS.nextMs;
    this.sync();
  }

  /** Manche suivante (ou podium) : par l'hôte, ou automatiquement à la fin de la pause. */
  advance(by) {
    if (by) this.requireHost(by);
    if (this.phase !== 'roundEnd' || this.solo) throw new GameError('badPhase');
    this.nextRound();
  }

  endGame() {
    this.phase = 'gameEnd';
    this.nextAt = null;
    this.awards = this.computeAwards();
    this.sync();
  }

  computeAwards() {
    const players = [...this.players.values()];
    if (players.length < 2) return [];
    const best = (value, wantMax = true) => {
      let winner = null;
      let top = null;
      for (const p of players) {
        const v = value(p);
        if (v === null || v === undefined) continue;
        if (top === null || (wantMax ? v > top : v < top)) {
          top = v;
          winner = p;
        }
      }
      return winner ? { id: winner.id, value: top } : null;
    };
    const awards = [];
    const add = (key, res, ok = (v) => v > 0) => {
      if (res && ok(res.value)) awards.push({ key, id: res.id, value: res.value });
    };
    add('fastest', best((p) => p.stats.fastestMs, false), () => true);
    add('brain', best((p) => (p.stats.found >= 2 ? p.stats.attemptsSum / p.stats.found : null), false), () => true);
    add('first', best((p) => p.stats.firsts));
    add('genius', best((p) => p.stats.genius));
    add('saboteur', best((p) => p.stats.attacks));
    add('unlucky', best((p) => p.stats.failed));
    return awards;
  }

  // ───────────────────────── discussion ─────────────────────────

  chat(p, raw) {
    const now = Date.now();
    if (typeof raw !== 'string' || now - p.lastChat < 400) return;
    p.lastChat = now;
    this.used = true;
    let text = raw
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    text = [...text].slice(0, LIMITS.chatMax).join('');
    if (!text) return;
    // Pas de triche : pendant la manche, un joueur qui connaît le mot ne peut pas l'écrire.
    // Ceux qui cherchent encore ne sont pas filtrés : ils ne le connaissent pas, et masquer leur
    // message reviendrait à leur confirmer qu'ils viennent de le trouver.
    let hidden = false;
    if (this.phase === 'playing' && this.round.word && p.r.status !== 'playing') {
      const letters = text
        .toLowerCase()
        .replace(/œ/g, 'oe')
        .replace(/æ/g, 'ae')
        .normalize('NFD')
        .toUpperCase()
        .replace(/[^A-Z]/g, '');
      hidden = letters.includes(this.round.word);
    }
    this.broadcast({ t: 'chat', id: p.id, name: p.name, avatar: p.avatar, text: hidden ? '' : text, hidden });
  }

  emote(p, emoji) {
    const now = Date.now();
    if (now - p.lastEmote < 250 || !EMOTES.includes(emoji)) return;
    p.lastEmote = now;
    this.broadcast({ t: 'emote', id: p.id, e: emoji });
  }

  // ───────────────────────── horloge ─────────────────────────

  /** Appelé régulièrement par le serveur : gère tout ce qui dépend du temps. */
  tick(now) {
    if (this.players.size === 0) return;
    const host = this.players.get(this.hostId);
    if (!host || (!host.connected && now - host.disconnectedAt > LIMITS.hostGraceMs)) {
      const next = this.connected[0];
      if (next && next.id !== this.hostId) {
        this.hostId = next.id;
        this.sync();
      }
    }
    if (this.phase === 'lobby') {
      // On ne libère les places des absents que s'il reste quelqu'un pour en profiter :
      // un salon momentanément vide garde tout son monde (et son hôte).
      if (this.connected.length > 0) {
        for (const p of [...this.players.values()]) {
          if (!p.connected && now - p.disconnectedAt > LIMITS.lobbyGoneMs) this.removePlayer(p);
        }
      }
      return;
    }
    // Plus personne en ligne : la partie se fige au lieu de défiler toute seule.
    // (Un chrono déjà lancé continue de courir ; le salon est supprimé s'il reste vide trop longtemps.)
    if (this.connected.length === 0) return;

    // Partie qui ne peut pas continuer à un seul : on laisse une minute à l'absent pour revenir.
    const short = !this.solo && this.settings.mode === 'master' && this.connected.length < 2;
    const mayReturn = [...this.players.values()].some((p) => !p.connected && now - p.disconnectedAt < LIMITS.returnMs);
    const holdOn = short && mayReturn;

    if (this.phase === 'choosing') {
      const master = this.players.get(this.round.masterId);
      const gone = !master || (!master.connected && now - master.disconnectedAt > LIMITS.graceMs);
      if (gone && !holdOn) this.skipMaster();
      else if (now >= this.round.chooseEndsAt) this.beginPlaying(this.pickWord());
    } else if (this.phase === 'playing') {
      if (this.round.endsAt && now >= this.round.endsAt) this.endRound(now);
      else this.checkRoundEnd(now);
    } else if (this.phase === 'roundEnd') {
      if (this.nextAt && now >= this.nextAt && !holdOn) this.nextRound();
    }
  }

  // ───────────────────────── diffusion ─────────────────────────

  broadcast(message) {
    const text = JSON.stringify(message);
    for (const p of this.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(text);
  }

  sync() {
    const now = Date.now();
    for (const p of this.players.values()) if (p.connected) send(p.ws, this.view(p, now));
  }

  /** L'état du salon tel qu'un joueur donné a le droit de le voir. */
  view(me, now = Date.now()) {
    const r = this.round;
    const over = this.phase === 'roundEnd' || this.phase === 'gameEnd';
    // Tant qu'on cherche encore, on ne voit des autres que les couleurs, pas les lettres.
    // Pareil pour un joueur arrivé en cours de manche : sinon il suffirait d'ouvrir le lien
    // dans une autre fenêtre pour lire le mot.
    const seesAll = over || ['master', 'won', 'lost'].includes(me.r.status);
    return {
      t: 'state',
      now,
      code: this.code,
      solo: this.solo,
      kind: this.kind,
      phase: this.phase,
      hostId: this.hostId,
      you: me.id,
      settings: this.settings,
      roundIndex: this.roundIndex,
      totalRounds: Number.isFinite(this.totalRounds) ? this.totalRounds : 0,
      nextAt: this.nextAt,
      dailyKey: this.dailyKey,
      round: r && {
        length: r.length,
        attempts: r.attempts,
        masterId: r.masterId,
        startedAt: r.startedAt,
        endsAt: r.endsAt,
        chooseEndsAt: r.chooseEndsAt,
        firstLetter: r.firstLetter,
        sprint: r.sprint,
        word: seesAll && this.phase !== 'choosing' ? r.word : null,
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        connected: p.connected,
        score: p.score,
        status: p.r.status,
        rank: p.r.rank,
        ms: p.r.finishedAt && r ? p.r.finishedAt - r.startedAt : null,
        guesses: p === me || seesAll ? p.r.guesses : p.r.guesses.map((g) => ({ f: g.f })),
        hints: p === me ? p.r.hints : undefined,
        hintsUsed: p.r.hints.length,
        attackUsed: p.r.attackUsed,
        points: over ? p.r.points : null,
        parts: over ? p.r.parts : null,
      })),
      history: this.phase === 'gameEnd' ? this.history : undefined,
      awards: this.phase === 'gameEnd' ? this.awards : undefined,
    };
  }
}
