# build-inno.ps1 - Builds the launcher (C#) + a real Inno Setup installer
# (release-inno\Cboinn-Driver-Scanner-Setup-<version>.exe). Replaces the legacy custom C# Setup.exe.
# Requires: .NET Framework 4.x (csc.exe, ships with Windows) + Inno Setup 6 (ISCC.exe).
[CmdletBinding()]
param([string]$Iscc)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$work = Join-Path $root 'setupbuild'
$version = (Get-Content -LiteralPath (Join-Path $root 'version.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'version.json icindeki version MAJOR.MINOR.PATCH olmali.' }
$version4 = $version + '.0'

# --- locate ISCC (Inno Setup compiler) ---
if (-not $Iscc) {
    $cands = @(
        "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 5\ISCC.exe"
    )
    $Iscc = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $Iscc) {
        $Iscc = Get-ChildItem "${env:ProgramFiles(x86)}", "$env:ProgramFiles" -Filter ISCC.exe -Recurse -Depth 2 -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
    }
}
if (-not $Iscc -or -not (Test-Path $Iscc)) { throw 'ISCC.exe bulunamadi (Inno Setup 6 gerekli).' }

# --- locate csc (.NET Framework 4.x) for the launcher ---
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe bulunamadi (.NET Framework 4.x gerekli).' }
$icon = Join-Path $root 'icon.ico'
$utf8 = New-Object System.Text.UTF8Encoding($false)

# --- UTF-8 BOM for the PowerShell sources (Windows PowerShell 5.1 reads Turkish reliably with a BOM) ---
$bom = [byte[]](0xEF, 0xBB, 0xBF)
foreach ($file in (Join-Path $root 'DriverScanner.ps1'), (Join-Path $root 'engine\Worker.ps1')) {
    $bytes = [IO.File]::ReadAllBytes($file)
    if (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)) {
        $out = New-Object byte[] ($bytes.Length + 3)
        [Array]::Copy($bom, 0, $out, 0, 3); [Array]::Copy($bytes, 0, $out, 3, $bytes.Length)
        [IO.File]::WriteAllBytes($file, $out)
    }
}

# --- AssemblyInfo + launcher manifest (asInvoker; the app elevates itself via Restart-AsAdmin) ---
$assemblyInfo = @"
using System.Reflection;
[assembly: AssemblyTitle("Cboinn Driver Scanner")]
[assembly: AssemblyProduct("Cboinn Driver Scanner")]
[assembly: AssemblyCompany("CBOINN")]
[assembly: AssemblyCopyright("Copyright (c) CBOINN")]
[assembly: AssemblyVersion("$version4")]
[assembly: AssemblyFileVersion("$version4")]
[assembly: AssemblyInformationalVersion("$version")]
"@
$assemblyInfoPath = Join-Path $work 'AssemblyInfo.cs'
[IO.File]::WriteAllText($assemblyInfoPath, $assemblyInfo, $utf8)

$launcherManifest = @'
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="CboinnDriverScanner" type="win32"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings><dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware></windowsSettings></application>
</assembly>
'@
$launcherManifestPath = Join-Path $work 'launcher.manifest'
[IO.File]::WriteAllText($launcherManifestPath, $launcherManifest, $utf8)

# --- compile the launcher (CboinnDriverScanner.exe) ---
$launcherSource = Join-Path $work 'Launcher.cs'
$launcherExe = Join-Path $root 'CboinnDriverScanner.exe'
Remove-Item -LiteralPath $launcherExe -Force -ErrorAction SilentlyContinue
& $csc /nologo /optimize+ /target:winexe "/win32icon:$icon" "/win32manifest:$launcherManifestPath" /reference:System.Windows.Forms.dll "/out:$launcherExe" $launcherSource $assemblyInfoPath
if ($LASTEXITCODE -ne 0) { throw 'Launcher derleme hatasi.' }

# --- compile the Inno Setup installer ---
& $Iscc /Qp (Join-Path $root 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'ISCC derleme hatasi.' }

$setupExe = Join-Path $root ("release-inno\Cboinn-Driver-Scanner-Setup-$version.exe")
if (-not (Test-Path $setupExe)) { throw "Beklenen installer uretilmedi: $setupExe" }
$len = (Get-Item $setupExe).Length
$sha = (Get-FileHash -LiteralPath $setupExe -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($setupExe + '.sha256') -Value ("{0}  Cboinn-Driver-Scanner-Setup-$version.exe" -f $sha) -Encoding ASCII
Write-Output ("OK Inno installer: {0}" -f $setupExe)
Write-Output ("   {0:N0} bayt | sha256 {1}" -f $len, $sha)
