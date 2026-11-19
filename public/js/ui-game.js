// Écran de partie : grille, clavier, adversaires, choix du mot, coups bas.
import { h, clear, avatarEl, icon, fmtClock, wordTiles, plural, keepFocus } from './dom.js';
import { S, serverNow, me, playerById, render, renderLater, actions } from './core.js';
import { send, checkAlive } from './net.js';
import { prefs } from './store.js';
import { LAYOUTS, ATTACK_INFO, EMOTES, MODES, ERRORS } from './consts.js';
import { play, buzz } from './sfx.js';
import { toast, confetti } from './fx.js';
import { openModal, confirmModal, modalOpen } from './modal.js';
import { soundButton } from './parts.js';
import { openHowTo } from './ui-panels.js';
import { mountChat, chatUnread, pushEvent } from './chat.js';
import { showRoundEnd, hideRoundEnd, roundEndOpen, recordSoloResult } from './ui-results.js';

// État propre à l'affichage (tout ce qui compte vraiment vient du serveur).
const G = {
  key: '', // identifie la manche affichée
  mode: '', // play | watch | choose | wait
  input: '', // lettres tapées, pas encore envoyées
  pending: false, // proposition envoyée, réponse attendue
  pendingAt: 0,
  shown: 0, // nombre de mes propositions déjà affichées
  animRow: -1, // ligne en cours de révélation
  animEnd: 0,
  resultFor: '', // manche dont les résultats ont déjà été présentés
  seen: {}, // nombre de propositions connues par joueur
  status: {}, // dernier statut connu par joueur
  hints: 0,
  sprintSeen: false,
  fx: {}, // coups bas subis : type → heure de fin
  fxFrom: '',
  shuffleKey: '',
  lastTick: -1,
  count: null, // chiffre du décompte affiché
  emoteOpen: false,
  chatModal: null,
  attackModal: null,
  giveUpModal: null,
  queued: false, // Entrée pressée pendant une révélation : on enverra dès qu'elle est finie
  hintBusy: 0, // indice demandé, réponse attendue (évite le double clic)
};

let root = null;
let titleEl;
let subEl;
let timerEl;
let scoreEl;
let oppsEl;
let bannerEl;
let stageEl;
let countEl;
let fxEl;
let actionsEl;
let kbEl;
let sideSlot;
let boardEl = null;
let watchEl = null;
let rowEls = [];
let tiles = [];
let keyEls = new Map();
let chooseApi = null;

const isGuesser = (p) => p.status === 'playing' || p.status === 'won' || p.status === 'lost';

// ───────────────────────── construction ─────────────────────────

function build() {
  titleEl = h('b');
  subEl = h('small');
  timerEl = h('div.g-timer', { role: 'timer' });
  scoreEl = h('div.g-score');
  oppsEl = h('aside.g-opps', { 'aria-label': 'Adversaires' });
  bannerEl = h('div.g-banner', { hidden: true });
  stageEl = h('div.g-stage');
  countEl = h('div.g-count', { hidden: true, 'aria-hidden': 'true' });
  fxEl = h('div.g-fx', { hidden: true });
  actionsEl = h('div.g-actions');
  kbEl = h('div.kb', { 'aria-label': 'Clavier' });
  sideSlot = h('div.chat-slot');

  root = h(
    'section.screen.game',
    h(
      'header.g-top',
      h('button.btn.icon.ghost', { type: 'button', onclick: () => actions.confirmLeave(), 'aria-label': 'Quitter la partie', title: 'Quitter' }, icon('exit')),
      h('div.g-title', titleEl, subEl),
      timerEl,
      scoreEl,
      soundButton(),
      h('button.btn.icon.ghost.g-help', { type: 'button', onclick: openHowTo, 'aria-label': 'Comment jouer', title: 'Comment jouer' }, icon('help')),
    ),
    h('div.g-body', oppsEl, h('main.g-main', bannerEl, stageEl, actionsEl, kbEl), h('aside.g-side', h('div.card-head', h('h2', 'Discussion')), sideSlot)),
  );

  new ResizeObserver(fitBoard).observe(stageEl);
  root.addEventListener('click', (e) => {
    if (e.detail > 0) e.target.closest?.('.g-top button, .g-actions button')?.blur();
  });
  document.addEventListener('pointerdown', (e) => {
    if (G.emoteOpen && !e.target.closest?.('.emote-wrap')) setEmoteOpen(false);
  });
}

/** Ouvre ou ferme le choix de réactions, sans reconstruire les boutons voisins (un clic en cours s'y perdrait). */
function setEmoteOpen(open) {
  G.emoteOpen = open;
  const wrap = actionsEl.querySelector('.emote-wrap');
  if (!wrap) return;
  wrap.querySelector('.emote-pop').hidden = !open;
  wrap.querySelector('.btn').setAttribute('aria-expanded', String(open));
}

