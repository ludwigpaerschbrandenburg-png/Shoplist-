/*
 * ShopList-Heimserver.
 *
 * - Liefert die PWA aus (Repo-Wurzel)
 * - POST /api/sync: Offline-Sync mit den Handys (Merge, letzter Push gewinnt)
 * - GET  /api/health: Erreichbarkeit + KI-Status
 * - KI-Worker (Ollama) für Produktfotos und Kassenbons
 * - HTTPS, sobald Zertifikate im CERT_DIR liegen (lego/Let's Encrypt),
 *   sonst HTTP mit Hinweis
 *
 * Bewusst ohne npm-Abhängigkeiten – läuft direkt im offiziellen
 * node:22-alpine Image.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const ai = require('./ai');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = Number(process.env.HTTP_PORT || 80);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const CERT_DIR = process.env.CERT_DIR || '/certs';
const DOMAIN = process.env.DOMAIN || '';
const PUBLIC_HTTPS_PORT = process.env.PUBLIC_HTTPS_PORT || ''; // Port im Browser, z. B. 8443
const MAX_BODY = 100 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ---------- Sync ---------- */

const FIELDS = {
  products: ['uid', 'name', 'aiLabel', 'aiStatus', 'photoRev', 'onList', 'checked', 'createdAt', 'updatedAt', 'deleted'],
  purchases: ['uid', 'productUid', 'price', 'date', 'receiptUid', 'aiFilled', 'updatedAt', 'deleted'],
  receipts: ['uid', 'photoRev', 'store', 'total', 'date', 'parsed', 'aiStatus', 'aiError', 'createdAt', 'updatedAt', 'deleted'],
};

function sanitize(storeName, rec) {
  const out = {};
  for (const f of FIELDS[storeName]) {
    if (rec[f] !== undefined) out[f] = rec[f];
  }
  return out;
}

function handleSync(body) {
  const since = Number(body.since || 0);
  const mergeTime = Date.now();
  const mergedNow = new Set();

  for (const storeName of store.STORES) {
    for (const rec of (body.changes && body.changes[storeName]) || []) {
      if (typeof rec.uid !== 'string' || !rec.uid || rec.uid.length > 64) continue;
      const merged = sanitize(storeName, rec);
      merged.updatedAt = mergeTime;

      const existing = store.data[storeName].get(rec.uid);
      if (typeof rec.photoB64 === 'string' && rec.photoB64 && storeName !== 'purchases') {
        try {
          store.savePhoto(storeName, rec.uid, Buffer.from(rec.photoB64, 'base64'));
          merged.photoRev = mergeTime;
        } catch (err) {
          console.error('[sync] Foto speichern fehlgeschlagen:', err.message);
        }
      } else if (existing && existing.photoRev) {
        merged.photoRev = existing.photoRev;
      }
      // KI-Ergebnisse nicht durch alte Client-Kopien zurücksetzen: wenn der
      // Server schon 'done' ist und der Client noch 'pending' schickt,
      // bleibt das Server-Ergebnis stehen.
      if (existing && existing.aiStatus === 'done' && merged.aiStatus === 'pending' && !rec.photoB64) {
        merged.aiStatus = 'done';
        if (storeName === 'products') {
          if (!merged.name && existing.name) merged.name = existing.name;
          merged.aiLabel = existing.aiLabel;
        } else if (storeName === 'receipts') {
          merged.parsed = existing.parsed;
        }
      }

      store.data[storeName].set(rec.uid, merged);
      mergedNow.add(`${storeName}:${rec.uid}`);
    }
    store.saveSoon(storeName);
  }

  const changes = {};
  for (const storeName of store.STORES) {
    changes[storeName] = [];
    for (const rec of store.data[storeName].values()) {
      if ((rec.updatedAt || 0) < since) continue;
      if (mergedNow.has(`${storeName}:${rec.uid}`)) continue;
      const out = { ...rec };
      if (storeName !== 'purchases' && (rec.photoRev || 0) >= since && rec.photoRev) {
        const photo = store.readPhoto(storeName, rec.uid);
        if (photo) out.photoB64 = photo.toString('base64');
      }
      changes[storeName].push(out);
    }
  }

  return { time: mergeTime, changes, ai: ai.health() };
}

