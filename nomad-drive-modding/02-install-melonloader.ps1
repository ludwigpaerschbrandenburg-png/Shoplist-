<#
.SYNOPSIS
    Installiert MelonLoader in eine Unity-Spielinstallation (Mono oder IL2CPP).

.DESCRIPTION
    Laedt das passende MelonLoader-Release von GitHub, entpackt es in den Spielordner
    und legt die Ordner Mods/, Plugins/ und UserLibs/ an.

    MelonLoader ab 0.6 enthaelt beide Backends in einem Paket und erkennt beim Start
    selbst, ob das Spiel Mono oder IL2CPP ist. Ausgewaehlt wird hier daher nur die
    CPU-Architektur (x64/x86), die aus dem PE-Header der Spiel-EXE gelesen wird.

.EXAMPLE
    .\02-install-melonloader.ps1 -GamePath "A:\SteamLibrary\steamapps\common\Nomad Drive Demo"

.EXAMPLE
    # Offline-Installation mit bereits heruntergeladenem ZIP
    .\02-install-melonloader.ps1 -GamePath "A:\..." -ZipPath "C:\Downloads\MelonLoader.x64.zip"

.EXAMPLE
    # Wieder entfernen
    .\02-install-melonloader.ps1 -GamePath "A:\..." -Uninstall
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GamePath,

    # 'latest' oder ein Tag wie 'v0.6.6'
    [string]$Version = 'latest',

    [ValidateSet('auto', 'x64', 'x86')]
    [string]$Architecture = 'auto',

    # Bereits heruntergeladenes MelonLoader-ZIP verwenden statt zu laden
    [string]$ZipPath,

    # Ueberschreibt eine bestehende Installation ohne Rueckfrage
    [switch]$Force,

    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

function Write-Head { param([string]$T) Write-Host ''; Write-Host ('=' * 78) -ForegroundColor DarkCyan; Write-Host "  $T" -ForegroundColor Cyan; Write-Host ('=' * 78) -ForegroundColor DarkCyan }
function Write-Ok   { param([string]$T) Write-Host "  [ok]   $T" -ForegroundColor Green }
function Write-Warn { param([string]$T) Write-Host "  [warn] $T" -ForegroundColor Yellow }
function Write-Info { param([string]$T) Write-Host "  [info] $T" }

function Get-PeArchitecture {
    param([string]$Path)
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try {
            $br = New-Object System.IO.BinaryReader($fs)
            $fs.Position = 0x3C
            $fs.Position = $br.ReadInt32()
            if ($br.ReadUInt32() -ne 0x00004550) { return $null }
            switch ($br.ReadUInt16()) {
                0x8664 { return 'x64' }
                0x014c { return 'x86' }
                default { return $null }
            }
        }
        finally { $fs.Dispose() }
    }
    catch { return $null }
}

if (-not (Test-Path -LiteralPath $GamePath -PathType Container)) {
    throw "Der Pfad '$GamePath' existiert nicht."
}
$GamePath = (Resolve-Path -LiteralPath $GamePath).Path

$mlDir      = Join-Path $GamePath 'MelonLoader'
$proxyFiles = @('version.dll', 'dobby.dll', 'NOTICE.txt')

# ---------------------------------------------------------------- Deinstallation

if ($Uninstall) {
    Write-Head 'MelonLoader entfernen'
    $removed = 0
    if (Test-Path -LiteralPath $mlDir) {
        Remove-Item -LiteralPath $mlDir -Recurse -Force
        Write-Ok 'MelonLoader/ entfernt'
        $removed++
    }
    foreach ($f in $proxyFiles) {
        $p = Join-Path $GamePath $f
        if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; Write-Ok "$f entfernt"; $removed++ }
    }
    if ($removed -eq 0) { Write-Info 'Nichts zu entfernen gefunden.' }
    Write-Info 'Mods/, Plugins/ und UserLibs/ wurden absichtlich behalten.'
    Write-Info 'Ueber Steam "Dateien auf Fehler ueberpruefen" laufen lassen, um ganz sicher zu sein.'
    return
}

# ---------------------------------------------------------------- Vorpruefungen

Write-Head 'MelonLoader installieren'
Write-Info "Spielordner: $GamePath"

$exe = Get-ChildItem -LiteralPath $GamePath -Filter '*.exe' -File |
       Where-Object { $_.Name -notmatch 'UnityCrashHandler|Uninstall' } |
       Select-Object -First 1
if (-not $exe) { throw 'Keine Spiel-EXE im angegebenen Ordner gefunden.' }
Write-Info "EXE: $($exe.Name)"

# Laeuft das Spiel gerade?
$procName = [System.IO.Path]::GetFileNameWithoutExtension($exe.Name)
$running = @(Get-Process -Name $procName -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) { throw "Das Spiel laeuft gerade ($procName). Bitte zuerst beenden." }

if ($Architecture -eq 'auto') {
    $detected = Get-PeArchitecture -Path $exe.FullName
    if (-not $detected) { throw 'Architektur konnte nicht aus dem PE-Header gelesen werden. Bitte -Architecture x64 oder x86 angeben.' }
    $Architecture = $detected
}
Write-Info "Architektur: $Architecture"

