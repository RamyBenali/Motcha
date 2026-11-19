// Point d'entrée : relie le serveur, l'état et les écrans.
import { S, render, onRender, actions, syncClock, playerById, dailyKeyNow } from './core.js';
import { connect, disconnect, send, on } from './net.js';
import { secret, profile, prefs, applyPrefs, session } from './store.js';
import { homeScreen, todaysDaily } from './ui-home.js';
import { lobbyScreen } from './ui-lobby.js';
import { gameScreen } from './ui-game.js';
import { podiumScreen, tickResults, showDailyRecap, recordSoloResult } from './ui-results.js';
import { toast, floatEmote } from './fx.js';
import { play } from './sfx.js';
import { modalOpen, closeTopModal, closeAllModals, confirmModal, openModal } from './modal.js';
import { resetChat, pushChat, pushEvent, markChatRead } from './chat.js';
import { ERRORS, ATTACK_INFO, EMOTES } from './consts.js';
import { h } from './dom.js';

applyPrefs();

const appEl = document.getElementById('app');
const connEl = h('div.conn', { hidden: true, role: 'status' }, h('i'), h('span', 'Reconnexion…'));
document.body.append(connEl);

let current = null;
let fromLink = false; // le salon vient d'un lien d'invitation
let leaving = false; // abandon d'une partie solo en cours : on attend sa conclusion pour l'enregistrer

// ───────────────────────── écrans ─────────────────────────

function pickScreen() {
  const room = S.room;
  if (!room) return homeScreen;
  if (room.phase === 'lobby') return lobbyScreen;
  if (room.phase === 'gameEnd') return podiumScreen;
  return gameScreen;
}

onRender(() => {
  const next = pickScreen();
  if (next !== current) {
    current?.leave?.();
    current = next;
    const el = next.el;
    appEl.replaceChildren(el);
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
    next.enter?.();
    window.scrollTo(0, 0);
  }
  current.update?.();
  markChatRead();
  // Le bandeau n'apparaît que si l'on est (ou devrait être) dans un salon.
  connEl.hidden = S.conn === 'open' || S.replaced || !(S.room || S.code);
});

setInterval(() => {
  current?.tick?.();
  tickResults();
}, 250);

// ───────────────────────── salon en cours ─────────────────────────

function setUrl(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('r', code);
  else url.searchParams.delete('r');
  history.replaceState(null, '', url);
}

function clearRoom() {
  S.room = null;
  S.prev = null;
  S.code = null;
  session.set('room', null);
  setUrl(null);
  closeAllModals();
  resetChat();
}

const myProfile = () => ({ name: profile.name.trim(), avatar: profile.avatar });

function request(message) {
  if (send(message)) return true;
  toast('Connexion au serveur en cours, réessaie dans un instant', { icon: '📡', kind: 'warn' });
  return false;
}

/** Signale dans la discussion les arrivées, départs et changements d'hôte. */
function announce(prev, next) {
  if (!prev || prev.code !== next.code || next.solo) return;
  const before = new Map(prev.players.map((p) => [p.id, p]));
  const after = new Map(next.players.map((p) => [p.id, p]));
  for (const p of next.players) {
    const old = before.get(p.id);
    if (!old) {
      pushEvent(`${p.name} a rejoint le salon`, '👋');
      if (p.id !== next.you) play('join');
    } else if (old.connected && !p.connected) {
      pushEvent(`${p.name} a perdu la connexion`, '💤');
    } else if (!old.connected && p.connected && p.id !== next.you) {
      pushEvent(`${p.name} est de retour`, '🔌');
    }
  }
  for (const p of prev.players) if (!after.has(p.id)) pushEvent(`${p.name} est parti`, '🚪');
  if (prev.hostId !== next.hostId && after.has(next.hostId)) {
    const host = after.get(next.hostId);
    pushEvent(`${host.name} est maintenant l’hôte`, '👑');
    if (host.id === next.you) toast('Tu es maintenant l’hôte du salon', { icon: '👑' });
  }
}

// ───────────────────────── messages du serveur ─────────────────────────

on('open', () => {
  if (S.code) send({ t: 'resume', code: S.code, secret });
});

on('hello', (m) => {
  S.hello = m;
  syncClock(m.now);
  render();
});

on('state', (m) => {
  syncClock(m.now);
  const prev = S.room;
  if (!prev || prev.code !== m.code) {
    closeAllModals();
    resetChat();
  }
  S.prev = prev;
  S.room = m;
  S.code = m.code;
  if (leaving && m.solo && m.phase === 'roundEnd') {
    // La partie abandonnée vient de se conclure : elle compte comme perdue, puis on sort.
    recordSoloResult();
    actions.leaveRoom();
    return;
  }
  session.set('room', m.code);
  setUrl(m.solo ? null : m.code);
  announce(prev, m);
  render();
});

// Réponse à une tentative de reprise : on n'est pas (ou plus) membre de ce salon.
on('roomInfo', (m) => {
  if (m.code !== S.code) return;
  const wasInside = !!S.room; // on y jouait : le serveur a redémarré, ou on en a été retiré
  if (!m.exists) {
    if (wasInside) toast('La partie a été interrompue : le salon n’existe plus', { icon: '🔌', kind: 'warn', ms: 4500 });
    else if (fromLink) toast('Ce salon n’existe plus', { icon: '🤷', kind: 'warn', ms: 3500 });
    clearRoom();
  } else if (m.full) {
    toast(ERRORS.full, { icon: '🚫', kind: 'warn', ms: 3500 });
    clearRoom();
  } else {
    // Lien d'invitation : on entre directement avec son profil.
    send({ t: 'join', code: m.code, secret, profile: myProfile() });
  }
  fromLink = false;
  render();
});

