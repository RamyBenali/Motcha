// Registre des salons et aiguillage des messages WebSocket.
import { randomInt } from 'node:crypto';
import { Room, GameError, LIMITS, ATTACKS, EMOTES } from './room.js';
import { MIN_LEN, MAX_LEN, dailyKey } from './words.js';

// Pas de voyelles : aucun risque de tomber sur un vrai mot (ni sur un gros mot) dans un code de salon.
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const CODE_LENGTH = 4;
const MAX_ROOMS = 3000;
const MAX_MISSES = 40; // codes de salon inexistants tolérés par connexion (contre le balayage des codes)
const TICK_MS = 500;

const validSecret = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s);
const cleanCode = (c) => (typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH) : '');

function send(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

export function createHub() {
  const rooms = new Map();

  function makeCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function leaveCurrent(ctx) {
    const room = ctx.room;
    if (!room) return;
    room.leave(ctx.player);
    ctx.room = ctx.player = null;
    if (room.players.size === 0 && rooms.get(room.code) === room) rooms.delete(room.code);
  }

  /** Trouve le salon visé et vérifie qu'on peut y entrer, AVANT de quitter le salon actuel. */
  function findRoom(ws, m) {
    const { ctx } = ws;
    const room = rooms.get(cleanCode(m.code));
    if (!room) {
      if (++ctx.misses > MAX_MISSES) ws.close(4008, 'trop de codes invalides');
      return null;
    }
    if (ctx.kickedFrom.has(room.code)) throw new GameError('banned');
    // Une connexion ne change pas d'identité à l'intérieur d'un même salon.
    if (ctx.room === room && ctx.player.secret !== m.secret) throw new GameError('badRequest');
    room.assertCanJoin(m.secret);
    return room;
  }

  // Messages possibles sans être dans un salon.
  const openHandlers = {
    create(ws, m) {
      if (!validSecret(m.secret)) throw new GameError('badRequest');
      if (rooms.size >= MAX_ROOMS) throw new GameError('busy');
      leaveCurrent(ws.ctx);
      const solo = m.solo === true;
      const kind = solo && ['free', 'daily', 'survival'].includes(m.kind) ? m.kind : 'free';
      const room = new Room(makeCode(), { solo, kind, settings: m.settings });
      rooms.set(room.code, room);
      // En solo la partie démarre aussitôt : inutile d'annoncer d'abord un salon d'attente.
      const player = room.join(m.secret, m.profile, ws, { quiet: solo });
      if (solo) room.start(player);
    },

    join(ws, m) {
      if (!validSecret(m.secret)) throw new GameError('badRequest');
      const room = findRoom(ws, m);
      if (!room) throw new GameError('noRoom');
      if (ws.ctx.room && ws.ctx.room !== room) leaveCurrent(ws.ctx);
      room.join(m.secret, m.profile, ws);
    },

    // Rechargement de page ou coupure réseau : on retrouve sa place si on en avait une.
    // Sinon, on apprend seulement si le salon existe et s'il reste de la place.
    resume(ws, m) {
      const code = cleanCode(m.code);
      const known = rooms.get(code);
      if (known && validSecret(m.secret) && known.bySecret.has(m.secret)) {
        const room = findRoom(ws, m);
        if (ws.ctx.room && ws.ctx.room !== room) leaveCurrent(ws.ctx);
        room.join(m.secret, null, ws);
        return;
      }
      const open = !!known && !known.solo;
      if (!open && ++ws.ctx.misses > MAX_MISSES) ws.close(4008, 'trop de codes invalides');
      send(ws, {
        t: 'roomInfo',
        code,
        exists: open,
        phase: open ? known.phase : null,
        full: open ? known.players.size >= LIMITS.maxPlayers : false,
        count: open ? known.players.size : 0,
      });
    },

    leave(ws) {
      leaveCurrent(ws.ctx);
      send(ws, { t: 'left' });
    },
  };

  // Messages qui s'adressent au salon du joueur.
  const roomHandlers = {
    settings: (room, p, m) => room.updateSettings(p, m.settings),
    start: (room, p) => room.start(p),
    next: (room, p) => room.advance(p),
    lobby: (room, p) => room.toLobby(p),
    kick: (room, p, m) => room.kick(p, m.id),
    word: (room, p, m) => room.setWord(p, m.word),
    suggest: (room, p) => room.suggest(p),
    guess: (room, p, m) => room.guess(p, m.word),
    hint: (room, p) => room.hint(p),
    giveup: (room, p) => room.giveUp(p),
    attack: (room, p, m) => room.attack(p, m.type, m.target),
    chat: (room, p, m) => room.chat(p, m.text),
    emote: (room, p, m) => room.emote(p, m.e),
  };

  function onMessage(ws, data) {
    const { ctx } = ws;
    const now = Date.now();
    // Anti-spam : 20 messages par seconde en régime de croisière, 40 en rafale.
    ctx.tokens = Math.min(40, ctx.tokens + (now - ctx.last) * 0.02);
    ctx.last = now;
    if (ctx.tokens < 1) return;
    ctx.tokens -= 1;

    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;

    try {
      if (m.t === 'ping') {
        send(ws, { t: 'pong', now });
      } else if (Object.hasOwn(openHandlers, m.t)) {
        openHandlers[m.t](ws, m);
      } else if (Object.hasOwn(roomHandlers, m.t)) {
        if (!ctx.room) throw new GameError('noRoom');
        ctx.room.touch();
        roomHandlers[m.t](ctx.room, ctx.player, m);
      }
    } catch (error) {
      if (error instanceof GameError) {
        send(ws, { t: 'err', code: error.code, ctx: m.t });
      } else {
        console.error(`[motcha] erreur inattendue (message « ${m.t} »)`, error);
        send(ws, { t: 'err', code: 'server', ctx: m.t });
      }
    }
  }

  function onConnection(ws) {
    ws.ctx = { room: null, player: null, tokens: 40, last: Date.now(), misses: 0, kickedFrom: new Set() };
    ws.on('message', (data, isBinary) => {
      if (!isBinary) onMessage(ws, data.toString());
    });
    ws.on('close', () => {
      const { room, player } = ws.ctx;
      if (room) room.detach(player, ws);
    });
    ws.on('error', () => {});
    send(ws, {
      t: 'hello',
      now: Date.now(),
      dailyKey: dailyKey(),
      dailyTz: process.env.DAILY_TZ || 'Europe/Paris',
      limits: { maxPlayers: LIMITS.maxPlayers, maxHints: LIMITS.maxHints, minLen: MIN_LEN, maxLen: MAX_LEN },
      emotes: EMOTES,
      attacks: ATTACKS,
    });
  }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      try {
        room.tick(now);
      } catch (error) {
        console.error(`[motcha] salon ${room.code}`, error);
      }
      if (room.isDead(now)) {
        for (const p of room.players.values()) {
          if (p.ws) {
            p.ws.ctx.room = p.ws.ctx.player = null;
            send(p.ws, { t: 'left' });
          }
        }
        if (rooms.get(room.code) === room) rooms.delete(room.code);
      }
    }
  }, TICK_MS);
  timer.unref();

  return {
    rooms,
    onConnection,
    stats: () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.connected.length, 0) }),
    close: () => clearInterval(timer),
  };
}