function resetRound(key, room, my) {
  G.key = key;
  G.mode = '';
  G.input = '';
  G.pending = false;
  G.shown = my.guesses.length;
  G.animRow = -1;
  G.animEnd = 0;
  G.seen = {};
  G.status = {};
  for (const p of room.players) {
    G.seen[p.id] = p.guesses.length;
    G.status[p.id] = p.status;
  }
  G.hints = my.hints?.length ?? 0;
  G.sprintSeen = room.round.sprint;
  G.fx = {};
  G.lastTick = -1;
  G.count = null;
  G.emoteOpen = false;
  G.queued = false;
  G.hintBusy = 0;
  closeRoundModals();
  countEl.hidden = true;
  actionsEl.dataset.sig = oppsEl.dataset.sig = '';
  hideRoundEnd();
}

/** Les fenêtres liées à la manche (coup bas, abandon) ne doivent pas lui survivre. */
function closeRoundModals() {
  G.attackModal?.close();
  G.giveUpModal?.close();
  G.attackModal = G.giveUpModal = null;
}

function pickMode(room, my) {
  if (room.phase === 'choosing') return my.status === 'master' ? 'choose' : 'wait';
  if (my.status === 'playing' || room.solo) return 'play';
  if (my.status === 'won' || my.status === 'lost') {
    // On laisse la dernière ligne finir de s'afficher avant de passer aux grilles des autres.
    const wait = G.animEnd + 1100 - Date.now();
    if (wait > 0) {
      renderLater(wait + 30);
      return 'play';
    }
  }
  return 'watch';
}

function buildStage(room) {
  const r = room.round;
  boardEl = watchEl = null;
  chooseApi = null;
  rowEls = [];
  tiles = [];
  stageEl.dataset.mode = G.mode;
  if (G.mode === 'play') {
    boardEl = h('div.board', { vars: { '--len': r.length }, role: 'grid', 'aria-label': 'Ta grille' });
    for (let row = 0; row < r.attempts; row++) {
      const cells = [];
      for (let col = 0; col < r.length; col++) cells.push(h('div.tile', { data: { s: 'empty' }, role: 'gridcell', 'aria-label': 'vide' }));
      const rowEl = h('div.board-row', { role: 'row' }, cells);
      rowEls.push(rowEl);
      tiles.push(cells);
      boardEl.append(rowEl);
    }
    clear(stageEl, boardEl, countEl, fxEl);
    fitBoard();
  } else if (G.mode === 'watch') {
    watchEl = h('div.watch');
    clear(stageEl, watchEl, countEl);
  } else if (G.mode === 'choose') {
    clear(stageEl, buildChoose(room));
  } else {
    const master = playerById(r.masterId);
    clear(
      stageEl,
      h(
        'div.wait',
        h('div.wait-av', avatarEl(master?.avatar, 'xxl'), h('span.wait-crown', '👑')),
        h('h2', `${master?.name ?? 'Le maître du mot'} choisit un mot`, h('span.dots', h('i'), h('i'), h('i'))),
        h('p.muted', 'Échauffe tes neurones, ça commence dans un instant.'),
      ),
    );
  }
}

/** Adapte la taille des tuiles à la place disponible. */
function fitBoard() {
  const r = S.room?.round;
  if (!boardEl || !r) return;
  const gap = 6;
  const width = stageEl.clientWidth - 12;
  const height = stageEl.clientHeight - 12;
  const size = Math.floor(Math.min((width - gap * (r.length - 1)) / r.length, (height - gap * (r.attempts - 1)) / r.attempts, 66));
  boardEl.style.setProperty('--tile', `${Math.max(18, size)}px`);
}

// ───────────────────────── ma grille ─────────────────────────

const TILE_LABELS = { 2: 'bien placée', 1: 'mal placée', 0: 'absente', ghost: 'déjà trouvée', hint: 'indice' };

function setTile(tile, letter, state) {
  if (tile.textContent === letter && tile.dataset.s === state) return;
  if (tile.textContent !== letter) tile.textContent = letter;
  if (tile.dataset.s !== state) tile.dataset.s = state;
  tile.setAttribute('aria-label', letter ? `${letter} ${TILE_LABELS[state] ?? ''}`.trim() : 'vide');
}

/** Les lettres dont je connais déjà la place (bien placées, indices, première lettre offerte). */
function knownLetters(my, r) {
  const known = new Array(r.length).fill(null);
  if (r.firstLetter) known[0] = { letter: r.firstLetter, hint: true };
  my.guesses.forEach((g, i) => {
    if (i >= G.shown || i === G.animRow) return;
    for (let c = 0; c < g.f.length; c++) if (g.f[c] === '2') known[c] = { letter: g.w[c], hint: false };
  });
  for (const hint of my.hints || []) if (!known[hint.pos] || known[hint.pos].hint) known[hint.pos] = { letter: hint.letter, hint: true };
  return known;
}

