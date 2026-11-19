// Connexion WebSocket au serveur, avec reconnexion automatique.
import { S, render } from './core.js';

const handlers = new Map();
/** on('state', fn) : fn reçoit chaque message de ce type. 'open' est émis à chaque (re)connexion. */
export const on = (type, fn) => handlers.set(type, fn);

let ws = null;
let attempts = 0;
let retryTimer = null;
let lastSeen = 0;
let awaiting = 0; // heure d'envoi d'un signe de vie resté sans réponse
let wanted = false;

function setConn(value) {
  if (S.conn === value) return;
  S.conn = value;
  render();
}

export function connect() {
  wanted = true;
  clearTimeout(retryTimer);
  if (ws) return;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${scheme}//${location.host}/ws`);
  ws = socket;
  setConn('connecting');

  socket.onopen = () => {
    if (ws !== socket) return;
    attempts = 0;
    awaiting = 0;
    lastSeen = Date.now();
    setConn('open');
    handlers.get('open')?.();
  };
  socket.onmessage = (event) => {
    if (ws !== socket) return;
    lastSeen = Date.now();
    awaiting = 0;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handlers.get(message.t)?.(message);
  };
  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    setConn('closed');
    if (wanted) retryTimer = setTimeout(connect, Math.min(5000, 400 * 2 ** attempts++));
  };
  socket.onerror = () => {};
}

/** Coupe la connexion sans chercher à la rétablir (partie reprise dans un autre onglet). */
export function disconnect() {
  wanted = false;
  clearTimeout(retryTimer);
  const socket = ws;
  ws = null;
  socket?.close();
  setConn('closed');
}

export function send(message) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function drop() {
  // Connexion muette : on l'abandonne tout de suite au lieu d'attendre que le navigateur s'en aperçoive.
  const socket = ws;
  if (!socket) return;
  ws = null;
  awaiting = 0;
  socket.onclose = null;
  socket.close();
  setConn('closed');
  if (wanted) connect();
}

/** Envoie un signe de vie ; sans réponse sous quelques secondes, la connexion est considérée comme morte. */
function probe() {
  if (!awaiting && send({ t: 'ping' })) awaiting = Date.now();
}

/** À appeler quand quelque chose reste sans réponse (une proposition, par exemple). */
export function checkAlive() {
  if (ws?.readyState === WebSocket.OPEN) probe();
}

setInterval(() => {
  if (ws?.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  if (awaiting && now - awaiting > 6_000) drop();
  else if (now - lastSeen > 12_000) probe();
}, 2_000);

function wake() {
  if (!wanted || document.hidden) return;
  if (!ws) {
    attempts = 0;
    connect();
  } else {
    checkAlive();
  }
}
document.addEventListener('visibilitychange', wake);
window.addEventListener('online', wake);
window.addEventListener('pageshow', wake);
