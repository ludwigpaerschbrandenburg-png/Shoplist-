<#
.SYNOPSIS
    Analysiert eine Unity-Spielinstallation (z.B. "Nomad Drive Demo") fuer Modding-Zwecke.

.DESCRIPTION
    Beantwortet vier Fragen:
      1. Mono- oder IL2CPP-Build?
      2. Welche DLLs liegen in <Data>/Managed und welche davon sind Spielcode?
      3. Welche Netzwerkloesung wird verwendet (NGO, Mirror, FishNet, Photon, EOS-P2P, ...)?
      4. Gibt es lesbare Konfigurationsdateien in StreamingAssets (Items, Loot, Fahrzeugwerte)?

    Schreibt einen Markdown-Bericht und gibt eine Zusammenfassung auf der Konsole aus.
    Das Spielverzeichnis wird ausschliesslich gelesen, nichts veraendert.

.EXAMPLE
    .\01-analyze.ps1 -GamePath "A:\SteamLibrary\steamapps\common\Nomad Drive Demo"

.EXAMPLE
    .\01-analyze.ps1 -GamePath "A:\SteamLibrary\steamapps\common\Nomad Drive Demo" -SkipDeepScan
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GamePath,

    [string]$ReportPath,

    # Ueberspringt das Durchsuchen grosser Binaerdateien (GameAssembly.dll / global-metadata.dat)
    [switch]$SkipDeepScan,

    # Anzahl Zeilen pro Vorschau einer Textdatei in StreamingAssets
    [int]$PreviewLines = 20
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

# ---------------------------------------------------------------- Hilfsfunktionen

$script:Latin1 = [System.Text.Encoding]::GetEncoding(28591)

function Write-Head {
    param([string]$Text)
    Write-Host ''
    Write-Host ('=' * 78) -ForegroundColor DarkCyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ('=' * 78) -ForegroundColor DarkCyan
}

function Format-Size {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N1} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

# Durchsucht eine (auch sehr grosse) Binaerdatei streamend nach ASCII-Zeichenketten.
function Search-BinaryNeedles {
    param(
        [string]$Path,
        [string[]]$Needles,
        [int]$ChunkSize = 8388608
    )
    $result = [ordered]@{}
    foreach ($n in $Needles) { $result[$n] = 0 }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $result }

    $maxNeedle = ($Needles | Measure-Object -Property Length -Maximum).Maximum
    $overlap = [Math]::Max(64, $maxNeedle * 2)

    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $buffer = New-Object byte[] $ChunkSize
        $carry = ''
        while (($read = $fs.Read($buffer, 0, $ChunkSize)) -gt 0) {
            $carryLen = $carry.Length
            $text = $carry + $script:Latin1.GetString($buffer, 0, $read)
            foreach ($n in $Needles) {
                $idx = 0
                while ($idx -ge 0 -and $idx -lt $text.Length) {
                    $idx = $text.IndexOf($n, $idx, [StringComparison]::OrdinalIgnoreCase)
                    if ($idx -lt 0) { break }
                    # Treffer, die komplett im uebernommenen Rest liegen, wurden schon gezaehlt
                    if (($idx + $n.Length) -gt $carryLen) { $result[$n] = $result[$n] + 1 }
                    $idx += $n.Length
                }
            }
            if ($text.Length -gt $overlap) { $carry = $text.Substring($text.Length - $overlap) } else { $carry = $text }
        }
    }
    finally { $fs.Dispose() }
    return $result
}

# Liest die Maschinenarchitektur aus dem PE-Header (x64 / x86).
function Get-PeArchitecture {
    param([string]$Path)
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try {
            $br = New-Object System.IO.BinaryReader($fs)
            $fs.Position = 0x3C
            $peOffset = $br.ReadInt32()
            $fs.Position = $peOffset
            if ($br.ReadUInt32() -ne 0x00004550) { return 'unbekannt' }  # "PE\0\0"
            $machine = $br.ReadUInt16()
            switch ($machine) {
                0x8664  { return 'x64' }
                0x014c  { return 'x86' }
                0xAA64  { return 'arm64' }
                default { return ('unbekannt (0x{0:X4})' -f $machine) }
            }
        }
        finally { $fs.Dispose() }
    }
    catch { return 'unbekannt' }
}

