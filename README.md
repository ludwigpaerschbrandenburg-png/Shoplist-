# 🛍️ ShopList – Haushalt & Einkauf

Eine App fürs iPhone (und jedes andere Smartphone), mit der du den Überblick über deinen Haushalt behältst:

- 📷 **Foto machen, wenn etwas leer läuft** – z. B. vom fast leeren Weichspüler. Das Produkt landet mit Bild auf deiner Einkaufsliste.
- 🛒 **Beim Einkaufen abhaken** – du siehst die Bilder und Namen deiner Produkte und tippst sie einfach ab.
- 🧾 **Kassenbon fotografieren** – nach dem Einkauf hältst du Preise und Kaufdatum fest.
- ⏱️ **Haltbarkeit lernen** – die App merkt sich, wie lange z. B. eine Flasche Weichspüler bei dir hält (Abstand zwischen den Käufen).
- 💶 **Ausgaben & Prognosen** – Ausgaben pro Woche, Monat und Jahr, vergangen **und** in die Zukunft gerechnet, inklusive „monatliche Fixkosten“ deiner wiederkehrenden Einkäufe.
- 💡 **Hinweise** – die App warnt dich, wenn du zuletzt deutlich **mehr bezahlt** hast als üblich oder ein Produkt **schneller verbraucht** wurde als sonst.

Alle Daten (auch die Fotos) bleiben **lokal auf deinem Gerät** (IndexedDB im Browser). Nichts wird an einen Server geschickt.

## 📲 Installation auf dem iPhone

Die App ist eine **Progressive Web App (PWA)** – sie braucht keinen App Store:

1. **GitHub Pages aktivieren** (einmalig):
   - Auf GitHub im Repository: **Settings → Pages**
   - Unter „Build and deployment“: **Source: Deploy from a branch**
   - Branch auswählen (z. B. `main` bzw. den Branch mit diesem Code), Ordner `/ (root)`, dann **Save**
   - Nach 1–2 Minuten ist die App unter `https://<dein-benutzername>.github.io/Shoplist-/` erreichbar
2. **Auf dem iPhone**: Diese URL in **Safari** öffnen
3. Unten auf **Teilen** (Viereck mit Pfeil) tippen → **„Zum Home-Bildschirm“**
4. Fertig! ShopList liegt jetzt wie eine normale App auf deinem Home-Bildschirm, läuft im Vollbild und funktioniert auch **offline**.

## 🚀 So benutzt du die App

1. **Produkt anlegen:** Läuft etwas leer? Tab „Liste“ → **+** → Foto machen → Name eingeben. Das Produkt steht jetzt auf der Einkaufsliste.
2. **Einkaufen:** Im Laden die Liste öffnen, gekaufte Artikel **abhaken**.
3. **Einkauf abschließen:** Unten auf „Einkauf abschließen“ tippen → optional den **Kassenbon fotografieren**, Geschäft und **Preise** eintragen.
4. **Auswerten:** Im Tab „Ausgaben“ siehst du deine Kosten pro **Woche / Monat / Jahr** – mit den Pfeilen blätterst du in Vergangenheit und **Zukunft** (Prognose). Im Tab „Produkte“ siehst du pro Produkt: letzter Preis, Durchschnittspreis, wie lange es hält und was es dich **pro Monat** kostet.

Je mehr Einkäufe und Bons du erfasst, desto genauer werden Haltbarkeit, Prognosen und Preis-Hinweise.

## 🛠️ Technik

- Reines HTML/CSS/JavaScript – **kein Build-Schritt**, keine Abhängigkeiten
- Speicherung: **IndexedDB** (Produkte, Käufe, Kassenbons – inkl. Fotos als komprimierte JPEGs)
- **Service Worker** für Offline-Betrieb
- Lokal testen: `python3 -m http.server 8000` im Projektordner, dann `http://localhost:8000` öffnen

## 🔭 Ideen für später

- **Barcode-Scan** statt Foto-Abgleich: Ein Barcode identifiziert das Produkt eindeutig und ist der zuverlässigste Weg zu automatischen Preisdaten.
- **Bon-Texterkennung (OCR)**, damit Preise nicht mehr von Hand eingetragen werden müssen.
- **Automatischer Online-Preisvergleich**: Dafür braucht es einen Server mit Produkt­erkennung und Zugriff auf Händler-Preisdaten – die App ist so gebaut, dass sich das später ergänzen lässt. Bis dahin lernt sie die Preise aus deinen eigenen Kassenbons, was für die Frage „zahle ich zu viel?“ oft sogar aussagekräftiger ist.
