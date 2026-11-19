// Contrôles de formulaire réutilisés par le salon, la configuration solo et les réglages.
import { h } from './dom.js';

/** Choix unique parmi quelques options : [[valeur, libellé, infobulle?], …] */
export function segmented(options, value, onChange, { disabled = false, cls = '', label = '' } = {}) {
  return h(
    'div.seg',
    { class: cls, role: 'radiogroup', 'aria-label': label || null },
    options.map(([val, text, title]) =>
      h(
        'button.seg-b',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(val === value),
          class: val === value ? 'on' : '',
          disabled,
          title: title || null,
          onclick: () => val !== value && onChange(val),
        },
        text,
      ),
    ),
  );
}

export function toggle(checked, onChange, { disabled = false, label = '' } = {}) {
  return h(
    'button.switch',
    { type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label, disabled, onclick: () => onChange(!checked) },
    h('i'),
  );
}

export function stepper(value, min, max, onChange, { disabled = false, label = '' } = {}) {
  return h(
    'div.stepper',
    { role: 'group', 'aria-label': label || null },
    h('button.btn.icon.small', { type: 'button', disabled: disabled || value <= min, onclick: () => onChange(value - 1), 'aria-label': 'Moins' }, '−'),
    h('b', value),
    h('button.btn.icon.small', { type: 'button', disabled: disabled || value >= max, onclick: () => onChange(value + 1), 'aria-label': 'Plus' }, '+'),
  );
}

/** Une ligne « libellé + contrôle ». */
export function field(label, control, hint = '') {
  return h('div.field', h('div.field-label', h('span', label), hint && h('small', hint)), control);
}

/** Une option à activer : icône, titre, explication, interrupteur. */
export function optionRow(emoji, title, desc, checked, onChange, disabled = false) {
  return h(
    'div.opt',
    { class: checked ? 'on' : '' },
    h('span.opt-ico', emoji),
    h('div.opt-text', h('b', title), h('small', desc)),
    toggle(checked, onChange, { disabled, label: title }),
  );
}
