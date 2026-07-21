/*
 * KI-Worker: spricht mit Ollama (auf der GPU des Servers) und erledigt
 * die Automatik, damit man nichts von Hand eintragen muss:
 *
 *  - Produktfoto  → Produktname + genaues Label ("Lenor Weichspüler 1L")
 *  - Kassenbon    → Geschäft, Datum, Summe, Positionen mit Preisen
 *                 → Zuordnung der Positionen zu den Haushaltsprodukten
 *                 → Käufe verbuchen, Preise eintragen, Liste abhaken
 *
 * Der Worker läuft als Schleife im Serverprozess und arbeitet alles ab,
 * was Clients mit aiStatus 'pending' hochsynchronisiert haben.
 */
'use strict';

const crypto = require('crypto');
const { data, saveSoon, readPhoto } = require('./store');

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://ollama:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5vl:7b';
const TICK_MS = Number(process.env.AI_TICK_MS || 15000);
const MAX_TRIES = 3;

const status = {
  url: OLLAMA_URL,
  model: MODEL,
  status: 'unreachable', // 'unreachable' | 'pulling' | 'ready'
  lastError: null,
};

let busy = false;
let pullStarted = false;

function now() {
  return Date.now();
}

async function checkModel() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tags = await res.json();
    const names = (tags.models || []).map(m => m.name);
    const have = names.some(n => n === MODEL || n === `${MODEL}:latest` || n.split(':')[0] === MODEL.split(':')[0]);
    if (have) {
      status.status = 'ready';
      return true;
    }
    status.status = 'pulling';
    if (!pullStarted) {
      pullStarted = true;
      console.log(`[ai] Modell ${MODEL} fehlt – Download startet (das kann beim ersten Mal dauern)`);
      fetch(`${OLLAMA_URL}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, stream: false }),
      }).then(r => {
        console.log(`[ai] Modell-Download beendet (HTTP ${r.status})`);
        pullStarted = false;
      }).catch(err => {
        console.error('[ai] Modell-Download fehlgeschlagen:', err.message);
        pullStarted = false;
      });
    }
    return false;
  } catch (err) {
    status.status = 'unreachable';
    status.lastError = err.message;
    return false;
  }
}

async function chat(prompt, imageB64) {
  const message = { role: 'user', content: prompt };
  if (imageB64) message.images = [imageB64];
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [message],
      stream: false,
      format: 'json',
      options: { temperature: 0, num_ctx: 8192 },
    }),
    // Auf älteren GPUs darf ein Bon ruhig ein paar Minuten dauern.
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const out = await res.json();
  const text = out.message && out.message.content;
  if (!text) throw new Error('Leere Antwort von Ollama');
  return JSON.parse(text);
}

function parseNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100) / 100;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.').replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n)) return Math.round(n * 100) / 100;
  }
  return null;
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00'));
}

/* ---------- Produktfoto → Name ---------- */

async function identifyProduct(product) {
  const photo = readPhoto('products', product.uid);
  if (!photo) {
    product.aiStatus = 'done';
    product.updatedAt = now();
    saveSoon('products');
    return;
  }
  const result = await chat(
    'Du siehst das Foto eines Produkts aus einem Haushalt (z. B. Reinigungsmittel, ' +
    'Lebensmittel, Drogerieartikel). Antworte NUR mit JSON in genau dieser Form: ' +
    '{"kurzname": "kurzer deutscher Alltagsname, z. B. Weichspüler oder Toast", ' +
    '"label": "so genau wie möglich: Marke, Produktname, Größe, z. B. Lenor Weichspüler Aprilfrisch 1L"}. ' +
    'Wenn du unsicher bist, gib deine beste Schätzung ab.',
    photo.toString('base64')
  );
  const kurzname = typeof result.kurzname === 'string' ? result.kurzname.trim().slice(0, 60) : '';
  const label = typeof result.label === 'string' ? result.label.trim().slice(0, 120) : '';
  if (!product.name && kurzname) product.name = kurzname;
  if (label) product.aiLabel = label;
  product.aiStatus = 'done';
  product.updatedAt = now();
  saveSoon('products');
  console.log(`[ai] Produkt erkannt: ${product.name}${label ? ` (${label})` : ''}`);
}

/* ---------- Kassenbon → Käufe ---------- */

async function extractReceipt(photoB64) {
  const result = await chat(
    'Das ist das Foto eines deutschen Kassenbons. Lies ihn sorgfältig und antworte NUR mit JSON ' +
    'in genau dieser Form: {"geschaeft": "Name des Geschäfts oder null", ' +
    '"datum": "Kaufdatum als YYYY-MM-DD oder null", "summe": Gesamtsumme als Zahl oder null, ' +
    '"positionen": [{"text": "Artikelzeile wie auf dem Bon", "preis": Preis als Zahl oder null}]}. ' +
    'Nur echte Artikelzeilen aufnehmen – keine Zwischensummen, kein Rückgeld, keine Rabatt-Gesamtzeilen. ' +
    'Pfand darf als eigene Position erscheinen. Preise sind Eurobeträge mit Punkt als Dezimaltrenner.',
    photoB64
  );
  const items = Array.isArray(result.positionen) ? result.positionen : [];
  return {
    store: typeof result.geschaeft === 'string' ? result.geschaeft.trim().slice(0, 60) : '',
    date: validDate(result.datum) ? result.datum : null,
    total: parseNumber(result.summe),
    items: items
      .map(p => ({
        text: typeof p.text === 'string' ? p.text.trim().slice(0, 80) : '',
        price: parseNumber(p.preis),
      }))
      .filter(p => p.text),
  };
}

async function matchItems(items, products) {
  if (!items.length || !products.length) return new Map();
  const productList = products.map(p => ({
    uid: p.uid,
    name: [p.name, p.aiLabel].filter(Boolean).join(' – '),
  }));
  const result = await chat(
    'Ordne Kassenbon-Positionen den Produkten eines Haushalts zu. ' +
    'Kassenbons kürzen Namen stark ab (z. B. "WEICHSP." für Weichspüler). ' +
    `Produkte: ${JSON.stringify(productList)}. ` +
    `Positionen: ${JSON.stringify(items.map((p, i) => ({ index: i, text: p.text })))}. ` +
    'Antworte NUR mit JSON: {"zuordnung": [{"index": Positionsindex, "uid": "Produkt-uid oder null"}]}. ' +
    'Setze uid nur, wenn die Position wirklich dieses Produkt ist – im Zweifel null.'
  );
  const map = new Map();
  const valid = new Set(products.map(p => p.uid));
  for (const z of (Array.isArray(result.zuordnung) ? result.zuordnung : [])) {
    const idx = Number(z.index);
    if (Number.isInteger(idx) && idx >= 0 && idx < items.length && typeof z.uid === 'string' && valid.has(z.uid)) {
      map.set(idx, z.uid);
    }
  }
  return map;
}

async function processReceipt(receipt) {
  const photo = readPhoto('receipts', receipt.uid);
  if (!photo) {
    receipt.aiStatus = 'error';
    receipt.aiError = 'Kein Foto vorhanden';
    receipt.updatedAt = now();
    saveSoon('receipts');
    return;
  }

  const parsed = await extractReceipt(photo.toString('base64'));
  const activeProducts = [...data.products.values()].filter(p => !p.deleted && (p.name || p.aiLabel));
  const matches = await matchItems(parsed.items, activeProducts);

  // Bon-Metadaten übernehmen, wo der Nutzer nichts eingetragen hat.
  if (!receipt.store && parsed.store) receipt.store = parsed.store;
  if (receipt.total == null && parsed.total != null) receipt.total = parsed.total;
  if (parsed.date) receipt.date = parsed.date;

  // Vorhandene Käufe zu diesem Bon (aus "Einkauf abschließen"):
  // fehlende Preise auffüllen statt Duplikate anzulegen.
  const existing = [...data.purchases.values()]
    .filter(x => !x.deleted && x.receiptUid === receipt.uid);
  const matchedItems = [];
  let booked = 0;

  for (const [idx, productUid] of matches) {
    const item = parsed.items[idx];
    matchedItems.push({ idx, productUid, price: item.price });

    const open = existing.find(x => x.productUid === productUid && x.price == null);
    if (open) {
      if (item.price != null) {
        open.price = item.price;
        open.updatedAt = now();
        booked++;
      }
      continue;
    }
    if (existing.some(x => x.productUid === productUid)) continue; // schon manuell verbucht

    const uid = crypto.randomUUID();
    data.purchases.set(uid, {
      uid,
      productUid,
      price: item.price,
      date: receipt.date,
      receiptUid: receipt.uid,
      aiFilled: true,
      updatedAt: now(),
      deleted: 0,
    });
    booked++;

    // Gekauft → von der Einkaufsliste nehmen.
    const product = data.products.get(productUid);
    if (product && product.onList) {
      product.onList = 0;
      product.checked = 0;
      product.updatedAt = now();
    }
  }

  receipt.parsed = {
    store: parsed.store,
    date: parsed.date,
    total: parsed.total,
    items: parsed.items.map((item, idx) => ({
      text: item.text,
      price: item.price,
      productUid: (matchedItems.find(m => m.idx === idx) || {}).productUid || null,
    })),
  };
  receipt.aiStatus = 'done';
  receipt.aiError = null;
  receipt.updatedAt = now();

  saveSoon('receipts');
  saveSoon('purchases');
  saveSoon('products');
  console.log(`[ai] Bon gelesen: ${parsed.items.length} Positionen, ${booked} Käufe verbucht (${receipt.store || 'Geschäft unbekannt'})`);
}

/* ---------- Worker-Schleife ---------- */

function pendingWork() {
  const receipt = [...data.receipts.values()]
    .find(r => !r.deleted && r.aiStatus === 'pending');
  if (receipt) return { kind: 'receipt', record: receipt };
  const product = [...data.products.values()]
    .find(p => !p.deleted && p.aiStatus === 'pending');
  if (product) return { kind: 'product', record: product };
  return null;
}

async function tick() {
  if (busy) return;
  const work = pendingWork();
  const ready = await checkModel();
  if (!work || !ready) return;

  busy = true;
  const { kind, record } = work;
  try {
    if (kind === 'receipt') await processReceipt(record);
    else await identifyProduct(record);
  } catch (err) {
    record.aiTries = (record.aiTries || 0) + 1;
    console.error(`[ai] ${kind} ${record.uid} fehlgeschlagen (Versuch ${record.aiTries}):`, err.message);
    if (record.aiTries >= MAX_TRIES) {
      record.aiStatus = 'error';
      if (kind === 'receipt') record.aiError = 'Bon konnte nicht gelesen werden';
      record.updatedAt = now();
      saveSoon(kind === 'receipt' ? 'receipts' : 'products');
    }
  } finally {
    busy = false;
  }
}

function start() {
  checkModel();
  setInterval(tick, TICK_MS);
  console.log(`[ai] Worker gestartet – Ollama: ${OLLAMA_URL}, Modell: ${MODEL}`);
}

function health() {
  return {
    url: OLLAMA_URL,
    model: MODEL,
    status: status.status,
  };
}

module.exports = { start, health };
