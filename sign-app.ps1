# Signs release artifacts without changing machine-wide trust stores.
[CmdletBinding()]
param(
    [string]$RootPath,
    [string]$CertificateThumbprint,
    [string[]]$Files = @('CboinnDriverScanner.exe', 'Setup.exe', 'DriverScanner.ps1', 'engine\Worker.ps1'),
    [switch]$CreateDevCertificate,
    [switch]$InstallCurrentUserTrust,
    [switch]$ExportPublicCertificate,
    [string]$TimestampServer = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
$root = if ($RootPath) { [IO.Path]::GetFullPath($RootPath) } else { $PSScriptRoot }
if (-not (Test-Path $root)) { throw "Imzalama kok klasoru bulunamadi: $root" }
$stateDir = Join-Path $env:LOCALAPPDATA 'Cboinn Driver Scanner\state'
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
$log = Join-Path $stateDir 'sign.log'
Set-Content -LiteralPath $log -Value '' -Encoding UTF8

function Write-SignLog([string]$Message) {
    $line = (Get-Date -Format 'HH:mm:ss') + ' ' + $Message
    Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    Write-Output $line
}

$cert = $null
if ($CertificateThumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
        Where-Object Thumbprint -eq $CertificateThumbprint |
        Select-Object -First 1
} else {
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
        Where-Object Subject -eq 'CN=Cboinn Driver Scanner' |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
}

if (-not $cert -and $CreateDevCertificate) {
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject 'CN=Cboinn Driver Scanner' `
        -CertStoreLocation Cert:\CurrentUser\My `
        -KeyUsage DigitalSignature `
        -KeyExportPolicy NonExportable `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(3)
    Write-SignLog ('Gelistirici sertifikasi olusturuldu: ' + $cert.Thumbprint)
}
if (-not $cert) {
    throw 'Kod imzalama sertifikasi bulunamadi. -CertificateThumbprint verin veya yalnizca gelistirme icin -CreateDevCertificate kullanin.'
}

Write-SignLog ('Sertifika: ' + $cert.Thumbprint)
if ($InstallCurrentUserTrust) {
    Write-Warning 'Self-signed sertifika yalnizca mevcut kullanicinin Root ve TrustedPublisher depolarina eklenecek. Bu secenegi sadece gelistirme makinesinde kullanin.'
    $certificateFile = Join-Path $env:TEMP 'cboinn-driver-scanner-publisher.cer'
    Export-Certificate -Cert $cert -FilePath $certificateFile -Force | Out-Null
    foreach ($storeName in 'Root', 'TrustedPublisher') {
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, 'CurrentUser')
        try {
            $store.Open('ReadWrite')
            $store.Add((New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $certificateFile))
            Write-SignLog ("CurrentUser\$storeName : eklendi")
        } finally {
            $store.Close()
        }
    }
}

if ($ExportPublicCertificate) {
    $publicCertificate = Join-Path $root 'publisher.cer'
    Export-Certificate -Cert $cert -FilePath $publicCertificate -Force | Out-Null
    Write-SignLog ('Acik sertifika disa aktarildi: ' + $publicCertificate)
}

foreach ($relativePath in $files) {
    $file = Join-Path $root $relativePath
    if (-not (Test-Path $file)) { throw "Imzalanacak dosya bulunamadi: $relativePath" }

    if ($file -like '*.ps1') {
        $text = [IO.File]::ReadAllText($file)
        $signatureStart = $text.IndexOf('
