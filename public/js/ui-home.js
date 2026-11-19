// Écran d'accueil : profil, parties entre amis, modes solo.
import { h, clear, avatarEl, icon, keepFocus } from './dom.js';
import { S, actions, dailyKeyNow, untilNextDaily } from './core.js';
import { profile, saveProfile, prefs, savePrefs, stats, refreshStats, dailyId, liveDailyStreak } from './store.js';
import { randomName, LANG_NAMES } from './consts.js';
import { logo, toolButtons } from './parts.js';
import { openAvatarPicker, openSoloConfig, openStats, openHowTo, langOptions } from './ui-panels.js';
import { segmented } from './controls.js';
import { play } from './sfx.js';
import { toast } from './fx.js';

let root = null;
let avatarBtn;
let nameInput;
let codeInput;
let langSlot;
let soloLang;
let roomLang;
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
  langSlot = h('div.lang-slot');
  soloLang = h('span.tag');
  roomLang = h('small.muted.center');
  connEl = h('p.home-conn', { hidden: true });

  root = h(
    'section.screen.home',
    h('header.topbar', h('div.topbar-left'), h('div.topbar-right', toolButtons())),
    h(
      'div.hero',
      logo('big'),
      h('p.tagline', 'Devine le mot secret. ', h('b', 'Bats tes potes.')),
      // Le choix vaut pour tout : mot du jour, entraînement, survie et prochain salon créé.
      h('div.lang-row', h('span.eyebrow', 'Langue des mots'), langSlot),
    ),
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
        roomLang,
        h('div.or', h('span', 'ou rejoins un salon')),
        h('div.join-row', codeInput, h('button.btn.violet.big', { type: 'button', onclick: join }, 'Rejoindre')),
      ),
      h(
        'div.card.solo-card',
        h('div.card-head', h('h2', 'En solo'), soloLang),
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

const FLAGS = { fr: '🇫🇷', en: '🇬🇧' };

function setLang(value) {
  prefs.lang = value;
  savePrefs();
  play('pop');
  toast(value === 'en' ? 'Mots en anglais : à toi de trouver des mots anglais' : 'Mots en français', { icon: FLAGS[value] });
  homeScreen.update();
}

/** Le sélecteur de langue des mots, et son rappel sur chaque carte. */
function paintLang() {
  const lang = prefs.lang;
  if (langSlot.dataset.lang !== lang) {
    langSlot.dataset.lang = lang;
    keepFocus(langSlot, () => clear(langSlot, segmented(langOptions(), lang, setLang, { cls: 'lang-seg', label: 'Langue des mots' })));
  }
  soloLang.textContent = `${FLAGS[lang]} ${LANG_NAMES[lang]}`;
  roomLang.textContent = lang === 'en' ? 'Les mots seront en anglais (modifiable dans le salon).' : 'Les mots seront en français (modifiable dans le salon).';
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
    paintLang();
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
