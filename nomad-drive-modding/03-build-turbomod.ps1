<#
.SYNOPSIS
    Baut das TurboMod-Testmod, kopiert es in den Mods-Ordner und prueft das MelonLoader-Log.

.DESCRIPTION
    Erkennt Mono/IL2CPP, ruft "dotnet build" mit den passenden Properties auf,
    legt die fertige DLL in <Spielordner>\Mods ab und kann anschliessend darauf warten,
    dass die Zeile "TurboMod geladen" in MelonLoader\Latest.log auftaucht.

.EXAMPLE
    .\03-build-turbomod.ps1 -GamePath "A:\SteamLibrary\steamapps\common\Nomad Drive Demo"

.EXAMPLE
    # Bauen, deployen und dann bis zu 5 Minuten auf den Logeintrag warten
    .\03-build-turbomod.ps1 -GamePath "A:\..." -WaitForLog 300
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GamePath,

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [ValidateSet('auto', 'Mono', 'Il2Cpp')]
    [string]$Flavor = 'auto',

    # Nur bauen, nicht in den Mods-Ordner kopieren
    [switch]$SkipDeploy,

    # Nach dem Deploy so viele Sekunden auf den Logeintrag warten (0 = nur einmal pruefen)
    [int]$WaitForLog = 0
)

$ErrorActionPreference = 'Stop'

function Write-Head { param([string]$T) Write-Host ''; Write-Host ('=' * 78) -ForegroundColor DarkCyan; Write-Host "  $T" -ForegroundColor Cyan; Write-Host ('=' * 78) -ForegroundColor DarkCyan }
function Write-Ok   { param([string]$T) Write-Host "  [ok]   $T" -ForegroundColor Green }
function Write-Warn { param([string]$T) Write-Host "  [warn] $T" -ForegroundColor Yellow }
function Write-Info { param([string]$T) Write-Host "  [info] $T" }

if (-not (Test-Path -LiteralPath $GamePath -PathType Container)) { throw "Der Pfad '$GamePath' existiert nicht." }
$GamePath = (Resolve-Path -LiteralPath $GamePath).Path

$projPath = Join-Path $PSScriptRoot 'TurboMod\TurboMod.csproj'
if (-not (Test-Path -LiteralPath $projPath)) { $projPath = Join-Path $PSScriptRoot (Join-Path 'TurboMod' 'TurboMod.csproj') }
if (-not (Test-Path -LiteralPath $projPath)) { throw "TurboMod.csproj nicht gefunden (erwartet neben diesem Skript)." }

Write-Head 'TurboMod bauen'

# ------------------------------------------------ Voraussetzungen

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    throw "Das .NET SDK wurde nicht gefunden. Installieren: https://dotnet.microsoft.com/download  (SDK 8.0 genuegt fuer alle hier benoetigten Zielframeworks)"
}
Write-Info ("dotnet SDK: " + (& dotnet --version))

