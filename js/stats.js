/*
 * Auswertungen: Preis- und Verbrauchsstatistik pro Produkt,
 * Zeiträume (Woche/Monat/Jahr) und Ausgaben-Prognosen.
 */
const Stats = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const AVG_MONTH_DAYS = 30.44;

  // 'YYYY-MM-DD' → Date (mittags, um Zeitzonen-Kippeffekte zu vermeiden)
  function parseDate(s) {
    return new Date(s + 'T12:00:00');
  }

  function todayStr(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /**
   * Statistik für ein Produkt aus seinen Käufen.
   * Käufe mit Preis fließen in Preis-Werte ein, alle Käufe in die Intervalle.
   */
  function productStats(purchases) {
    const sorted = [...purchases].sort((a, b) => a.date.localeCompare(b.date));
    const prices = sorted.filter(p => p.price != null).map(p => p.price);
    const stats = {
      count: sorted.length,
      lastDate: sorted.length ? sorted[sorted.length - 1].date : null,
      lastPrice: prices.length ? prices[prices.length - 1] : null,
      avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      avgIntervalDays: null,
      lastIntervalDays: null,
      costPerDay: null,
      costPerMonth: null,
      priceHint: null,
      usageHint: null,
    };

    if (sorted.length >= 2) {
      const intervals = [];
      for (let i = 1; i < sorted.length; i++) {
        const days = Math.round((parseDate(sorted[i].date) - parseDate(sorted[i - 1].date)) / DAY);
        if (days > 0) intervals.push(days);
      }
      if (intervals.length) {
        stats.avgIntervalDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        stats.lastIntervalDays = intervals[intervals.length - 1];
      }
    }

    if (stats.avgPrice != null && stats.avgIntervalDays) {
      stats.costPerDay = stats.avgPrice / stats.avgIntervalDays;
      stats.costPerMonth = stats.costPerDay * AVG_MONTH_DAYS;
    }

    // Hinweis: zuletzt deutlich mehr bezahlt als üblich?
    if (stats.lastPrice != null && stats.avgPrice != null && prices.length >= 3) {
      const ratio = stats.lastPrice / stats.avgPrice;
      if (ratio >= 1.15) {
        stats.priceHint = { type: 'warn', pct: Math.round((ratio - 1) * 100) };
      } else if (ratio <= 0.85) {
        stats.priceHint = { type: 'good', pct: Math.round((1 - ratio) * 100) };
      }
    }

    // Hinweis: zuletzt deutlich schneller verbraucht als üblich?
    if (stats.lastIntervalDays != null && stats.avgIntervalDays != null && sorted.length >= 4) {
      const ratio = stats.lastIntervalDays / stats.avgIntervalDays;
      if (ratio <= 0.72) stats.usageHint = { type: 'warn' };
      else if (ratio >= 1.3) stats.usageHint = { type: 'good' };
    }

    return stats;
  }

  /**
   * Zeitraum bestimmen: kind = 'week' | 'month' | 'year',
   * offset = 0 (aktuell), negativ (Vergangenheit), positiv (Zukunft).
   * Liefert { start:Date, end:Date (exklusiv), label, days, future }.
   */
  function periodRange(kind, offset, now = new Date()) {
    let start, end, label;
    if (kind === 'week') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dow = (d.getDay() + 6) % 7; // Montag = 0
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow + offset * 7);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      const fmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
      const endIncl = new Date(end - DAY);
      label = `${fmt.format(start)} – ${fmt.format(endIncl)}`;
    } else if (kind === 'month') {
      start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
      label = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(start);
    } else {
      start = new Date(now.getFullYear() + offset, 0, 1);
      end = new Date(now.getFullYear() + offset + 1, 0, 1);
      label = String(start.getFullYear());
    }
    return {
      start, end, label,
      days: Math.round((end - start) / DAY),
      future: start > now,
    };
  }

  function shortPeriodLabel(kind, range) {
    if (kind === 'week') {
      return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric' }).format(range.start);
    }
    if (kind === 'month') {
      return new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(range.start);
    }
    return String(range.start.getFullYear());
  }

  function purchasesIn(purchases, range) {
    return purchases.filter(p => {
      const d = parseDate(p.date);
      return d >= range.start && d < range.end;
    });
  }

  function sumPrices(purchases) {
    return purchases.reduce((sum, p) => sum + (p.price || 0), 0);
  }

  /**
   * Prognose: Summe über alle wiederkehrenden Produkte (≥2 Käufe mit Preis)
   * von Tageskosten × Zeitraumlänge. Liefert { total, items:[{productId, amount}] }.
   */
  function projection(products, purchasesByProduct, days) {
    const items = [];
    let total = 0;
    for (const product of products) {
      const stats = productStats(purchasesByProduct.get(product.uid) || []);
      if (stats.costPerDay != null) {
        const amount = stats.costPerDay * days;
        items.push({ productUid: product.uid, amount, stats });
        total += amount;
      }
    }
    items.sort((a, b) => b.amount - a.amount);
    return { total, items };
  }

  return { parseDate, todayStr, productStats, periodRange, shortPeriodLabel, purchasesIn, sumPrices, projection, AVG_MONTH_DAYS };
})();