function paintBoard(room, my) {
  const r = room.round;
  if (!boardEl || tiles.length !== r.attempts || tiles[0].length !== r.length) return;
  const known = knownLetters(my, r);
  const current = my.status === 'playing' ? my.guesses.length : -1;
  for (let row = 0; row < r.attempts; row++) {
    rowEls[row].classList.toggle('current', row === current);
    if (row === G.animRow) continue;
    const guess = row < G.shown ? my.guesses[row] : null;
    for (let col = 0; col < r.length; col++) {
      const tile = tiles[row][col];
      if (guess) setTile(tile, guess.w[col], guess.f[col]);
      else if (row === current && G.input[col]) setTile(tile, G.input[col], 'tbd');
      else if (row === current && known[col]) setTile(tile, known[col].letter, known[col].hint ? 'hint' : 'ghost');
      else setTile(tile, '', 'empty');
    }
  }
}

/** Révèle une ligne, tuile après tuile. */
function revealRow(index, guess, status) {
  const row = tiles[index];
  if (!row) return;
  const key = G.key;
  const n = guess.w.length;
  const step = n >= 7 ? 140 : 190;
  const total = (n - 1) * step + 420;
  G.animRow = index;
  G.animEnd = Date.now() + total;
  row.forEach((tile, c) => setTile(tile, guess.w[c], 'tbd'));
  row.forEach((tile, c) =>
    setTimeout(() => {
      if (G.key !== key || !tile.isConnected) return;
      tile.dataset.s = guess.f[c];
      tile.setAttribute('aria-label', `${guess.w[c]} ${TILE_LABELS[guess.f[c]]}`);
      tile.classList.remove('stamp');
      void tile.offsetWidth;
      tile.classList.add('stamp');
      play(`r${guess.f[c]}`);
    }, c * step),
  );
  setTimeout(() => {
    if (G.key !== key) return;
    G.animRow = -1;
    if (!row[0].isConnected) return; // on a quitté la partie entre-temps : ni son ni confettis
    if (status === 'playing' && G.queued) {
      // Entrée avait été pressée pendant l'animation : on envoie maintenant.
      G.queued = false;
      const room = S.room;
      const my = me();
      if (room && my && canType(room, my) && G.input.length === room.round.length) submit(room);
    }
    if (status === 'won') {
      play('win');
      buzz([40, 40, 90]);
      row.forEach((tile, c) => {
        tile.style.setProperty('--d', `${c * 70}ms`);
        tile.classList.add('dance');
      });
      confetti({ from: rowEls[index], count: 80 });
      G.animEnd = Date.now() + 800;
    } else if (status === 'lost') {
      play('lose');
      buzz(160);
      G.animEnd = Date.now() + 300;
    }
    render();
  }, total);
}

function shakeRow() {
  const my = me();
  const rowEl = rowEls[my?.guesses.length ?? 0];
  if (!rowEl) return;
  rowEl.classList.remove('shake');
  void rowEl.offsetWidth;
  rowEl.classList.add('shake');
}

function reject(text) {
  toast(text, { kind: 'warn', icon: '✋' });
  play('bad');
  buzz(70);
  shakeRow();
}

// ───────────────────────── saisie ─────────────────────────

function canType(room, my) {
  return G.mode === 'play' && room.phase === 'playing' && my.status === 'playing' && !G.pending && serverNow() >= room.round.startedAt;
}

function submit(room) {
  if (G.animRow !== -1) {
    G.queued = true;
    return;
  }
  if (G.input.length < room.round.length) {
    reject('Pas assez de lettres');
    return;
  }
  if (!send({ t: 'guess', word: G.input })) {
    toast('Connexion perdue, on réessaie…', { kind: 'warn', icon: '📡' });
    return;
  }
  G.pending = true;
  G.pendingAt = Date.now();
  kbEl.classList.add('busy');
}

/** Une touche du clavier (physique ou à l'écran) : 'A'…'Z', 'ENTER' ou 'BACK'. */
function press(key) {
  const room = S.room;
  const my = me();
  if (!room || !my || !canType(room, my)) return;
  if (key === 'ENTER') {
    submit(room);
  } else if (key === 'BACK') {
    if (!G.input) return;
    G.queued = false;
    G.input = G.input.slice(0, -1);
    play('del');
    paintBoard(room, my);
  } else if (/^[A-Z]$/.test(key) && G.input.length < room.round.length) {
    G.queued = false;
    G.input += key;
    play('key');
    paintBoard(room, my);
  }
}

function layoutFor(room) {
  if (prefs.layout === 'azerty' || prefs.layout === 'qwerty') return prefs.layout;
  return room.settings.lang === 'en' ? 'qwerty' : 'azerty';
}

