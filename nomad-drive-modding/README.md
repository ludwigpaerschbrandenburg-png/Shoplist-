# Nomad Drive Demo – Modding-Toolkit

Werkzeuge für die drei Arbeitsschritte: **Installation analysieren → MelonLoader aufsetzen →
Spielcode dekompilieren und die relevanten Klassen finden.**

---

## Warum Skripte statt fertiger Ergebnisse?

Die Anfrage nennt `A:\SteamLibrary\steamapps\common\Nomad Drive Demo`. Diese Sitzung läuft
aber in einer **Linux-Cloud-VM ohne Zugriff auf den heimischen Rechner** – kein A:-Laufwerk,
keine Steam-Bibliothek, kein Windows. Die Punkte 1–4 der Analyse, die MelonLoader-Installation
und das Dekompilieren müssen also lokal laufen.

Deshalb liegt hier alles als ausführbares Werkzeug: die vier Skripte machen genau das, was in
den Prompts steht, und schreiben die Ergebnisse als Markdown-Bericht. Ergebnisberichte hier
einfügen – dann geht es mit dem eigentlichen Mod weiter.

| Prompt | Skript |
|---|---|
| 1 – Installation analysieren | `01-analyze.ps1` |
| 2 – MelonLoader installieren | `02-install-melonloader.ps1` |
| 2 – Test-Mod bauen und prüfen | `TurboMod/` + `03-build-turbomod.ps1` |
| 3 – Dekompilieren, Klassen finden | `04-decompile.ps1` |

---

## Voraussetzungen

