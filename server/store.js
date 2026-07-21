/*
 * Persistenz für den ShopList-Server.
 * Datensätze liegen als JSON-Dateien im DATA_DIR, Fotos als JPEG-Dateien
 * daneben. Für einen Haushalt ist das robust und völlig ausreichend –
 * keine Datenbank, keine Abhängigkeiten, einfach zu sichern (ZFS-Snapshots).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/data';
const PHOTO_DIR = path.join(DATA_DIR, 'photos');

const STORES = ['products', 'purchases', 'receipts'];
const data = {
  products: new Map(),
  purchases: new Map(),
  receipts: new Map(),
};

const saveTimers = new Map();

function load() {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  for (const store of STORES) {
    const file = path.join(DATA_DIR, `${store}.json`);
    try {
      const records = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const rec of records) data[store].set(rec.uid, rec);
      console.log(`[store] ${store}: ${data[store].size} Datensätze geladen`);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[store] ${file} nicht lesbar:`, err.message);
    }
  }
}

function saveSoon(store) {
  clearTimeout(saveTimers.get(store));
  saveTimers.set(store, setTimeout(() => {
    const file = path.join(DATA_DIR, `${store}.json`);
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify([...data[store].values()]));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`[store] Speichern von ${store} fehlgeschlagen:`, err.message);
    }
  }, 500));
}

function photoPath(store, uid) {
  // uid ist eine von uns erzeugte UUID – zur Sicherheit trotzdem filtern.
  const safe = String(uid).replace(/[^a-zA-Z0-9-]/g, '');
  return path.join(PHOTO_DIR, `${store}-${safe}.jpg`);
}

function savePhoto(store, uid, buffer) {
  fs.writeFileSync(photoPath(store, uid), buffer);
}

function readPhoto(store, uid) {
  try {
    return fs.readFileSync(photoPath(store, uid));
  } catch {
    return null;
  }
}

module.exports = { STORES, data, load, saveSoon, savePhoto, readPhoto };