function Get-UnityVersion {
    param([string]$DataPath, [string]$GamePath)

    foreach ($candidate in @('globalgamemanagers', 'data.unity3d')) {
        $f = Join-Path $DataPath $candidate
        if (Test-Path -LiteralPath $f -PathType Leaf) {
            try {
                $fs = [System.IO.File]::OpenRead($f)
                try {
                    $buf = New-Object byte[] 4096
                    $n = $fs.Read($buf, 0, $buf.Length)
                    $head = $script:Latin1.GetString($buf, 0, $n)
                    $m = [regex]::Match($head, '\d{4}\.\d+\.\d+[abfpx]\d+')
                    if ($m.Success) { return $m.Value }
                }
                finally { $fs.Dispose() }
            }
            catch { }
        }
    }

    $up = Join-Path $GamePath 'UnityPlayer.dll'
    if (Test-Path -LiteralPath $up -PathType Leaf) {
        try {
            $v = (Get-Item -LiteralPath $up).VersionInfo.ProductVersion
            if ($v) { return "$v (aus UnityPlayer.dll)" }
        }
        catch { }
    }
    return 'nicht ermittelbar'
}

# ---------------------------------------------------------------- Klassifikationstabellen

# Reihenfolge ist wichtig: erste passende Regel gewinnt.
$Classifiers = @(
    @{ Pattern = '^Assembly-CSharp'                                  ; Kategorie = 'SPIELCODE'   ; Info = 'Kompilierter C#-Code des Spiels - das Hauptziel fuers Modding' }
    @{ Pattern = '^Assembly-UnityScript'                             ; Kategorie = 'SPIELCODE'   ; Info = 'Alter UnityScript-Code des Spiels' }

    @{ Pattern = '^UnityEngine'                                      ; Kategorie = 'UNITY'       ; Info = 'Unity-Engine-Modul' }
    @{ Pattern = '^UnityEditor'                                      ; Kategorie = 'UNITY'       ; Info = 'Unity-Editor-Assembly (sollte im Build eigentlich fehlen)' }
    @{ Pattern = '^Unity\.Netcode'                                   ; Kategorie = 'NETZWERK'    ; Info = 'Unity Netcode for GameObjects (NGO)' }
    @{ Pattern = '^Unity\.Networking\.Transport'                     ; Kategorie = 'NETZWERK'    ; Info = 'Unity Transport (UTP) - Low-Level-Layer unter NGO' }
    @{ Pattern = '^Unity\.Multiplayer'                               ; Kategorie = 'NETZWERK'    ; Info = 'Unity Multiplayer Tools/Widgets' }
    @{ Pattern = '^Unity\.Services'                                  ; Kategorie = 'DRITTANBIETER'; Info = 'Unity Gaming Services (Lobby/Relay/Auth)' }
    @{ Pattern = '^Unity\.|^com\.unity\.|^Cinemachine$'              ; Kategorie = 'UNITY'       ; Info = 'Unity-Package' }

    @{ Pattern = '^Mirror'                                           ; Kategorie = 'NETZWERK'    ; Info = 'Mirror Networking' }
    @{ Pattern = '^Telepathy$|^kcp2k$|^SimpleWebTransport|^Edgegap'  ; Kategorie = 'NETZWERK'    ; Info = 'Mirror-Transportschicht' }
    @{ Pattern = '^FishNet|^GameKit'                                 ; Kategorie = 'NETZWERK'    ; Info = 'FishNet (Fish-Networking)' }
    @{ Pattern = '^Photon|^PhotonRealtime|^PhotonUnityNetworking'    ; Kategorie = 'NETZWERK'    ; Info = 'Photon (PUN / Realtime)' }
    @{ Pattern = '^Fusion'                                           ; Kategorie = 'NETZWERK'    ; Info = 'Photon Fusion' }
    @{ Pattern = '^Quantum'                                          ; Kategorie = 'NETZWERK'    ; Info = 'Photon Quantum' }
    @{ Pattern = '^LiteNetLib'                                       ; Kategorie = 'NETZWERK'    ; Info = 'LiteNetLib (reliable UDP) - oft Unterbau eigener Loesungen' }
    @{ Pattern = '^Riptide'                                          ; Kategorie = 'NETZWERK'    ; Info = 'Riptide Networking' }
    @{ Pattern = '^DarkRift'                                         ; Kategorie = 'NETZWERK'    ; Info = 'DarkRift Networking' }
    @{ Pattern = '^Nakama|^Heroic'                                   ; Kategorie = 'NETZWERK'    ; Info = 'Nakama Backend' }
    @{ Pattern = '^MLAPI'                                            ; Kategorie = 'NETZWERK'    ; Info = 'MLAPI (Vorgaenger von NGO)' }
    @{ Pattern = '^Netcode'                                          ; Kategorie = 'NETZWERK'    ; Info = 'Netcode-Transport/Adapter' }
    @{ Pattern = '^Epic|^EOSSDK|^EpicOnlineServices|^PlayEveryWare'  ; Kategorie = 'NETZWERK'    ; Info = 'Epic Online Services SDK (Lobby / P2P / Auth)' }
    @{ Pattern = '^Steamworks|^Facepunch'                            ; Kategorie = 'NETZWERK'    ; Info = 'Steamworks (Steam-Lobby / Steam-P2P)' }

    @{ Pattern = '^mscorlib$|^netstandard$|^System($|\.)'            ; Kategorie = 'BCL'         ; Info = '.NET-Basisklassenbibliothek' }
    @{ Pattern = '^Mono\.|^I18N|^Microsoft\.(CSharp|Win32|Bcl)'      ; Kategorie = 'BCL'         ; Info = 'Mono-/.NET-Laufzeitbibliothek' }

    @{ Pattern = '^Newtonsoft\.Json'                                 ; Kategorie = 'DRITTANBIETER'; Info = 'JSON.NET - Hinweis auf JSON-Konfigurationen zur Laufzeit' }
    @{ Pattern = '^YamlDotNet|^Tommy$|^SharpConfig'                  ; Kategorie = 'DRITTANBIETER'; Info = 'Konfigurations-/Serialisierungsbibliothek' }
    @{ Pattern = '^Sirenix'                                          ; Kategorie = 'DRITTANBIETER'; Info = 'Odin Inspector/Serializer - haeufig fuer ScriptableObject-Daten' }
    @{ Pattern = '^DOTween'                                          ; Kategorie = 'DRITTANBIETER'; Info = 'DOTween (Animation)' }
    @{ Pattern = '^Rewired'                                          ; Kategorie = 'DRITTANBIETER'; Info = 'Rewired (Input)' }
    @{ Pattern = '^FMOD|^fmod'                                       ; Kategorie = 'DRITTANBIETER'; Info = 'FMOD (Audio)' }
    @{ Pattern = '^AK\.|^Wwise'                                      ; Kategorie = 'DRITTANBIETER'; Info = 'Wwise (Audio)' }
    @{ Pattern = '^UniTask|^Cysharp|^ZString'                        ; Kategorie = 'DRITTANBIETER'; Info = 'Cysharp/UniTask' }
    @{ Pattern = '^Google\.Protobuf|^protobuf'                       ; Kategorie = 'DRITTANBIETER'; Info = 'Protocol Buffers' }
    @{ Pattern = '^Discord'                                          ; Kategorie = 'DRITTANBIETER'; Info = 'Discord Game SDK' }
    @{ Pattern = '^ICSharpCode|^Ionic\.'                             ; Kategorie = 'DRITTANBIETER'; Info = 'Kompressionsbibliothek' }
    @{ Pattern = '^JetBrains|^Rider'                                 ; Kategorie = 'DRITTANBIETER'; Info = 'JetBrains Annotations' }
    @{ Pattern = '^Amplify|^Crest|^Bakery|^Beautify|^MicroSplat'     ; Kategorie = 'DRITTANBIETER'; Info = 'Asset-Store-Renderingpaket' }
    @{ Pattern = '^Obi|^FinalIK|^RootMotion|^EasyRoads|^Gley'        ; Kategorie = 'DRITTANBIETER'; Info = 'Asset-Store-Gameplaypaket' }
    @{ Pattern = '^NWH|^EdyVehicle|^RCC|^VehiclePhysics|^Ashsvp'     ; Kategorie = 'DRITTANBIETER'; Info = 'Fahrzeugphysik-Asset - sehr interessant fuer Fahrwerte!' }
)