# Backend nur zur Information ausgeben
$dataDir = Get-ChildItem -LiteralPath $GamePath -Directory | Where-Object { $_.Name -like '*_Data' } | Select-Object -First 1
$isIl2Cpp = Test-Path -LiteralPath (Join-Path $GamePath 'GameAssembly.dll')
$backend  = if ($isIl2Cpp) { 'IL2CPP' } else { 'Mono' }
Write-Info "Erkanntes Backend: $backend"

# Konkurrierende Loader?
$bepinex = Join-Path $GamePath 'BepInEx'
if (Test-Path -LiteralPath $bepinex) {
    Write-Warn 'BepInEx ist ebenfalls installiert. Zwei Loader gleichzeitig fuehren haeufig zu Abstuerzen.'
}
if ((Test-Path -LiteralPath $mlDir) -and -not $Force) {
    Write-Warn 'MelonLoader ist bereits installiert.'
    $answer = Read-Host '  Ueberschreiben? (j/N)'
    if ($answer -notmatch '^(j|ja|y|yes)$') { Write-Info 'Abgebrochen.'; return }
}

# ---------------------------------------------------------------- ZIP beschaffen

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('ml-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    if ($ZipPath) {
        if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { throw "ZIP '$ZipPath' nicht gefunden." }
        $zip = (Resolve-Path -LiteralPath $ZipPath).Path
        Write-Info "Verwende lokales ZIP: $zip"
    }
    else {
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

        $apiUrl = if ($Version -eq 'latest') {
            'https://api.github.com/repos/LavaGang/MelonLoader/releases/latest'
        } else {
            "https://api.github.com/repos/LavaGang/MelonLoader/releases/tags/$Version"
        }

        Write-Info "Frage GitHub-Release ab: $apiUrl"
        $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = 'nomad-drive-modding-script' } -UseBasicParsing

        $wanted = "MelonLoader.$Architecture.zip"
        $asset  = $release.assets |
                  Where-Object { $_.name -eq $wanted } |
                  Select-Object -First 1
        if (-not $asset) {
            $asset = $release.assets |
                     Where-Object { $_.name -like "*$Architecture*.zip" -and $_.name -notmatch 'CI|Debug|Linux|Android' } |
                     Select-Object -First 1
        }
        if (-not $asset) {
            $names = ($release.assets | ForEach-Object { $_.name }) -join ', '
            throw "Kein passendes Asset in Release $($release.tag_name) gefunden. Verfuegbar: $names"
        }

        Write-Ok "Release $($release.tag_name), Asset $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)"
        $zip = Join-Path $tempRoot $asset.name
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
        Write-Ok "Heruntergeladen nach $zip"
    }

    # ---------------------------------------------------------------- Entpacken

    $stage = Join-Path $tempRoot 'stage'
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue } catch { }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)
    Write-Ok 'ZIP entpackt'

    # Manche Releases packen alles in einen Unterordner - dann eine Ebene hochziehen.
    $stageItems = @(Get-ChildItem -LiteralPath $stage)
    if ($stageItems.Count -eq 1 -and $stageItems[0].PSIsContainer -and $stageItems[0].Name -ne 'MelonLoader') {
        $stage = $stageItems[0].FullName
    }

    Write-Info 'Kopiere nach:'
    foreach ($item in Get-ChildItem -LiteralPath $stage) {
        Copy-Item -LiteralPath $item.FullName -Destination $GamePath -Recurse -Force
        Write-Host "         $($item.Name)"
    }
    Write-Ok 'MelonLoader-Dateien installiert'

    foreach ($d in @('Mods', 'Plugins', 'UserLibs')) {
        $p = Join-Path $GamePath $d
        if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
    }
    Write-Ok 'Mods/, Plugins/ und UserLibs/ angelegt'
}
finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- Kontrolle

Write-Head 'Ergebnis'
$checks = @(
    @{ Path = Join-Path $GamePath 'version.dll'; Label = 'version.dll (Proxy-Loader)' }
    @{ Path = $mlDir;                            Label = 'MelonLoader/' }
    @{ Path = Join-Path $mlDir 'net6';           Label = 'MelonLoader/net6 (IL2CPP-Mods)' }
    @{ Path = Join-Path $mlDir 'net35';          Label = 'MelonLoader/net35 (Mono-Mods)' }
    @{ Path = Join-Path $GamePath 'Mods';        Label = 'Mods/' }
)
foreach ($c in $checks) {
    if (Test-Path -LiteralPath $c.Path) { Write-Ok $c.Label } else { Write-Warn "$($c.Label) fehlt" }
}

Write-Host ''
Write-Host 'Naechste Schritte:' -ForegroundColor Cyan
Write-Host '  1. Spiel EINMAL starten und wieder beenden.'
if ($isIl2Cpp) {
    Write-Host '     Beim ersten Start erzeugt Il2CppInterop die Interop-Assemblies unter'
    Write-Host '     MelonLoader\Il2CppAssemblies\. Das kann mehrere Minuten dauern.'
}
Write-Host '  2. Log pruefen:  MelonLoader\Latest.log'
Write-Host '  3. Test-Mod bauen: .\03-build-turbomod.ps1 -GamePath "<Spielordner>"'
Write-Host ''
Write-Warn 'Hinweise: Antivirensoftware schlaegt bei version.dll/dobby.dll gelegentlich an (Proxy-DLL-Technik).'
Write-Warn 'Ein Steam-Update kann die Dateien entfernen - dann dieses Skript erneut laufen lassen.'
