// État global de l'application et boucle de rendu.

export const S = {
  conn: 'connecting', // connecting | open | closed
  hello: null, // message d'accueil du serveur (date du mot du jour, limites…)
  room: null, // dernier état du salon reçu
  prev: null, // état précédent, pour repérer ce qui a changé
  code: null, // code du salon en cours (ou en cours de reprise)
  offset: null, // écart entre l'horloge du serveur et celle du navigateur
  replaced: false, // la partie a été reprise dans un autre onglet
};

/** L'heure du serveur, pour afficher des chronos identiques chez tout le monde. */
export const serverNow = () => Date.now() + (S.offset ?? 0);

export function syncClock(serverTime) {
  // Chaque mesure vaut « vrai écart − latence » : la plus grande est donc la plus juste.
  const sample = serverTime - Date.now();
  S.offset = S.offset === null ? sample : Math.max(S.offset, sample);
}

/** Le fuseau horaire qui fait changer le mot du jour (celui du serveur). */
function dailyFormat(options) {
  try {
    return new Intl.DateTimeFormat(options.locale, { ...options, timeZone: S.hello?.dailyTz || 'Europe/Paris' });
  } catch {
    return new Intl.DateTimeFormat(options.locale, { ...options, timeZone: 'Europe/Paris' });
  }
}

/** Date du jour (AAAA-MM-JJ) dans ce fuseau : c'est elle qui décide du mot du jour. */
export function dailyKeyNow() {
  return dailyFormat({ locale: 'en-CA', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(serverNow()));
}

/** Temps restant avant le prochain mot du jour, sous la forme « 05:12:09 ». */
export function untilNextDaily() {
  const parts = dailyFormat({ locale: 'en-GB', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(serverNow()));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const left = 86_400 - (get('hour') * 3600 + get('minute') * 60 + get('second'));
  const two = (n) => String(n).padStart(2, '0');
  return `${two(Math.floor(left / 3600))}:${two(Math.floor((left % 3600) / 60))}:${two(left % 60)}`;
}

export const me = () => S.room?.players.find((p) => p.id === S.room.you) ?? null;
export const isHost = () => !!S.room && S.room.hostId === S.room.you;
export const playerById = (id) => S.room?.players.find((p) => p.id === id) ?? null;

const renderers = new Set();
export const onRender = (fn) => renderers.add(fn);

let queued = false;
/** Demande un rafraîchissement de l'écran (regroupé : plusieurs appels = un seul rendu). */
export function render() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const fn of renderers) fn();
  });
}

export const renderLater = (ms) => setTimeout(render, Math.max(0, ms));

/** Actions de haut niveau, définies dans app.js et utilisées par tous les écrans. */
export const actions = {};