on('err', (m) => {
  const text = ERRORS[m.code] ?? ERRORS.server;
  if (m.ctx === 'join' || m.ctx === 'create' || m.ctx === 'resume') {
    // L'entrée a échoué (exclu, salon plein, disparu…) : quoi qu'on affichait, on n'est dans aucun salon.
    toast(text, { icon: '⚠️', kind: 'warn', ms: 3500 });
    clearRoom();
    render();
  } else if (m.code === 'noRoom') {
    // Le serveur ne nous compte plus dans ce salon : inutile de rester devant un écran fantôme.
    if (S.room) toast('Tu n’es plus dans ce salon', { icon: '🚪', kind: 'warn', ms: 3500 });
    clearRoom();
    render();
  } else if (current === gameScreen) {
    gameScreen.error(m.code, m.ctx);
  } else {
    toast(text, { icon: '✋', kind: 'warn' });
  }
});

on('left', () => {
  // Simple accusé de réception quand c'est nous qui venons de quitter : rien à faire.
  if (!S.room && !S.code) return;
  if (S.room) toast('Le salon a été fermé', { icon: '🚪' });
  clearRoom();
  render();
});

on('kicked', () => {
  clearRoom();
  toast('Tu as été exclu du salon', { icon: '🚪', kind: 'warn', ms: 4000 });
  render();
});

on('replaced', () => {
  S.replaced = true;
  disconnect();
  closeAllModals();
  const modal = openModal({
    title: 'Partie ouverte ailleurs',
    className: 'small',
    dismissible: false,
    body: h('p.lead', 'Motcha vient d’être ouvert dans un autre onglet avec ton profil. Une seule fenêtre peut jouer à la fois.'),
    footer: h(
      'button.btn.primary.big.wide',
      {
        type: 'button',
        onclick: () => {
          S.replaced = false;
          modal.close();
          connect();
        },
      },
      'Reprendre ici',
    ),
  });
  render();
});

on('chat', (m) => {
  pushChat(m);
  if (S.room && m.id !== S.room.you) play('pop');
});

on('emote', (m) => {
  if (!EMOTES.includes(m.e) || !/^p\d+$/.test(String(m.id))) return;
  const from = document.querySelector(`#app [data-pid="${m.id}"] .av`) ?? document.querySelector('#app .emote-wrap');
  floatEmote(m.e, from);
  play('pop');
});

on('attack', (m) => {
  const info = ATTACK_INFO[m.type];
  const from = playerById(m.from);
  const to = playerById(m.to);
  if (!info || !from || !to || !S.room) return;
  const text = `${from.name} lance « ${info.name} » sur ${to.name}`;
  pushEvent(text, info.icon);
  if (m.to !== S.room.you) toast(text, { icon: info.icon });
});

on('fx', (m) => gameScreen.fx(m));
on('suggestion', (m) => gameScreen.suggestion(String(m.word ?? '')));

// ───────────────────────── actions ─────────────────────────

// Les règles du dernier salon servent de base, mais la langue est celle choisie à l'accueil.
actions.createRoom = () => request({ t: 'create', secret, profile: myProfile(), settings: { ...prefs.multi, lang: prefs.lang } });

actions.joinRoom = (code) => {
  fromLink = false;
  request({ t: 'join', code, secret, profile: myProfile() });
};

actions.playSolo = (kind) => {
  const settings =
    kind === 'survival'
      ? { lang: prefs.lang, length: 0, attempts: 6, timer: 120, hints: true, firstLetter: false, strict: true }
      : { ...prefs.solo, lang: prefs.lang, strict: true };
  request({ t: 'create', secret, profile: myProfile(), solo: true, kind, settings });
};

actions.playDaily = () => {
  const done = todaysDaily();
  if (done) showDailyRecap(done, dailyKeyNow(), prefs.lang);
  else request({ t: 'create', secret, profile: myProfile(), solo: true, kind: 'daily', settings: { lang: prefs.lang } });
};

actions.leaveRoom = () => {
  leaving = false;
  send({ t: 'leave' });
  clearRoom();
  render();
};

/** Quitter une partie solo en cours : elle est d'abord conclue (perdue) pour être comptée, puis on sort. */
function abandonSolo() {
  if (S.room?.solo && S.room.phase === 'playing' && send({ t: 'giveup' })) {
    leaving = true;
    setTimeout(() => leaving && actions.leaveRoom(), 1500); // pas de réponse du serveur : on sort quand même
  } else {
    actions.leaveRoom();
  }
}

actions.confirmLeave = () => {
  const room = S.room;
  if (!room) return;
  if (room.solo && room.phase !== 'playing') {
    actions.leaveRoom();
    return;
  }
  confirmModal({
    title: room.solo ? 'Abandonner la partie ?' : 'Quitter le salon ?',
    text: room.solo ? 'Ta partie en cours sera comptée comme perdue.' : room.phase === 'lobby' ? 'Tu pourras revenir avec le code du salon.' : 'La partie continuera sans toi et ton score sera perdu.',
    yes: room.solo ? 'Abandonner' : 'Quitter',
    no: 'Rester',
    danger: true,
    onYes: room.solo ? abandonSolo : actions.leaveRoom,
  });
};

// ───────────────────────── clavier ─────────────────────────

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeTopModal();
    return;
  }
  if (modalOpen() || current !== gameScreen) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  gameScreen.key(event);
});

// ───────────────────────── démarrage ─────────────────────────

const linked = (new URLSearchParams(location.search).get('r') || '').toUpperCase().replace(/[^A-Z]/g, '');
if (linked.length === 4) {
  S.code = linked;
  fromLink = true;
} else {
  setUrl(null);
  S.code = session.get('room');
}

render();
connect();
