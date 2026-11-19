// Salon d'attente : invitation, joueurs, règles de la partie, discussion.
import { h, clear, avatarEl, icon, copyText, keepFocus } from './dom.js';
import { S, actions, isHost, playerById } from './core.js';
import { send } from './net.js';
import { prefs, savePrefs } from './store.js';
import { MODES, TIMER_CHOICES } from './consts.js';
import { topbar } from './parts.js';
import { segmented, stepper, field, optionRow } from './controls.js';
import { lengthOptions, langOptions } from './ui-panels.js';
import { mountChat } from './chat.js';
import { toast } from './fx.js';
import { confirmModal } from './modal.js';

let root = null;
let codeEl;
let countEl;
let playersEl;
let rulesEl;
let footEl;
let chatSlot;
let shareBtn;

const inviteLink = () => `${location.origin}/?r=${S.room.code}`;

async function copyLink() {
  const ok = await copyText(inviteLink());
  toast(ok ? 'Lien copié ! Envoie-le à tes amis' : `Code du salon : ${S.room.code}`, { icon: ok ? '🔗' : '🔑' });
}

async function shareLink() {
  try {
    await navigator.share({ title: 'Motcha', text: `Rejoins-moi sur Motcha ! Code du salon : ${S.room.code}`, url: inviteLink() });
  } catch {
    /* partage annulé */
  }
}

function build() {
  codeEl = h('div.code', { title: 'Copier le lien', onclick: copyLink });
  countEl = h('span.tag');
  playersEl = h('ul.players');
  rulesEl = h('div.stack');
  footEl = h('div.lobby-foot');
  chatSlot = h('div.chat-slot');
  shareBtn = h('button.btn.violet', { type: 'button', onclick: shareLink, hidden: !navigator.share }, icon('share'), 'Partager');

  root = h(
    'section.screen.lobby',
    topbar({ onBack: () => actions.confirmLeave(), backLabel: 'Quitter le salon' }),
    h(
      'div.lobby-grid',
      h(
        'div.lobby-col',
        h(
          'div.card.invite-card',
          h('span.eyebrow', 'Code du salon'),
          codeEl,
          h('div.row', h('button.btn', { type: 'button', onclick: copyLink }, icon('copy'), 'Copier le lien'), shareBtn),
          h('small.muted', 'Tes amis ouvrent le lien et arrivent directement ici.'),
        ),
        h('div.card.players-card', h('div.card-head', h('h2', 'Joueurs'), countEl), playersEl),
      ),
      h('div.card.rules-card', rulesEl, footEl),
      h('div.card.chat-card', h('div.card-head', h('h2', 'Discussion')), chatSlot),
    ),
  );
}

function paintPlayers(room) {
  const host = isHost();
  const max = S.hello?.limits.maxPlayers ?? 8;
  countEl.textContent = `${room.players.length}/${max}`;
  const rows = room.players.map((p) =>
    h(
      'li.player',
      { data: { pid: p.id }, class: `${p.id === room.you ? 'me' : ''} ${p.connected ? '' : 'off'}` },
      avatarEl(p.avatar),
      h('span.player-name', p.name, p.id === room.you && h('small', ' (toi)')),
      p.id === room.hostId && h('span.tag.gold', '👑 Hôte'),
      !p.connected && h('span.tag', '💤 absent'),
      host &&
        p.id !== room.you &&
        h(
          'button.btn.icon.small.ghost',
          {
            type: 'button',
            title: `Exclure ${p.name}`,
            'aria-label': `Exclure ${p.name}`,
            onclick: () =>
              confirmModal({
                title: 'Exclure ce joueur ?',
                text: `${p.name} sera retiré du salon et ne pourra plus y revenir.`,
                yes: 'Exclure',
                danger: true,
                onYes: () => send({ t: 'kick', id: p.id }),
              }),
          },
          icon('close'),
        ),
    ),
  );
  const empty = Math.max(0, Math.min(4, max) - room.players.length);
  for (let i = 0; i < empty; i++) rows.push(h('li.player.empty', h('span.av.ghost', '+'), h('span.player-name', 'En attente d’un joueur…')));
  clear(playersEl, rows);
}

