[CmdletBinding()]
param([switch]$Runtime)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$scripts = @(
    'DriverScanner.ps1',
    'engine\Worker.ps1',
    'build-setup.ps1',
    'build-release.ps1',
    'sign-app.ps1'
)
foreach ($relativePath in $scripts) {
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root $relativePath), [ref]$tokens, [ref]$errors)
    Assert (@($errors).Count -eq 0) ("PowerShell parse error: {0} - {1}" -f $relativePath, (@($errors | ForEach-Object Message) -join ' | '))
}
Write-Output '[PASS] PowerShell parse'

Add-Type -AssemblyName PresentationFramework
[xml]$xaml = [IO.File]::ReadAllText((Join-Path $root 'ui.xaml'))
$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
Assert ($null -ne $window.FindName('BtnClearData')) 'BtnClearData is missing from XAML.'
Write-Output '[PASS] XAML load'

& (Join-Path $root 'build-setup.ps1')
Assert (Test-Path (Join-Path $root 'Setup.exe')) 'Setup.exe was not built.'
Assert ((Get-Item (Join-Path $root 'Setup.exe')).VersionInfo.FileVersion -match '^2\.1\.0') 'Setup.exe version metadata is incorrect.'
$payloadSource = Get-Content -LiteralPath (Join-Path $root 'setupbuild\PayloadHashes.cs') -Raw
foreach ($relativePath in @('DriverScanner.ps1','ui.xaml','engine/Worker.ps1','icon.ico','logo.png','CboinnDriverScanner.exe','README.md','LICENSE','version.json')) {
    $expected = (Get-FileHash -LiteralPath (Join-Path $root $relativePath) -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert ($payloadSource.Contains('"' + $relativePath.Replace('\','/') + '", "' + $expected + '"')) ("Embedded payload hash mismatch: " + $relativePath)
}
Write-Output '[PASS] Setup/launcher build'

if ($Runtime) {
    foreach ($mode in 'Inventory', 'SysInfo', 'SoftwareScan', 'Scan') {
        $state = Join-Path $env:TEMP ('cboinn-scanner-test-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $state | Out-Null
        try {
            $operationId = 'test-' + $mode.ToLowerInvariant()
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'engine\Worker.ps1') -Mode $mode -StateDir $state -OperationId $operationId
            Assert ($LASTEXITCODE -eq 0) "$mode worker exited with $LASTEXITCODE."
            $status = Get-Content -LiteralPath (Join-Path $state 'status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            Assert ($status.done -eq $true) "$mode did not finish."
            Assert ($status.operationId -eq $operationId) "$mode operation ID mismatch."
            Assert ([string]::IsNullOrWhiteSpace([string]$status.error)) "$mode returned error: $($status.error)"
            Write-Output ("[PASS] Runtime {0}" -f $mode)
        } finally {
            $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
            $stateFull = [IO.Path]::GetFullPath($state).TrimEnd('\') + '\'
            if ($stateFull.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $state -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Output 'All scanner tests passed.'
