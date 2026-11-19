// Serveur Motcha : fichiers statiques + WebSocket de jeu, sans autre dépendance que `ws`.
import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createHub } from './hub.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MAX_CONNECTIONS = 4000;

/** Le chemin d'une requête, ou null si l'adresse est invalide (« // », par exemple). */
function pathOf(req) {
  try {
    return new URL(req.url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

async function resolveFile(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const file = path.join(PUBLIC_DIR, pathname);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return null;
  for (const candidate of [file, path.join(file, 'index.html')]) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return { file: candidate, info };
    } catch {
      /* on essaie le candidat suivant */
    }
  }
  // Adresse sans extension (lien d'invitation, par exemple) : on sert l'application.
  if (!path.extname(pathname)) {
    const index = path.join(PUBLIC_DIR, 'index.html');
    return { file: index, info: await stat(index) };
  }
  return null;
}

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const pathname = pathOf(req);
  const found = pathname === null ? null : await resolveFile(pathname);
  if (!found) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end('Introuvable');
    return;
  }
  const { file, info } = found;
  const ext = path.extname(file);
  const etag = `W/"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: etag,
    ...SECURITY_HEADERS,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  headers['Content-Length'] = info.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  // pipeline referme le fichier même si le visiteur coupe la connexion en cours de route.
  const stream = createReadStream(file);
  try {
    pipeline(stream, res, () => {});
  } catch {
    stream.destroy(); // le visiteur est déjà parti
  }
}

export function startServer({ port = 3000, host } = {}) {
  const hub = createHub();
  const server = http.createServer((req, res) => {
    if (pathOf(req) === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...hub.stats() }));
      return;
    }
    serveStatic(req, res).catch((error) => {
      console.error('[motcha] fichier statique', error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (pathOf(req) !== '/ws' || wss.clients.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      hub.onConnection(ws);
    });
  });

  // Les hébergeurs coupent les connexions muettes : on envoie un battement régulier
  // et on ferme les connexions qui ne répondent plus.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25_000);
  heartbeat.unref();

  const ready = new Promise((resolve) => {
    server.listen(port, host, () => resolve(server.address().port));
  });

  const close = () =>
    new Promise((resolve) => {
      clearInterval(heartbeat);
      hub.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close(() => resolve());
      server.closeAllConnections?.();
    });

  return { server, hub, ready, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ready, close } = startServer({ port: Number(process.env.PORT) || 3000, host: process.env.HOST });
  ready.then((port) => console.log(`Motcha est en ligne → http://localhost:${port}`));
  // Dernier filet : une erreur imprévue est notée, mais les parties en cours ne sont pas perdues.
  process.on('uncaughtException', (error) => console.error('[motcha] exception non rattrapée', error));
  process.on('unhandledRejection', (error) => console.error('[motcha] promesse rejetée', error));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
  }
}