function buildKeyboard(name, signature) {
  const rows = LAYOUTS[name].map((row) => [...row]);
  if (G.fx.shuffle) {
    // Coup bas « clavier fou » : les lettres changent de place.
    const letters = rows.flat();
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    let k = 0;
    for (const row of rows) for (let i = 0; i < row.length; i++) row[i] = letters[k++];
  }
  keyEls = new Map();
  const keyButton = (key, label, extra = '') => {
    const name = key === 'ENTER' ? 'Entrer' : key === 'BACK' ? 'Effacer' : key;
    const btn = h('button.key', { type: 'button', class: extra, tabIndex: -1, 'aria-label': name, data: { s: '' } }, label);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press(key);
    });
    // Lecteur d'écran, commande vocale, contacteur : ces activations n'émettent pas de « pointerdown ».
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) press(key);
    });
    if (key.length === 1) keyEls.set(key, btn);
    return btn;
  };
  clear(
    kbEl,
    rows.map((row, index) =>
      h(
        'div.kb-row',
        index === 2 && keyButton('ENTER', 'ENTRER', 'wide enter'),
        row.map((letter) => keyButton(letter, letter)),
        index === 2 && keyButton('BACK', '⌫', 'wide back'),
      ),
    ),
  );
  kbEl.dataset.sig = signature;
}

function paintKeyboard(room, my) {
  const name = layoutFor(room);
  const signature = `${name}|${G.fx.shuffle ? G.shuffleKey : ''}`;
  if (kbEl.dataset.sig !== signature) buildKeyboard(name, signature);
  const best = {};
  my.guesses.forEach((g, i) => {
    if (i >= G.shown || i === G.animRow) return;
    for (let c = 0; c < g.w.length; c++) {
      const value = Number(g.f[c]);
      if (best[g.w[c]] === undefined || value > best[g.w[c]]) best[g.w[c]] = value;
    }
  });
  for (const [letter, btn] of keyEls) btn.dataset.s = best[letter] === undefined ? '' : String(best[letter]);
  kbEl.classList.toggle('off', !canType(room, my) && !G.pending);
  kbEl.classList.toggle('busy', G.pending);
}

// ───────────────────────── les autres joueurs ─────────────────────────

function statusBadge(p, r) {
  if (!p.connected) return h('span.badge.off', '💤');
  if (p.status === 'won') return h('span.badge.ok', `✅ ${p.guesses.length}/${r.attempts}`);
  if (p.status === 'lost') return h('span.badge.ko', '❌');
  if (p.status === 'master') return h('span.badge.gold', '👑');
  if (p.status === 'spectating') return h('span.badge', '👀');
  if (p.status === 'playing') return h('span.badge', `${p.guesses.length}/${r.attempts}`);
  return null;
}

function miniBoard(p, r, withLetters) {
  const fresh = p.guesses.length > (G.seen[p.id] ?? 0);
  const cells = [];
  for (let row = 0; row < r.attempts; row++) {
    const guess = p.guesses[row];
    const pop = fresh && row === p.guesses.length - 1;
    for (let col = 0; col < r.length; col++) {
      cells.push(h('i', { data: { s: guess ? guess.f[col] : '' }, class: pop ? 'pop' : '', vars: pop ? { '--d': `${col * 45}ms` } : {} }, withLetters && guess?.w ? guess.w[col] : ''));
    }
  }
  return h('div.mini', { class: withLetters ? 'letters' : '', vars: { '--len': r.length } }, cells);
}

function paintOpps(room, my) {
  const r = room.round;
  const others = room.players.filter((p) => p.id !== my.id);
  oppsEl.hidden = room.solo || !others.length;
  if (oppsEl.hidden) return;
  const showMinis = room.phase !== 'choosing' && r.length > 0;
  const signature = JSON.stringify([G.key, showMinis, others.map((p) => [p.id, p.name, p.avatar, p.connected, p.score, p.status, p.guesses.map((g) => g.f)])]);
  if (oppsEl.dataset.sig === signature) return;
  oppsEl.dataset.sig = signature;
  clear(
    oppsEl,
    others.map((p) =>
      h(
        'div.opp',
        { data: { pid: p.id, st: p.status }, class: p.connected ? '' : 'off' },
        h('div.opp-head', avatarEl(p.avatar, 'sm'), h('div.opp-id', h('b', p.name), h('small', `${p.score} pts`)), statusBadge(p, r)),
        showMinis && isGuesser(p) && miniBoard(p, r, false),
      ),
    ),
  );
}

function paintWatch(room, my) {
  const r = room.round;
  const guessers = room.players.filter(isGuesser);
  const signature = JSON.stringify(guessers.map((p) => [p.id, p.name, p.connected, p.status, p.guesses]));
  if (watchEl.dataset.sig === signature) return;
  watchEl.dataset.sig = signature;
  clear(
    watchEl,
    guessers.length
      ? guessers.map((p) =>
          h(
            'div.wcard',
            { data: { pid: p.id, st: p.status }, class: `${p.id === my.id ? 'me' : ''} ${p.connected ? '' : 'off'}` },
            h('div.wcard-head', avatarEl(p.avatar, 'sm'), h('b', p.name, p.id === my.id && h('small', ' (toi)')), statusBadge(p, r)),
            miniBoard(p, r, true),
          ),
        )
      : h('p.muted', 'Personne ne joue cette manche.'),
  );
}

