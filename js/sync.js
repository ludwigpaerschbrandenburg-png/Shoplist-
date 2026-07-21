/*
 * Offline-first Synchronisation mit dem ShopList-Server (falls vorhanden).
 *
 * Prinzip:
 *  - Die App funktioniert immer komplett lokal (IndexedDB).
 *  - Läuft die App vom eigenen Server (TrueNAS), meldet /api/health Erfolg
 *    und die Engine schaltet sich ein. Auf GitHub Pages o. Ä. bleibt sie aus.
 *  - Push: alle als "dirty" markierten Datensätze zum Server, Fotos als
 *    Base64 nur wenn sie sich geändert haben.
 *  - Pull: alle Server-Änderungen seit dem letzten Sync (Server-Zeit).
 *    Lokal noch nicht gepushte (dirty) Datensätze gewinnen gegen den Pull.
 *  - Der Server ist die zentrale Wahrheit; Konflikte: letzter Push gewinnt.
 */
const Sync = (() => {
  const LS_KEY = 'shoplist-lastSync';
  const STORES = ['products', 'purchases', 'receipts'];

  const state = {
    enabled: false,
    syncing: false,
    lastError: null,
    lastSyncAt: null,
    ai: null, // { reachable, model, status } vom Server
  };

  let onChange = null;   // Callback: Daten haben sich durch einen Pull geändert
  let onStatus = null;   // Callback: Statusanzeige aktualisieren
  let timer = null;
  let debounceTimer = null;
  let pendingAgain = false;

  function notifyStatus() {
    if (onStatus) onStatus(state);
  }

  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function b64ToBlob(b64, type = 'image/jpeg') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function checkServer() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('api/health', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || data.app !== 'shoplist') return false;
      state.ai = data.ai || null;
      return true;
    } catch {
      return false;
    }
  }

  async function collectChanges() {
    const dirty = await DB.getAll('dirty');
    const changes = { products: [], purchases: [], receipts: [] };
    for (const d of dirty) {
      if (!STORES.includes(d.store)) continue;
      const rec = await DB.get(d.store, d.uid);
      if (!rec) continue;
      const out = { ...rec };
      delete out.photo;
      if (d.photo && rec.photo) out.photoB64 = await blobToB64(rec.photo);
      changes[d.store].push(out);
    }
    return { dirty, changes };
  }

  async function applyServerChanges(changes, dirtyKeys) {
    let applied = 0;
    for (const store of STORES) {
      for (const rec of changes[store] || []) {
        // Lokale, noch nicht gepushte Änderungen nicht überschreiben.
        if (dirtyKeys.has(`${store}:${rec.uid}`)) continue;
        const local = await DB.get(store, rec.uid);
        const value = { ...rec };
        if (value.photoB64) {
          value.photo = b64ToBlob(value.photoB64);
          delete value.photoB64;
        } else if (local && local.photo && (value.photoRev || 0) <= (local.photoRev || 0)) {
          value.photo = local.photo;
          value.photoRev = local.photoRev;
        } else if (!('photo' in value) && store !== 'purchases') {
          value.photo = null;
        }
        await DB.putSynced(store, value);
        applied++;
      }
    }
    return applied;
  }

  async function syncNow() {
    if (!state.enabled || state.syncing) {
      pendingAgain = state.syncing;
      return;
    }
    state.syncing = true;
    state.lastError = null;
    notifyStatus();
    try {
      const since = Number(localStorage.getItem(LS_KEY) || 0);
      const { dirty, changes } = await collectChanges();
      const res = await fetch('api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since, changes }),
      });
      if (!res.ok) throw new Error(`Server-Antwort ${res.status}`);
      const data = await res.json();

      await DB.clearDirty(dirty.map(d => d.key));
      // Frisch geänderte Datensätze (während des Requests) bleiben dirty:
      // clearDirty löscht nur die Keys, die wir eingesammelt hatten – ein
      // put() währenddessen legt den Key sofort wieder an. Deshalb Dirty-Set
      // NACH dem Clear neu lesen und beim Anwenden respektieren.
      const nowDirty = new Set((await DB.getAll('dirty')).map(d => d.key));
      const applied = await applyServerChanges(data.changes || {}, nowDirty);

      localStorage.setItem(LS_KEY, String(data.time || Date.now()));
      state.lastSyncAt = Date.now();
      state.ai = data.ai || state.ai;
      if (applied && onChange) onChange();
    } catch (err) {
      state.lastError = err.message || String(err);
    } finally {
      state.syncing = false;
      notifyStatus();
      if (pendingAgain) {
        pendingAgain = false;
        setTimeout(syncNow, 500);
      }
    }
  }

  // Nach lokalen Änderungen aufrufen: synct kurz gebündelt.
  function schedule() {
    if (!state.enabled) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncNow, 1500);
  }

  async function reconnectOrSync() {
    if (!state.enabled) {
      state.enabled = await checkServer();
      notifyStatus();
      if (state.enabled) syncNow();
    } else {
      syncNow();
    }
  }

  async function start(callbacks = {}) {
    onChange = callbacks.onChange || null;
    onStatus = callbacks.onStatus || null;

    state.enabled = await checkServer();
    notifyStatus();
    if (state.enabled) syncNow();

    // Regelmäßig syncen bzw. den Server wiederfinden (z. B. wenn man
    // unterwegs war und wieder ins Heim-WLAN kommt).
    timer = setInterval(reconnectOrSync, 45000);
    window.addEventListener('online', reconnectOrSync);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reconnectOrSync();
    });
  }

  return { start, syncNow, schedule, state };
})();
