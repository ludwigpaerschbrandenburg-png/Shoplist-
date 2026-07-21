# 🛍️ ShopList – Haushalt & Einkauf

Eine App fürs iPhone (und jedes andere Smartphone), mit der du den Überblick über deinen Haushalt behältst:

- 📷 **Foto machen, wenn etwas leer läuft** – z. B. vom fast leeren Weichspüler. Das Produkt landet mit Bild auf deiner Einkaufsliste.
- 🛒 **Beim Einkaufen abhaken** – du siehst die Bilder und Namen deiner Produkte und tippst sie einfach ab.
- 🧾 **Kassenbon fotografieren** – Preise und Kaufdatum werden festgehalten.
- ⏱️ **Haltbarkeit lernen** – die App merkt sich, wie lange z. B. eine Flasche Weichspüler bei dir hält (Abstand zwischen den Käufen).
- 💶 **Ausgaben & Prognosen** – Ausgaben pro Woche, Monat und Jahr, vergangen **und** in die Zukunft gerechnet, inklusive „monatliche Fixkosten“ deiner wiederkehrenden Einkäufe.
- 💡 **Hinweise** – die App warnt dich, wenn du zuletzt deutlich **mehr bezahlt** hast als üblich oder ein Produkt **schneller verbraucht** wurde als sonst.

## Zwei Betriebsarten

### 1. Nur Handy (ohne Server)

Die App ist eine **Progressive Web App (PWA)**: über GitHub Pages gehostet, auf
dem iPhone per Safari → **Teilen → „Zum Home-Bildschirm“** installierbar, läuft
offline. Alle Daten (auch Fotos) bleiben lokal auf dem Gerät. Preise trägst du
in dieser Betriebsart selbst ein.

GitHub Pages aktivieren: **Settings → Pages → Deploy from a branch** → Branch
wählen → `/ (root)` → Save. Danach ist die App unter
`https://<benutzername>.github.io/Shoplist-/` erreichbar.

### 2. Mit Heimserver + KI (TrueNAS, empfohlen) 🤖

Läuft ShopList auf deinem Server (z. B. TrueNAS mit NVIDIA-GPU), kommt die
Automatik dazu – **komplett lokal, ohne Cloud**:

- **Produktfoto → Name:** Foto machen, Name leer lassen – die KI (Ollama mit
  einem Vision-Modell) erkennt das Produkt und benennt es.
- **Kassenbon → alles automatisch:** Bon fotografieren, fertig. Die KI liest
  Geschäft, Datum, Summe und Positionen, ordnet sie deinen Produkten zu, trägt
  Preise ein und hakt Gekauftes von der Einkaufsliste ab.
- **Offline unterwegs, Sync zu Hause:** Im Supermarkt läuft die App lokal
  (Liste ansehen, abhaken). Sobald das Handy den Server wieder erreicht,
  synchronisieren sich beide automatisch. Mehrere Handys teilen sich denselben
  Haushalt.

👉 **[Schritt-für-Schritt-Anleitung für TrueNAS SCALE](deploy/TRUENAS.md)**

## 🛠️ Technik

- **App:** reines HTML/CSS/JavaScript, kein Build-Schritt. Speicherung in
  IndexedDB (inkl. Fotos), Service Worker für Offline-Betrieb.
- **Server** (`server/`): Node.js ohne Abhängigkeiten – statische Auslieferung,
  Sync-API (`POST /api/sync`, Offline-first, letzter Push gewinnt), Daten als
  JSON + JPEG-Dateien im Datenverzeichnis, HTTPS mit Let's-Encrypt-Zertifikaten.
- **KI-Worker:** spricht mit [Ollama](https://ollama.com) (Standard-Modell
  `qwen2.5vl:7b`, läuft auf ~6 GB VRAM). Verarbeitet Produktfotos und
  Kassenbons im Hintergrund.
- **Deployment:** Docker Compose für TrueNAS SCALE 25.10+ (`deploy/`), GPU wird
  an Ollama durchgereicht.

Lokal testen:

```sh
# Nur die App (ohne Server):
python3 -m http.server 8000

# Mit Server und Sync (ohne KI):
DATA_DIR=/tmp/shoplist-data HTTP_PORT=8000 node server/server.js
```

## 🔭 Ideen für später

- **Barcode-Scan** als noch zuverlässigere Produkterkennung
- **Automatischer Online-Preisvergleich** („zahle ich woanders weniger?“) –
  bis dahin lernt die App deine echten Preise aus deinen eigenen Kassenbons
- Mengen-Erkennung („2×“) und Pfand-Verrechnung auf dem Bon