/** Annonce ce qui vient d'arriver aux autres (trouvé, raté, sprint final, indice). */
function noticeChanges(room, my) {
  const r = room.round;
  for (const p of room.players) {
    const before = G.status[p.id];
    G.status[p.id] = p.status;
    G.seen[p.id] = p.guesses.length;
    if (p.id === my.id || before === undefined || before === p.status || room.phase !== 'playing') continue;
    if (p.status === 'won') {
      toast(`${p.name} a trouvé en ${plural(p.guesses.length, 'essai', 'essais')} !`, { icon: '✅' });
      pushEvent(`${p.name} a trouvé le mot en ${plural(p.guesses.length, 'essai', 'essais')}`, '✅');
      play('ping');
    } else if (p.status === 'lost') {
      pushEvent(`${p.name} a épuisé ses essais`, '❌');
    }
  }
  if (r.sprint && !G.sprintSeen) {
    G.sprintSeen = true;
    if (my.status === 'playing') {
      toast('Sprint final ! Plus qu’une minute', { icon: '⚡', kind: 'warn', ms: 3500 });
      buzz([60, 40, 60]);
    }
  }
  const hints = my.hints?.length ?? 0;
  if (hints !== G.hints) G.hintBusy = 0;
  if (hints > G.hints) {
    const hint = my.hints[hints - 1];
    toast(`Lettre n°${hint.pos + 1} : ${hint.letter}`, { icon: '💡', ms: 3200 });
    play('hint');
  }
  G.hints = hints;
}

// ───────────────────────── bandeau, en-tête, actions ─────────────────────────

function paintTop(room, my) {
  const r = room.round;
  if (room.solo) {
    titleEl.textContent = room.kind === 'daily' ? 'Mot du jour' : room.kind === 'survival' ? `Survie · mot ${room.roundIndex + 1}` : 'Entraînement';
    subEl.textContent = `${r.length} lettres · ${room.settings.lang === 'en' ? 'English' : 'Français'}`;
  } else {
    titleEl.textContent = `Manche ${room.roundIndex + 1}/${room.totalRounds}`;
    const mode = MODES[room.settings.mode];
    subEl.textContent = `${mode.icon} ${mode.name}${r.length ? ` · ${r.length} lettres` : ''}`;
  }
  scoreEl.hidden = room.solo && room.kind !== 'survival';
  scoreEl.textContent = `${my.score} pts`;
}

function paintBanner(room, my) {
  const r = room.round;
  const playing = room.phase === 'playing';
  let content = null;
  if (G.mode === 'watch' && playing && !r.word) {
    // Arrivé en cours de manche : on regarde les couleurs, sans connaître le mot.
    content = ['👀 Manche déjà commencée : tu joues à la prochaine !'];
  } else if (G.mode === 'watch' && r.word) {
    const word = wordTiles(r.word, null, 'tiny');
    if (my.status === 'master') content = ['👑 Ton mot : ', word, playing && ' Regarde-les chercher !'];
    else if (my.status === 'won') content = [`✅ Trouvé en ${plural(my.guesses.length, 'essai', 'essais')} !`, playing && ' Les autres cherchent encore…'];
    else if (my.status === 'lost') content = ['😵 Raté ! Le mot était ', word];
    else content = ['👀 Le mot : ', word];
    if (room.phase === 'roundEnd') content.push(h('button.btn.small.violet', { type: 'button', onclick: () => showRoundEnd(true) }, 'Voir les résultats'));
  } else if (G.mode === 'play' && playing && r.sprint && my.status === 'playing') {
    content = ['⚡ Sprint final : plus qu’une minute !'];
  }
  bannerEl.hidden = !content;
  clear(bannerEl, content);
}

function useHint() {
  if (G.hintBusy) return;
  if (send({ t: 'hint' })) {
    G.hintBusy = Date.now();
    render();
  }
}

function openAttack() {
  const targets = () => S.room.players.filter((p) => p.id !== S.room.you && p.status === 'playing' && p.connected);
  let target = targets().length === 1 ? targets()[0].id : null;
  const body = h('div.stack');
  let shown = '';
  const paint = () => {
    const list = targets();
    if (!list.some((p) => p.id === target)) target = list.length === 1 ? list[0].id : null;
    const signature = `${target}|${list.map((p) => p.id).join(',')}`;
    if (signature === shown) return;
    shown = signature;
    keepFocus(body, () => fill(list));
  };
  const fill = (list) => {
    clear(
      body,
      h('p.lead', 'Choisis ta victime…'),
      h(
        'div.targets',
        list.length
          ? list.map((p) =>
              h(
                'button.target',
                {
                  type: 'button',
                  class: target === p.id ? 'on' : '',
                  onclick: () => {
                    target = p.id;
                    paint();
                  },
                },
                avatarEl(p.avatar),
                h('b', p.name),
              ),
            )
          : h('p.muted', 'Plus personne à embêter !'),
      ),
      h('p.lead', '…et ton coup bas'),
      h(
        'div.attacks',
        Object.entries(ATTACK_INFO).map(([type, info]) =>
          h(
            'button.attack',
            {
              type: 'button',
              disabled: !target,
              onclick: () => {
                send({ t: 'attack', type, target });
                play('throw');
                G.attackModal?.close();
              },
            },
            h('span.attack-ico', info.icon),
            h('b', info.name),
            h('small', info.desc),
          ),
        ),
      ),
    );
  };
  paint();
  G.attackModal = openModal({
    title: '😈 Coup bas',
    className: 'small',
    body,
    onClose: () => {
      G.attackModal = null;
    },
  });
  G.attackModal.paint = paint;
}

