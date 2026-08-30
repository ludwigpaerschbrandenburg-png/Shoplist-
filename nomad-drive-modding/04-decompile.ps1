<#
.SYNOPSIS
    Dekompiliert den Spielcode nach C# und sucht darin die fuers Modding relevanten Klassen.

.DESCRIPTION
    Mono-Build:
        Assembly-CSharp.dll (und weitere Studio-Assemblies) werden mit ilspycmd
        in einen Quellcodebaum dekompiliert - vollstaendig, inklusive Methodenkoerper.

    IL2CPP-Build:
        Es gibt keine Managed-DLLs. Verwendet werden die von MelonLoader beim ersten
        Spielstart erzeugten Interop-Assemblies (MelonLoader\Il2CppAssemblies).
        Wichtig: das sind Stubs - Klassen, Felder, Properties und Methodensignaturen
        sind vollstaendig, die Methodenkoerper aber leer. Zum Auffinden von Klassen
        und Feldern reicht das; fuer echte Logik zusaetzlich Cpp2IL verwenden
        (-Cpp2IlPath) oder Il2CppDumper.

    Anschliessend wird der Quellcodebaum nach vier Themen durchsucht:
        Motor/Antrieb, Item/Inventar, Loot/Spawn, Fahrzeugsteuerung.
    Ergebnis ist ein Markdown-Bericht mit Klassen, Dateipfaden und Fundstellen.

.EXAMPLE
    .\04-decompile.ps1 -GamePath "A:\SteamLibrary\steamapps\common\Nomad Drive Demo"

.EXAMPLE
    # Nur die Suche auf einem schon vorhandenen Quellcodebaum laufen lassen
    .\04-decompile.ps1 -GamePath "A:\..." -SourceDir .\decompiled -SkipDecompile
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GamePath,

    [string]$SourceDir,

    [string]$ReportPath,

    # ilspycmd nicht automatisch per "dotnet tool install -g" nachinstallieren
    [switch]$NoInstall,

    # Nur suchen, nicht dekompilieren
    [switch]$SkipDecompile,

    # Optional: Pfad zu Cpp2IL.exe fuer echte Methodenkoerper bei IL2CPP
    [string]$Cpp2IlPath,

    # Anzahl der pro Thema aufgelisteten Dateien
    [int]$Top = 15
)

$ErrorActionPreference = 'Stop'

function Write-Head { param([string]$T) Write-Host ''; Write-Host ('=' * 78) -ForegroundColor DarkCyan; Write-Host "  $T" -ForegroundColor Cyan; Write-Host ('=' * 78) -ForegroundColor DarkCyan }
function Write-Ok   { param([string]$T) Write-Host "  [ok]   $T" -ForegroundColor Green }
function Write-Warn { param([string]$T) Write-Host "  [warn] $T" -ForegroundColor Yellow }
function Write-Info { param([string]$T) Write-Host "  [info] $T" }

if (-not (Test-Path -LiteralPath $GamePath -PathType Container)) { throw "Der Pfad '$GamePath' existiert nicht." }
$GamePath = (Resolve-Path -LiteralPath $GamePath).Path

if (-not $SourceDir) { $SourceDir = Join-Path $PSScriptRoot 'decompiled' }

$isIl2Cpp = Test-Path -LiteralPath (Join-Path $GamePath 'GameAssembly.dll')
$dataDir  = Get-ChildItem -LiteralPath $GamePath -Directory | Where-Object { $_.Name -like '*_Data' } | Select-Object -First 1

Write-Head 'Dekompilieren'
Write-Info "Backend: $(if ($isIl2Cpp) { 'IL2CPP' } else { 'Mono' })"
Write-Info "Zielordner: $SourceDir"

# ---------------------------------------------------------------- Eingabe-Assemblies bestimmen

$inputDir  = $null
$inputDlls = @()