function paintRules(room) {
  const s = room.settings;
  const host = isHost();
  const locked = !host;
  const set = (patch) => send({ t: 'settings', settings: patch });
  const master = s.mode === 'master';

  clear(
    rulesEl,
    h('div.card-head', h('h2', 'Règles de la partie'), locked && h('span.tag', 'Choisies par l’hôte')),
    h(
      'div.mode-pick',
      { role: 'radiogroup', 'aria-label': 'Mode de jeu' },
      Object.entries(MODES).map(([key, mode]) =>
        h(
          'button.mode-opt',
          { type: 'button', role: 'radio', 'aria-checked': String(s.mode === key), class: s.mode === key ? 'on' : '', disabled: locked, onclick: () => set({ mode: key }) },
          h('span.mode-ico', mode.icon),
          h('b', mode.name),
          h('small', mode.desc),
        ),
      ),
    ),
    field('Langue des mots', segmented(langOptions(), s.lang, (v) => set({ lang: v }), { disabled: locked, label: 'Langue des mots' })),
    field(
      'Nombre de lettres',
      segmented(lengthOptions(master ? 'Libre' : '🎲', master ? 'Au choix du maître' : 'Au hasard'), s.length, (v) => set({ length: v }), { disabled: locked, cls: 'tight', label: 'Nombre de lettres' }),
      s.length === 0 ? (master ? 'Le maître choisit un mot de 4 à 8 lettres' : 'Longueur tirée au sort à chaque manche') : '',
    ),
    field('Essais', stepper(s.attempts, 4, 8, (v) => set({ attempts: v }), { disabled: locked, label: 'Nombre d’essais' })),
    master
      ? field(
          'Tours',
          segmented(
            [1, 2, 3].map((n) => [n, String(n)]),
            s.tours,
            (v) => set({ tours: v }),
            { disabled: locked, label: 'Nombre de tours' },
          ),
          'Chaque joueur choisit un mot par tour',
        )
      : field(
          'Manches',
          segmented(
            [3, 5, 7, 10].map((n) => [n, String(n)]),
            s.rounds,
            (v) => set({ rounds: v }),
            { disabled: locked, label: 'Nombre de manches' },
          ),
        ),
    field('Chrono par manche', segmented(TIMER_CHOICES, s.timer, (v) => set({ timer: v }), { disabled: locked, cls: 'wrap', label: 'Chrono par manche' })),
    h(
      'div.opts',
      optionRow('💡', 'Indices', 'Une lettre révélée contre 30 points', s.hints, (v) => set({ hints: v }), locked),
      optionRow('😈', 'Coups bas', 'Un sabotage par manche pour chaque joueur', s.attacks, (v) => set({ attacks: v }), locked),
      optionRow('⚡', 'Sprint final', 'Dès qu’un joueur trouve, plus qu’une minute', s.sprint, (v) => set({ sprint: v }), locked),
      optionRow('🅰️', 'Première lettre offerte', 'La première lettre du mot est donnée', s.firstLetter, (v) => set({ firstLetter: v }), locked),
      optionRow(
        '📖',
        'Dictionnaire strict',
        s.strict ? 'Seuls les vrais mots sont acceptés' : 'Tout est permis : prénoms, blagues, inventions…',
        s.strict,
        (v) => set({ strict: v }),
        locked,
      ),
    ),
  );

  const online = room.players.filter((p) => p.connected).length;
  if (host) {
    const blocked = master && online < 2;
    clear(
      footEl,
      h('button.btn.primary.big.wide', { type: 'button', disabled: blocked, onclick: () => send({ t: 'start' }) }, '🚀 Lancer la partie'),
      h(
        'small.muted',
        blocked ? 'Il faut être au moins 2 pour le Maître du mot.' : online < 2 ? 'Tu peux lancer seul pour tester, mais c’est plus drôle à plusieurs !' : `${online} joueurs prêts.`,
      ),
    );
    // Les règles choisies servent de point de départ au prochain salon créé.
    const snapshot = JSON.stringify(s);
    if (JSON.stringify(prefs.multi) !== snapshot) {
      prefs.multi = JSON.parse(snapshot);
      savePrefs();
    }
  } else {
    const hostName = playerById(room.hostId)?.name ?? 'l’hôte';
    clear(footEl, h('p.waiting', h('span.dots', h('i'), h('i'), h('i')), `En attente de ${hostName}`));
  }
}

export const lobbyScreen = {
  get el() {
    if (!root) build();
    return root;
  },

  enter() {
    if (!root) build();
    codeEl.dataset.sig = playersEl.dataset.sig = rulesEl.dataset.sig = '';
    mountChat(chatSlot);
  },

  update() {
    const room = S.room;
    // Chaque bloc n'est reconstruit que si ce qu'il affiche a changé.
    const repaint = (el, signature, paint) => {
      const text = JSON.stringify(signature);
      if (el.dataset.sig === text) return;
      el.dataset.sig = text;
      keepFocus(el.parentElement, paint);
    };
    repaint(codeEl, room.code, () => clear(codeEl, [...room.code].map((ch, i) => h('span.code-l', { vars: { '--i': i } }, ch))));
    repaint(playersEl, [room.you, room.hostId, room.players.map((p) => [p.id, p.name, p.avatar, p.connected])], () => paintPlayers(room));
    repaint(rulesEl, [room.settings, room.you, room.hostId, playerById(room.hostId)?.name, room.players.filter((p) => p.connected).length], () => paintRules(room));
  },
};
