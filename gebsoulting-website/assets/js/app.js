(function () {
  "use strict";

  var CFG = window.GEBSOULTING_CONFIG || {};
  var DATA = window.GEBSOULTING_DATA || { deals: [], team: [], branchen: [] };
  var VIEWS = ["start", "leistungen", "deals", "ueber-uns", "kontakt", "impressum", "datenschutz"];
  var DRAFT_KEY = "gebsoulting-contact-draft";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- Unternehmensdaten einsetzen ---------- */
  function fillConfig() {
    var values = {
      legalName: CFG.legalName,
      representative: CFG.representative,
      email: CFG.email,
      phone: CFG.phone,
      hours: CFG.hours,
      register: CFG.register,
      vatId: CFG.vatId,
      addressHtml: (CFG.address || []).map(esc).join("<br>")
    };
    $all("[data-cfg]").forEach(function (el) {
      var key = el.getAttribute("data-cfg");
      if (!(key in values)) return;
      if (key === "addressHtml") el.innerHTML = values[key];
      else el.textContent = values[key] || "";
    });
    var year = $("#year");
    if (year) year.textContent = new Date().getFullYear();
  }

  /* ---------- Deals (Tombstones) ---------- */
  function tombstone(d) {
    return (
      '<article class="tombstone" data-art="' + esc(d.art) + '">' +
        (d.platzhalter && CFG.showPlaceholderNotice ? '<span class="chip-example">Beispiel</span>' : "") +
        '<p class="ts-kicker">' + esc(d.art) + "</p>" +
        '<p class="ts-party">' + esc(d.partei) + "</p>" +
        '<p class="ts-verb">' + esc(d.aktion) + "</p>" +
        (d.gegenpartei ? '<p class="ts-party ts-party-sm">' + esc(d.gegenpartei) + "</p>" : "") +
        '<p class="ts-role">Gebsoulting: ' + esc(d.rolle) + "</p>" +
        '<div class="ts-foot"><span>' + esc(d.branche) + "</span><span>" + esc(d.jahr) + "</span></div>" +
      "</article>"
    );
  }

  function renderDeals() {
    var teaser = $("#deals-teaser");
    if (teaser) {
      var limit = parseInt(teaser.getAttribute("data-limit"), 10) || 3;
      teaser.innerHTML = DATA.deals.slice(0, limit).map(tombstone).join("");
    }

    var all = $("#deals-all");
    var filter = $("#deal-filter");
    if (!all || !filter) return;

    var hasPlaceholder = DATA.deals.some(function (d) { return d.platzhalter; });
    var notice = $("#deals-notice");
    if (notice) notice.hidden = !(hasPlaceholder && CFG.showPlaceholderNotice);

    var arts = [];
    DATA.deals.forEach(function (d) { if (arts.indexOf(d.art) === -1) arts.push(d.art); });
    var options = ["Alle"].concat(arts);
    filter.innerHTML = options.map(function (a, i) {
      return '<button type="button" class="chip" id="deal-filter-' + i + '" data-filter="' + esc(a) + '" aria-pressed="' + (i === 0) + '">' + esc(a) + "</button>";
    }).join("");

    function apply(art) {
      var list = art === "Alle" ? DATA.deals : DATA.deals.filter(function (d) { return d.art === art; });
      all.innerHTML = list.map(tombstone).join("");
      $all(".chip", filter).forEach(function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-filter") === art));
      });
    }
    filter.addEventListener("click", function (e) {
      var btn = e.target.closest(".chip");
      if (btn) apply(btn.getAttribute("data-filter"));
    });
    apply("Alle");

    var ind = $("#industries");
    if (ind) ind.innerHTML = DATA.branchen.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("");
  }

  /* ---------- Team ---------- */
  function initials(name) {
    var clean = String(name).replace(/[\[\]]/g, "").trim();
    if (!clean || clean.toLowerCase() === "name") return "G";
    return clean.split(/\s+/).map(function (p) { return p.charAt(0); }).slice(0, 2).join("").toUpperCase();
  }
  function renderTeam() {
    var el = $("#team");
    if (!el) return;
    el.innerHTML = DATA.team.map(function (p) {
      return (
        '<article class="person">' +
          '<div class="person-avatar" aria-hidden="true">' + esc(initials(p.name)) + "</div>" +
          "<div>" +
            '<h3 class="h4">' + esc(p.name) + (p.platzhalter && CFG.showPlaceholderNotice ? ' <span class="chip-example chip-inline">Platzhalter</span>' : "") + "</h3>" +
            '<p class="person-role">' + esc(p.rolle) + "</p>" +
            "<p>" + esc(p.text) + "</p>" +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  /* ---------- Navigation (Hash-Routing) ---------- */
  function viewFromHash() {
    var h = (location.hash || "").replace(/^#/, "");
    return VIEWS.indexOf(h) !== -1 ? h : null;
  }

  function show(view, scroll) {
    $all(".view").forEach(function (sec) {
      sec.hidden = sec.getAttribute("data-view") !== view;
    });
    $all("[data-nav]").forEach(function (a) {
      if (a.getAttribute("data-nav") === view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    var sec = $('.view[data-view="' + view + '"]');
    if (sec && sec.getAttribute("data-title")) document.title = sec.getAttribute("data-title");
    closeNav();
    if (scroll) window.scrollTo(0, 0);
  }

  function initRouting() {
    // Nur Hashes, die eine Seite benennen, wechseln die Ansicht; andere (z. B. #main) springen normal.
    window.addEventListener("hashchange", function () {
      var v = viewFromHash();
      if (v) show(v, true);
    });
    show(viewFromHash() || "start", false);
  }

  /* ---------- Mobiles Menü ---------- */
  function closeNav() {
    var btn = $("#nav-toggle");
    if (!btn) return;
    btn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("nav-open");
  }
  function initNav() {
    var btn = $("#nav-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("nav-open", open);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeNav(); });
  }

  /* ---------- Kopieren ---------- */
  function copyText(text, btn) {
    function done(ok) {
      var old = btn.getAttribute("data-label") || btn.textContent;
      btn.setAttribute("data-label", old);
      btn.textContent = ok ? "Kopiert" : "Markiert";
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    function selectFallback() {
      var target = btn.previousElementSibling;
      if (target) {
        var range = document.createRange();
        range.selectNodeContents(target);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      done(false);
    }
    try {
      navigator.clipboard.writeText(text).then(function () { done(true); }, selectFallback);
    } catch (e) { selectFallback(); }
  }
  function initCopy() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-copy-cfg], [data-copy-target]");
      if (!btn) return;
      var text = btn.hasAttribute("data-copy-cfg")
        ? CFG[btn.getAttribute("data-copy-cfg")]
        : ($(btn.getAttribute("data-copy-target")) || {}).textContent;
      copyText(text || "", btn);
    });
  }

  /* ---------- Kontaktformular ---------- */
  function initForm() {
    var form = $("#contact-form");
    if (!form) return;
    var status = $("#cf-status");
    var submit = $("#cf-submit");
    var fields = ["name", "company", "email", "phone", "topic", "message"];

    // Entwurf wiederherstellen (nur in diesem Browser)
    try {
      var draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (draft) fields.forEach(function (f) { if (draft[f] && form.elements[f]) form.elements[f].value = draft[f]; });
    } catch (e) { /* Speicher nicht verfügbar */ }

    form.addEventListener("input", function () {
      try {
        var d = {};
        fields.forEach(function (f) { d[f] = form.elements[f].value; });
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch (e) { /* ignorieren */ }
    });

    function setError(id, msg) {
      var input = $("#" + id);
      var err = $("#" + id + "-err");
      if (err) err.textContent = msg || "";
      if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
      if (input && err) {
        if (msg) input.setAttribute("aria-describedby", id + "-err");
        else input.removeAttribute("aria-describedby");
      }
    }

    function validate() {
      var ok = true;
      var name = form.elements.name.value.trim();
      var email = form.elements.email.value.trim();
      var msg = form.elements.message.value.trim();
      setError("cf-name", name ? "" : "Bitte geben Sie Ihren Namen an.");
      if (!name) ok = false;
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      setError("cf-email", emailOk ? "" : "Bitte geben Sie eine gültige E-Mail-Adresse an, z. B. name@firma.de.");
      if (!emailOk) ok = false;
      setError("cf-message", msg.length >= 10 ? "" : "Bitte beschreiben Sie Ihr Anliegen in ein, zwei Sätzen.");
      if (msg.length < 10) ok = false;
      var consent = form.elements.consent.checked;
      setError("cf-consent", consent ? "" : "Bitte bestätigen Sie die Einwilligung, damit wir Ihre Anfrage bearbeiten dürfen.");
      if (!consent) ok = false;
      return ok;
    }

    function summary() {
      var f = form.elements;
      return [
        "Name: " + f.name.value.trim(),
        "Unternehmen: " + (f.company.value.trim() || "–"),
        "E-Mail: " + f.email.value.trim(),
        "Telefon: " + (f.phone.value.trim() || "–"),
        "Thema: " + f.topic.value,
        "",
        f.message.value.trim()
      ].join("\n");
    }

    function showStatus(kind, html) {
      status.className = "form-status form-status-" + kind;
      status.innerHTML = html;
      status.hidden = false;
      status.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function clearDraft() {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignorieren */ }
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      status.hidden = true;

      // Spam-Falle: echte Menschen füllen dieses Feld nicht aus
      if (form.elements.website.value) {
        showStatus("ok", "<strong>Vielen Dank.</strong> Ihre Anfrage ist eingegangen.");
        form.reset();
        return;
      }
      if (!validate()) {
        var first = form.querySelector('[aria-invalid="true"]');
        if (first) first.focus();
        return;
      }

      var text = summary();

      if (CFG.formEndpoint) {
        submit.disabled = true;
        submit.textContent = "Wird gesendet …";
        var body = new FormData(form);
        body.delete("website");
        body.append("_subject", "Website-Anfrage: " + form.elements.topic.value);
        fetch(CFG.formEndpoint, { method: "POST", body: body, headers: { Accept: "application/json" } })
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            showStatus("ok", "<strong>Vielen Dank, Ihre Anfrage ist bei uns angekommen.</strong> Wir melden uns innerhalb von zwei Werktagen.");
            form.reset();
            clearDraft();
          })
          .catch(function () {
            showStatus("err",
              "<strong>Die Anfrage konnte gerade nicht gesendet werden.</strong> Bitte versuchen Sie es in ein paar Minuten erneut " +
              "oder schreiben Sie direkt an <span class=\"copyable\">" + esc(CFG.email) + "</span>.");
          })
          .then(function () {
            submit.disabled = false;
            submit.textContent = "Anfrage senden";
          });
        return;
      }

      // Ohne Formular-Dienst: vorbereitete E-Mail öffnen
      var subject = "Website-Anfrage: " + form.elements.topic.value;
      var href = "mailto:" + encodeURIComponent(CFG.email) +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(text);
      var a = document.createElement("a");
      a.href = href;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();

      showStatus("info",
        "<p><strong>Fast geschafft.</strong> Wir haben Ihre Nachricht als E-Mail vorbereitet. Senden Sie sie in Ihrem E-Mail-Programm ab.</p>" +
        "<p>Falls sich kein E-Mail-Programm geöffnet hat, kopieren Sie die Nachricht und senden Sie sie an " +
        "<span class=\"copyable\" id=\"cf-mail-addr\">" + esc(CFG.email) + "</span> " +
        "<button class=\"copy-btn\" type=\"button\" data-copy-cfg=\"email\">Adresse kopieren</button></p>" +
        "<pre class=\"mail-preview\" id=\"cf-mail-text\">" + esc(text) + "</pre>" +
        "<button class=\"copy-btn\" type=\"button\" data-copy-target=\"#cf-mail-text\">Nachricht kopieren</button>");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    fillConfig();
    renderDeals();
    renderTeam();
    initNav();
    initCopy();
    initForm();
    initRouting();
  });
})();