* Windows mit PowerShell 5.1 (vorinstalliert) oder PowerShell 7
* [.NET SDK 8](https://dotnet.microsoft.com/download) – nur für Schritt 2 und 3
* Internetzugang für MelonLoader und `ilspycmd`

PowerShell im Ordner dieser Skripte öffnen. Falls die Ausführung blockiert wird:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

## Schnellstart

```powershell
$game = "A:\SteamLibrary\steamapps\common\Nomad Drive Demo"

# 1. Analyse - liest nur, verändert nichts
.\01-analyze.ps1 -GamePath $game

# 2. MelonLoader installieren, danach das Spiel EINMAL starten und beenden
.\02-install-melonloader.ps1 -GamePath $game

# 3. Test-Mod bauen, deployen, Log prüfen (Spiel starten, während gewartet wird)
.\03-build-turbomod.ps1 -GamePath $game -WaitForLog 300

# 4. Dekompilieren und relevante Klassen suchen
.\04-decompile.ps1 -GamePath $game
```

Berichte landen in `reports/`.

---

## 01-analyze.ps1 – Was analysiert wird

**Punkt 1 – Mono oder IL2CPP.** Geprüft werden `GameAssembly.dll` im Wurzelverzeichnis,
`<Data>/il2cpp_data/Metadata/global-metadata.dat`, `<Data>/Managed/Assembly-CSharp.dll` und die
Mono-Laufzeit. Zusätzlich werden Unity-Version (aus `globalgamemanagers`) und CPU-Architektur
(aus dem PE-Header der EXE) ermittelt.

**Punkt 2 – DLL-Inventar.** Jede DLL in `<Data>/Managed` wird einer Kategorie zugeordnet:

| Kategorie | Bedeutung |
|---|---|
| `SPIELCODE` | `Assembly-CSharp.dll` – das Hauptziel |
| `VERMUTLICH SPIELCODE` | passt zu keinem bekannten Muster, also eigene Studio-Assembly |
| `NETZWERK` | Mirror, FishNet, Photon, NGO, EOS, Steamworks … |
| `DRITTANBIETER` | Odin, DOTween, Newtonsoft, Fahrzeugphysik-Assets … |
| `UNITY` / `BCL` | Engine-Module und .NET-Basisbibliotheken |

Native Plugins (`<Data>/Plugins`) werden mit aufgeführt – bei EOS-Spielen liegt dort
`EOSSDK-Win64-Shipping.dll`, der zuverlässigste Beleg für Epic Online Services.

**Punkt 3 – Netzwerklösung.** Zwölf Frameworks werden über charakteristische Namespace- und
Typnamen erkannt (`Unity.Netcode`, `Mirror.NetworkIdentity`, `FishNet.Object`, `Photon.Pun`,
`Fusion.NetworkRunner`, `Epic.OnlineServices`, `SteamNetworking`, `LiteNetLib` …). Gesucht wird
streamend im Binärbild – bei Mono in `Assembly-CSharp.dll`, bei IL2CPP zusätzlich in
`GameAssembly.dll` und `global-metadata.dat`. Auch mehrere hundert MB sind kein Problem.

Die Auswertung unterscheidet zwei Fälle:

* **Highlevel-Framework gefunden** → EOS dient dann meist nur für Login/Lobby/NAT-Traversal,
  während die Spiellogik über das Framework repliziert.
* **Nur EOS-Signaturen** → das Spiel setzt direkt auf EOS P2P/Lobby auf und serialisiert seine
  Pakete selbst. Für Mods heißt das: keine `[ServerRpc]`-Konventionen, sondern eine eigene
  Nachrichtenschicht, die erst im dekompilierten Code verstanden werden muss.

**Punkt 4 – StreamingAssets.** Alle Dateien werden nach Endung gruppiert; lesbare Textformate
(json, xml, csv, yaml, ini …) werden mit Vorschau ausgegeben, thematisch passende Namen
(`item`, `loot`, `vehicle`, `engine`, `spawn`, `recipe` …) bevorzugt. Binärdateien mit
`.dat`-Endung werden anhand des Anteils an Steuerzeichen aussortiert. Addressables/AssetBundles
werden separat gemeldet – die brauchen AssetRipper, UABEA oder AssetStudio.

Wenn `StreamingAssets` fehlt oder leer ist, stecken Item-, Loot- und Fahrzeugdaten in
ScriptableObjects innerhalb von `resources.assets` bzw. den Bundles.

---

## 02-install-melonloader.ps1

Lädt das passende Release von `LavaGang/MelonLoader` über die GitHub-API, entpackt es in den
Spielordner und legt `Mods/`, `Plugins/` und `UserLibs/` an.

MelonLoader ab 0.6 enthält Mono- und IL2CPP-Unterstützung in einem Paket und erkennt das
Backend beim Start selbst. Ausgewählt wird deshalb nur die **Architektur**, gelesen aus dem
PE-Header der Spiel-EXE.

```powershell
# Bestimmte Version
.\02-install-melonloader.ps1 -GamePath $game -Version v0.6.6

# Ohne Internet: ZIP vorher von Hand laden
.\02-install-melonloader.ps1 -GamePath $game -ZipPath "C:\Downloads\MelonLoader.x64.zip"

# Wieder entfernen (Mods/ bleibt erhalten)
.\02-install-melonloader.ps1 -GamePath $game -Uninstall
```

Das Skript bricht ab, wenn das Spiel läuft, warnt bei parallel installiertem BepInEx und fragt
vor dem Überschreiben einer bestehenden Installation nach.

**Nach der Installation das Spiel einmal starten.** Bei IL2CPP erzeugt Il2CppInterop dabei die
Interop-Assemblies unter `MelonLoader\Il2CppAssemblies\` – das dauert einige Minuten und ist
Voraussetzung für Schritt 3 und 4.

---

## TurboMod + 03-build-turbomod.ps1

`TurboMod/Main.cs` ist bewusst minimal: eine Logzeile beim Initialisieren, eine je Szene.

```csharp
public override void OnInitializeMelon()
{
    LoggerInstance.Msg("TurboMod geladen");
}
```

`TurboMod.csproj` erkennt Mono/IL2CPP selbst und referenziert entsprechend:

| Flavor | TargetFramework | Referenzen |
|---|---|---|
| Mono | `net472` | `MelonLoader\net35\MelonLoader.dll`, `<Data>\Managed\*.dll` |
| Il2Cpp | `net6.0` / `net8.0` | `MelonLoader\net6\*.dll`, `MelonLoader\Il2CppAssemblies\*.dll` |

Für sehr alte Mono-Titel mit Scripting Runtime 3.5: `-p:TargetFramework=net35`.

`03-build-turbomod.ps1` baut, kopiert `TurboMod.dll` nach `<Spiel>\Mods\` und durchsucht
anschließend `MelonLoader\Latest.log`. Mit `-WaitForLog 300` wartet es bis zu fünf Minuten, in
denen das Spiel gestartet werden kann, und meldet dann die gefundene Zeile. Fehlt sie, listet
es die geladenen Melons und die häufigsten Ursachen auf.

Erwartete Logzeile:

```
[00:00:01.234] [TurboMod] TurboMod geladen
```

---

## 04-decompile.ps1

**Mono:** `ilspycmd` dekompiliert `Assembly-CSharp.dll` und weitere Studio-Assemblies in einen
Projektbaum unter `decompiled/` – vollständig, inklusive Methodenkörper. Unity-, BCL- und
bekannte Fremdassemblies werden übersprungen. Fehlt `ilspycmd`, installiert das Skript es per
`dotnet tool install -g ilspycmd` (mit `-NoInstall` unterdrückbar).

**IL2CPP:** Es gibt keine Managed-DLLs. Verwendet werden die Interop-Assemblies aus
`MelonLoader\Il2CppAssemblies`. Wichtig: **das sind Stubs.** Klassen, Felder, Properties und
Methodensignaturen sind vollständig – genau das, was zum Auffinden der richtigen Klassen und
Werte gebraucht wird –, die Methodenkörper aber leer. Für echte Logik zusätzlich Cpp2IL:

```powershell
.\04-decompile.ps1 -GamePath $game -Cpp2IlPath "C:\tools\Cpp2IL\Cpp2IL.exe"
```

Die Parameternamen von Cpp2IL haben sich zwischen den Versionen geändert; das Skript gibt den
verwendeten Aufruf aus, damit er notfalls von Hand angepasst werden kann. Alternative:
Il2CppDumper (erzeugt `dump.cs` plus DummyDll).

Danach wird der Quellcodebaum nach vier Themen durchsucht:

| Thema | Stichworte |
|---|---|
| Motor / Antriebswerte | engine, motor, torque, horsepower, topSpeed, acceleration, rpm, gearRatio, throttle, powerCurve |
| Item- / Inventarsystem | inventory, itemData, itemDefinition, stackSize, slot, pickUp, container, storage |
| Loot-Tables / Spawn-Logik | lootTable, spawner, spawnPoint, scavenger, camp, rarity, dropChance, respawn |
| Fahrzeugsteuerung / Physik | WheelCollider, VehicleController, suspension, steer, brakeTorque, motorTorque, centerOfMass |

Bewertet wird nach **Anzahl verschiedener** Stichworte (nicht nach bloßen Wiederholungen);
Treffer im Dateinamen zählen extra. Der Bericht listet je Thema Dateipfad, enthaltene Klassen,
Score und die konkreten Fundstellen.

Zusätzlich entsteht eine Tabelle **numerischer Feldkandidaten** – `float`/`int`-Felder, deren
Namen auf Balancing-Werte hindeuten (`maxSpeed`, `engineTorque`, `dropChance`, `stackSize` …).
Das sind die direkten Angriffspunkte für einen Tuning-Mod.

---

## Wenn etwas nicht klappt

| Symptom | Ursache / Lösung |
|---|---|
| `01` findet keinen `*_Data`-Ordner | Falscher Pfad, oder es ist der Steam-Ordner statt der Spielordner |
| `02` bricht mit „Spiel läuft gerade" ab | Spiel und Launcher beenden |
| Virenscanner meldet `version.dll` / `dobby.dll` | Proxy-DLL-Technik, bei MelonLoader normal – Ausnahme eintragen |
| Nach Steam-Update ist MelonLoader weg | `02` erneut ausführen |
| `03` bricht ab: Interop-Assemblies fehlen | Spiel nach der MelonLoader-Installation einmal starten |
| Mod erscheint nicht im Log | Falscher Flavor gebaut, oder Steam startet eine andere EXE als die gepatchte |
| `04` findet nichts unter „Motor" | Code liegt in einer anderen Assembly – Ausgabe von `01` prüfen, welche Studio-DLLs es gibt |
| `ilspycmd` nicht im PATH | Neue Shell öffnen (globale dotnet-Tools werden erst dann sichtbar) |

---

## Zum Koop-Betrieb

Nomad Drive Demo ist Koop über EOS. Zwei Dinge sind beim Modden von Fahrzeugwerten relevant:

* **Replikation.** Ob ein geänderter Wert nur lokal wirkt oder an die Mitspieler übertragen
  wird, entscheidet die Netzwerkschicht. Wirkt er nur lokal, weicht das eigene Fahrverhalten
  vom Bild der anderen ab – das sieht nach Teleportieren aus. `04-decompile.ps1` zeigt in der
  Netzwerksektion von `01`, womit man es zu tun hat.
* **Mitspieler.** Geänderte Werte in einer gemeinsamen Runde betreffen alle Beteiligten.
  Sinnvoll ist, solche Mods in eigenen oder abgesprochenen Sessions zu benutzen.

---

## Ordnerstruktur

```
nomad-drive-modding/
├── 01-analyze.ps1              Installation analysieren (Punkte 1-4)
├── 02-install-melonloader.ps1  MelonLoader installieren / entfernen
├── 03-build-turbomod.ps1       Test-Mod bauen, deployen, Log prüfen
├── 04-decompile.ps1            Dekompilieren + Klassensuche
├── TurboMod/
│   ├── TurboMod.csproj         Mono/IL2CPP-fähiges Modprojekt
│   └── Main.cs                 "TurboMod geladen"
├── reports/                    generierte Berichte (nicht eingecheckt)
└── decompiled/                 Quellcodebaum aus Schritt 4 (nicht eingecheckt)
```