if ($isIl2Cpp) {
    $mlDir = Join-Path $GamePath 'MelonLoader'
    $inputDir = @(
        (Join-Path $mlDir 'Il2CppAssemblies'),
        (Join-Path $mlDir 'Managed')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if (-not $inputDir) {
        Write-Warn 'Keine Il2Cpp-Interop-Assemblies gefunden.'
        Write-Info 'Voraussetzung: 02-install-melonloader.ps1 ausfuehren und das Spiel danach EINMAL starten.'
        Write-Info 'Alternativ Cpp2IL oder Il2CppDumper direkt auf GameAssembly.dll + global-metadata.dat anwenden.'
        throw 'Abbruch: keine Eingabe-Assemblies.'
    }
    Write-Ok "Interop-Assemblies: $inputDir"
    Write-Warn 'Interop-Assemblies enthalten KEINE Methodenkoerper. Klassen/Felder sind vollstaendig, Logik nicht.'
}
else {
    if (-not $dataDir) { throw 'Kein *_Data-Ordner gefunden.' }
    $inputDir = Join-Path $dataDir.FullName 'Managed'
    if (-not (Test-Path -LiteralPath $inputDir)) { throw "Managed-Ordner nicht gefunden: $inputDir" }
    Write-Ok "Managed-Ordner: $inputDir"
}

# Kandidaten: Spielcode, keine Unity-/BCL-/bekannten Fremdassemblies
$skipPattern = '^(UnityEngine|Unity\.|Il2Cpp(mscorlib|System)|mscorlib|netstandard|System|Mono\.|Microsoft\.|I18N|Newtonsoft|Sirenix|DOTween|Rewired|FMOD|AK\.|Cinemachine|JetBrains|Photon|Mirror|FishNet|LiteNetLib|Telepathy|kcp2k|Epic\.|Steamworks|Facepunch|ICSharpCode|Ionic)'
$allDlls = @(Get-ChildItem -LiteralPath $inputDir -Filter '*.dll' -File | Sort-Object Name)
$inputDlls = @($allDlls | Where-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) -notmatch $skipPattern })

if ($inputDlls.Count -eq 0) {
    Write-Warn 'Keine Spielcode-Assemblies erkannt - dekompiliere ersatzweise Assembly-CSharp*.'
    $inputDlls = @($allDlls | Where-Object { $_.Name -like 'Assembly-CSharp*' })
}
if ($inputDlls.Count -eq 0) { throw 'Keine dekompilierbaren Assemblies gefunden.' }

Write-Info ("Zu dekompilieren: " + (($inputDlls | ForEach-Object { $_.Name }) -join ', '))

# ---------------------------------------------------------------- ilspycmd bereitstellen

function Get-IlspyCmd {
    param([switch]$NoInstall)
    $cmd = Get-Command ilspycmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # Auch im Standardpfad fuer globale dotnet-Tools nachsehen
    $toolPath = Join-Path $env:USERPROFILE '.dotnet\tools\ilspycmd.exe'
    if (Test-Path -LiteralPath $toolPath) { return $toolPath }

    if ($NoInstall) { throw 'ilspycmd ist nicht installiert (und -NoInstall wurde gesetzt).' }

    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        throw 'Weder ilspycmd noch das .NET SDK gefunden. SDK installieren: https://dotnet.microsoft.com/download'
    }
    Write-Info 'Installiere ilspycmd (dotnet tool install -g ilspycmd) ...'
    & dotnet tool install -g ilspycmd
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'Installation fehlgeschlagen. Manuell: dotnet tool install -g ilspycmd'
        Write-Warn 'Alternative ohne CLI: ILSpy-GUI oder dnSpyEx, dort "Export to Project".'
        throw 'ilspycmd nicht verfuegbar.'
    }
    $cmd = Get-Command ilspycmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if (Test-Path -LiteralPath $toolPath) { return $toolPath }
    throw 'ilspycmd wurde installiert, ist aber nicht im PATH. Neue Shell oeffnen und erneut versuchen.'
}

# ---------------------------------------------------------------- Cpp2IL (optional)