function Get-DllClassification {
    param([string]$Name)
    foreach ($c in $Classifiers) {
        if ($Name -match $c.Pattern) {
            return [pscustomobject]@{ Kategorie = $c.Kategorie; Info = $c.Info }
        }
    }
    return [pscustomobject]@{ Kategorie = 'VERMUTLICH SPIELCODE'; Info = 'Passt zu keiner bekannten Unity-/Fremdbibliothek - vermutlich eigener Code des Studios' }
}

# ---------------------------------------------------------------- Start

if (-not (Test-Path -LiteralPath $GamePath -PathType Container)) {
    throw "Der Pfad '$GamePath' existiert nicht oder ist kein Ordner."
}
$GamePath = (Resolve-Path -LiteralPath $GamePath).Path

$md = New-Object System.Collections.Generic.List[string]
function Add-Md { param([string]$Line = '') ; $md.Add($Line) | Out-Null }

Add-Md "# Analyse der Unity-Installation"
Add-Md ''
Add-Md "**Pfad:** ``$GamePath``  "
Add-Md ("**Erstellt:** {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Md ''

Write-Head 'Nomad Drive Demo - Modding-Analyse'
Write-Host "Spielpfad: $GamePath"

# ---------------------------------------------------------------- 0. Grundstruktur

$exeFiles = @(Get-ChildItem -LiteralPath $GamePath -Filter '*.exe' -File -ErrorAction SilentlyContinue)
$dataDirs = @(Get-ChildItem -LiteralPath $GamePath -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*_Data' })

$mainExe = $null
$dataPath = $null

if ($dataDirs.Count -gt 0) {
    $dataPath = $dataDirs[0].FullName
    $expectedExe = ($dataDirs[0].Name -replace '_Data$', '') + '.exe'
    $mainExe = $exeFiles | Where-Object { $_.Name -eq $expectedExe } | Select-Object -First 1
}
if (-not $mainExe -and $exeFiles.Count -gt 0) {
    $mainExe = $exeFiles | Where-Object { $_.Name -notmatch 'UnityCrashHandler|Uninstall' } | Select-Object -First 1
}

Add-Md '## 0. Grundstruktur'
Add-Md ''
if ($mainExe) {
    $arch = Get-PeArchitecture -Path $mainExe.FullName
    Add-Md "- Ausfuehrbare Datei: ``$($mainExe.Name)`` ($arch, $(Format-Size $mainExe.Length))"
    Write-Host "Executable : $($mainExe.Name)  [$arch]"
} else {
    Add-Md '- **Keine .exe gefunden** - ist das wirklich der Installationsordner?'
    Write-Host 'Executable : keine gefunden' -ForegroundColor Yellow
}

if ($dataPath) {
    Add-Md "- Data-Ordner: ``$(Split-Path $dataPath -Leaf)``"
    Write-Host "Data-Ordner: $(Split-Path $dataPath -Leaf)"
} else {
    Add-Md '- **Kein `*_Data`-Ordner gefunden** - Unity-Build unklar.'
    Write-Host 'Data-Ordner: nicht gefunden' -ForegroundColor Yellow
}

$unityVersion = if ($dataPath) { Get-UnityVersion -DataPath $dataPath -GamePath $GamePath } else { 'nicht ermittelbar' }
Add-Md "- Unity-Version: **$unityVersion**"
Write-Host "Unity      : $unityVersion"
Add-Md ''

# ---------------------------------------------------------------- 1. Mono oder IL2CPP

Write-Head '1. Scripting-Backend: Mono oder IL2CPP?'

$managedPath   = if ($dataPath) { Join-Path $dataPath 'Managed' } else { $null }
$gameAssembly  = Join-Path $GamePath 'GameAssembly.dll'
$metadataPath  = if ($dataPath) { Join-Path (Join-Path (Join-Path $dataPath 'il2cpp_data') 'Metadata') 'global-metadata.dat' } else { $null }

$hasGameAssembly = Test-Path -LiteralPath $gameAssembly -PathType Leaf
$hasMetadata     = $metadataPath -and (Test-Path -LiteralPath $metadataPath -PathType Leaf)
$hasManagedDir   = $managedPath -and (Test-Path -LiteralPath $managedPath -PathType Container)
$hasAsmCSharp    = $hasManagedDir -and (Test-Path -LiteralPath (Join-Path $managedPath 'Assembly-CSharp.dll') -PathType Leaf)
$monoRuntimeDlls = @(Get-ChildItem -LiteralPath $GamePath -Recurse -Depth 3 -Filter 'mono*.dll' -File -ErrorAction SilentlyContinue |
                     Where-Object { $_.Name -match '^mono(bdwgc|-2\.0)' })

$backend = 'UNKLAR'
if ($hasGameAssembly -and $hasMetadata) { $backend = 'IL2CPP' }
elseif ($hasAsmCSharp -and -not $hasGameAssembly) { $backend = 'MONO' }
elseif ($hasGameAssembly) { $backend = 'IL2CPP (Metadaten nicht am Standardort)' }
elseif ($hasAsmCSharp) { $backend = 'MONO' }

Add-Md '## 1. Scripting-Backend'
Add-Md ''
Add-Md "### Ergebnis: **$backend**"
Add-Md ''
Add-Md '| Indikator | Vorhanden |'
Add-Md '|---|---|'
Add-Md "| ``GameAssembly.dll`` im Root | $(if ($hasGameAssembly) { "JA ($(Format-Size (Get-Item -LiteralPath $gameAssembly).Length))" } else { 'nein' }) |"
Add-Md "| ``<Data>/il2cpp_data/Metadata/global-metadata.dat`` | $(if ($hasMetadata) { "JA ($(Format-Size (Get-Item -LiteralPath $metadataPath).Length))" } else { 'nein' }) |"
Add-Md "| ``<Data>/Managed/`` | $(if ($hasManagedDir) { 'JA' } else { 'nein' }) |"
Add-Md "| ``<Data>/Managed/Assembly-CSharp.dll`` | $(if ($hasAsmCSharp) { "JA ($(Format-Size (Get-Item -LiteralPath (Join-Path $managedPath 'Assembly-CSharp.dll')).Length))" } else { 'nein' }) |"
Add-Md "| Mono-Laufzeit (``mono-2.0-bdwgc.dll``) | $(if ($monoRuntimeDlls.Count -gt 0) { 'JA' } else { 'nein' }) |"
Add-Md ''

switch -Wildcard ($backend) {
    'IL2CPP*' {
        Add-Md '**Konsequenz fuers Modding:** Der C#-Code wurde nach C++ transpiliert und nativ kompiliert. Es gibt keine editierbaren Managed-DLLs. Fuer MelonLoader ist das der IL2CPP-Pfad (Il2CppInterop erzeugt beim ersten Start Interop-Assemblies). Zum Lesen des Quellcodes wird Cpp2IL/Il2CppDumper benoetigt.'
        Write-Host "Backend: IL2CPP" -ForegroundColor Yellow
    }
    'MONO' {
        Add-Md '**Konsequenz fuers Modding:** Der C#-Code liegt als normale .NET-Assembly vor. Direkt mit ILSpy/dnSpy lesbar und mit Harmony patchbar - der einfachste Fall.'
        Write-Host "Backend: MONO" -ForegroundColor Green
    }
    default {
        Add-Md '**Konsequenz fuers Modding:** Backend nicht eindeutig - bitte den Ordnerinhalt manuell pruefen.'
        Write-Host "Backend: UNKLAR" -ForegroundColor Red
    }
}
Add-Md ''

# ---------------------------------------------------------------- 2. DLL-Inventar

Write-Head '2. DLL-Inventar'

Add-Md '## 2. DLL-Inventar'
Add-Md ''

$managedDlls = @()
if ($hasManagedDir) {
    $managedDlls = @(Get-ChildItem -LiteralPath $managedPath -Filter '*.dll' -File | Sort-Object Name)
}

if ($managedDlls.Count -eq 0) {
    if ($backend -like 'IL2CPP*') {
        Add-Md 'Kein ``Managed``-Ordner - erwartungsgemaess bei IL2CPP. Die Typinformationen stecken in ``global-metadata.dat``; lesbare Interop-Assemblies entstehen erst durch MelonLoader (``MelonLoader/Il2CppAssemblies/``) oder durch Cpp2IL/Il2CppDumper.'
    } else {
        Add-Md 'Kein ``Managed``-Ordner gefunden.'
    }
    Write-Host 'Kein Managed-Ordner vorhanden.' -ForegroundColor Yellow
} else {
    $rows = foreach ($dll in $managedDlls) {
        $base = [System.IO.Path]::GetFileNameWithoutExtension($dll.Name)
        $cls  = Get-DllClassification -Name $base
        [pscustomobject]@{
            Name      = $dll.Name
            Groesse   = Format-Size $dll.Length
            Kategorie = $cls.Kategorie
            Info      = $cls.Info
        }
    }

    Add-Md ("Gefunden: **{0} DLLs** in ``{1}``" -f $managedDlls.Count, ($managedPath -replace [regex]::Escape($GamePath), '<Game>'))
    Add-Md ''
    $order = @('SPIELCODE', 'VERMUTLICH SPIELCODE', 'NETZWERK', 'DRITTANBIETER', 'UNITY', 'BCL')
    foreach ($kat in $order) {
        $group = @($rows | Where-Object { $_.Kategorie -eq $kat })
        if ($group.Count -eq 0) { continue }
        $label = switch ($kat) {
            'SPIELCODE'            { 'Spielcode (Hauptziel)' }
            'VERMUTLICH SPIELCODE' { 'Vermutlich Spielcode / Studio-Assemblies' }
            'NETZWERK'             { 'Netzwerk- und Online-Bibliotheken' }
            'DRITTANBIETER'        { 'Drittanbieter-Bibliotheken' }
            'UNITY'                { 'Unity-Engine-Module' }
            'BCL'                  { '.NET-/Mono-Basisbibliotheken' }
        }
        Add-Md "### $label ($($group.Count))"
        Add-Md ''
        Add-Md '| DLL | Groesse | Bedeutung |'
        Add-Md '|---|---|---|'
        foreach ($r in $group) { Add-Md ("| ``{0}`` | {1} | {2} |" -f $r.Name, $r.Groesse, $r.Info) }
        Add-Md ''
    }

    $rows | Group-Object Kategorie | Sort-Object Count -Descending | ForEach-Object {
        Write-Host ("  {0,-22} {1,3} DLL(s)" -f $_.Name, $_.Count)
    }
}

# Native Plugins mit auswerten - dort steckt bei EOS-Spielen die entscheidende DLL.
$pluginRoots = @()
if ($dataPath) { $pluginRoots += (Join-Path $dataPath 'Plugins') }
$nativePlugins = @()
foreach ($pr in $pluginRoots) {
    if (Test-Path -LiteralPath $pr -PathType Container) {
        $nativePlugins += @(Get-ChildItem -LiteralPath $pr -Recurse -Include '*.dll', '*.so' -File -ErrorAction SilentlyContinue)
    }
}
$nativePlugins += @(Get-ChildItem -LiteralPath $GamePath -Filter '*.dll' -File -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -notmatch '^(UnityPlayer|GameAssembly|WinPixEventRuntime|D3D12Core|d3d12SDKLayers|baselib)' })

Add-Md '### Native Plugins / Root-DLLs'
Add-Md ''
if ($nativePlugins.Count -eq 0) {
    Add-Md 'Keine gefunden.'
} else {
    Add-Md '| Datei | Groesse | Hinweis |'
    Add-Md '|---|---|---|'
    foreach ($p in ($nativePlugins | Sort-Object Name -Unique)) {
        $hint = ''
        if ($p.Name -match 'EOSSDK|EpicOnlineServices') { $hint = 'Epic Online Services SDK (nativ)' }
        elseif ($p.Name -match 'steam_api')             { $hint = 'Steamworks (nativ)' }
        elseif ($p.Name -match 'fmod')                  { $hint = 'FMOD Audio' }
        elseif ($p.Name -match 'discord')               { $hint = 'Discord SDK' }
        Add-Md ("| ``{0}`` | {1} | {2} |" -f $p.Name, (Format-Size $p.Length), $hint)
    }
}
Add-Md ''

# ---------------------------------------------------------------- 3. Netzwerkloesung

Write-Head '3. Netzwerkloesung'

Add-Md '## 3. Netzwerkloesung'
Add-Md ''

# Signaturen: Namespace-/Typnamen, die im Binaerbild auftauchen muessen.
$netSignatures = [ordered]@{
    'Unity Netcode for GameObjects (NGO)' = @('Unity.Netcode', 'NetworkVariable', 'ServerRpcAttribute', 'NetworkBehaviourReference')
    'Unity Transport (UTP)'               = @('Unity.Networking.Transport', 'NetworkDriver', 'RelayServerData')
    'Mirror'                              = @('Mirror.NetworkIdentity', 'Mirror.NetworkBehaviour', 'SyncVarAttribute', 'Telepathy')
    'FishNet'                             = @('FishNet.Object', 'FishNet.Managing', 'SyncVar<', 'NetworkConnection')
    'Photon PUN / Realtime'               = @('Photon.Pun', 'Photon.Realtime', 'PhotonNetwork', 'ExitGames.Client')
    'Photon Fusion'                       = @('Fusion.NetworkRunner', 'Fusion.Simulation', 'NetworkedAttribute')
    'MLAPI (alt)'                         = @('MLAPI.NetworkingManager')
    'LiteNetLib'                          = @('LiteNetLib.NetManager', 'LiteNetLib.NetPeer')
    'Riptide'                             = @('Riptide.Server', 'RiptideNetworking')
    'DarkRift'                            = @('DarkRift.Server')
    'Epic Online Services (P2P/Lobby)'    = @('Epic.OnlineServices', 'EOS_P2P', 'EOS_Lobby', 'P2PInterface', 'LobbyInterface', 'SendPacketOptions')
    'Steamworks (P2P/Lobby)'              = @('Steamworks.SteamNetworking', 'SteamMatchmaking', 'CSteamID')
}

$scanTargets = @()
if ($hasAsmCSharp) { $scanTargets += (Join-Path $managedPath 'Assembly-CSharp.dll') }
if ($hasManagedDir) {
    $scanTargets += @($managedDlls | Where-Object { (Get-DllClassification -Name ([System.IO.Path]::GetFileNameWithoutExtension($_.Name))).Kategorie -eq 'VERMUTLICH SPIELCODE' } | ForEach-Object { $_.FullName })
}
if (-not $SkipDeepScan) {
    if ($hasMetadata)     { $scanTargets += $metadataPath }
    if ($hasGameAssembly) { $scanTargets += $gameAssembly }
}
$scanTargets = @($scanTargets | Select-Object -Unique)

$allNeedles = @()
foreach ($k in $netSignatures.Keys) { $allNeedles += $netSignatures[$k] }
$allNeedles = @($allNeedles | Select-Object -Unique)

$hits = [ordered]@{}
foreach ($n in $allNeedles) { $hits[$n] = 0 }

if ($scanTargets.Count -eq 0) {
    Add-Md 'Keine durchsuchbaren Binaerdateien gefunden - Netzwerkloesung nicht bestimmbar.'
    Write-Host 'Keine Scan-Ziele gefunden.' -ForegroundColor Yellow
} else {
    Add-Md 'Durchsuchte Dateien:'
    Add-Md ''
    foreach ($t in $scanTargets) {
        $rel = $t -replace [regex]::Escape($GamePath), '<Game>'
        $sz  = Format-Size (Get-Item -LiteralPath $t).Length
        Add-Md "- ``$rel`` ($sz)"
        Write-Host "  scanne $rel ($sz) ..."
        $r = Search-BinaryNeedles -Path $t -Needles $allNeedles
        foreach ($n in $allNeedles) { $hits[$n] = $hits[$n] + $r[$n] }
    }
    Add-Md ''

    # DLL-Namen zaehlen ebenfalls als starker Beleg.
    $netDllNames = @($managedDlls | Where-Object { (Get-DllClassification -Name ([System.IO.Path]::GetFileNameWithoutExtension($_.Name))).Kategorie -eq 'NETZWERK' } | ForEach-Object { $_.Name })

    Add-Md '| Loesung | Signaturtreffer | Bewertung |'
    Add-Md '|---|---|---|'
    $verdicts = @()
    foreach ($sol in $netSignatures.Keys) {
        $sum = 0
        $detail = @()
        foreach ($n in $netSignatures[$sol]) {
            $sum += $hits[$n]
            if ($hits[$n] -gt 0) { $detail += ("{0}={1}" -f $n, $hits[$n]) }
        }
        $verdict = if ($sum -eq 0) { 'nicht gefunden' } elseif ($sum -lt 5) { 'schwacher Hinweis' } elseif ($sum -lt 50) { 'wahrscheinlich vorhanden' } else { 'EINDEUTIG VORHANDEN' }
        $verdicts += [pscustomobject]@{ Loesung = $sol; Treffer = $sum; Bewertung = $verdict }
        Add-Md ("| {0} | {1} | {2}{3} |" -f $sol, $sum, $verdict, $(if ($detail.Count) { ' — ' + ($detail -join ', ') } else { '' }))
    }
    Add-Md ''

    $top = @($verdicts | Where-Object { $_.Treffer -gt 0 } | Sort-Object Treffer -Descending)
    Add-Md '### Einschaetzung'
    Add-Md ''
    if ($top.Count -eq 0) {
        Add-Md 'Keine bekannte Netzwerkbibliothek erkannt. Entweder ist der Deep-Scan uebersprungen worden (`-SkipDeepScan`), oder das Spiel benutzt eine hauseigene Loesung direkt auf Sockets/EOS.'
    } else {
        Add-Md ("Staerkstes Signal: **{0}** ({1} Treffer)." -f $top[0].Loesung, $top[0].Treffer)
        Add-Md ''
        if ($netDllNames.Count -gt 0) {
            Add-Md ('Bestaetigt durch DLL-Namen: ' + (($netDllNames | ForEach-Object { "``$_``" }) -join ', '))
            Add-Md ''
        }
        $eosOnly = ($top[0].Loesung -like 'Epic Online Services*')
        if ($eosOnly) {
            Add-Md 'Nur EOS-Signaturen und kein Highlevel-Framework: das Spiel setzt sehr wahrscheinlich **direkt auf EOS P2P/Lobby** auf und serialisiert seine Pakete selbst. Fuer Mods heisst das: es gibt keine bekannten `[ServerRpc]`-Konventionen, sondern eine spieleigene Nachrichtenschicht, die man erst im dekompilierten Code (Schritt 3) verstehen muss.'
        } else {
            Add-Md 'Ein Highlevel-Framework ist vorhanden. EOS wird dann typischerweise nur fuer Login/Lobby/NAT-Traversal benutzt, waehrend die Spiellogik ueber das Framework repliziert.'
        }
        foreach ($v in $top) { Write-Host ("  {0,-38} {1,6} Treffer  {2}" -f $v.Loesung, $v.Treffer, $v.Bewertung) }
    }
}
Add-Md ''

# ---------------------------------------------------------------- 4. StreamingAssets

Write-Head '4. StreamingAssets'

Add-Md '## 4. StreamingAssets'
Add-Md ''

$saPath = if ($dataPath) { Join-Path $dataPath 'StreamingAssets' } else { $null }
if (-not $saPath -or -not (Test-Path -LiteralPath $saPath -PathType Container)) {
    Add-Md 'Kein ``StreamingAssets``-Ordner vorhanden. Item-, Loot- und Fahrzeugdaten stecken dann in Unity-Assets (ScriptableObjects in ``resources.assets`` / ``*.bundle``) und sind nur mit AssetRipper oder UABEA zugaenglich - oder sie sind fest im Code hinterlegt.'
    Write-Host 'Kein StreamingAssets-Ordner.' -ForegroundColor Yellow
} else {
    $saFiles = @(Get-ChildItem -LiteralPath $saPath -Recurse -File -ErrorAction SilentlyContinue)
    Add-Md ("Gefunden: **{0} Dateien**, gesamt {1}." -f $saFiles.Count, (Format-Size (($saFiles | Measure-Object Length -Sum).Sum)))
    Add-Md ''

    $textExt = @('.json', '.xml', '.csv', '.tsv', '.txt', '.yaml', '.yml', '.ini', '.cfg', '.config', '.lua', '.js', '.md', '.toml', '.dat')
    $keyword = 'item|loot|drop|spawn|vehicle|car|rv|camper|engine|motor|fuel|speed|recipe|craft|scaveng|camp|table|balanc|stat|config|tuning|upgrade|part'

    $byExt = $saFiles | Group-Object { $_.Extension.ToLowerInvariant() } | Sort-Object Count -Descending
    Add-Md '| Endung | Anzahl |'
    Add-Md '|---|---|'
    foreach ($g in $byExt) { Add-Md ("| ``{0}`` | {1} |" -f $(if ($g.Name) { $g.Name } else { '(keine)' }), $g.Count) }
    Add-Md ''

    $textFiles = @($saFiles | Where-Object { $textExt -contains $_.Extension.ToLowerInvariant() })
    $interesting = @($textFiles | Where-Object { $_.Name -match $keyword -or $_.DirectoryName -match $keyword })

    Add-Md ("### Lesbare Textdateien: {0} (davon {1} thematisch interessant)" -f $textFiles.Count, $interesting.Count)
    Add-Md ''

    if ($textFiles.Count -eq 0) {
        Add-Md 'Keine lesbaren Konfigurationsdateien. Alles liegt in Unity-Bundles / Addressables.'
        Write-Host 'Keine lesbaren Konfigurationsdateien gefunden.' -ForegroundColor Yellow
    } else {
        $show = if ($interesting.Count -gt 0) { $interesting } else { $textFiles | Select-Object -First 25 }
        foreach ($f in $show) {
            $rel = $f.FullName -replace [regex]::Escape($saPath), 'StreamingAssets'
            Add-Md "#### ``$rel`` ($(Format-Size $f.Length))"
            Add-Md ''
            try {
                $head = Get-Content -LiteralPath $f.FullName -TotalCount $PreviewLines -ErrorAction Stop
                $printable = ($head -join "`n")
                # Binaerdateien mit .dat-Endung aussortieren
                $ctrl = ([regex]::Matches($printable, '[\x00-\x08\x0E-\x1F]')).Count
                if ($ctrl -gt ($printable.Length * 0.05)) {
                    Add-Md '_(binaer, keine Vorschau)_'
                } else {
                    Add-Md '```'
                    foreach ($line in $head) { Add-Md ($line -replace '`', "'") }
                    Add-Md '```'
                }
            }
            catch { Add-Md "_(nicht lesbar: $($_.Exception.Message))_" }
            Add-Md ''
        }
        Write-Host ("{0} lesbare Textdateien, {1} thematisch interessant." -f $textFiles.Count, $interesting.Count) -ForegroundColor Green
    }

    # Addressables/Bundles gesondert melden
    $bundles = @($saFiles | Where-Object { $_.Extension -match '^\.(bundle|bin|hash)$' -or $_.Directory.Name -eq 'aa' -or $_.FullName -match '[\\/]aa[\\/]' })
    if ($bundles.Count -gt 0) {
        Add-Md ("### Addressables/AssetBundles: {0} Dateien" -f $bundles.Count)
        Add-Md ''
        Add-Md 'Diese sind nicht im Klartext lesbar. Werkzeuge: **AssetRipper**, **UABEA** oder **AssetStudio**. Dort liegen typischerweise die ScriptableObjects mit Item-Definitionen, Loot-Tabellen und Fahrzeug-Presets.'
        Add-Md ''
    }
}

# ---------------------------------------------------------------- Zusammenfassung

Add-Md '## Zusammenfassung und naechste Schritte'
Add-Md ''
Add-Md "- **Backend:** $backend"
Add-Md "- **Unity:** $unityVersion"
Add-Md ("- **Managed-DLLs:** {0}" -f $managedDlls.Count)
if ($backend -like 'IL2CPP*') {
    Add-Md '- Naechster Schritt: ``02-install-melonloader.ps1`` (installiert die IL2CPP-Variante), danach Spiel einmal starten, damit ``MelonLoader/Il2CppAssemblies`` erzeugt wird.'
    Add-Md '- Danach ``03-decompile.ps1`` fuer lesbaren Code (Stubs aus den Interop-Assemblies; fuer echte Methodenkoerper zusaetzlich Cpp2IL).'
} else {
    Add-Md '- Naechster Schritt: ``02-install-melonloader.ps1``, danach ``03-decompile.ps1`` auf ``Assembly-CSharp.dll``.'
}
Add-Md ''

if (-not $ReportPath) {
    $reportDir = Join-Path $PSScriptRoot 'reports'
    if (-not (Test-Path -LiteralPath $reportDir)) { New-Item -ItemType Directory -Path $reportDir -Force | Out-Null }
    $ReportPath = Join-Path $reportDir ("analyse-{0}.md" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$md -join "`r`n" | Set-Content -LiteralPath $ReportPath -Encoding UTF8

Write-Head 'Fertig'
Write-Host "Bericht geschrieben: $ReportPath" -ForegroundColor Green
