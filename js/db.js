/*
 * Kleine Promise-basierte IndexedDB-Schicht mit Sync-Unterstützung.
 *
 * Stores (alle mit keyPath 'uid'):
 *   products:  { uid, name, aiLabel, aiStatus, photo(Blob|null), photoRev,
 *                onList(0|1), checked(0|1), createdAt, updatedAt, deleted(0|1) }
 *   purchases: { uid, productUid, price(Number|null), date('YYYY-MM-DD'),
 *                receiptUid(String|null), updatedAt, deleted(0|1) }
 *   receipts:  { uid, photo(Blob|null), photoRev, store, total(Number|null),
 *                date('YYYY-MM-DD'), parsed(Object|null), aiStatus, aiError,
 *                createdAt, updatedAt, deleted(0|1) }
 *   dirty:     { key: '<store>:<uid>', store, uid, photo(bool) }
 *
 * Lokale Änderungen laufen über put()/softDelete() und landen im Dirty-Store,
 * damit die Sync-Engine weiß, was zum Server gepusht werden muss. Vom Server
 * empfangene Datensätze werden mit putSynced() geschrieben (kein Dirty-Eintrag).
 */
const DB = (() => {
  const NAME = 'shoplist-db';
  const VERSION = 2;
  let dbPromise = null;

  // crypto.randomUUID gibt es nur in Secure Contexts – im Heimnetz über
  // HTTP brauchen wir einen Fallback.
  function genUid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function migrateV1(db, tx) {
    // Version 1 nutzte Auto-Increment-IDs (id, productId, receiptId).
    // Alte Daten einlesen, Stores neu anlegen und Datensätze mit UIDs
    // übernehmen. Alles bleibt in derselben versionchange-Transaktion.
    const old = { products: [], purchases: [], receipts: [] };
    const reads = [];
    for (const name of Object.keys(old)) {
      if (!db.objectStoreNames.contains(name)) continue;
      reads.push(new Promise(res => {
        const req = tx.objectStore(name).getAll();
        req.onsuccess = () => { old[name] = req.result || []; res(); };
        req.onerror = () => res();
      }));
    }

    return Promise.all(reads).then(() => {
      for (const name of ['products', 'purchases', 'receipts']) {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      }
      const products = db.createObjectStore('products', { keyPath: 'uid' });
      const purchases = db.createObjectStore('purchases', { keyPath: 'uid' });
      const receipts = db.createObjectStore('receipts', { keyPath: 'uid' });
      const dirty = db.createObjectStore('dirty', { keyPath: 'key' });

      const now = Date.now();
      const productUids = new Map();
      const receiptUids = new Map();

      for (const p of old.products) {
        const uid = genUid();
        productUids.set(p.id, uid);
        products.put({
          uid,
          name: p.name || '',
          aiLabel: '',
          aiStatus: null,
          photo: p.photo || null,
          photoRev: p.photo ? now : 0,
          onList: p.onList ? 1 : 0,
          checked: p.checked ? 1 : 0,
          createdAt: p.createdAt || now,
          updatedAt: now,
          deleted: 0,
        });
        dirty.put({ key: `products:${uid}`, store: 'products', uid, photo: !!p.photo });
      }
      for (const r of old.receipts) {
        const uid = genUid();
        receiptUids.set(r.id, uid);
        receipts.put({
          uid,
          photo: r.photo || null,
          photoRev: r.photo ? now : 0,
          store: r.store || '',
          total: r.total ?? null,
          date: r.date,
          parsed: null,
          aiStatus: null,
          aiError: null,
          createdAt: r.createdAt || now,
          updatedAt: now,
          deleted: 0,
        });
        dirty.put({ key: `receipts:${uid}`, store: 'receipts', uid, photo: !!r.photo });
      }
      for (const x of old.purchases) {
        const productUid = productUids.get(x.productId);
        if (!productUid) continue;
        const uid = genUid();
        purchases.put({
          uid,
          productUid,
          price: x.price ?? null,
          date: x.date,
          receiptUid: x.receiptId != null ? (receiptUids.get(x.receiptId) || null) : null,
          updatedAt: now,
          deleted: 0,
        });
        dirty.put({ key: `purchases:${uid}`, store: 'purchases', uid, photo: false });
      }
    });
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = e => {
        const db = req.result;
        if (e.oldVersion >= 1) {
          migrateV1(db, req.transaction);
        } else {
          db.createObjectStore('products', { keyPath: 'uid' });
          db.createObjectStore('purchases', { keyPath: 'uid' });
          db.createObjectStore('receipts', { keyPath: 'uid' });
          db.createObjectStore('dirty', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function txDone(t) {
    return new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function put(store, value, { photoChanged = false } = {}) {
    value.updatedAt = Date.now();
    const db = await open();
    const key = `${store}:${value.uid}`;
    const prevDirty = await get('dirty', key).catch(() => null);
    const t = db.transaction([store, 'dirty'], 'readwrite');
    t.objectStore(store).put(value);
    t.objectStore('dirty').put({
      key, store, uid: value.uid,
      photo: photoChanged || !!(prevDirty && prevDirty.photo),
    });
    await txDone(t);
    return value;
  }

  // Schreiben ohne Dirty-Markierung (für vom Server empfangene Datensätze).
  async function putSynced(store, value) {
    const db = await open();
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(value);
    await txDone(t);
  }

  async function softDelete(store, record) {
    record.deleted = 1;
    return put(store, record);
  }

  function reqPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, uid) {
    const db = await open();
    return reqPromise(db.transaction(store).objectStore(store).get(uid));
  }

  async function getAll(store) {
    const db = await open();
    return reqPromise(db.transaction(store).objectStore(store).getAll());
  }

  async function clearDirty(keys) {
    const db = await open();
    const t = db.transaction('dirty', 'readwrite');
    for (const key of keys) t.objectStore('dirty').delete(key);
    await txDone(t);
  }

  return { genUid, put, putSynced, softDelete, get, getAll, clearDirty, open };
})();
