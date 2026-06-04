# Builds a clean release directory, ZIP and SHA-256 checksum.
[CmdletBinding()]
param(
    [switch]$Sign,
    [string]$CertificateThumbprint
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'version.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$releaseRoot = Join-Path $root 'release'
$packageRoot = Join-Path $releaseRoot 'Cboinn-Driver-Scanner'
$zipPath = Join-Path $releaseRoot 'Cboinn-Driver-Scanner.zip'
$zipChecksumPath = $zipPath + '.sha256'

if (Test-Path $releaseRoot) {
    $resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    $resolvedRelease = [IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
    if (-not $resolvedRelease.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Release klasoru proje kokunun disinda olamaz.'
    }
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'engine') -Force | Out-Null

$buildArgs = @{}
if ($Sign) { $buildArgs.Sign = $true }
if ($CertificateThumbprint) { $buildArgs.CertificateThumbprint = $CertificateThumbprint }
& (Join-Path $root 'build-setup.ps1') @buildArgs

$files = @(
    'Setup.exe',
    'CboinnDriverScanner.exe',
    'DriverScanner.ps1',
    'ui.xaml',
    'engine\Worker.ps1',
    'icon.ico',
    'logo.png',
    'README.md',
    'LICENSE',
    'SECURITY.md',
    'VERIFY.md',
    'version.json'
)
if ($Sign -and (Test-Path (Join-Path $root 'publisher.cer'))) { $files += 'publisher.cer' }
foreach ($relativePath in $files) {
    $source = Join-Path $root $relativePath
    if (-not (Test-Path $source)) { throw "Paket dosyasi bulunamadi: $relativePath" }
    $destination = Join-Path $packageRoot $relativePath
    $destinationDirectory = Split-Path -Parent $destination
    if (-not (Test-Path $destinationDirectory)) { New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null }
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

$checksums = Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
        $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
        '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
    }
Set-Content -LiteralPath (Join-Path $packageRoot 'SHA256SUMS.txt') -Value $checksums -Encoding UTF8

Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath $zipChecksumPath -Value ("{0}  Cboinn-Driver-Scanner.zip" -f $zipHash) -Encoding ASCII

Write-Output ('Release hazir: v{0}' -f $version)
Write-Output $zipPath
Write-Output $zipChecksumPath
