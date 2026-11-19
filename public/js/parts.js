// Éléments d'interface communs à plusieurs écrans.
import { h, icon } from './dom.js';
import { prefs, savePrefs } from './store.js';
import { play } from './sfx.js';
import { openHowTo, openSettings } from './ui-panels.js';

const LOGO_STATES = ['2', '1', '0', '2', '0', '1'];

/** Le logo : six tuiles aux couleurs du jeu. */
export function logo(extra = '') {
  return h(
    'span.logo',
    { class: extra, 'aria-label': 'Motcha', role: 'img' },
    [...'MOTCHA'].map((ch, i) => h('span.logo-t', { data: { s: LOGO_STATES[i] }, vars: { '--i': i } }, ch)),
  );
}

const soundButtons = new Set();

export function soundButton() {
  const btn = h('button.btn.icon.ghost', {
    type: 'button',
    onclick: () => {
      prefs.sound = !prefs.sound;
      savePrefs();
      refreshSoundButtons();
      play('pop');
    },
  });
  soundButtons.add(btn);
  paint(btn);
  return btn;
}

function paint(btn) {
  btn.replaceChildren(icon(prefs.sound ? 'sound' : 'mute'));
  btn.setAttribute('aria-label', prefs.sound ? 'Couper le son' : 'Activer le son');
  btn.title = prefs.sound ? 'Son activé' : 'Son coupé';
}

export function refreshSoundButtons() {
  // Les écrans sont construits une fois puis réutilisés : on repeint aussi les boutons hors écran.
  for (const btn of soundButtons) paint(btn);
}

/** Boutons toujours présents en haut à droite : son, aide, réglages. */
export function toolButtons() {
  return [
    soundButton(),
    h('button.btn.icon.ghost', { type: 'button', onclick: openHowTo, 'aria-label': 'Comment jouer', title: 'Comment jouer' }, icon('help')),
    h('button.btn.icon.ghost', { type: 'button', onclick: openSettings, 'aria-label': 'Réglages', title: 'Réglages' }, icon('gear')),
  ];
}

export function topbar({ onBack = null, backLabel = 'Retour', center = null } = {}) {
  return h(
    'header.topbar',
    h(
      'div.topbar-left',
      onBack && h('button.btn.icon.ghost', { type: 'button', onclick: onBack, 'aria-label': backLabel, title: backLabel }, icon('back')),
      center ?? logo('small'),
    ),
    h('div.topbar-right', toolButtons()),
  );
}
