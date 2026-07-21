/*
 * Kleine Promise-basierte IndexedDB-Schicht.
 * Stores:
 *   products:  { id, name, photo(Blob|null), onList(0|1), checked(0|1), createdAt }
 *   purchases: { id, productId, price(Number|null), date('YYYY-MM-DD'), receiptId(Number|null) }
 *   receipts:  { id, photo(Blob|null), store, total(Number|null), date('YYYY-MM-DD'), createdAt }
 */
const DB = (() => {
  const NAME = 'shoplist-db';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('products')) {
          db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('purchases')) {
          const s = db.createObjectStore('purchases', { keyPath: 'id', autoIncrement: true });
          s.createIndex('productId', 'productId');
          s.createIndex('receiptId', 'receiptId');
        }
        if (!db.objectStoreNames.contains('receipts')) {
          db.createObjectStore('receipts', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  return {
    add: (store, value) => tx(store, 'readwrite', s => s.add(value)),
    put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
    del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
    get(store, key) {
      return open().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }));
    },
    getAll(store) {
      return open().then(db => new Promise((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }));
    },
  };
})();
