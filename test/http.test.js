// Le serveur de fichiers statiques : bons en-têtes, rien qui sorte du dossier public.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startServer } from '../server/index.js';

let app;
let base;
before(async () => {
  app = startServer({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${await app.ready}`;
});
after(async () => {
  await app.close();
});

/** Requête brute : `fetch` normaliserait les « .. » avant de les envoyer. */
function raw(path) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

test('page d’accueil servie avec les en-têtes de sécurité', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.match(await res.text(), /<title>Motcha/);
});

test('types de fichiers, cache des polices, validation par ETag', async () => {
  const js = await fetch(`${base}/js/app.js`);
  assert.match(js.headers.get('content-type'), /^text\/javascript/);
  const css = await fetch(`${base}/css/style.css`);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  const font = await fetch(`${base}/fonts/bricolage-latin.woff2`);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.match(font.headers.get('cache-control'), /immutable/);

  const etag = js.headers.get('etag');
  assert.ok(etag);
  const again = await fetch(`${base}/js/app.js`, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
});

test('lien d’invitation et adresses inconnues', async () => {
  const invite = await fetch(`${base}/?r=BCDF`);
  assert.equal(invite.status, 200);
  assert.match(await invite.text(), /<title>Motcha/);
  const deep = await fetch(`${base}/salon/BCDF`);
  assert.equal(deep.status, 200, 'une adresse sans extension renvoie l’application');
  const missing = await fetch(`${base}/js/absent.js`);
  assert.equal(missing.status, 404);
});

test('impossible de lire un fichier hors du dossier public', async () => {
  for (const path of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/js/../../server/index.js', '/....//package.json', '/%00', '/%E0%A4%A']) {
    const response = await raw(path);
    assert.match(response, /^HTTP\/1\.1 \d{3}/, `${path} doit recevoir une réponse HTTP`);
    assert.ok(!/"dependencies"/.test(response), `${path} ne doit pas exposer package.json`);
    assert.ok(!/createHub/.test(response), `${path} ne doit pas exposer le code du serveur`);
  }
});

test('méthodes refusées, HEAD sans corps, état de santé', async () => {
  const post = await fetch(`${base}/`, { method: 'POST', body: 'x' });
  assert.equal(post.status, 405);
  const head = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const health = await fetch(`${base}/healthz`).then((r) => r.json());
  assert.deepEqual(Object.keys(health).sort(), ['ok', 'players', 'rooms']);
});

test('une demande WebSocket avec une adresse invalide ne fait pas tomber le serveur', async () => {
  const { port } = new URL(base);
  for (const target of ['//', '///', '//[', 'http://']) {
    await new Promise((resolve) => {
      const socket = net.connect(Number(port), '127.0.0.1', () => {
        socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
      });
      socket.on('close', resolve);
      socket.on('error', resolve);
      setTimeout(() => socket.destroy(), 500);
    });
  }
  const bad = await raw('//');
  assert.match(bad, /^HTTP\/1\.1 404/);
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200, 'le serveur répond toujours');
});

test('un téléchargement interrompu ne laisse pas de fichier ouvert', async () => {
  const { port } = new URL(base);
  const { readdirSync } = await import('node:fs');
  const openFiles = () => {
    try {
      return readdirSync('/dev/fd').length;
    } catch {
      return null;
    }
  };
  const before = openFiles();
  if (before === null) return; // système sans /dev/fd : rien à mesurer
  for (let i = 0; i < 150; i++) {
    await new Promise((resolve) => {
      const socket = net.connect(Number(port), '127.0.0.1', () => {
        socket.write('GET /css/style.css HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
        setImmediate(() => socket.destroy());
      });
      socket.on('close', resolve);
      socket.on('error', resolve);
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(openFiles() - before < 20, `descripteurs ouverts : ${before} → ${openFiles()}`);
});
