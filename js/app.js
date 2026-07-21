/* ShopList – Einkaufsliste mit Fotos, Kassenbons, Ausgaben-Statistik,
 * optionalem Heimserver-Sync und KI-Automatik (Ollama). */
(() => {
  'use strict';

  const state = {
    tab: 'list',
    statsKind: 'month',
    statsOffset: 0,
  };

  let products = [];
  let purchases = [];
  let receipts = [];

  const view = document.getElementById('view');
  const modalRoot = document.getElementById('modal-root');
  const headerAction = document.getElementById('header-action');
  const screenTitle = document.getElementById('screen-title');
  const syncDot = document.getElementById('sync-dot');

  const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  const DATE_FMT = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });

  const TITLES = {
    list: 'Einkaufsliste',
    products: 'Produkte',
    receipts: 'Kassenbons',
    stats: 'Ausgaben',
  };

  /* ---------- Helpers ---------- */

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtEUR(n) {
    return n == null ? '–' : EUR.format(n);
  }

  function fmtDate(s) {
    return DATE_FMT.format(Stats.parseDate(s));
  }

  function fmtDays(n) {
    if (n == null) return '–';
    const d = Math.round(n);
    return d === 1 ? '1 Tag' : `${d} Tage`;
  }

  function parsePrice(str) {
    const cleaned = String(str || '').replace(/[^\d,.-]/g, '').replace(',', '.');
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }

  function displayName(p) {
    if (p.name) return p.name;
    return p.aiStatus === 'pending' ? 'Wird erkannt…' : 'Unbenanntes Produkt';
  }

  let objectURLs = [];
  function photoURL(blob) {
    const url = URL.createObjectURL(blob);
    objectURLs.push(url);
    return url;
  }
  function revokeURLs() {
    objectURLs.forEach(u => URL.revokeObjectURL(u));
    objectURLs = [];
  }

  function thumbHTML(photo, fallbackEmoji) {
    if (photo) return `<img class="thumb" src="${photoURL(photo)}" alt="">`;
    return `<div class="thumb thumb-placeholder">${fallbackEmoji}</div>`;
  }

  function pickImage() {
    return new Promise(resolve => {
      const input = document.getElementById('file-input');
      input.value = '';
      input.onchange = () => resolve(input.files[0] || null);
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async function resizeImage(file, maxDim = 1280, quality = 0.82) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
      return blob || file;
    } catch {
      return file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const aiOn = () => Sync.state.enabled;

  /* ---------- Daten ---------- */

  async function loadData() {
    const [allProducts, allPurchases, allReceipts] = await Promise.all([
      DB.getAll('products'),
      DB.getAll('purchases'),
      DB.getAll('receipts'),
    ]);
    products = allProducts.filter(p => !p.deleted);
    purchases = allPurchases.filter(p => !p.deleted);
    receipts = allReceipts.filter(r => !r.deleted);
    products.sort((a, b) => displayName(a).localeCompare(displayName(b), 'de'));
    purchases.sort((a, b) => a.date.localeCompare(b.date));
    receipts.sort((a, b) => b.date.localeCompare(a.date));
  }

  function purchasesByProduct() {
    const map = new Map();
    for (const p of purchases) {
      if (!map.has(p.productUid)) map.set(p.productUid, []);
      map.get(p.productUid).push(p);
    }
    return map;
  }

  function productByUid(uid) {
    return products.find(p => p.uid === uid);
  }

  /* ---------- Rendern ---------- */

  async function render() {
    revokeURLs();
    closeSheet();
    await loadData();
    renderView();
  }

  function renderView() {
    screenTitle.textContent = TITLES[state.tab];
    headerAction.hidden = state.tab === 'stats';
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === state.tab);
    });

    if (state.tab === 'list') renderList();
    else if (state.tab === 'products') renderProducts();
    else if (state.tab === 'receipts') renderReceipts();
    else renderStats();
  }

  // Nach einem Sync-Pull: Daten neu laden und die Ansicht im Hintergrund
  // aktualisieren, ohne ein offenes Sheet zu schließen.
  async function refreshAfterSync() {
    await loadData();
    renderView();
  }

  function updateSyncDot(s) {
    syncDot.hidden = false;
    let cls = 'off', title = 'Kein Server erreichbar – App läuft lokal';
    if (s.enabled) {
      if (s.syncing) { cls = 'busy'; title = 'Synchronisiert…'; }
      else if (s.lastError) { cls = 'err'; title = `Sync-Fehler: ${s.lastError}`; }
      else {
        cls = 'ok';
        title = 'Mit Heimserver verbunden';
        if (s.ai && s.ai.status && s.ai.status !== 'ready') {
          cls = 'busy';
          title = s.ai.status === 'pulling'
            ? 'KI-Modell wird heruntergeladen…'
            : 'KI (Ollama) nicht erreichbar – Sync läuft trotzdem';
        }
      }
    }
    syncDot.className = `sync-dot ${cls}`;
    syncDot.title = title;
  }

  /* ----- Einkaufsliste ----- */

  function productSub(p, stats) {
    if (p.aiStatus === 'pending' && !p.name) return '🤖 KI erkennt das Produkt…';
    if (stats.lastPrice != null) {
      return `Zuletzt ${fmtEUR(stats.lastPrice)}${stats.avgIntervalDays ? ` · hält ~${fmtDays(stats.avgIntervalDays)}` : ''}`;
    }
    return 'Noch kein Preis erfasst';
  }

  function renderList() {
    const byProduct = purchasesByProduct();
    const items = products.filter(p => p.onList);
    items.sort((a, b) => (a.checked - b.checked) || displayName(a).localeCompare(displayName(b), 'de'));
    const others = products.filter(p => !p.onList);
    const checkedCount = items.filter(p => p.checked).length;

    let html = '';

    if (!items.length) {
      html += `
        <div class="empty">
          <span class="emoji">🛒</span>
          <h2>Deine Liste ist leer</h2>
          <p>Läuft etwas leer? Tippe oben auf <strong>+</strong> und mach ein Foto davon – beim Einkaufen siehst du es dann hier.</p>
        </div>`;
    } else {
      html += `<div class="card">` + items.map(p => {
        const stats = Stats.productStats(byProduct.get(p.uid) || []);
        return `
          <div class="row ${p.checked ? 'done' : ''}" data-action="open-product" data-id="${p.uid}">
            <button class="check ${p.checked ? 'checked' : ''}" data-action="toggle-check" data-id="${p.uid}" aria-label="Abhaken"></button>
            ${thumbHTML(p.photo, '🧺')}
            <div class="row-main">
              <div class="row-title">${esc(displayName(p))}</div>
              <div class="row-sub">${productSub(p, stats)}</div>
            </div>
          </div>`;
      }).join('') + `</div>`;
    }

    if (others.length) {
      html += `<div class="section-label">Wieder kaufen?</div><div class="card">` + others.map(p => `
        <div class="row" data-action="open-product" data-id="${p.uid}">
          ${thumbHTML(p.photo, '📦')}
          <div class="row-main"><div class="row-title">${esc(displayName(p))}</div></div>
          <button class="icon-btn" data-action="quick-add" data-id="${p.uid}" aria-label="Auf die Liste">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>`).join('') + `</div>`;
    }

    if (checkedCount) {
      html += `<div style="height:76px"></div>
        <button class="btn sticky-action" data-action="complete-purchase">
          ${checkedCount} Artikel gekauft – Einkauf abschließen
        </button>`;
    }

    view.innerHTML = html;
  }

  /* ----- Produkte ----- */

  function renderProducts() {
    const byProduct = purchasesByProduct();

    if (!products.length) {
      view.innerHTML = `
        <div class="empty">
          <span class="emoji">📦</span>
          <h2>Noch keine Produkte</h2>
          <p>Leg deine Haushaltsprodukte mit Foto an – z.&nbsp;B. Weichspüler, Spülmittel oder Kaffee. ShopList lernt mit jedem Einkauf, was sie kosten und wie lange sie halten.</p>
        </div>`;
      return;
    }

    view.innerHTML = `<div class="card">` + products.map(p => {
      const stats = Stats.productStats(byProduct.get(p.uid) || []);
      let sub;
      if (p.aiStatus === 'pending' && !p.name) sub = '🤖 KI erkennt das Produkt…';
      else if (!stats.count) sub = 'Noch keine Käufe erfasst';
      else {
        const parts = [`${stats.count} ${stats.count === 1 ? 'Kauf' : 'Käufe'}`];
        if (stats.avgPrice != null) parts.push(`Ø ${fmtEUR(stats.avgPrice)}`);
        if (stats.avgIntervalDays) parts.push(`hält ~${fmtDays(stats.avgIntervalDays)}`);
        sub = parts.join(' · ');
      }
      const end = stats.costPerMonth != null
        ? `<div class="row-end">≈ ${fmtEUR(stats.costPerMonth)}<br><span style="font-size:11px;color:var(--text-3)">pro Monat</span></div>`
        : (p.onList ? `<div class="row-end" style="color:var(--accent);font-size:13px;font-weight:600">Auf der Liste</div>` : '');
      return `
        <div class="row" data-action="open-product" data-id="${p.uid}">
          ${thumbHTML(p.photo, '📦')}
          <div class="row-main">
            <div class="row-title">${esc(displayName(p))}</div>
            <div class="row-sub">${sub}</div>
          </div>
          ${end}
        </div>`;
    }).join('') + `</div>`;
  }

  /* ----- Kassenbons ----- */

  function receiptTitle(r) {
    return r.store || (r.parsed && r.parsed.store) || 'Kassenbon';
  }

  function renderReceipts() {
    if (!receipts.length) {
      view.innerHTML = `
        <div class="empty">
          <span class="emoji">🧾</span>
          <h2>Noch keine Kassenbons</h2>
          <p>Fotografiere nach dem Einkauf deinen Bon${aiOn() ? ' – die KI liest die Preise automatisch und hakt gekaufte Produkte ab' : ' und trage die Preise ein'}. So weiß ShopList, was deine Produkte kosten und wie lange sie halten.</p>
        </div>`;
      return;
    }

    view.innerHTML = `<div class="card">` + receipts.map(r => {
      const rp = purchases.filter(p => p.receiptUid === r.uid);
      const total = r.total != null ? r.total : (rp.length ? Stats.sumPrices(rp) : null);
      let sub;
      if (r.aiStatus === 'pending') sub = '🤖 Bon wird gelesen…';
      else if (r.aiStatus === 'error') sub = '⚠️ KI konnte den Bon nicht lesen';
      else {
        const names = rp.map(p => {
          const prod = productByUid(p.productUid);
          return prod ? displayName(prod) : null;
        }).filter(Boolean);
        sub = names.length
          ? `${fmtDate(r.date)} · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`
          : fmtDate(r.date);
      }
      return `
        <div class="row" data-action="open-receipt" data-id="${r.uid}">
          ${thumbHTML(r.photo, '🧾')}
          <div class="row-main">
            <div class="row-title">${esc(receiptTitle(r))}</div>
            <div class="row-sub">${sub}</div>
          </div>
          <div class="row-end">${total != null ? fmtEUR(total) : ''}</div>
        </div>`;
    }).join('') + `</div>`;
  }

  /* ----- Ausgaben ----- */

  function renderStats() {
    const kind = state.statsKind;
    const range = Stats.periodRange(kind, state.statsOffset);
    const byProduct = purchasesByProduct();

    const inRange = Stats.purchasesIn(purchases, range);
    const actual = Stats.sumPrices(inRange);
    const proj = Stats.projection(products, byProduct, range.days);
    const monthlyFix = Stats.projection(products, byProduct, Stats.AVG_MONTH_DAYS);

    const shown = range.future ? proj.total : actual;
    const caption = range.future
      ? 'Prognose auf Basis deiner bisherigen Käufe'
      : (state.statsOffset === 0 ? 'bisher ausgegeben' : 'ausgegeben');

    const cols = [];
    let maxVal = 0;
    for (let off = -4; off <= 1; off++) {
      const r = Stats.periodRange(kind, off);
      const val = r.future
        ? Stats.projection(products, byProduct, r.days).total
        : Stats.sumPrices(Stats.purchasesIn(purchases, r));
      maxVal = Math.max(maxVal, val);
      cols.push({ off, val, r });
    }

    const chart = `<div class="chart">` + cols.map(c => `
      <button class="col ${c.off === state.statsOffset ? 'selected' : ''} ${c.r.future ? 'future' : ''}"
              data-action="chart-col" data-off="${c.off}">
        <div class="bar" style="height:${maxVal ? Math.max(3, Math.round(c.val / maxVal * 100)) : 3}%"></div>
        <span class="tick">${Stats.shortPeriodLabel(kind, c.r)}</span>
      </button>`).join('') + `</div>`;

    let breakdown = '';
    if (range.future) {
      if (proj.items.length) {
        breakdown = `<div class="section-label">Prognose nach Produkt</div><div class="card">` +
          proj.items.map(item => {
            const p = productByUid(item.productUid);
            if (!p) return '';
            return `
              <div class="row" data-action="open-product" data-id="${p.uid}">
                ${thumbHTML(p.photo, '📦')}
                <div class="row-main">
                  <div class="row-title">${esc(displayName(p))}</div>
                  <div class="row-sub">alle ~${fmtDays(item.stats.avgIntervalDays)} · Ø ${fmtEUR(item.stats.avgPrice)}</div>
                </div>
                <div class="row-end">≈ ${fmtEUR(item.amount)}</div>
              </div>`;
          }).join('') + `</div>
          <p class="note">Die Prognose beruht auf deinen Kaufabständen und Durchschnittspreisen. Je mehr Bons du erfasst, desto genauer wird sie.</p>`;
      } else {
        breakdown = `<p class="note">Für eine Prognose braucht ShopList mindestens zwei erfasste Käufe pro Produkt (mit Preis). Scanne dafür einfach deine Kassenbons.</p>`;
      }
    } else {
      const sums = new Map();
      for (const p of inRange) {
        sums.set(p.productUid, (sums.get(p.productUid) || 0) + (p.price || 0));
      }
      const rows = [...sums.entries()].sort((a, b) => b[1] - a[1]);
      if (rows.length) {
        breakdown = `<div class="section-label">Ausgaben nach Produkt</div><div class="card">` +
          rows.map(([uid, sum]) => {
            const p = productByUid(uid);
            if (!p) return '';
            const count = inRange.filter(x => x.productUid === uid).length;
            return `
              <div class="row" data-action="open-product" data-id="${p.uid}">
                ${thumbHTML(p.photo, '📦')}
                <div class="row-main">
                  <div class="row-title">${esc(displayName(p))}</div>
                  <div class="row-sub">${count} ${count === 1 ? 'Kauf' : 'Käufe'}</div>
                </div>
                <div class="row-end">${fmtEUR(sum)}</div>
              </div>`;
          }).join('') + `</div>`;
      } else {
        breakdown = `<p class="note">In diesem Zeitraum sind keine Einkäufe erfasst.</p>`;
      }
    }

    view.innerHTML = `
      <div class="seg">
        <button data-action="stats-kind" data-kind="week" class="${kind === 'week' ? 'active' : ''}">Woche</button>
        <button data-action="stats-kind" data-kind="month" class="${kind === 'month' ? 'active' : ''}">Monat</button>
        <button data-action="stats-kind" data-kind="year" class="${kind === 'year' ? 'active' : ''}">Jahr</button>
      </div>

      <div class="period-nav">
        <button data-action="stats-nav" data-dir="-1" aria-label="Zurück">‹</button>
        <div class="label">${esc(range.label)}${range.future ? '<span class="badge">Prognose</span>' : ''}</div>
        <button data-action="stats-nav" data-dir="1" aria-label="Weiter">›</button>
      </div>

      <div class="card big-number">
        <div class="amount">${fmtEUR(shown)}</div>
        <div class="caption">${caption}</div>
      </div>

      <div class="stat-grid">
        <div class="stat-tile">
          <div class="value">${monthlyFix.items.length ? '≈ ' + fmtEUR(monthlyFix.total) : '–'}</div>
          <div class="label">Monatliche Fixkosten (Prognose)</div>
        </div>
        <div class="stat-tile">
          <div class="value">${range.future ? proj.items.length : inRange.length}</div>
          <div class="label">${range.future ? 'Produkte in der Prognose' : 'Käufe im Zeitraum'}</div>
        </div>
      </div>

      <div class="card">${chart}</div>
      ${breakdown}`;
  }

  /* ---------- Bottom Sheets ---------- */

  function openSheet(html) {
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-action="close-sheet"></div>
      <div class="sheet">
        <div class="sheet-grabber"></div>
        ${html}
      </div>`;
    return modalRoot.querySelector('.sheet');
  }

  function closeSheet() {
    modalRoot.innerHTML = '';
  }

  function sheetHead(title) {
    return `<div class="sheet-head"><h2>${esc(title)}</h2><button class="sheet-close" data-action="close-sheet">✕</button></div>`;
  }

  /* ----- Produkt anlegen ----- */

  function openAddProduct(toList) {
    let photoBlob = null;
    const ai = aiOn();
    const sheet = openSheet(`
      ${sheetHead('Produkt hinzufügen')}
      <div class="field">
        <button type="button" class="photo-pick" id="pp">
          <span class="cam-emoji">📷</span>
          <span>Foto aufnehmen oder auswählen</span>
        </button>
      </div>
      <div class="field">
        <label for="np">Name${ai ? ' (leer lassen = KI erkennt ihn vom Foto)' : ''}</label>
        <input type="text" id="np" placeholder="${ai ? 'automatisch per KI' : 'z. B. Weichspüler'}" autocomplete="off">
      </div>
      <button class="btn" id="save" disabled>${toList ? 'Auf die Einkaufsliste setzen' : 'Produkt speichern'}</button>
    `);

    const nameInput = sheet.querySelector('#np');
    const saveBtn = sheet.querySelector('#save');
    const photoBtn = sheet.querySelector('#pp');

    const updateSave = () => {
      saveBtn.disabled = !nameInput.value.trim() && !(ai && photoBlob);
    };
    nameInput.addEventListener('input', updateSave);

    photoBtn.addEventListener('click', async () => {
      const file = await pickImage();
      if (!file) return;
      photoBlob = await resizeImage(file);
      photoBtn.classList.add('has-photo');
      photoBtn.innerHTML = `<img src="${photoURL(photoBlob)}" alt="Produktfoto">`;
      updateSave();
    });

    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name && !(ai && photoBlob)) return;
      await DB.put('products', {
        uid: DB.genUid(),
        name,
        aiLabel: '',
        aiStatus: ai && photoBlob ? 'pending' : null,
        photo: photoBlob,
        photoRev: photoBlob ? Date.now() : 0,
        onList: toList ? 1 : 0,
        checked: 0,
        createdAt: Date.now(),
        deleted: 0,
      }, { photoChanged: !!photoBlob });
      Sync.schedule();
      render();
    });

    if (!ai) setTimeout(() => nameInput.focus(), 300);
  }

  /* ----- Produkt-Detail ----- */

  function openProductDetail(uid) {
    const p = productByUid(uid);
    if (!p) return;
    const productPurchases = (purchasesByProduct().get(uid) || []);
    const stats = Stats.productStats(productPurchases);
    const receiptByUid = new Map(receipts.map(r => [r.uid, r]));

    let hints = '';
    if (stats.priceHint) {
      hints += stats.priceHint.type === 'warn'
        ? `<div class="hint warn">💸 Zuletzt ${stats.priceHint.pct} % teurer als dein Durchschnitt – vielleicht lohnt ein Preisvergleich.</div>`
        : `<div class="hint good">🎉 Zuletzt ${stats.priceHint.pct} % günstiger als üblich – guter Preis!</div>`;
    }
    if (stats.usageHint) {
      hints += stats.usageHint.type === 'warn'
        ? `<div class="hint warn">⏳ Zuletzt deutlich schneller verbraucht als üblich.</div>`
        : `<div class="hint good">👍 Hält aktuell länger als üblich.</div>`;
    }

    const history = productPurchases.length
      ? `<div class="section-label">Kaufhistorie</div><div class="card">` +
        [...productPurchases].reverse().map(x => {
          const r = x.receiptUid ? receiptByUid.get(x.receiptUid) : null;
          return `
            <div class="row" style="min-height:48px">
              <div class="row-main">
                <div class="row-title" style="font-size:15px">${fmtDate(x.date)}</div>
                ${r && receiptTitle(r) !== 'Kassenbon' ? `<div class="row-sub">${esc(receiptTitle(r))}</div>` : ''}
              </div>
              <div class="row-end">${x.price != null ? fmtEUR(x.price) : '–'}</div>
            </div>`;
        }).join('') + `</div>`
      : `<p class="note">Noch keine Käufe erfasst. Trage einen Kauf nach oder schließe einen Einkauf über die Liste ab.</p>`;

    openSheet(`
      ${sheetHead(displayName(p))}
      ${p.photo ? `<img class="detail-photo" src="${photoURL(p.photo)}" alt="${esc(displayName(p))}">` : ''}
      ${p.aiLabel ? `<p class="note" style="margin:8px 4px">🤖 KI-Erkennung: ${esc(p.aiLabel)}</p>` : ''}
      <div class="stat-grid">
        <div class="stat-tile"><div class="value">${fmtEUR(stats.lastPrice)}</div><div class="label">Letzter Preis</div></div>
        <div class="stat-tile"><div class="value">${fmtEUR(stats.avgPrice)}</div><div class="label">Ø Preis</div></div>
        <div class="stat-tile"><div class="value">${stats.avgIntervalDays ? '~' + fmtDays(stats.avgIntervalDays) : '–'}</div><div class="label">Hält im Schnitt</div></div>
        <div class="stat-tile"><div class="value">${stats.costPerMonth != null ? '≈ ' + fmtEUR(stats.costPerMonth) : '–'}</div><div class="label">Kosten pro Monat</div></div>
      </div>
      ${hints}
      ${history}
      <div style="margin-top:16px">
        ${p.onList
          ? `<button class="btn secondary" data-action="product-unlist" data-id="${p.uid}">Von der Liste nehmen</button>`
          : `<button class="btn" data-action="product-list" data-id="${p.uid}">Auf die Einkaufsliste</button>`}
        <button class="btn secondary" data-action="product-log" data-id="${p.uid}">Kauf nachtragen</button>
        <button class="btn secondary" data-action="product-photo" data-id="${p.uid}">Foto ändern</button>
        <button class="btn secondary" data-action="product-rename" data-id="${p.uid}">Umbenennen</button>
        <button class="btn danger" data-action="product-delete" data-id="${p.uid}">Produkt löschen</button>
      </div>
    `);
  }

  function openRenameProduct(uid) {
    const p = productByUid(uid);
    if (!p) return;
    const sheet = openSheet(`
      ${sheetHead('Umbenennen')}
      <div class="field">
        <label for="rn">Name</label>
        <input type="text" id="rn" value="${esc(p.name)}" autocomplete="off">
      </div>
      <button class="btn" id="save">Speichern</button>
    `);
    const input = sheet.querySelector('#rn');
    sheet.querySelector('#save').addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      p.name = name;
      await DB.put('products', p);
      Sync.schedule();
      render();
    });
    setTimeout(() => { input.focus(); input.select(); }, 300);
  }

  function openLogPurchase(uid) {
    const p = productByUid(uid);
    if (!p) return;
    const sheet = openSheet(`
      ${sheetHead('Kauf nachtragen')}
      <p class="note">Du weißt noch, wann du ${esc(displayName(p))} gekauft hast? Trage es hier nach – so werden Haltbarkeit und Prognosen genauer.</p>
      <div class="field">
        <label for="ld">Datum</label>
        <input type="date" id="ld" value="${Stats.todayStr()}" max="${Stats.todayStr()}">
      </div>
      <div class="field">
        <label for="lp">Preis (optional)</label>
        <input type="text" id="lp" inputmode="decimal" placeholder="z. B. 3,49">
      </div>
      <button class="btn" id="save">Kauf speichern</button>
    `);
    sheet.querySelector('#save').addEventListener('click', async () => {
      const date = sheet.querySelector('#ld').value;
      if (!date) return;
      await DB.put('purchases', {
        uid: DB.genUid(),
        productUid: p.uid,
        price: parsePrice(sheet.querySelector('#lp').value),
        date,
        receiptUid: null,
        deleted: 0,
      });
      Sync.schedule();
      await loadData();
      renderView();
      openProductDetail(p.uid);
    });
  }

  /* ----- Einkauf abschließen ----- */

  function openCompletePurchase() {
    const items = products.filter(p => p.onList && p.checked);
    if (!items.length) return;
    const byProduct = purchasesByProduct();
    const ai = aiOn();
    let receiptBlob = null;

    const sheet = openSheet(`
      ${sheetHead('Einkauf abschließen')}
      <div class="field">
        <button type="button" class="photo-pick" id="rp" style="aspect-ratio:auto;height:110px">
          <span class="cam-emoji">🧾</span>
          <span>Kassenbon fotografieren${ai ? ' – KI liest die Preise' : ' (optional)'}</span>
        </button>
      </div>
      <div class="field">
        <label for="store">Geschäft (optional)</label>
        <input type="text" id="store" placeholder="z. B. Rewe" autocomplete="off">
      </div>
      <div class="field">
        <label for="pd">Datum</label>
        <input type="date" id="pd" value="${Stats.todayStr()}" max="${Stats.todayStr()}">
      </div>
      <div class="section-label">Preise${ai ? ' (leer lassen = KI liest sie vom Bon)' : ' vom Bon (optional)'}</div>
      <div class="card">
        ${items.map(p => {
          const stats = Stats.productStats(byProduct.get(p.uid) || []);
          return `
            <div class="price-row">
              ${thumbHTML(p.photo, '🧺')}
              <div class="row-main"><div class="row-title" style="font-size:15px">${esc(displayName(p))}</div></div>
              <input class="price-input" data-pid="${p.uid}" inputmode="decimal"
                     placeholder="${stats.lastPrice != null ? stats.lastPrice.toFixed(2).replace('.', ',') : '0,00'}">
              <span class="currency-suffix">€</span>
            </div>`;
        }).join('')}
      </div>
      <p class="note">${ai
        ? 'Mit Bon-Foto trägt die KI fehlende Preise automatisch nach, sobald der Server den Bon gelesen hat.'
        : 'Preise kannst du auch weglassen – dann merkt sich ShopList nur das Kaufdatum für die Haltbarkeit.'}</p>
      <button class="btn" id="save" style="margin-top:8px">Einkauf speichern</button>
    `);

    const photoBtn = sheet.querySelector('#rp');
    photoBtn.addEventListener('click', async () => {
      const file = await pickImage();
      if (!file) return;
      receiptBlob = await resizeImage(file, 1600, 0.85);
      photoBtn.classList.add('has-photo');
      photoBtn.innerHTML = `<img src="${photoURL(receiptBlob)}" alt="Kassenbon">`;
    });

    sheet.querySelector('#save').addEventListener('click', async () => {
      const date = sheet.querySelector('#pd').value || Stats.todayStr();
      const store = sheet.querySelector('#store').value.trim();
      const priceInputs = [...sheet.querySelectorAll('.price-input')];
      const prices = new Map(priceInputs.map(i => [i.dataset.pid, parsePrice(i.value)]));

      let receiptUid = null;
      if (receiptBlob || store) {
        receiptUid = DB.genUid();
        const entered = [...prices.values()].filter(v => v != null);
        await DB.put('receipts', {
          uid: receiptUid,
          photo: receiptBlob,
          photoRev: receiptBlob ? Date.now() : 0,
          store,
          total: entered.length ? Math.round(entered.reduce((a, b) => a + b, 0) * 100) / 100 : null,
          date,
          parsed: null,
          aiStatus: ai && receiptBlob ? 'pending' : null,
          aiError: null,
          createdAt: Date.now(),
          deleted: 0,
        }, { photoChanged: !!receiptBlob });
      }

      for (const p of items) {
        await DB.put('purchases', {
          uid: DB.genUid(),
          productUid: p.uid,
          price: prices.get(p.uid) ?? null,
          date,
          receiptUid,
          deleted: 0,
        });
        p.onList = 0;
        p.checked = 0;
        await DB.put('products', p);
      }
      Sync.schedule();
      render();
    });
  }

  /* ----- Kassenbon anlegen ----- */

  function openAddReceipt() {
    let receiptBlob = null;
    const selected = new Set();
    const ai = aiOn();

    const sheet = openSheet(`
      ${sheetHead('Kassenbon erfassen')}
      <div class="field">
        <button type="button" class="photo-pick" id="rp">
          <span class="cam-emoji">🧾</span>
          <span>Bon fotografieren oder auswählen</span>
        </button>
      </div>
      ${ai ? `<p class="note">🤖 Die KI liest Geschäft, Datum, Summe und Positionen automatisch, ordnet sie deinen Produkten zu und hakt gekaufte Sachen von der Liste ab. Du kannst die Felder unten deshalb leer lassen.</p>` : ''}
      <div class="field">
        <label for="store">Geschäft (optional)</label>
        <input type="text" id="store" placeholder="z. B. Aldi" autocomplete="off">
      </div>
      <div class="field">
        <label for="rd">Datum</label>
        <input type="date" id="rd" value="${Stats.todayStr()}" max="${Stats.todayStr()}">
      </div>
      <div class="field">
        <label for="rt">Bon-Summe (optional)</label>
        <input type="text" id="rt" inputmode="decimal" placeholder="z. B. 42,80">
      </div>
      ${!ai && products.length ? `
        <div class="section-label">Gekaufte Produkte zuordnen</div>
        <div class="card" id="assign">
          ${products.map(p => `
            <div class="price-row">
              <button class="check" data-assign="${p.uid}" aria-label="Auswählen"></button>
              ${thumbHTML(p.photo, '📦')}
              <div class="row-main"><div class="row-title" style="font-size:15px">${esc(displayName(p))}</div></div>
              <input class="price-input" data-pid="${p.uid}" inputmode="decimal" placeholder="0,00" disabled>
              <span class="currency-suffix">€</span>
            </div>`).join('')}
        </div>
        <p class="note">Wähle die Produkte aus, die auf dem Bon stehen, und trage ihre Preise ein. Daraus berechnet ShopList Haltbarkeit und Kosten.</p>
      ` : ''}
      <button class="btn" id="save" style="margin-top:8px" disabled>Bon speichern</button>
    `);

    const saveBtn = sheet.querySelector('#save');
    const photoBtn = sheet.querySelector('#rp');
    photoBtn.addEventListener('click', async () => {
      const file = await pickImage();
      if (!file) return;
      receiptBlob = await resizeImage(file, 1600, 0.85);
      photoBtn.classList.add('has-photo');
      photoBtn.innerHTML = `<img src="${photoURL(receiptBlob)}" alt="Kassenbon">`;
      saveBtn.disabled = false;
    });

    sheet.querySelectorAll('[data-assign]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.assign;
        const input = sheet.querySelector(`.price-input[data-pid="${pid}"]`);
        if (selected.has(pid)) {
          selected.delete(pid);
          btn.classList.remove('checked');
          input.disabled = true;
        } else {
          selected.add(pid);
          btn.classList.add('checked');
          input.disabled = false;
          input.focus();
        }
      });
    });

    saveBtn.addEventListener('click', async () => {
      if (!receiptBlob) return;
      const date = sheet.querySelector('#rd').value || Stats.todayStr();
      const store = sheet.querySelector('#store').value.trim();
      const total = parsePrice(sheet.querySelector('#rt').value);
      const receiptUid = DB.genUid();

      await DB.put('receipts', {
        uid: receiptUid,
        photo: receiptBlob,
        photoRev: Date.now(),
        store,
        total,
        date,
        parsed: null,
        aiStatus: ai ? 'pending' : null,
        aiError: null,
        createdAt: Date.now(),
        deleted: 0,
      }, { photoChanged: true });

      for (const pid of selected) {
        const input = sheet.querySelector(`.price-input[data-pid="${pid}"]`);
        await DB.put('purchases', {
          uid: DB.genUid(),
          productUid: pid,
          price: parsePrice(input.value),
          date,
          receiptUid,
          deleted: 0,
        });
      }
      Sync.schedule();
      render();
    });
  }

  /* ----- Kassenbon-Detail ----- */

  function openReceiptDetail(uid) {
    const r = receipts.find(x => x.uid === uid);
    if (!r) return;
    const rp = purchases.filter(p => p.receiptUid === r.uid);
    const total = r.total != null ? r.total : (rp.length ? Stats.sumPrices(rp) : null);

    let aiSection = '';
    if (r.aiStatus === 'pending') {
      aiSection = `<div class="hint good">🤖 Der Bon liegt beim Server und wird von der KI gelesen. Ergebnis kommt beim nächsten Sync.</div>`;
    } else if (r.aiStatus === 'error') {
      aiSection = `<div class="hint warn">⚠️ Die KI konnte den Bon nicht lesen${r.aiError ? `: ${esc(r.aiError)}` : '.'} Du kannst Käufe manuell nachtragen.</div>`;
    } else if (r.parsed && r.parsed.items && r.parsed.items.length) {
      aiSection = `<div class="section-label">Vom Bon gelesen (KI)</div><div class="card">` +
        r.parsed.items.map(item => {
          const p = item.productUid ? productByUid(item.productUid) : null;
          return `
            <div class="row" style="min-height:44px" ${p ? `data-action="open-product" data-id="${p.uid}"` : ''}>
              <div class="row-main">
                <div class="row-title" style="font-size:14px">${esc(item.text)}</div>
                ${p ? `<div class="row-sub">→ ${esc(displayName(p))}</div>` : `<div class="row-sub" style="color:var(--text-3)">kein passendes Produkt</div>`}
              </div>
              <div class="row-end">${item.price != null ? fmtEUR(item.price) : ''}</div>
            </div>`;
        }).join('') + `</div>`;
    }

    openSheet(`
      ${sheetHead(receiptTitle(r))}
      <p class="note" style="margin-top:0">${fmtDate(r.date)}${total != null ? ` · Summe ${fmtEUR(total)}` : ''}</p>
      ${aiSection}
      ${r.photo ? `<img class="receipt-photo" src="${photoURL(r.photo)}" alt="Kassenbon">` : ''}
      ${rp.length ? `
        <div class="section-label">Verbuchte Käufe</div>
        <div class="card">
          ${rp.map(x => {
            const p = productByUid(x.productUid);
            return `
              <div class="row" style="min-height:48px" ${p ? `data-action="open-product" data-id="${p.uid}"` : ''}>
                <div class="row-main"><div class="row-title" style="font-size:15px">${esc(p ? displayName(p) : 'Gelöschtes Produkt')}</div></div>
                <div class="row-end">${x.price != null ? fmtEUR(x.price) : '–'}</div>
              </div>`;
          }).join('')}
        </div>` : ''}
      <div style="margin-top:16px">
        <button class="btn danger" data-action="receipt-delete" data-id="${r.uid}">Bon löschen</button>
      </div>
      <p class="note">Beim Löschen bleiben verbuchte Käufe (Preise &amp; Daten) erhalten.</p>
    `);
  }

  /* ---------- Aktionen (Event-Delegation) ---------- */

  const confirmPending = new Set();

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const uid = el.dataset.id || null;

    switch (action) {
      case 'close-sheet':
        closeSheet();
        break;

      case 'toggle-check': {
        e.stopPropagation();
        const p = productByUid(uid);
        if (!p) return;
        p.checked = p.checked ? 0 : 1;
        await DB.put('products', p);
        Sync.schedule();
        render();
        break;
      }

      case 'quick-add': {
        e.stopPropagation();
        const p = productByUid(uid);
        if (!p) return;
        p.onList = 1;
        p.checked = 0;
        await DB.put('products', p);
        Sync.schedule();
        render();
        break;
      }

      case 'open-product':
        if (e.target.closest('.check') || e.target.closest('.icon-btn')) return;
        openProductDetail(uid);
        break;

      case 'open-receipt':
        openReceiptDetail(uid);
        break;

      case 'complete-purchase':
        openCompletePurchase();
        break;

      case 'product-list': {
        const p = productByUid(uid);
        if (!p) return;
        p.onList = 1;
        p.checked = 0;
        await DB.put('products', p);
        Sync.schedule();
        state.tab = 'list';
        render();
        break;
      }

      case 'product-unlist': {
        const p = productByUid(uid);
        if (!p) return;
        p.onList = 0;
        p.checked = 0;
        await DB.put('products', p);
        Sync.schedule();
        render();
        break;
      }

      case 'product-log':
        openLogPurchase(uid);
        break;

      case 'product-rename':
        openRenameProduct(uid);
        break;

      case 'product-photo': {
        const p = productByUid(uid);
        if (!p) return;
        const file = await pickImage();
        if (!file) return;
        p.photo = await resizeImage(file);
        p.photoRev = Date.now();
        if (aiOn()) p.aiStatus = 'pending';
        await DB.put('products', p, { photoChanged: true });
        Sync.schedule();
        await loadData();
        renderView();
        openProductDetail(uid);
        break;
      }

      case 'product-delete': {
        if (!confirmPending.has(`product-${uid}`)) {
          confirmPending.add(`product-${uid}`);
          el.textContent = 'Wirklich löschen? (inkl. Kaufhistorie)';
          setTimeout(() => {
            confirmPending.delete(`product-${uid}`);
            if (el.isConnected) el.textContent = 'Produkt löschen';
          }, 3000);
          return;
        }
        confirmPending.delete(`product-${uid}`);
        for (const x of purchases.filter(p => p.productUid === uid)) {
          await DB.softDelete('purchases', x);
        }
        const p = productByUid(uid);
        if (p) await DB.softDelete('products', p);
        Sync.schedule();
        render();
        break;
      }

      case 'receipt-delete': {
        if (!confirmPending.has(`receipt-${uid}`)) {
          confirmPending.add(`receipt-${uid}`);
          el.textContent = 'Wirklich löschen?';
          setTimeout(() => {
            confirmPending.delete(`receipt-${uid}`);
            if (el.isConnected) el.textContent = 'Bon löschen';
          }, 3000);
          return;
        }
        confirmPending.delete(`receipt-${uid}`);
        for (const x of purchases.filter(p => p.receiptUid === uid)) {
          x.receiptUid = null;
          await DB.put('purchases', x);
        }
        const r = receipts.find(x => x.uid === uid);
        if (r) await DB.softDelete('receipts', r);
        Sync.schedule();
        render();
        break;
      }

      case 'stats-kind':
        state.statsKind = el.dataset.kind;
        state.statsOffset = 0;
        render();
        break;

      case 'stats-nav':
        state.statsOffset += Number(el.dataset.dir);
        render();
        break;

      case 'chart-col':
        state.statsOffset = Number(el.dataset.off);
        render();
        break;
    }
  });

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      state.tab = t.dataset.tab;
      render();
    });
  });

  headerAction.addEventListener('click', () => {
    if (state.tab === 'list') openAddProduct(true);
    else if (state.tab === 'products') openAddProduct(false);
    else if (state.tab === 'receipts') openAddReceipt();
  });

  syncDot.addEventListener('click', () => Sync.syncNow());

  render().then(() => {
    Sync.start({
      onChange: refreshAfterSync,
      onStatus: updateSyncDot,
    });
  });
})();
