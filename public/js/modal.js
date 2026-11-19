// Fenêtres modales (centrées, ou en volet depuis le bas sur mobile).
import { h, icon } from './dom.js';

const stack = [];

/** Tant qu'une fenêtre est ouverte, la page derrière ne reçoit ni clic ni focus. */
function syncInert() {
  const app = document.getElementById('app');
  if (app) app.inert = stack.length > 0;
}

/**
 * openModal({ title, body, footer, className, dismissible, onClose })
 * Renvoie { close, el, body, foot }.
 */
export function openModal({ title = '', body = null, footer = null, className = '', dismissible = true, onClose = null } = {}) {
  const root = document.getElementById('modals');
  const previousFocus = document.activeElement;
  let closed = false;

  const api = {
    dismissible,
    close() {
      if (closed) return;
      closed = true;
      stack.splice(stack.indexOf(api), 1);
      syncInert();
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 200);
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus?.({ preventScroll: true });
      onClose?.();
    },
  };

  const bodyEl = h('div.modal-body', body);
  const footEl = footer ? h('footer.modal-foot', footer) : null;
  const box = h(
    'div.modal',
    { class: className, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Fenêtre', tabIndex: -1 },
    (title || dismissible) &&
      h(
        'header.modal-head',
        h('h2', title),
        dismissible && h('button.btn.icon.ghost', { type: 'button', onclick: () => api.close(), 'aria-label': 'Fermer' }, icon('close')),
      ),
    bodyEl,
    footEl,
  );
  const wrap = h('div.modal-wrap', box);
  // On ne ferme que si le clic commence ET finit sur le fond (pas en relâchant une sélection de texte dehors).
  let pressedOutside = false;
  wrap.addEventListener('pointerdown', (e) => {
    pressedOutside = e.target === wrap;
  });
  wrap.addEventListener('click', (e) => {
    if (dismissible && pressedOutside && e.target === wrap) api.close();
  });
  // Le focus reste dans la fenêtre.
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.disabled && el.offsetParent !== null,
    );
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active !== box && box.contains(active);
    if (!inside || (e.shiftKey && active === first) || (!e.shiftKey && active === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  });

  root.append(wrap);
  stack.push(api);
  syncInert();
  box.focus({ preventScroll: true });
  Object.assign(api, { el: box, wrap, body: bodyEl, foot: footEl });
  return api;
}

export const modalOpen = () => stack.length > 0;

/** Ferme la fenêtre du dessus si elle peut l'être (touche Échap). */
export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top?.dismissible) top.close();
}

export function closeAllModals() {
  for (const m of [...stack]) m.close();
}

/** Petite fenêtre de confirmation. */
export function confirmModal({ title, text, yes = 'Confirmer', no = 'Annuler', danger = false, onYes }) {
  const modal = openModal({
    title,
    className: 'small',
    body: h('p.lead', text),
    footer: [
      h('button.btn.ghost', { type: 'button', onclick: () => modal.close() }, no),
      h(
        'button.btn',
        {
          type: 'button',
          class: danger ? 'danger' : 'primary',
          onclick: () => {
            modal.close();
            onYes();
          },
        },
        yes,
      ),
    ],
  });
  return modal;
}
