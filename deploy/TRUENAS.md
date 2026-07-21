# 🖥️ ShopList auf TrueNAS SCALE installieren

Diese Anleitung ist für **TrueNAS SCALE 25.10 („Goldeye")** oder neuer geschrieben
und geht Schritt für Schritt durch. Am Ende hast du:

- ShopList als App auf deinem NAS – dein Handy synchronisiert sich automatisch,
  sobald es den Server erreicht (Heim-WLAN)
- **KI-Automatik auf deiner NVIDIA-GPU** (Ollama): Produktfotos werden erkannt und
  benannt, Kassenbons gelesen, Preise eingetragen und gekaufte Sachen von der
  Liste abgehakt – ganz ohne Tipparbeit
- Unterwegs läuft die App offline weiter (Liste ansehen, abhaken, Fotos machen)
  und gleicht sich zu Hause wieder ab

Alles bleibt in deinem Heimnetz. Es wird **kein Port ins Internet geöffnet**.

---

## Schritt 1: NVIDIA-Treiber aktivieren

1. TrueNAS-Weboberfläche → **Apps**
2. Oben rechts **Configuration → Settings**
3. Haken bei **„Install NVIDIA Drivers"** setzen → **Save**
4. Kurz warten (der Treiber wird installiert)

## Schritt 2: Ordner anlegen und Code holen

1. TrueNAS-Weboberfläche → **System → Shell**
2. Diese Befehle eingeben – ersetze `tank` durch den Namen deines Pools
   (siehe **Storage**, z. B. `tank`, `pool1` …):

```sh
mkdir -p /mnt/tank/apps/shoplist
cd /mnt/tank/apps/shoplist
git clone https://github.com/ludwigpaerschbrandenburg-png/Shoplist-.git code
mkdir -p data certs ollama
```

> Falls der Code noch auf dem Entwicklungs-Branch liegt, stattdessen:
> `git clone -b claude/household-shopping-app-r5wfg2 https://github.com/ludwigpaerschbrandenburg-png/Shoplist-.git code`

Das war's an der Kommandozeile – alles Weitere passiert in der Weboberfläche.

## Schritt 3: DuckDNS einrichten (für HTTPS)

**Warum?** Das iPhone erlaubt den Offline-Modus einer Web-App nur über HTTPS.
DuckDNS gibt dir kostenlos einen Namen wie `meine-shoplist.duckdns.org`, und
darüber holt sich ShopList automatisch ein echtes Let's-Encrypt-Zertifikat –
**ohne** dass irgendetwas aus dem Internet erreichbar wird. Der Name zeigt
einfach auf die interne IP deines NAS.

1. https://www.duckdns.org öffnen und anmelden (geht mit Google-Konto)
2. Oben einen Namen eintragen, z. B. `meine-shoplist` → **add domain**
3. Bei dieser Domain unter **current ip** die **LAN-IP deines NAS** eintragen
   (z. B. `192.168.1.50` – steht im TrueNAS-Dashboard) → **update ip**
4. Den **token** (lange Zeichenkette oben auf der Seite) kopieren – den brauchst
   du gleich

> Du kannst diesen Schritt auch erst mal überspringen und die App ohne HTTPS
> unter `http://NAS-IP:8080` testen. Dann funktioniert alles außer dem
> Offline-Modus auf dem iPhone.

## Schritt 4: App installieren

1. **Apps → Discover Apps** → oben rechts auf **⋮ → Install via YAML**
2. Name: `shoplist`
3. Den Inhalt der Datei [`deploy/docker-compose.yaml`](docker-compose.yaml)
   einfügen und die markierten Stellen anpassen:

| Stelle | Was eintragen |
|---|---|
| `/mnt/tank/apps/shoplist/...` (6×) | Deinen Pfad aus Schritt 2 |
| `DOMAIN` (2×) | Deine DuckDNS-Domain, z. B. `meine-shoplist.duckdns.org` |
| `DUCKDNS_TOKEN` | Dein Token von duckdns.org |
| `EMAIL` | Deine E-Mail (für Let's Encrypt) |

4. **Save** – TrueNAS startet die drei Container (ShopList, Ollama, Zertifikat)

## Schritt 5: Erster Start

- **Ollama lädt beim ersten Start das KI-Modell herunter (~6 GB)** – je nach
  Internetleitung dauert das eine Weile. Solange zeigt die App den Status
  „KI-Modell wird heruntergeladen".
- Prüfen: `https://deine-domain.duckdns.org:8443/api/health` im Browser öffnen.
  Wenn dort `"status":"ready"` steht, ist die KI einsatzbereit.
- Das HTTPS-Zertifikat wird beim ersten Start geholt (1–2 Minuten). Danach
  erneuert es sich automatisch.

## Schritt 6: iPhone einrichten

1. In **Safari** öffnen: `https://deine-domain.duckdns.org:8443`
2. **Teilen-Symbol → „Zum Home-Bildschirm"**
3. Fertig. Die App auf dem Home-Bildschirm läuft jetzt auch offline und
   synchronisiert sich automatisch, sobald du im Heim-WLAN bist.

Der grüne Punkt oben in der App zeigt: **Server verbunden**. Grau = unterwegs
(App läuft lokal weiter), orange blinkend = KI arbeitet gerade oder Modell lädt.

Das Ganze funktioniert auf beliebig vielen Geräten – alle teilen sich denselben
Haushalt. Einfach auf jedem Handy die gleiche Adresse öffnen und installieren.

## So benutzt du die KI-Automatik

- **Produkt anlegen:** Foto machen, **Namen einfach leer lassen** – die KI
  erkennt das Produkt und benennt es von selbst.
- **Nach dem Einkauf:** Bon fotografieren (Tab „Bons" → **+**, oder direkt beim
  „Einkauf abschließen"). Die KI liest Geschäft, Datum, Summe und alle
  Positionen, ordnet sie deinen Produkten zu, trägt die Preise ein und hakt
  Gekauftes von der Liste ab.
- Das passiert im Hintergrund auf dem Server – beim nächsten Blick in die App
  ist alles ausgefüllt.

## Updates einspielen

```sh
cd /mnt/tank/apps/shoplist/code
git pull
```

Danach in **Apps** die shoplist-App neu starten.

## Datensicherung

Alle Daten (Produkte, Käufe, Bons, Fotos) liegen als einfache Dateien in
`/mnt/tank/apps/shoplist/data`. Ein ZFS-Snapshot oder eine Kopie dieses
Ordners ist ein vollständiges Backup.

## Wenn etwas hakt

| Problem | Lösung |
|---|---|
| App-Start schlägt fehl mit GPU-Fehler | Schritt 1 prüfen (NVIDIA-Treiber). Zur Not: `deploy:`-Block beim `ollama`-Service löschen – läuft dann (langsam) auf der CPU. |
| `/api/health` zeigt `"status":"unreachable"` | Ollama-Container läuft nicht oder startet noch – in Apps die Logs von `ollama` ansehen. |
| `"status":"pulling"` bleibt lange stehen | Normal beim ersten Start – das Modell hat ~6 GB. |
| Safari meldet Zertifikatsfehler | 1–2 Minuten warten (Zertifikat wird geholt), Logs vom `lego`-Container prüfen. Stimmen Domain und Token? |
| Port 8080/8443 schon belegt | In der YAML die linken Portnummern ändern, z. B. `18080:80` und `18443:443`. |
| KI erkennt ein Produkt falsch | In der App: Produkt → „Umbenennen". Die KI-Zuordnung nutzt danach deinen Namen. |

## Optional: Zugriff auch unterwegs

Ohne weiteres Zutun läuft die App unterwegs offline und synct zu Hause – das
reicht für den Einkaufszettel völlig. Wenn du irgendwann doch von unterwegs
live auf den Server willst: Installiere die **Tailscale-App** aus dem
TrueNAS-Katalog und die Tailscale-App auf dem iPhone, melde beide mit demselben
Konto an – mehr ist es nicht. Die ShopList-Adresse funktioniert dann auch
unterwegs. Nötig ist das aber nicht.