/* ---------- HTTP ---------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body zu groß'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/favicon.ico') pathname = '/icons/icon-192.png';
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext] || file.startsWith(path.join(ROOT, 'server')) || file.includes(path.sep + 'deploy' + path.sep)) {
    res.writeHead(404);
    return res.end('Nicht gefunden');
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Nicht gefunden');
    }
    const cache = (pathname === '/sw.js' || pathname === '/index.html')
      ? 'no-cache'
      : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': cache });
    res.end(content);
  });
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/api/health') {
      return sendJSON(res, 200, { app: 'shoplist', ok: true, time: Date.now(), ai: ai.health() });
    }
    if (pathname === '/api/sync' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return sendJSON(res, 400, { error: 'Ungültiges JSON' });
      }
      return sendJSON(res, 200, handleSync(body));
    }
    if (pathname.startsWith('/api/')) {
      return sendJSON(res, 404, { error: 'Unbekannter Endpunkt' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[http]', err.message);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Serverfehler' });
  }
}

/* ---------- TLS ---------- */

function findCerts() {
  const candidates = [];
  if (DOMAIN) {
    candidates.push({
      cert: path.join(CERT_DIR, 'certificates', `${DOMAIN}.crt`),
      key: path.join(CERT_DIR, 'certificates', `${DOMAIN}.key`),
    });
    // lego ersetzt '*' in Wildcard-Domains durch '_'
    candidates.push({
      cert: path.join(CERT_DIR, 'certificates', `_.${DOMAIN}.crt`),
      key: path.join(CERT_DIR, 'certificates', `_.${DOMAIN}.key`),
    });
  }
  candidates.push({
    cert: path.join(CERT_DIR, 'fullchain.pem'),
    key: path.join(CERT_DIR, 'privkey.pem'),
  });
  for (const c of candidates) {
    try {
      return { cert: fs.readFileSync(c.cert), key: fs.readFileSync(c.key), paths: c };
    } catch {
      /* weiter suchen */
    }
  }
  return null;
}

/* ---------- Start ---------- */

store.load();
ai.start();

const certs = findCerts();

if (certs) {
  const httpsServer = https.createServer({ cert: certs.cert, key: certs.key }, handler);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`[http] HTTPS läuft auf Port ${HTTPS_PORT}${DOMAIN ? ` (https://${DOMAIN}${PUBLIC_HTTPS_PORT ? ':' + PUBLIC_HTTPS_PORT : ''})` : ''}`);
  });

  // Zertifikat wird von lego regelmäßig erneuert – neu einlesen.
  setInterval(() => {
    const fresh = findCerts();
    if (fresh && !fresh.cert.equals(certs.cert)) {
      httpsServer.setSecureContext({ cert: fresh.cert, key: fresh.key });
      certs.cert = fresh.cert;
      console.log('[http] Neues Zertifikat geladen');
    }
  }, 6 * 60 * 60 * 1000);

  // HTTP → HTTPS umleiten.
  http.createServer((req, res) => {
    const host = (req.headers.host || DOMAIN).split(':')[0];
    const port = PUBLIC_HTTPS_PORT ? `:${PUBLIC_HTTPS_PORT}` : '';
    res.writeHead(301, { Location: `https://${host}${port}${req.url}` });
    res.end();
  }).listen(HTTP_PORT, () => {
    console.log(`[http] HTTP-Umleitung auf Port ${HTTP_PORT}`);
  });
} else {
  http.createServer(handler).listen(HTTP_PORT, () => {
    console.log(`[http] HTTP läuft auf Port ${HTTP_PORT}`);
    console.log('[http] Hinweis: Ohne HTTPS-Zertifikat funktioniert die App im Browser,');
    console.log('[http] aber der iPhone-Offline-Modus (Service Worker) braucht HTTPS.');
    console.log('[http] Siehe deploy/TRUENAS.md, Abschnitt "HTTPS mit DuckDNS".');
  });
}
