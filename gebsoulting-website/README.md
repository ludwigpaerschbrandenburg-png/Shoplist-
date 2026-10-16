# Gebsoulting – Website (erster Entwurf)

Statische Website ohne Build-Schritt: HTML, CSS, JavaScript. Läuft auf jedem Webspace
(GitHub Pages, Netlify, Strato, IONOS …), einfach den Ordner `gebsoulting-website/` hochladen.

## Seiten

| Seite | Adresse |
|---|---|
| Start | `index.html` bzw. `#start` |
| Leistungen | `#leistungen` |
| Deals & Erfahrung | `#deals` |
| Über uns (Wer wir sind, Team) | `#ueber-uns` |
| Kontakt (mit Formular) | `#kontakt` |
| Impressum | `#impressum` |
| Datenschutz | `#datenschutz` |

Alle Seiten liegen in `index.html` und werden per Navigation umgeschaltet.

## Was wo geändert wird

- **Firmendaten** (E-Mail, Telefon, Adresse, Impressum-Angaben): `assets/js/config.js`.
  Die Werte erscheinen automatisch auf Kontakt-, Impressum-, Datenschutzseite und im Footer.
- **Deals, Team, Branchen**: `assets/js/data.js`. Neuer Deal = neuer Eintrag in der Liste.
  Die ersten drei Deals erscheinen auch auf der Startseite.
- **Texte** (Leistungen, Über uns, Startseite): direkt in `index.html`.
- **Farben und Schriften**: oben in `assets/css/style.css`.

Sobald echte Deals und Teamdaten drin sind, in `config.js` `showPlaceholderNotice: false` setzen.

## Kontaktformular

- Ohne weitere Einrichtung öffnet das Formular eine fertig ausgefüllte E-Mail an die Adresse aus `config.js`
  und zeigt die Nachricht zusätzlich zum Kopieren an.
- Für direkten Versand ohne E-Mail-Programm einen Formular-Dienst anbinden (z. B. Formspree oder Web3Forms)
  und dessen URL in `config.js` bei `formEndpoint` eintragen.
- Eingebaut: Pflichtfeld-Prüfung, Einwilligungs-Checkbox (DSGVO), Spam-Falle, Entwurf wird lokal gemerkt.

## Vor dem Livegang

- [ ] Platzhalter in eckigen Klammern in `config.js` ersetzen (Rechtsform, Adresse, Register, USt-ID)
- [ ] Echte Deals und Team in `data.js` eintragen
- [ ] Impressum und Datenschutz rechtlich prüfen lassen
- [ ] Optional: Schriften lokal einbinden statt über Google Fonts
- [ ] Formular-Dienst einrichten (`formEndpoint`)

## Lokal ansehen

```bash
cd gebsoulting-website
python3 -m http.server 8080
# dann http://localhost:8080 öffnen
```