if ($Cpp2IlPath -and -not $SkipDecompile) {
    if (-not (Test-Path -LiteralPath $Cpp2IlPath -PathType Leaf)) { throw "Cpp2IL nicht gefunden: $Cpp2IlPath" }
    $exe = Get-ChildItem -LiteralPath $GamePath -Filter '*.exe' -File | Where-Object { $_.Name -notmatch 'UnityCrashHandler' } | Select-Object -First 1
    $cppOut = Join-Path $SourceDir '_cpp2il'
    New-Item -ItemType Directory -Path $cppOut -Force | Out-Null
    $cppArgs = @('--game-path', $GamePath, '--exe-name', [System.IO.Path]::GetFileNameWithoutExtension($exe.Name), '--output-root', $cppOut)
    Write-Info ("Starte Cpp2IL: `"$Cpp2IlPath`" " + ($cppArgs -join ' '))
    Write-Info 'Falls Cpp2IL andere Parameternamen erwartet, den Aufruf bitte manuell anpassen.'
    & $Cpp2IlPath @cppArgs
    if ($LASTEXITCODE -eq 0) {
        $dummy = Get-ChildItem -LiteralPath $cppOut -Recurse -Directory | Where-Object { $_.Name -match 'dummydll|DummyDll' } | Select-Object -First 1
        if ($dummy) {
            Write-Ok "Cpp2IL-DummyDLLs: $($dummy.FullName) - werden statt der Interop-Assemblies dekompiliert."
            $inputDir  = $dummy.FullName
            $inputDlls = @(Get-ChildItem -LiteralPath $inputDir -Filter '*.dll' -File |
                           Where-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) -notmatch $skipPattern })
        }
    } else {
        Write-Warn "Cpp2IL endete mit Exitcode $LASTEXITCODE - fahre mit den Interop-Assemblies fort."
    }
}

# ---------------------------------------------------------------- Dekompilieren

if (-not $SkipDecompile) {
    $ilspy = Get-IlspyCmd -NoInstall:$NoInstall
    Write-Ok "ilspycmd: $ilspy"

    foreach ($dll in $inputDlls) {
        $name = [System.IO.Path]::GetFileNameWithoutExtension($dll.Name)
        $out  = Join-Path $SourceDir $name
        if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
        New-Item -ItemType Directory -Path $out -Force | Out-Null

        Write-Info "Dekompiliere $($dll.Name) -> $out"
        & $ilspy $dll.FullName -p -o $out -r $inputDir 2>&1 | ForEach-Object {
            if ($_ -match 'error|Exception') { Write-Host "         $_" -ForegroundColor DarkYellow }
        }
        if ($LASTEXITCODE -ne 0) { Write-Warn "ilspycmd meldete Exitcode $LASTEXITCODE fuer $($dll.Name)" }
        else { Write-Ok "$($dll.Name) fertig" }
    }
}
else {
    Write-Info 'Dekompilierung uebersprungen (-SkipDecompile).'
}

if (-not (Test-Path -LiteralPath $SourceDir)) { throw "Quellcodeordner $SourceDir existiert nicht." }

# ---------------------------------------------------------------- Klassensuche

Write-Head 'Relevante Klassen suchen'

$themes = [ordered]@{
    'Motor / Antriebswerte' = @{
        Beschreibung = 'Beschleunigung, Hoechstgeschwindigkeit, Leistung, Getriebe'
        Muster = @('engine', 'motor', 'torque', 'horse\s?power', 'top\s?speed', 'max\s?speed',
                   'acceleration', 'accelerate', '\brpm\b|\w+rpm\b', 'gear\s?ratio', '\bgears?\b',
                   'transmission', 'drivetrain', 'throttle', 'power\s?curve', 'clutch', 'fuel\s?consum')
    }
    'Item- / Inventarsystem' = @{
        Beschreibung = 'Aufsammelbare Gegenstaende, Slots, Stapelgroessen, Container'
        Muster = @('inventory', 'item\s?data', 'item\s?definition', 'item\s?stack', 'item\s?id',
                   'stack\s?size', '\bslots?\b', 'pick\s?up', 'container', 'storage', 'equip',
                   'scriptableobject', 'consumable', 'craft')
    }
    'Loot-Tables / Spawn-Logik' = @{
        Beschreibung = 'Fundorte, Scavenger-Camps, Dropchancen, Seltenheiten'
        Muster = @('loot\s?table', 'loot', 'spawner', 'spawn\s?point', 'spawn', 'scaveng',
                   '\bcamps?\b', 'rarity', 'drop\s?chance', 'respawn', 'weighted\s?random',
                   '\bpoi\b', 'random\.range')
    }
    'Fahrzeugsteuerung / Physik' = @{
        Beschreibung = 'WheelCollider, Lenkung, Bremsen, Federung'
        Muster = @('wheel\s?collider', 'vehicle\w*controller', 'car\s?controller', 'suspension',
                   'steer', 'brake\s?torque', 'motor\s?torque', 'wheel\s?friction\s?curve',
                   'wheel', 'rigidbody', 'center\s?of\s?mass', 'handbrake', 'traction')
    }
}

$csFiles = @(Get-ChildItem -LiteralPath $SourceDir -Recurse -Filter '*.cs' -File -ErrorAction SilentlyContinue)
Write-Info ("Durchsuche {0} .cs-Dateien ..." -f $csFiles.Count)
if ($csFiles.Count -eq 0) { throw "Keine .cs-Dateien in $SourceDir." }

$typeRegex  = [regex]'(?m)^\s*(?:\[[^\]]*\]\s*)*(?:public|internal|private|protected)?\s*(?:sealed\s+|abstract\s+|static\s+|partial\s+)*(class|struct|interface|enum)\s+([A-Za-z_]\w*)'
$fieldRegex = [regex]'(?im)^\s*(?:public|private|protected|internal)\s+(?:static\s+|readonly\s+|const\s+)*(float|int|double|bool)\s+(\w*(?:speed|torque|power|accel|force|mass|fuel|damage|rate|multiplier|amount|capacity|chance|weight|hp)\w*)\s*[;=]'

$results = @{}
foreach ($t in $themes.Keys) { $results[$t] = New-Object System.Collections.Generic.List[object] }
$fieldCandidates = New-Object System.Collections.Generic.List[object]

$i = 0
foreach ($f in $csFiles) {
    $i++
    if (($i % 500) -eq 0) { Write-Host "         $i / $($csFiles.Count)" }
    $text = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $text) { continue }

    $types = @($typeRegex.Matches($text) | ForEach-Object { $_.Groups[2].Value } | Select-Object -Unique)

    foreach ($t in $themes.Keys) {
        $total    = 0
        $distinct = 0
        $evidence = New-Object System.Collections.Generic.List[string]
        foreach ($p in $themes[$t].Muster) {
            $m = [regex]::Matches($text, $p, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
            if ($m.Count -gt 0) {
                $total += $m.Count
                $distinct++
                $sample = @($m | ForEach-Object { $_.Value } | Select-Object -Unique -First 2)
                foreach ($s in $sample) { if (-not $evidence.Contains($s)) { $evidence.Add($s) | Out-Null } }
            }
        }
        # Treffer im Dateinamen zaehlen stark - dann heisst die Klasse schon so
        $nameBonus = 0
        foreach ($p in $themes[$t].Muster) { if ($f.BaseName -match $p) { $nameBonus += 30 } }

        # Verschiedene Stichworte sind aussagekraeftiger als viele Wiederholungen desselben
        $score = $total + ($distinct * 10) + $nameBonus

        if (($distinct -ge 2 -and $score -ge 25) -or $nameBonus -gt 0) {
            $results[$t].Add([pscustomobject]@{
                Datei     = $f.FullName
                Klassen   = $types
                Score     = $score
                Distinct  = $distinct
                NameHit   = ($nameBonus -gt 0)
                Belege    = ($evidence | Select-Object -First 10)
            }) | Out-Null
        }
    }

    foreach ($fm in $fieldRegex.Matches($text)) {
        $fieldCandidates.Add([pscustomobject]@{
            Datei = $f.FullName
            Typ   = $fm.Groups[1].Value
            Feld  = $fm.Groups[2].Value
            Zeile = $fm.Value.Trim()
        }) | Out-Null
    }
}

# ---------------------------------------------------------------- Bericht

$md = New-Object System.Collections.Generic.List[string]
function Add-Md { param([string]$L = '') $md.Add($L) | Out-Null }

Add-Md '# Relevante Klassen im dekompilierten Spielcode'
Add-Md ''
Add-Md "**Spiel:** ``$GamePath``  "
Add-Md "**Quellcode:** ``$SourceDir``  "
Add-Md "**Backend:** $(if ($isIl2Cpp) { 'IL2CPP' } else { 'Mono' })  "
Add-Md "**Durchsuchte Dateien:** $($csFiles.Count)  "
Add-Md ("**Erstellt:** {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Md ''
if ($isIl2Cpp) {
    Add-Md '> Hinweis: Bei IL2CPP stammen die Quellen aus den Il2Cpp-Interop-Assemblies. Klassennamen, Felder und Signaturen sind vollstaendig, **Methodenkoerper fehlen**. Fuer echte Logik Cpp2IL (`-Cpp2IlPath`) oder Il2CppDumper verwenden.'
    Add-Md ''
}

foreach ($t in $themes.Keys) {
    $list = @($results[$t] | Sort-Object Score -Descending | Select-Object -First $Top)
    Add-Md "## $t"
    Add-Md ''
    Add-Md "_$($themes[$t].Beschreibung)_"
    Add-Md ''
    if ($list.Count -eq 0) {
        Add-Md 'Keine passenden Dateien gefunden. Entweder heissen die Klassen anders, oder der Code liegt in einer Assembly, die nicht dekompiliert wurde.'
        Add-Md ''
        continue
    }
    Add-Md '| Datei | Klassen | Score | Stichworte | Belege |'
    Add-Md '|---|---|---|---|---|'
    foreach ($r in $list) {
        $rel = $r.Datei -replace [regex]::Escape((Resolve-Path -LiteralPath $SourceDir).Path), '.'
        $kl  = if ($r.Klassen.Count -gt 0) { (($r.Klassen | Select-Object -First 4) -join ', ') } else { '(keine)' }
        $bel = (($r.Belege | Select-Object -First 6) -join ', ')
        $marker = if ($r.NameHit) { ' **(Name passt)**' } else { '' }
        Add-Md ("| ``{0}``{1} | {2} | {3} | {4} | {5} |" -f $rel, $marker, $kl, $r.Score, $r.Distinct, $bel)
    }
    Add-Md ''
    Write-Host ("  {0,-32} {1,3} Datei(en)" -f $t, $list.Count) -ForegroundColor Green
}

# Feldkandidaten - direkte Ziele fuer einen Tuning-Mod
$topFields = @($fieldCandidates | Group-Object Feld | Sort-Object Count -Descending | Select-Object -First 40)
Add-Md '## Numerische Feldkandidaten fuer einen Tuning-Mod'
Add-Md ''
if ($topFields.Count -eq 0) {
    Add-Md 'Keine gefunden.'
} else {
    Add-Md 'Felder mit Namen, die auf Balancing-Werte hindeuten. Genau diese sind die typischen Angriffspunkte fuer einen Harmony-Postfix oder ein direktes Setzen beim Szenenstart.'
    Add-Md ''
    Add-Md '| Feld | Typ | Vorkommen | Beispieldatei |'
    Add-Md '|---|---|---|---|'
    foreach ($g in $topFields) {
        $first = $g.Group[0]
        $rel = $first.Datei -replace [regex]::Escape((Resolve-Path -LiteralPath $SourceDir).Path), '.'
        Add-Md ("| ``{0}`` | {1} | {2} | ``{3}`` |" -f $g.Name, $first.Typ, $g.Count, $rel)
    }
}
Add-Md ''

Add-Md '## Naechster Schritt'
Add-Md ''
Add-Md 'Die oben markierten Klassen im Editor oeffnen und pruefen, ob die Werte'
Add-Md 'a) Felder einer MonoBehaviour-Instanz sind (dann zur Laufzeit ueber `Object.FindObjectsOfType<T>()` setzbar) oder'
Add-Md 'b) aus einem ScriptableObject/Asset geladen werden (dann besser die Ladefunktion mit Harmony patchen).'
Add-Md ''
Add-Md 'Bei Koop ueber EOS zusaetzlich pruefen, ob der Wert nur lokal wirkt oder repliziert wird - sonst weicht das eigene Fahrverhalten vom Bild der Mitspieler ab.'
Add-Md ''

if (-not $ReportPath) {
    $reportDir = Join-Path $PSScriptRoot 'reports'
    if (-not (Test-Path -LiteralPath $reportDir)) { New-Item -ItemType Directory -Path $reportDir -Force | Out-Null }
    $ReportPath = Join-Path $reportDir ("klassen-{0}.md" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$md -join "`r`n" | Set-Content -LiteralPath $ReportPath -Encoding UTF8

Write-Head 'Fertig'
Write-Host "Bericht: $ReportPath" -ForegroundColor Green
Write-Host "Quellcode: $SourceDir" -ForegroundColor Green
