# Cboinn motor test paketi — sözdizimi/BOM + salt-okunur modların geçerli JSON üretmesi.
# Çalıştır: powershell -ExecutionPolicy Bypass -File engine/run-tests.ps1   (çıkış 0 = geçti)
$worker = Join-Path $PSScriptRoot 'Worker.ps1'
$state = Join-Path $env:TEMP ('cboinn-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $state -Force | Out-Null
$script:fail = 0
function Test-Case {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; Write-Host ('  [PASS] ' + $Name) -ForegroundColor Green }
    catch { $script:fail++; Write-Host ('  [FAIL] ' + $Name + ' -- ' + $_.Exception.Message) -ForegroundColor Red }
}

Write-Host 'Cboinn Driver Scanner - motor testleri'
Test-Case 'Worker.ps1 sozdizimi (parse)' {
    $e = $null; [System.Management.Automation.Language.Parser]::ParseFile($worker, [ref]$null, [ref]$e) | Out-Null
    if (@($e).Count -ne 0) { throw ('parse hatalari: ' + @($e).Count) }
}
Test-Case 'Worker.ps1 UTF-8 BOM (Turkce-guvenli)' {
    $b = [IO.File]::ReadAllBytes($worker)
    if (-not ($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)) { throw 'BOM yok' }
}
$readonly = @(
    @('SystemHealth', 'health.json'), @('ProblemDevices', 'problems.json'), @('CleanScan', 'cleanscan.json'),
    @('DriverStore', 'driverstore.json'), @('RestoreList', 'restore.json'), @('NetworkInfo', 'network.json'),
    @('StartupList', 'startup.json'), @('PrivacyScan', 'privacy.json'), @('SysInfo', 'sysinfo.json')
)
foreach ($m in $readonly) {
    Test-Case ($m[0] + ' gecerli JSON uretir') {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $worker -Mode $m[0] -StateDir $state | Out-Null
        $p = Join-Path $state $m[1]
        if (-not (Test-Path $p)) { throw ($m[1] + ' yazilmadi') }
        $null = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
    }
}
Remove-Item $state -Recurse -Force -ErrorAction SilentlyContinue
if ($script:fail -gt 0) { Write-Host ("BASARISIZ: $($script:fail) test") -ForegroundColor Red; exit 1 }
Write-Host 'TUM TESTLER GECTI' -ForegroundColor Green
exit 0
