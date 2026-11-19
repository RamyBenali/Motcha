// Écran d'accueil : profil, parties entre amis, modes solo.
import { h, clear, avatarEl, icon } from './dom.js';
import { S, actions, dailyKeyNow, untilNextDaily } from './core.js';
import { profile, saveProfile, prefs, savePrefs, stats, refreshStats, dailyId, liveDailyStreak } from './store.js';
import { randomName } from './consts.js';
import { logo, toolButtons } from './parts.js';
import { openAvatarPicker, openSoloConfig, openStats, openHowTo, langOptions } from './ui-panels.js';
import { segmented } from './controls.js';
import { play } from './sfx.js';

let root = null;
let avatarBtn;
let nameInput;
let codeInput;
let soloHead;
let dailyText;
let survivalText;
let connEl;

/** Le résultat du mot du jour, s'il a déjà été joué dans cette langue. */
export function todaysDaily() {
  const record = stats.daily.days[dailyId(prefs.lang, dailyKeyNow())];
  return record && typeof record === 'object' && typeof record.word === 'string' && Array.isArray(record.rows) ? record : null;
}

function paintAvatar() {
  clear(avatarBtn, avatarEl(profile.avatar, 'xl'), h('span.av-edit', '✏️'));
}

function modeCard(emoji, title, textEl, onclick, extra = '') {
  return h('button.mode', { type: 'button', class: extra, onclick }, h('span.mode-ico', emoji), h('span.mode-text', h('b', title), textEl), h('span.mode-go', '→'));
}

function join() {
  const code = codeInput.value.trim();
  if (code.length < 4) {
    codeInput.focus();
    codeInput.classList.remove('shake');
    void codeInput.offsetWidth;
    codeInput.classList.add('shake');
    play('bad');
    return;
  }
  actions.joinRoom(code);
}

function build() {
  nameInput = h('input.input.name-input', {
    type: 'text',
    maxLength: 16,
    value: profile.name,
    placeholder: 'Ton pseudo',
    autocomplete: 'nickname',
    spellcheck: false,
    'aria-label': 'Ton pseudo',
    oninput: () => {
      profile.name = nameInput.value;
      saveProfile();
    },
    onblur: () => {
      if (!nameInput.value.trim()) {
        profile.name = nameInput.value = randomName();
        saveProfile();
      }
    },
  });
  avatarBtn = h('button.av-btn', {
    type: 'button',
    'aria-label': 'Changer d’avatar',
    title: 'Changer d’avatar',
    onclick: () =>
      openAvatarPicker(profile.avatar, (index) => {
        profile.avatar = index;
        saveProfile();
        paintAvatar();
      }),
  });
  paintAvatar();

  codeInput = h('input.input.code-input', {
    type: 'text',
    maxLength: 4,
    placeholder: 'CODE',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: false,
    'aria-label': 'Code du salon',
    oninput: () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') join();
    },
  });

  dailyText = h('small');
  survivalText = h('small');
  soloHead = h('div.card-head');
  connEl = h('p.home-conn', { hidden: true });

  root = h(
    'section.screen.home',
    h('header.topbar', h('div.topbar-left'), h('div.topbar-right', toolButtons())),
    h('div.hero', logo('big'), h('p.tagline', 'Devine le mot secret. ', h('b', 'Bats tes potes.'))),
    connEl,
    h(
      'div.home-grid',
      h(
        'div.card.me-card',
        avatarBtn,
        h('label.me-field', h('span.eyebrow', 'Ton pseudo'), nameInput),
        h('button.btn.ghost.small', { type: 'button', onclick: openStats, 'aria-label': 'Mes statistiques', title: 'Mes statistiques' }, icon('chart'), h('span.btn-label', 'Mes stats')),
      ),
      h(
        'div.card.friends-card',
        h('div.card-head', h('h2', 'Entre amis'), h('span.tag', '2 à 8 joueurs')),
        h('p.muted', 'Crée un salon, envoie le lien à tes amis et affrontez-vous en direct : course au mot ou maître du mot.'),
        h('button.btn.primary.big.wide', { type: 'button', onclick: () => actions.createRoom() }, '🎉 Créer un salon'),
        h('div.or', h('span', 'ou rejoins un salon')),
        h('div.join-row', codeInput, h('button.btn.violet.big', { type: 'button', onclick: join }, 'Rejoindre')),
      ),
      h(
        'div.card.solo-card',
        soloHead,
        modeCard('📅', 'Mot du jour', dailyText, () => actions.playDaily(), 'daily'),
        modeCard('🎯', 'Entraînement', h('small', 'Choisis tes règles et joue autant que tu veux'), () => openSoloConfig(() => actions.playSolo('free'))),
        modeCard('🔥', 'Survie', survivalText, () => actions.playSolo('survival')),
      ),
    ),
    h(
      'footer.home-foot',
      h('button.link', { type: 'button', onclick: openHowTo }, 'Comment jouer ?'),
      h('span', '·'),
      h('span', 'Motcha, le jeu de mots à jouer entre potes'),
    ),
  );
}

function paintSoloHead() {
  clear(
    soloHead,
    h('h2', 'En solo'),
    segmented(
      langOptions().map(([code, label]) => [code, label.split(' ')[0], label.split(' ').slice(1).join(' ')]),
      prefs.lang,
      (value) => {
        prefs.lang = value;
        savePrefs();
        homeScreen.update();
      },
      { cls: 'compact', label: 'Langue des mots' },
    ),
  );
}

export const homeScreen = {
  get el() {
    if (!root) build();
    return root;
  },

  enter() {
    if (!root) build();
    refreshStats(); // un autre onglet a pu jouer entre-temps
    nameInput.value = profile.name;
    paintAvatar();
    codeInput.value = '';
  },

  update() {
    paintSoloHead();
    const best = stats.survival.best;
    survivalText.textContent = best ? `Enchaîne les mots sans te tromper · record ${best} pts` : 'Enchaîne les mots sans te tromper';
    connEl.hidden = S.conn === 'open';
    connEl.textContent = S.conn === 'open' ? '' : 'Connexion au serveur…';
    this.tick();
  },

  tick() {
    if (!root) return;
    const done = todaysDaily();
    const card = dailyText.closest('.mode');
    card.classList.toggle('done', !!done);
    if (done) {
      dailyText.textContent = `${done.found ? `Trouvé en ${done.attempts}/${done.max} ✅` : 'Raté 😵'} · prochain mot dans ${untilNextDaily()}`;
    } else {
      const streak = liveDailyStreak(dailyKeyNow());
      dailyText.textContent = streak > 1 ? `Le même mot pour tout le monde · série de ${streak} 🔥` : 'Le même mot pour tout le monde';
    }
  },
};
