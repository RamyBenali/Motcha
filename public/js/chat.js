// Discussion du salon : un seul panneau, déplacé d'un écran à l'autre.
import { h, avatarEl, icon } from './dom.js';
import { S, render } from './core.js';
import { send } from './net.js';

const MAX_ROWS = 80;
let unread = 0;

const empty = h('p.chat-empty', 'Dis bonjour 👋');
const logEl = h('div.chat-log', { 'aria-live': 'polite' }, empty);
const input = h('input.input', {
  type: 'text',
  maxLength: 160,
  placeholder: 'Écris un message…',
  autocomplete: 'off',
  enterKeyHint: 'send',
  'aria-label': 'Message',
});
const form = h(
  'form.chat-form',
  {
    onsubmit: (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text && send({ t: 'chat', text })) input.value = '';
    },
  },
  input,
  h('button.btn.icon.violet', { type: 'submit', 'aria-label': 'Envoyer' }, icon('send')),
);

export const chatEl = h('div.chat', logEl, form);

const onScreen = () => chatEl.isConnected && chatEl.offsetParent !== null;

function addRow(row, countUnread) {
  empty.remove();
  const stick = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60;
  logEl.append(row);
  while (logEl.children.length > MAX_ROWS) logEl.firstElementChild.remove();
  if (stick) logEl.scrollTop = logEl.scrollHeight;
  if (countUnread && !onScreen()) {
    unread++;
    render();
  }
}

/** Message d'un joueur (reçu du serveur). */
export function pushChat(m) {
  const mine = S.room && m.id === S.room.you;
  addRow(
    h(
      'div.chat-msg',
      { class: mine ? 'mine' : '' },
      avatarEl(m.avatar, 'xs'),
      h('div.chat-bubble', !mine && h('b', m.name), m.hidden ? h('i', '🤐 Message masqué : il contenait le mot !') : h('span', m.text)),
    ),
    !mine,
  );
}

/** Événement du jeu (« Léa a trouvé le mot »). */
export function pushEvent(text, emoji = '•') {
  addRow(h('div.chat-event', h('span', emoji), h('span', text)), false);
}

export function resetChat() {
  logEl.replaceChildren(empty);
  input.value = '';
  unread = 0;
}

export const chatUnread = () => unread;

export function mountChat(container) {
  container.append(chatEl);
  unread = 0;
  logEl.scrollTop = logEl.scrollHeight;
}

export function markChatRead() {
  if (unread && onScreen()) {
    unread = 0;
    render();
  }
}