function openChat() {
  const slot = h('div.chat-slot');
  G.chatModal = openModal({
    title: 'Discussion',
    className: 'chat-modal',
    body: slot,
    onClose: () => {
      G.chatModal = null;
      mountChat(sideSlot);
      render();
    },
  });
  mountChat(slot);
  render();
}

function paintActions(room, my) {
  const r = room.round;
  const started = serverNow() >= r.startedAt;
  const items = [];
  G.attackModal?.paint?.();

  // On ne reconstruit les boutons que si leur état change (sinon un clic en cours pourrait se perdre).
  const signature = JSON.stringify([
    G.mode,
    room.phase,
    my.status,
    started,
    room.settings.hints,
    room.settings.attacks,
    my.hints?.length ?? 0,
    !!G.hintBusy,
    my.attackUsed,
    room.players.some((p) => p.id !== my.id && p.status === 'playing' && p.connected),
    chatUnread(),
  ]);
  if (actionsEl.dataset.sig === signature) return;
  actionsEl.dataset.sig = signature;

  if (G.mode === 'play' && room.settings.hints && room.phase === 'playing' && my.status === 'playing') {
    const left = (S.hello?.limits.maxHints ?? 2) - (my.hints?.length ?? 0);
    items.push(
      h('button.btn.act', { type: 'button', disabled: left <= 0 || !started || !!G.hintBusy, onclick: useHint, title: 'Révèle une lettre à sa place (−30 points)' }, h('span', '💡'), h('span.act-label', 'Indice'), h('em', left)),
    );
  }
  if (room.solo && G.mode === 'play' && room.phase === 'playing' && my.status === 'playing') {
    items.push(
      h(
        'button.btn.act',
        {
          type: 'button',
          title: 'Abandonner et voir le mot',
          onclick: () =>
            (G.giveUpModal = confirmModal({
              title: 'Jeter l’éponge ?',
              text: 'Le mot sera révélé et la partie comptée comme perdue.',
              yes: 'Voir le mot',
              no: 'Je continue',
              danger: true,
              onYes: () => send({ t: 'giveup' }),
            })),
        },
        h('span', '🏳️'),
        h('span.act-label', 'Abandonner'),
      ),
    );
  }
  if (!room.solo && room.settings.attacks && room.phase === 'playing' && my.status !== 'spectating' && my.status !== 'idle') {
    const hasTarget = room.players.some((p) => p.id !== my.id && p.status === 'playing' && p.connected);
    items.push(
      h(
        'button.btn.act.pink',
        { type: 'button', disabled: my.attackUsed || !hasTarget || !started, onclick: openAttack, title: my.attackUsed ? 'Déjà utilisé cette manche' : 'Embête un adversaire (un par manche)' },
        h('span', '😈'),
        h('span.act-label', 'Coup bas'),
        my.attackUsed && h('em', '✓'),
      ),
    );
  }
  if (!room.solo) {
    items.push(
      h(
        'div.emote-wrap',
        h(
          'button.btn.act',
          {
            type: 'button',
            'aria-expanded': String(G.emoteOpen),
            'aria-label': 'Réactions',
            onclick: () => setEmoteOpen(!G.emoteOpen),
          },
          h('span', '😀'),
        ),
        h(
          'div.emote-pop',
          { hidden: !G.emoteOpen },
          EMOTES.map((emoji) => h('button.emote-b', { type: 'button', 'aria-label': `Réaction ${emoji}`, onclick: () => send({ t: 'emote', e: emoji }) }, emoji)),
        ),
      ),
    );
    const unread = chatUnread();
    items.push(h('button.btn.act.chat-btn', { type: 'button', onclick: openChat, 'aria-label': 'Discussion' }, icon('chat'), unread > 0 && h('em.alert', unread > 9 ? '9+' : unread)));
  }
  actionsEl.hidden = !items.length;
  keepFocus(actionsEl, () => clear(actionsEl, items));
}

