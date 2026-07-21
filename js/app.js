/* ShopList – Einkaufsliste mit Fotos, Kassenbons und Ausgaben-Statistik. */
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

  /* ---------- Daten ---------- */

  async function loadData() {
    [products, purchases, receipts] = await Promise.all([
      DB.getAll('products'),
      DB.getAll('purchases'),
      DB.getAll('receipts'),
    ]);
    products.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    purchases.sort((a, b) => a.date.localeCompare(b.date));
    receipts.sort((a, b) => b.date.localeCompare(a.date));
  }

  function purchasesByProduct() {
    const map = new Map();
    for (const p of purchases) {
      if (!map.has(p.productId)) map.set(p.productId, []);
      map.get(p.productId).push(p);
    }
    return map;
  }

  function productById(id) {
    return products.find(p => p.id === id);
  }

  /* ---------- Rendern ---------- */

  async function render() {
    revokeURLs();
    closeSheet();
    await loadData();

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

  /* ----- Einkaufsliste ----- */

  function renderList() {
    const byProduct = purchasesByProduct();
    const items = products.filter(p => p.onList);
    items.sort((a, b) => (a.checked - b.checked) || a.name.localeCompare(b.name, 'de'));
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
        const stats = Stats.productStats(byProduct.get(p.id) || []);
        const sub = stats.lastPrice != null
          ? `Zuletzt ${fmtEUR(stats.lastPrice)}${stats.avgIntervalDays ? ` · hält ~${fmtDays(stats.avgIntervalDays)}` : ''}`
          : 'Noch kein Preis erfasst';
        return `
          <div class="row ${p.checked ? 'done' : ''}" data-action="open-product" data-id="${p.id}">
            <button class="check ${p.checked ? 'checked' : ''}" data-action="toggle-check" data-id="${p.id}" aria-label="Abhaken"></button>
            ${thumbHTML(p.photo, '🧺')}
            <div class="row-main">
              <div class="row-title">${esc(p.name)}</div>
              <div class="row-sub">${sub}</div>
            </div>
          </div>`;
      }).join('') + `</div>`;
    }

    if (others.length) {
      html += `<div class="section-label">Wieder kaufen?</div><div class="card">` + others.map(p => `
        <div class="row" data-action="open-product" data-id="${p.id}">
          ${thumbHTML(p.photo, '📦')}
          <div class="row-main"><div class="row-title">${esc(p.name)}</div></div>
          <button class="icon-btn" data-action="quick-add" data-id="${p.id}" aria-label="Auf die Liste">
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
      const stats = Stats.productStats(byProduct.get(p.id) || []);
      let sub;
      if (!stats.count) sub = 'Noch keine Käufe erfasst';
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
        <div class="row" data-action="open-product" data-id="${p.id}">
          ${thumbHTML(p.photo, '📦')}
          <div class="row-main">
            <div class="row-title">${esc(p.name)}</div>
            <div class="row-sub">${sub}</div>
          </div>
          ${end}
        </div>`;
    }).join('') + `</div>`;
  }

  /* ----- Kassenbons ----- */

  function renderReceipts() {
    if (!receipts.length) {
      view.innerHTML = `
        <div class="empty">
          <span class="emoji">🧾</span>
          <h2>Noch keine Kassenbons</h2>
          <p>Fotografiere nach dem Einkauf deinen Bon und trage die Preise ein. So weiß ShopList, was deine Produkte kosten und wie lange sie halten.</p>
        </div>`;
      return;
    }

    view.innerHTML = `<div class="card">` + receipts.map(r => {
      const rp = purchases.filter(p => p.receiptId === r.id);
      const total = r.total != null ? r.total : (rp.length ? Stats.sumPrices(rp) : null);
      const names = rp.map(p => productById(p.productId)?.name).filter(Boolean);
      const sub = names.length
        ? `${fmtDate(r.date)} · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`
        : fmtDate(r.date);
      return `
        <div class="row" data-action="open-receipt" data-id="${r.id}">
          ${thumbHTML(r.photo, '🧾')}
          <div class="row-main">
            <div class="row-title">${esc(r.store || 'Kassenbon')}</div>
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

    // Balkendiagramm: 5 Perioden zurück bis 1 in die Zukunft
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

    // Aufschlüsselung
    let breakdown = '';
    if (range.future) {
      if (proj.items.length) {
        breakdown = `<div class="section-label">Prognose nach Produkt</div><div class="card">` +
          proj.items.map(item => {
            const p = productById(item.productId);
            if (!p) return '';
            return `
              <div class="row" data-action="open-product" data-id="${p.id}">
                ${thumbHTML(p.photo, '📦')}
                <div class="row-main">
                  <div class="row-title">${esc(p.name)}</div>
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
        sums.set(p.productId, (sums.get(p.productId) || 0) + (p.price || 0));
      }
      const rows = [...sums.entries()].sort((a, b) => b[1] - a[1]);
      if (rows.length) {
        breakdown = `<div class="section-label">Ausgaben nach Produkt</div><div class="card">` +
          rows.map(([pid, sum]) => {
            const p = productById(pid);
            if (!p) return '';
            const count = inRange.filter(x => x.productId === pid).length;
            return `
              <div class="row" data-action="open-product" data-id="${p.id}">
                ${thumbHTML(p.photo, '📦')}
                <div class="row-main">
                  <div class="row-title">${esc(p.name)}</div>
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
    const sheet = openSheet(`
      ${sheetHead('Produkt hinzufügen')}
      <div class="field">
        <button type="button" class="photo-pick" id="pp">
          <span class="cam-emoji">📷</span>
          <span>Foto aufnehmen oder auswählen</span>
        </button>
      </div>
      <div class="field">
        <label for="np">Name</label>
        <input type="text" id="np" placeholder="z. B. Weichspüler" autocomplete="off">
      </div>
      <button class="btn" id="save" disabled>${toList ? 'Auf die Einkaufsliste setzen' : 'Produkt speichern'}</button>
    `);

    const nameInput = sheet.querySelector('#np');
    const saveBtn = sheet.querySelector('#save');
    const photoBtn = sheet.querySelector('#pp');

    nameInput.addEventListener('input', () => {
      saveBtn.disabled = !nameInput.value.trim();
    });

    photoBtn.addEventListener('click', async () => {
      const file = await pickImage();
      if (!file) return;
      photoBlob = await resizeImage(file);
      photoBtn.classList.add('has-photo');
      photoBtn.innerHTML = `<img src="${photoURL(photoBlob)}" alt="Produktfoto">`;
    });

    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      await DB.add('products', {
        name,
        photo: photoBlob,
        onList: toList ? 1 : 0,
        checked: 0,
        createdAt: Date.now(),
      });
      render();
    });

    setTimeout(() => nameInput.focus(), 300);
  }

  /* ----- Produkt-Detail ----- */

  function openProductDetail(id) {
    const p = productById(id);
    if (!p) return;
    const productPurchases = (purchasesByProduct().get(id) || []);
    const stats = Stats.productStats(productPurchases);
    const receiptById = new Map(receipts.map(r => [r.id, r]));

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
          const r = x.receiptId != null ? receiptById.get(x.receiptId) : null;
          return `
            <div class="row" style="min-height:48px">
              <div class="row-main">
                <div class="row-title" style="font-size:15px">${fmtDate(x.date)}</div>
                ${r && r.store ? `<div class="row-sub">${esc(r.store)}</div>` : ''}
              </div>
              <div class="row-end">${x.price != null ? fmtEUR(x.price) : '–'}</div>
            </div>`;
        }).join('') + `</div>`
      : `<p class="note">Noch keine Käufe erfasst. Trage einen Kauf nach oder schließe einen Einkauf über die Liste ab.</p>`;

    openSheet(`
      ${sheetHead(p.name)}
      ${p.photo ? `<img class="detail-photo" src="${photoURL(p.photo)}" alt="${esc(p.name)}">` : ''}
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
          ? `<button class="btn secondary" data-action="product-unlist" data-id="${p.id}">Von der Liste nehmen</button>`
          : `<button class="btn" data-action="product-list" data-id="${p.id}">Auf die Einkaufsliste</button>`}
        <button class="btn secondary" data-action="product-log" data-id="${p.id}">Kauf nachtragen</button>
        <button class="btn secondary" data-action="product-photo" data-id="${p.id}">Foto ändern</button>
        <button class="btn secondary" data-action="product-rename" data-id="${p.id}">Umbenennen</button>
        <button class="btn danger" data-action="product-delete" data-id="${p.id}">Produkt löschen</button>
      </div>
    `);
  }

  function openRenameProduct(id) {
    const p = productById(id);
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
      render();
    });
    setTimeout(() => { input.focus(); input.select(); }, 300);
  }

  function openLogPurchase(id) {
    const p = productById(id);
    if (!p) return;
    const sheet = openSheet(`
      ${sheetHead('Kauf nachtragen')}
      <p class="note">Du weißt noch, wann du ${esc(p.name)} gekauft hast? Trage es hier nach – so werden Haltbarkeit und Prognosen genauer.</p>
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
      await DB.add('purchases', {
        productId: p.id,
        price: parsePrice(sheet.querySelector('#lp').value),
        date,
        receiptId: null,
      });
      openProductDetailAfterReload(p.id);
    });
  }

  // Daten neu laden, die Ansicht im Hintergrund aktualisieren und das
  // Produkt-Sheet wieder öffnen (z. B. nach "Kauf nachtragen").
  async function openProductDetailAfterReload(id) {
    await loadData();
    if (state.tab === 'list') renderList();
    else if (state.tab === 'products') renderProducts();
    else if (state.tab === 'receipts') renderReceipts();
    else renderStats();
    openProductDetail(id);
  }

  /* ----- Einkauf abschließen ----- */

  function openCompletePurchase() {
    const items = products.filter(p => p.onList && p.checked);
    if (!items.length) return;
    const byProduct = purchasesByProduct();
    let receiptBlob = null;

    const sheet = openSheet(`
      ${sheetHead('Einkauf abschließen')}
      <div class="field">
        <button type="button" class="photo-pick" id="rp" style="aspect-ratio:auto;height:110px">
          <span class="cam-emoji">🧾</span>
          <span>Kassenbon fotografieren (optional)</span>
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
      <div class="section-label">Preise vom Bon (optional)</div>
      <div class="card">
        ${items.map(p => {
          const stats = Stats.productStats(byProduct.get(p.id) || []);
          return `
            <div class="price-row">
              ${thumbHTML(p.photo, '🧺')}
              <div class="row-main"><div class="row-title" style="font-size:15px">${esc(p.name)}</div></div>
              <input class="price-input" data-pid="${p.id}" inputmode="decimal"
                     placeholder="${stats.lastPrice != null ? stats.lastPrice.toFixed(2).replace('.', ',') : '0,00'}">
              <span class="currency-suffix">€</span>
            </div>`;
        }).join('')}
      </div>
      <p class="note">Preise kannst du auch weglassen – dann merkt sich ShopList nur das Kaufdatum für die Haltbarkeit.</p>
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
      const prices = new Map(priceInputs.map(i => [Number(i.dataset.pid), parsePrice(i.value)]));

      let receiptId = null;
      if (receiptBlob || store) {
        const entered = [...prices.values()].filter(v => v != null);
        receiptId = await DB.add('receipts', {
          photo: receiptBlob,
          store,
          total: entered.length ? Math.round(entered.reduce((a, b) => a + b, 0) * 100) / 100 : null,
          date,
          createdAt: Date.now(),
        });
      }

      for (const p of items) {
        await DB.add('purchases', {
          productId: p.id,
          price: prices.get(p.id) ?? null,
          date,
          receiptId,
        });
        p.onList = 0;
        p.checked = 0;
        await DB.put('products', p);
      }
      render();
    });
  }

  /* ----- Kassenbon anlegen ----- */

  function openAddReceipt() {
    let receiptBlob = null;
    const selected = new Set();

    const sheet = openSheet(`
      ${sheetHead('Kassenbon erfassen')}
      <div class="field">
        <button type="button" class="photo-pick" id="rp">
          <span class="cam-emoji">🧾</span>
          <span>Bon fotografieren oder auswählen</span>
        </button>
      </div>
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
      ${products.length ? `
        <div class="section-label">Gekaufte Produkte zuordnen</div>
        <div class="card" id="assign">
          ${products.map(p => `
            <div class="price-row">
              <button class="check" data-assign="${p.id}" aria-label="Auswählen"></button>
              ${thumbHTML(p.photo, '📦')}
              <div class="row-main"><div class="row-title" style="font-size:15px">${esc(p.name)}</div></div>
              <input class="price-input" data-pid="${p.id}" inputmode="decimal" placeholder="0,00" disabled>
              <span class="currency-suffix">€</span>
            </div>`).join('')}
        </div>
        <p class="note">Wähle die Produkte aus, die auf dem Bon stehen, und trage ihre Preise ein. Daraus berechnet ShopList Haltbarkeit und Kosten.</p>
      ` : `<p class="note">Lege zuerst Produkte an, um Bon-Positionen zuzuordnen.</p>`}
      <button class="btn" id="save" style="margin-top:8px">Bon speichern</button>
    `);

    const photoBtn = sheet.querySelector('#rp');
    photoBtn.addEventListener('click', async () => {
      const file = await pickImage();
      if (!file) return;
      receiptBlob = await resizeImage(file, 1600, 0.85);
      photoBtn.classList.add('has-photo');
      photoBtn.innerHTML = `<img src="${photoURL(receiptBlob)}" alt="Kassenbon">`;
    });

    sheet.querySelectorAll('[data-assign]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = Number(btn.dataset.assign);
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

    sheet.querySelector('#save').addEventListener('click', async () => {
      const date = sheet.querySelector('#rd').value || Stats.todayStr();
      const store = sheet.querySelector('#store').value.trim();
      const total = parsePrice(sheet.querySelector('#rt').value);

      const receiptId = await DB.add('receipts', {
        photo: receiptBlob,
        store,
        total,
        date,
        createdAt: Date.now(),
      });

      for (const pid of selected) {
        const input = sheet.querySelector(`.price-input[data-pid="${pid}"]`);
        await DB.add('purchases', {
          productId: pid,
          price: parsePrice(input.value),
          date,
          receiptId,
        });
      }
      render();
    });
  }

  /* ----- Kassenbon-Detail ----- */

  function openReceiptDetail(id) {
    const r = receipts.find(x => x.id === id);
    if (!r) return;
    const rp = purchases.filter(p => p.receiptId === r.id);
    const total = r.total != null ? r.total : (rp.length ? Stats.sumPrices(rp) : null);

    openSheet(`
      ${sheetHead(r.store || 'Kassenbon')}
      <p class="note" style="margin-top:0">${fmtDate(r.date)}${total != null ? ` · Summe ${fmtEUR(total)}` : ''}</p>
      ${r.photo ? `<img class="receipt-photo" src="${photoURL(r.photo)}" alt="Kassenbon">` : ''}
      ${rp.length ? `
        <div class="section-label">Verbuchte Käufe</div>
        <div class="card">
          ${rp.map(x => {
            const p = productById(x.productId);
            return `
              <div class="row" style="min-height:48px" ${p ? `data-action="open-product" data-id="${p.id}"` : ''}>
                <div class="row-main"><div class="row-title" style="font-size:15px">${esc(p ? p.name : 'Gelöschtes Produkt')}</div></div>
                <div class="row-end">${x.price != null ? fmtEUR(x.price) : '–'}</div>
              </div>`;
          }).join('')}
        </div>` : ''}
      <div style="margin-top:16px">
        <button class="btn danger" data-action="receipt-delete" data-id="${r.id}">Bon löschen</button>
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
    const id = el.dataset.id != null ? Number(el.dataset.id) : null;

    switch (action) {
      case 'close-sheet':
        closeSheet();
        break;

      case 'toggle-check': {
        e.stopPropagation();
        const p = productById(id);
        if (!p) return;
        p.checked = p.checked ? 0 : 1;
        await DB.put('products', p);
        render();
        break;
      }

      case 'quick-add': {
        e.stopPropagation();
        const p = productById(id);
        if (!p) return;
        p.onList = 1;
        p.checked = 0;
        await DB.put('products', p);
        render();
        break;
      }

      case 'open-product':
        if (e.target.closest('.check') || e.target.closest('.icon-btn')) return;
        openProductDetail(id);
        break;

      case 'open-receipt':
        openReceiptDetail(id);
        break;

      case 'complete-purchase':
        openCompletePurchase();
        break;

      case 'product-list': {
        const p = productById(id);
        if (!p) return;
        p.onList = 1;
        p.checked = 0;
        await DB.put('products', p);
        state.tab = 'list';
        render();
        break;
      }

      case 'product-unlist': {
        const p = productById(id);
        if (!p) return;
        p.onList = 0;
        p.checked = 0;
        await DB.put('products', p);
        render();
        break;
      }

      case 'product-log':
        openLogPurchase(id);
        break;

      case 'product-rename':
        openRenameProduct(id);
        break;

      case 'product-photo': {
        const p = productById(id);
        if (!p) return;
        const file = await pickImage();
        if (!file) return;
        p.photo = await resizeImage(file);
        await DB.put('products', p);
        openProductDetailAfterReload(id);
        break;
      }

      case 'product-delete': {
        if (!confirmPending.has(`product-${id}`)) {
          confirmPending.add(`product-${id}`);
          el.textContent = 'Wirklich löschen? (inkl. Kaufhistorie)';
          setTimeout(() => {
            confirmPending.delete(`product-${id}`);
            if (el.isConnected) el.textContent = 'Produkt löschen';
          }, 3000);
          return;
        }
        confirmPending.delete(`product-${id}`);
        for (const x of purchases.filter(p => p.productId === id)) {
          await DB.del('purchases', x.id);
        }
        await DB.del('products', id);
        render();
        break;
      }

      case 'receipt-delete': {
        if (!confirmPending.has(`receipt-${id}`)) {
          confirmPending.add(`receipt-${id}`);
          el.textContent = 'Wirklich löschen?';
          setTimeout(() => {
            confirmPending.delete(`receipt-${id}`);
            if (el.isConnected) el.textContent = 'Bon löschen';
          }, 3000);
          return;
        }
        confirmPending.delete(`receipt-${id}`);
        for (const x of purchases.filter(p => p.receiptId === id)) {
          x.receiptId = null;
          await DB.put('purchases', x);
        }
        await DB.del('receipts', id);
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

  render();
})();
