// Fenêtres secondaires : aide, réglages, statistiques, choix d'avatar, configuration d'une partie solo.
import { h, clear, avatarEl, wordTiles, keepFocus } from './dom.js';
import { openModal } from './modal.js';
import { segmented, stepper, field, optionRow } from './controls.js';
import { prefs, savePrefs, applyPrefs, stats, liveDailyStreak } from './store.js';
import { render, dailyKeyNow } from './core.js';
import { AVATARS, TIMER_CHOICES, LANG_NAMES, ATTACK_INFO } from './consts.js';
import { refreshSoundButtons } from './parts.js';
import { play } from './sfx.js';

// ───────────── comment jouer ─────────────

export function openHowTo() {
  const legend = (letter, state, title, text) =>
    h('div.legend-row', wordTiles(letter, [state], 'mid'), h('span', h('b', title), ` — ${text}`));
  const score = (points, text) => h('li', h('b.pts', points), h('span', text));

  openModal({
    title: 'Comment jouer',
    className: 'howto',
    body: [
      h('p.lead', 'Trouve le mot secret avant d’avoir épuisé tes essais. Après chaque proposition, les lettres te disent où tu en es :'),
      h(
        'div.legend',
        legend('P', '2', 'Bien placée', 'la lettre est au bon endroit.'),
        legend('I', '1', 'Mal placée', 'elle est dans le mot, mais ailleurs.'),
        legend('X', '0', 'Absente', 'elle n’est pas dans le mot.'),
      ),
      h('div.example', wordTiles('PIANO', ['2', '1', '0', '0', '2'], 'mid'), h('small', 'Ici le mot commence par P, finit par O et contient un I… mais pas en 2ᵉ position.')),

      h('h3', 'Les modes'),
      h(
        'ul.modes',
        h('li', h('span', '🏁'), h('div', h('b', 'Course'), h('small', 'Tout le monde cherche le même mot en même temps. Tu vois les couleurs des autres, pas leurs lettres.'))),
        h('li', h('span', '👑'), h('div', h('b', 'Maître du mot'), h('small', 'Chacun son tour, un joueur choisit le mot secret et regarde les autres galérer.'))),
        h('li', h('span', '📅'), h('div', h('b', 'Mot du jour'), h('small', 'Un mot par jour, le même pour tout le monde. Compare ta grille avec tes amis.'))),
        h('li', h('span', '🔥'), h('div', h('b', 'Survie'), h('small', 'Enchaîne les mots : au premier raté, c’est fini. Jusqu’où iras-tu ?'))),
      ),

      h('h3', 'Les points'),
      h(
        'ul.scores',
        score('+100', 'pour un mot trouvé'),
        score('+20', 'par essai qu’il te restait'),
        score('+50', 'max de bonus de rapidité'),
        score('+30', 'pour le premier à trouver (+15, +5 pour les suivants)'),
        score('−30', 'par indice utilisé'),
      ),
      h(
        'p.note',
        h('b', 'Maître du mot : '),
        'plus les autres ont besoin d’essais, plus tu gagnes (jusqu’à 120). Mais un mot introuvable ne rapporte que 70 : vise le mot trouvé de justesse !',
      ),

      h('h3', 'Les bonus'),
      h(
        'ul.modes',
        h('li', h('span', '💡'), h('div', h('b', 'Indice'), h('small', 'Révèle une lettre à sa place. Deux par manche, 30 points chacun.'))),
        h(
          'li',
          h('span', '😈'),
          h(
            'div',
            h('b', 'Coup bas'),
            h('small', `Un par manche, pour embêter un adversaire : ${Object.values(ATTACK_INFO).map((a) => `${a.icon} ${a.name}`).join(', ')}.`),
          ),
        ),
        h('li', h('span', '⚡'), h('div', h('b', 'Sprint final'), h('small', 'Dès qu’un joueur trouve, il ne reste qu’une minute aux autres.'))),
      ),
    ],
  });
}

// ───────────── réglages ─────────────

export function openSettings() {
  const body = h('div.stack');
  const set = (key, value) => {
    prefs[key] = value;
    savePrefs();
    applyPrefs();
    refreshSoundButtons();
    keepFocus(body, paint);
    render();
  };
  function paint() {
    clear(
      body,
      optionRow('🔊', 'Sons', 'Bruitages du jeu', prefs.sound, (v) => {
        set('sound', v);
        play('pop');
      }),
      optionRow('🎨', 'Couleurs contrastées', 'Bleu et orange, plus lisibles pour les daltoniens', prefs.colorblind, (v) => set('colorblind', v)),
      field(
        'Thème',
        segmented(
          [
            ['night', '🌙 Nuit'],
            ['day', '☀️ Jour'],
          ],
          prefs.theme,
          (v) => set('theme', v),
          { label: 'Thème' },
        ),
      ),
      field(
        'Clavier',
        segmented(
          [
            ['auto', 'Auto'],
            ['azerty', 'AZERTY'],
            ['qwerty', 'QWERTY'],
          ],
          prefs.layout,
          (v) => set('layout', v),
          { label: 'Disposition du clavier' },
        ),
        'Auto : AZERTY en français, QWERTY en anglais',
      ),
    );
  }
  paint();
  openModal({ title: 'Réglages', className: 'small', body });
}