function paintFx() {
  const now = Date.now();
  const active = Object.keys(G.fx).filter((type) => G.fx[type] > now);
  root.dataset.fog = G.fx.fog > now ? '1' : '0';
  root.dataset.flip = G.fx.flip > now ? '1' : '0';
  const signature = active.join('+');
  if (fxEl.dataset.sig === signature) return;
  fxEl.dataset.sig = signature;
  fxEl.hidden = !active.length;
  clear(
    fxEl,
    active.map((type) => {
      const info = ATTACK_INFO[type];
      return h('div.fx-pill', { vars: { '--ms': `${G.fx[type] - now}ms` } }, h('span', info.icon), h('b', info.name), G.fxFrom && h('small', `cadeau de ${G.fxFrom}`), h('i'));
    }),
  );
}

// ───────────────────────── maître du mot : choisir ─────────────────────────

function cleanWord(text) {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function buildChoose(room) {
  const wanted = room.round.length; // 0 = libre
  const min = S.hello?.limits.minLen ?? 4;
  const max = S.hello?.limits.maxLen ?? 8;
  const input = h('input.input.word-input', {
    type: 'text',
    maxLength: (wanted || max) + 4,
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: false,
    placeholder: 'TON MOT',
    'aria-label': 'Mot secret',
    enterKeyHint: 'done',
  });
  const preview = h('div.choose-preview');
  const status = h('small.choose-status');
  const okBtn = h('button.btn.primary.big', { type: 'button' }, 'Valider ce mot');

  const paint = () => {
    const word = cleanWord(input.value);
    const tooLong = word.length > (wanted || max);
    const ok = wanted ? word.length === wanted : word.length >= min && word.length <= max;
    clear(preview, word ? wordTiles(word.slice(0, 12), null, 'mid') : h('span.muted', 'Ton mot apparaîtra ici'));
    status.textContent = `${wanted ? `${word.length}/${wanted} lettres` : `${plural(word.length, 'lettre', 'lettres')} (entre ${min} et ${max})`}${tooLong ? ' · trop long !' : ''}`;
    status.dataset.ok = ok ? '1' : '0';
    okBtn.disabled = !ok;
    return ok ? word : null;
  };
  const submit = () => {
    const word = paint();
    if (word) send({ t: 'word', word });
  };
  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  okBtn.addEventListener('click', submit);
  paint();
  setTimeout(() => {
    // On ne vole pas le focus à quelqu'un qui écrit dans la discussion ou qui a une fenêtre ouverte.
    const active = document.activeElement;
    if (!input.isConnected || modalOpen() || (active && /^(INPUT|TEXTAREA)$/.test(active.tagName))) return;
    input.focus();
  }, 60);

  chooseApi = {
    setWord(word) {
      input.value = word;
      paint();
      play('pop');
    },
    refuse() {
      input.classList.remove('shake');
      void input.offsetWidth;
      input.classList.add('shake');
    },
  };

  return h(
    'div.choose',
    h('div.choose-crown', '👑'),
    h('h2', 'À toi de choisir le mot secret'),
    h('p.muted', wanted ? `Un mot de ${wanted} lettres` : `Un mot de ${min} à ${max} lettres`, room.settings.strict ? ', présent dans le dictionnaire.' : '. Tout est permis !'),
    h(
      'div.choose-row',
      input,
      h('button.btn.icon.big', { type: 'button', title: 'Mot au hasard', 'aria-label': 'Mot au hasard', onclick: () => send({ t: 'suggest' }) }, '🎲'),
    ),
    preview,
    status,
    okBtn,
    h('p.tip', '💡 Vise un mot que les autres trouveront de justesse : c’est là que tu gagnes le plus. Introuvable, il rapporte moins !'),
  );
}

// ───────────────────────── fin de manche ─────────────────────────

function handleRoundEnd(room) {
  if (room.phase !== 'roundEnd') {
    hideRoundEnd();
    return;
  }
  // Le résultat est enregistré tout de suite, même si l'on quitte avant de voir la fenêtre.
  if (room.solo) recordSoloResult();
  if (S.replaced) return;
  if (G.resultFor === G.key) {
    // En solo, cette fenêtre est le seul moyen de continuer : si elle a disparu, on la rouvre.
    showRoundEnd(room.solo && !roundEndOpen());
    return;
  }
  const wait = G.animEnd + 900 - Date.now();
  if (wait > 0) {
    renderLater(wait + 30);
    return;
  }
  G.resultFor = G.key;
  showRoundEnd(true);
}

// ───────────────────────── interface publique ─────────────────────────

export const gameScreen = {
  get el() {
    if (!root) build();
    return root;
  },

  enter() {
    if (!root) build();
    G.key = '';
    G.resultFor = '';
    mountChat(sideSlot);
  },

  leave() {
    G.chatModal?.close();
    G.attackModal?.close();
    hideRoundEnd();
  },

  update() {
    const room = S.room;
    const my = me();
    const r = room?.round;
    if (!r || !my) return;

    // Pendant le choix du mot, la manche est identifiée par son maître (il peut être remplacé).
    const key = `${room.code}|${room.roundIndex}|${r.startedAt || `choix:${r.masterId}`}`;
    if (key !== G.key) resetRound(key, room, my);
    if (room.phase !== 'playing') closeRoundModals();

    // Le serveur a accepté une proposition : on l'affiche.
    if (my.guesses.length > G.shown) {
      const index = my.guesses.length - 1;
      const single = my.guesses.length - G.shown === 1;
      G.shown = my.guesses.length;
      G.input = '';
      G.pending = false;
      if (single && G.mode === 'play') revealRow(index, my.guesses[index], my.status);
    }

    const mode = pickMode(room, my);
    if (mode !== G.mode) {
      G.mode = mode;
      buildStage(room);
    }
    root.dataset.mode = mode;
    root.dataset.solo = room.solo ? '1' : '0';

    paintTop(room, my);
    paintOpps(room, my);
    if (mode === 'play') {
      paintBoard(room, my);
      paintKeyboard(room, my);
    } else if (mode === 'watch') {
      paintWatch(room, my);
    }
    noticeChanges(room, my);
    paintBanner(room, my);
    paintActions(room, my);
    paintFx();
    handleRoundEnd(room);
    this.tick();
  },

  /** Appelé plusieurs fois par seconde : chronos, décompte, fin des coups bas. */
  tick() {
    const room = S.room;
    const r = room?.round;
    if (!root || !r) return;
    const now = serverNow();
    let text = '';
    let warn = false;

    if (room.phase === 'choosing') {
      const left = r.chooseEndsAt - now;
      text = fmtClock(left);
      warn = left <= 10_000;
    } else if (room.phase === 'playing') {
      const before = r.startedAt - now;
      if (before > 0) {
        const n = Math.min(3, Math.ceil(before / 1000));
        if (G.count !== n) {
          G.count = n;
          countEl.hidden = false;
          countEl.textContent = n;
          countEl.classList.remove('beat');
          void countEl.offsetWidth;
          countEl.classList.add('beat');
          play('count');
        }
        text = r.endsAt ? fmtClock(r.endsAt - r.startedAt) : '';
      } else {
        if (G.count !== null) {
          G.count = null;
          countEl.hidden = true;
          play('start');
          render();
        }
        if (r.endsAt) {
          const left = r.endsAt - now;
          text = fmtClock(left);
          warn = left <= 10_000;
          const second = Math.ceil(left / 1000);
          if (warn && second > 0 && second !== G.lastTick && me()?.status === 'playing') {
            G.lastTick = second;
            play('tick');
          }
        } else {
          text = fmtClock(Math.floor((now - r.startedAt) / 1000) * 1000);
        }
      }
    }
    timerEl.hidden = !text;
    timerEl.textContent = text;
    timerEl.dataset.warn = warn ? '1' : '0';
    timerEl.dataset.sprint = r.sprint && room.phase === 'playing' ? '1' : '0';

    const stamp = Date.now();
    let expired = false;
    for (const type of Object.keys(G.fx)) {
      if (G.fx[type] <= stamp) {
        delete G.fx[type];
        expired = true;
      }
    }
    if (G.pending && stamp - G.pendingAt > 6000) {
      // Proposition restée sans réponse : on débloque la saisie et on vérifie que la connexion vit encore.
      G.pending = false;
      expired = true;
      checkAlive();
      toast('Pas de réponse du serveur, réessaie', { kind: 'warn', icon: '📡' });
    }
    if (G.hintBusy && stamp - G.hintBusy > 3000) {
      G.hintBusy = 0;
      expired = true;
    }
    if (expired) render();
  },

  /** Touche du clavier physique. */
  key(event) {
    if (G.mode !== 'play' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter') {
      // Sur un bouton ou un lien choisi au clavier, Entrée garde son rôle habituel.
      if (event.target instanceof Element && event.target.closest('button, a, summary')) return;
      event.preventDefault();
      press('ENTER');
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      press('BACK');
    } else if (event.key.length === 1) {
      const letter = cleanWord(event.key);
      if (letter.length === 1) press(letter);
    }
  },

  /** Le serveur a refusé quelque chose. */
  error(code, context) {
    G.hintBusy = 0;
    if (context === 'guess') {
      G.pending = false;
      reject(ERRORS[code] || ERRORS.server);
      render();
    } else if (context === 'word') {
      chooseApi?.refuse();
      toast(ERRORS[code] || ERRORS.server, { kind: 'warn', icon: '✋' });
      play('bad');
    } else {
      toast(ERRORS[code] || ERRORS.server, { kind: 'warn', icon: '✋' });
    }
  },

  /** Un adversaire me lance un coup bas. */
  fx(message) {
    const info = ATTACK_INFO[message.type];
    if (!info || !root) return;
    G.fx[message.type] = Date.now() + message.ms;
    G.fxFrom = playerById(message.from)?.name ?? '';
    if (message.type === 'shuffle') G.shuffleKey = String(Math.random());
    fxEl.dataset.sig = '';
    play('attack');
    buzz([90, 50, 90]);
    render();
  },

  suggestion(word) {
    chooseApi?.setWord(word);
  },
};
