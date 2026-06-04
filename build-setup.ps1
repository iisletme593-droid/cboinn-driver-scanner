# build-setup.ps1 - Builds the protected installer and application launcher.
[CmdletBinding()]
param(
    [switch]$Sign,
    [string]$CertificateThumbprint
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$work = Join-Path $root 'setupbuild'
$versionFile = Join-Path $root 'version.json'
if (-not (Test-Path $versionFile)) { throw 'version.json bulunamadi.' }
$version = Get-Content -LiteralPath $versionFile -Raw -Encoding UTF8 | ConvertFrom-Json
$version3 = [string]$version.version
if ($version3 -notmatch '^\d+\.\d+\.\d+$') { throw 'version.json icindeki version degeri MAJOR.MINOR.PATCH olmali.' }
$version4 = $version3 + '.0'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'csc.exe bulunamadi (.NET Framework 4.x gerekli).' }
$icon = Join-Path $root 'icon.ico'

# Windows PowerShell 5.1 reads Turkish reliably when scripts carry a UTF-8 BOM.
$bom = [byte[]](0xEF, 0xBB, 0xBF)
foreach ($file in (Join-Path $root 'DriverScanner.ps1'), (Join-Path $root 'engine\Worker.ps1')) {
    $bytes = [IO.File]::ReadAllBytes($file)
    if (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)) {
        $output = New-Object byte[] ($bytes.Length + 3)
        [Array]::Copy($bom, 0, $output, 0, 3)
        [Array]::Copy($bytes, 0, $output, 3, $bytes.Length)
        [IO.File]::WriteAllBytes($file, $output)
    }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$assemblyInfo = @"
using System.Reflection;
[assembly: AssemblyTitle("Cboinn Driver Scanner")]
[assembly: AssemblyProduct("Cboinn Driver Scanner")]
[assembly: AssemblyCompany("CBOINN")]
[assembly: AssemblyCopyright("Copyright (c) CBOINN")]
[assembly: AssemblyVersion("$version4")]
[assembly: AssemblyFileVersion("$version4")]
[assembly: AssemblyInformationalVersion("$version3")]
"@
$assemblyInfoPath = Join-Path $work 'AssemblyInfo.cs'
[IO.File]::WriteAllText($assemblyInfoPath, $assemblyInfo, $utf8)

$launcherManifest = @'
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="CboinnDriverScanner" type="win32"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings><dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware></windowsSettings>
  </application>
</assembly>
'@
$setupManifest = @'
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="CboinnDriverScannerSetup" type="win32"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="requireAdministrator" uiAccess="false"/></requestedPrivileges></security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings><dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware></windowsSettings>
  </application>
</assembly>
'@
$launcherManifestPath = Join-Path $work 'launcher.manifest'
$setupManifestPath = Join-Path $work 'setup.manifest'
[IO.File]::WriteAllText($launcherManifestPath, $launcherManifest, $utf8)
[IO.File]::WriteAllText($setupManifestPath, $setupManifest, $utf8)

$launcherSource = Join-Path $work 'Launcher.cs'
$setupSource = Join-Path $work 'Setup.cs'
$payloadHashesSource = Join-Path $work 'PayloadHashes.cs'
$launcherExe = Join-Path $root 'CboinnDriverScanner.exe'
$setupExe = Join-Path $root 'Setup.exe'

foreach ($artifact in $launcherExe, $setupExe, (Join-Path $work 'CboinnDriverScanner.exe')) {
    Remove-Item -LiteralPath $artifact -Force -ErrorAction SilentlyContinue
}

& $csc /nologo /optimize+ /target:winexe "/win32icon:$icon" "/win32manifest:$launcherManifestPath" /reference:System.Windows.Forms.dll "/out:$launcherExe" $launcherSource $assemblyInfoPath
if ($LASTEXITCODE -ne 0) { throw 'Launcher derleme hatasi.' }
[IO.File]::Copy($launcherExe, (Join-Path $work 'CboinnDriverScanner.exe'), $true)

if ($Sign) {
    $signArgs = @{ Files = @('CboinnDriverScanner.exe') }
    if ($CertificateThumbprint) { $signArgs.CertificateThumbprint = $CertificateThumbprint }
    & (Join-Path $root 'sign-app.ps1') @signArgs
    [IO.File]::Copy($launcherExe, (Join-Path $work 'CboinnDriverScanner.exe'), $true)
}

$payloadFiles = @(
    'DriverScanner.ps1',
    'ui.xaml',
    'engine/Worker.ps1',
    'icon.ico',
    'logo.png',
    'CboinnDriverScanner.exe',
    'README.md',
    'LICENSE',
    'version.json'
)
$hashEntries = foreach ($relativePath in $payloadFiles) {
    $file = Join-Path $root $relativePath
    if (-not (Test-Path $file)) { throw "Payload dosyasi bulunamadi: $relativePath" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    '            { "' + $relativePath.Replace('\', '/') + '", "' + $hash + '" },'
}
$payloadHashes = @"
using System;
using System.Collections.Generic;
namespace CboinnSetup
{
    static class PayloadHashes
    {
        internal static readonly Dictionary<string, string> Files =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
$($hashEntries -join "`r`n")
        };
    }
}
"@
[IO.File]::WriteAllText($payloadHashesSource, $payloadHashes, $utf8)

& $csc /nologo /optimize+ /target:winexe "/win32icon:$icon" "/win32manifest:$setupManifestPath" /reference:System.Windows.Forms.dll "/out:$setupExe" $setupSource $payloadHashesSource $assemblyInfoPath
if ($LASTEXITCODE -ne 0) { throw 'Setup derleme hatasi.' }

if ($Sign) {
    $signArgs = @{ Files = @('Setup.exe'); ExportPublicCertificate = $true }
    if ($CertificateThumbprint) { $signArgs.CertificateThumbprint = $CertificateThumbprint }
    & (Join-Path $root 'sign-app.ps1') @signArgs
}

Write-Output ('Launcher: {0} ({1:N0} bayt)' -f $version3, (Get-Item $launcherExe).Length)
Write-Output ('Setup.exe: {0} ({1:N0} bayt, korumali Program Files kurulumu)' -f $version3, (Get-Item $setupExe).Length)