// ───────────── statistiques ─────────────

export function openStats() {
  const { solo, survival, daily, multi } = stats;
  const dailyStreak = liveDailyStreak(dailyKeyNow());
  const pct = solo.played ? Math.round((solo.wins / solo.played) * 100) : 0;
  const big = (value, label) => h('div.stat', h('b', value), h('small', label));
  const top = Math.max(1, ...Object.values(solo.dist));
  const rows = [];
  for (let n = 1; n <= 8; n++) {
    const count = solo.dist[n] || 0;
    if (n > 6 && !count) continue;
    rows.push(h('div.dist-row', h('span', n), h('div.dist-bar', { vars: { '--w': `${Math.max(6, (count / top) * 100)}%` }, class: count ? 'on' : '' }, count)));
  }

  openModal({
    title: 'Mes statistiques',
    className: 'stats',
    body: [
      h('h3', 'En solo'),
      h('div.stat-row', big(solo.played, solo.played > 1 ? 'parties' : 'partie'), big(`${pct} %`, 'de réussite'), big(solo.streak, 'série en cours'), big(solo.maxStreak, 'meilleure série')),
      h('h3', 'Essais nécessaires'),
      solo.wins ? h('div.dist', rows) : h('p.muted', 'Gagne une partie solo pour voir ta répartition.'),
      h('h3', 'Records'),
      h(
        'div.stat-row',
        big(dailyStreak, dailyStreak > 1 ? 'jours d’affilée' : 'jour d’affilée'),
        big(daily.maxStreak, 'record de jours'),
        big(survival.best, 'record en survie'),
        big(survival.bestWords, 'mots d’affilée'),
      ),
      h('h3', 'Entre amis'),
      h('div.stat-row', big(multi.games, 'parties'), big(multi.wins, 'victoires')),
    ],
  });
}

// ───────────── avatar ─────────────

export function openAvatarPicker(current, onPick) {
  const modal = openModal({
    title: 'Choisis ton avatar',
    className: 'small',
    body: h(
      'div.avatar-grid',
      AVATARS.map((_, index) =>
        h(
          'button.av-pick',
          {
            type: 'button',
            class: index === current ? 'on' : '',
            'aria-label': `Avatar ${index + 1}`,
            onclick: () => {
              onPick(index);
              play('pop');
              modal.close();
            },
          },
          avatarEl(index, 'lg'),
        ),
      ),
    ),
  });
}

// ───────────── configuration d'une partie solo ─────────────

export function lengthOptions(freeLabel = '🎲', freeTitle = 'Au hasard') {
  return [
    [4, '4'],
    [5, '5'],
    [6, '6'],
    [7, '7'],
    [8, '8'],
    [0, freeLabel, freeTitle],
  ];
}

export const langOptions = () => Object.entries(LANG_NAMES).map(([code, name]) => [code, `${code === 'fr' ? '🇫🇷' : '🇬🇧'} ${name}`]);

export function openSoloConfig(onStart) {
  const body = h('div.stack');
  const cfg = prefs.solo;
  const set = (key, value) => {
    cfg[key] = value;
    savePrefs();
    keepFocus(body, paint);
  };
  function paint() {
    clear(
      body,
      field(
        'Langue des mots',
        segmented(
          langOptions(),
          prefs.lang,
          (v) => {
            prefs.lang = v;
            savePrefs();
            keepFocus(body, paint);
            render();
          },
          { label: 'Langue des mots' },
        ),
      ),
      field('Nombre de lettres', segmented(lengthOptions(), cfg.length, (v) => set('length', v), { cls: 'tight', label: 'Nombre de lettres' })),
      field('Essais', stepper(cfg.attempts, 4, 8, (v) => set('attempts', v), { label: 'Nombre d’essais' })),
      field('Chrono', segmented(TIMER_CHOICES, cfg.timer, (v) => set('timer', v), { cls: 'wrap', label: 'Chrono' })),
      optionRow('💡', 'Indices', 'Révèle une lettre contre 30 points', cfg.hints, (v) => set('hints', v)),
      optionRow('🅰️', 'Première lettre offerte', 'La première lettre du mot est donnée', cfg.firstLetter, (v) => set('firstLetter', v)),
    );
  }
  paint();
  const modal = openModal({
    title: 'Entraînement',
    className: 'small',
    body,
    footer: h(
      'button.btn.primary.big.wide',
      {
        type: 'button',
        onclick: () => {
          modal.close();
          onStart();
        },
      },
      'C’est parti !',
    ),
  });
}