$mlDir = Join-Path $GamePath 'MelonLoader'
if (-not (Test-Path -LiteralPath $mlDir)) {
    throw "MelonLoader ist nicht installiert. Zuerst: .\02-install-melonloader.ps1 -GamePath `"$GamePath`""
}

if ($Flavor -eq 'auto') {
    $Flavor = if (Test-Path -LiteralPath (Join-Path $GamePath 'GameAssembly.dll')) { 'Il2Cpp' } else { 'Mono' }
}
Write-Info "Flavor: $Flavor"

if ($Flavor -eq 'Il2Cpp') {
    $interop = @(
        (Join-Path $mlDir 'Il2CppAssemblies'),
        (Join-Path $mlDir 'Managed')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if (-not $interop) {
        Write-Warn 'Es gibt noch keine Il2Cpp-Interop-Assemblies.'
        Write-Warn 'Das Spiel muss nach der MelonLoader-Installation einmal gestartet werden -'
        Write-Warn 'Il2CppInterop generiert die Assemblies dann beim ersten Start (dauert einige Minuten).'
        throw 'Abbruch: MelonLoader\Il2CppAssemblies fehlt.'
    }
    $count = @(Get-ChildItem -LiteralPath $interop -Filter '*.dll' -File).Count
    Write-Ok "Interop-Assemblies: $count DLLs in $(Split-Path $interop -Leaf)"

    if (-not (Test-Path -LiteralPath (Join-Path $interop 'Assembly-CSharp.dll'))) {
        Write-Warn 'Assembly-CSharp.dll fehlt in den Interop-Assemblies - dann heisst der Spielcode dort evtl. anders.'
    }
}

# ------------------------------------------------ Build

$buildArgs = @(
    'build', $projPath,
    '-c', $Configuration,
    "-p:GamePath=$GamePath",
    "-p:Flavor=$Flavor",
    '--nologo',
    '-v', 'minimal'
)
Write-Info ('dotnet ' + ($buildArgs -join ' '))
& dotnet @buildArgs
if ($LASTEXITCODE -ne 0) { throw "Build fehlgeschlagen (Exitcode $LASTEXITCODE)." }
Write-Ok 'Build erfolgreich'

$outDir = Join-Path (Split-Path $projPath -Parent) (Join-Path 'bin' $Configuration)
$dll = Get-ChildItem -LiteralPath $outDir -Filter 'TurboMod.dll' -File -Recurse -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $dll) { throw "TurboMod.dll wurde nicht gefunden (gesucht unter $outDir)." }
Write-Ok ("Artefakt: {0} ({1:N0} Bytes)" -f $dll.FullName, $dll.Length)

# ------------------------------------------------ Deploy

if ($SkipDeploy) {
    Write-Info 'Deploy uebersprungen (-SkipDeploy).'
    return
}

$modsDir = Join-Path $GamePath 'Mods'
if (-not (Test-Path -LiteralPath $modsDir)) { New-Item -ItemType Directory -Path $modsDir -Force | Out-Null }

$target = Join-Path $modsDir 'TurboMod.dll'
$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($GamePath, [StringComparison]::OrdinalIgnoreCase) })
if ($running.Count -gt 0) {
    Write-Warn "Das Spiel laeuft gerade ($($running[0].ProcessName)) - die DLL ist evtl. gesperrt."
}
Copy-Item -LiteralPath $dll.FullName -Destination $target -Force
Write-Ok "Kopiert nach $target"

# ------------------------------------------------ Log pruefen

Write-Head 'MelonLoader-Log pruefen'

$logPath = Join-Path $mlDir 'Latest.log'
$needle  = 'TurboMod geladen'

function Test-LogForMod {
    param([string]$Path, [string]$Needle)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $lines = Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue
    $hits  = @($lines | Where-Object { $_ -match [regex]::Escape($Needle) -or $_ -match 'TurboMod' })
    return [pscustomobject]@{
        Exists    = $true
        Lines     = $lines
        Hits      = $hits
        Loaded    = @($lines | Where-Object { $_ -match [regex]::Escape($Needle) }).Count -gt 0
    }
}

if ($WaitForLog -gt 0) {
    Write-Info "Bitte das Spiel jetzt starten. Warte bis zu $WaitForLog Sekunden auf '$needle' ..."
    $deadline = (Get-Date).AddSeconds($WaitForLog)
    $found = $false
    while ((Get-Date) -lt $deadline) {
        $r = Test-LogForMod -Path $logPath -Needle $needle
        if ($r -and $r.Loaded) { $found = $true; break }
        Start-Sleep -Seconds 3
    }
    if (-not $found) { Write-Warn 'Zeitlimit erreicht, ohne den Eintrag zu finden.' }
}

$result = Test-LogForMod -Path $logPath -Needle $needle

if (-not $result) {
    Write-Warn "Noch kein Log unter $logPath."
    Write-Info 'Das Spiel muss mindestens einmal mit installiertem MelonLoader gestartet worden sein.'
    return
}

if ($result.Loaded) {
    Write-Ok "Gefunden - TurboMod wird geladen:"
    foreach ($h in $result.Hits) { Write-Host "         $h" -ForegroundColor Green }
} else {
    Write-Warn "'$needle' steht nicht im Log."
    if ($result.Hits.Count -gt 0) {
        Write-Info 'Immerhin wird TurboMod erwaehnt:'
        foreach ($h in $result.Hits) { Write-Host "         $h" -ForegroundColor Yellow }
    }
    Write-Host ''
    Write-Info 'Geladene Melons laut Log:'
    $melonSection = @($result.Lines | Where-Object { $_ -match 'Melon|Mods? Loaded|Loading Mods|Compatibility Layer|Il2Cpp' } | Select-Object -Last 25)
    foreach ($l in $melonSection) { Write-Host "         $l" }
    Write-Host ''
    Write-Info 'Haeufige Ursachen:'
    Write-Info '  - Spiel seit dem Kopieren nicht neu gestartet'
    Write-Info '  - Falscher Flavor gebaut (Mono-DLL in IL2CPP-Spiel oder umgekehrt)'
    Write-Info '  - MelonLoader-Version der Referenz-DLL passt nicht zur installierten'
    Write-Info '  - Steam-Startoption/Launcher startet eine andere EXE als die gepatchte'
}

Write-Host ''
Write-Info "Vollstaendiges Log: $logPath"
