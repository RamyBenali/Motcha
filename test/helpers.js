// Outils de test : un vrai serveur sur un port libre et de faux joueurs connectés en WebSocket.
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { isWord } from '../server/words.js';

export async function boot() {
  const app = startServer({ port: 0, host: '127.0.0.1' });
  const port = await app.ready;
  const clients = [];
  return {
    hub: app.hub,
    port,
    room: (code) => app.hub.rooms.get(code),
    async player(name, secret = randomUUID()) {
      const c = await connect(port, name, secret);
      clients.push(c);
      return c;
    },
    async stop() {
      for (const c of clients) c.ws.terminate();
      await app.close();
    },
  };
}

function connect(port, name, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const client = {
      ws,
      name,
      secret,
      profile: { name, avatar: 1 },
      state: null,
      raw: [], // tous les messages reçus, en texte brut
      inbox: [], // messages reçus hors « state »
      waiters: [],
      send: (message) => ws.send(JSON.stringify(message)),
      /** Attend qu'un état du salon vérifie la condition (l'état courant compte). */
      until(check, label = 'condition') {
        if (client.state && check(client.state)) return Promise.resolve(client.state);
        return client.wait((m) => m.t === 'state' && check(m), label);
      },
      /** Attend le prochain message (non encore consommé) qui vérifie la condition. */
      next(check, label = 'message') {
        const index = client.inbox.findIndex(check);
        if (index >= 0) return Promise.resolve(client.inbox.splice(index, 1)[0]);
        return client.wait((m) => m.t !== 'state' && check(m), label).then((m) => {
          client.inbox.splice(client.inbox.indexOf(m), 1);
          return m;
        });
      },
      wait(check, label) {
        return new Promise((ok, ko) => {
          const waiter = { check, ok };
          const timer = setTimeout(() => {
            client.waiters.splice(client.waiters.indexOf(waiter), 1);
            ko(new Error(`${name} : délai dépassé en attendant « ${label} »`));
          }, 4000);
          waiter.ok = (m) => {
            clearTimeout(timer);
            ok(m);
          };
          client.waiters.push(waiter);
        });
      },
      me: () => client.state.players.find((p) => p.id === client.state.you),
      close: () => new Promise((done) => {
        ws.once('close', done);
        ws.close();
      }),
    };
    ws.on('message', (data) => {
      const text = data.toString();
      const m = JSON.parse(text);
      client.raw.push(text);
      if (m.t === 'state') client.state = m;
      else client.inbox.push(m);
      for (const waiter of [...client.waiters]) {
        if (waiter.check(m)) {
          client.waiters.splice(client.waiters.indexOf(waiter), 1);
          waiter.ok(m);
        }
      }
    });
    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

const POOL = {
  4: ['CHAT', 'LUNE', 'PAIN', 'ROSE', 'VENT', 'BLEU', 'MAIN', 'DENT'],
  5: ['TABLE', 'CHIEN', 'POMME', 'LIVRE', 'ROUGE', 'PORTE', 'MONDE', 'FLEUR'],
  6: ['MAISON', 'JARDIN', 'CHEVAL', 'SOLEIL', 'ORANGE', 'BATEAU', 'CHEMIN', 'FLEUVE'],
  7: ['VOITURE', 'FROMAGE', 'CUISINE', 'FENETRE', 'MONTRES', 'JOURNAL', 'COULEUR', 'CHAMBRE'],
  8: ['MONTAGNE', 'CHOCOLAT', 'ELEPHANT', 'FAUTEUIL', 'COUTEAUX', 'LUMIERES', 'VACANCES', 'CAMPAGNE'],
};

/** Des mots valides du dictionnaire français, tous différents du mot secret. */
export function wrongWords(secret, count) {
  const words = POOL[secret.length].filter((w) => w !== secret && isWord('fr', w));
  if (words.length < count) throw new Error(`pas assez de mots de test de ${secret.length} lettres`);
  return words.slice(0, count);
}

export const pause = (ms) => new Promise((done) => setTimeout(done, ms));
