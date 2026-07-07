<#
    Worker.ps1 - Cboinn Driver Scanner çekirdek motoru (UI'sız)
    Modlar: Inventory / Scan / Install / SoftwareScan / SoftwareInstall / SysInfo / BackupDrivers
    Arayüzle iletişim yalnızca $StateDir altındaki düz JSON dosyaları üzerinden olur.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Inventory', 'Scan', 'Install', 'SoftwareScan', 'SoftwareInstall', 'SysInfo', 'BackupDrivers', 'ProblemDevices', 'CleanScan', 'CleanApply', 'SoftwareInventory', 'SoftwareSearch', 'SoftwareUninstall', 'SoftwareInstallNew', 'DriverStore', 'DriverStoreDelete', 'BloatScan', 'BloatRemove', 'RecycleList', 'RecycleRestore', 'UsbList', 'MakeBootable', 'SystemHealth', 'SystemRepair', 'RestoreList', 'RestoreCreate', 'NetworkInfo', 'NetworkAction', 'StartupList', 'StartupSetState', 'PrivacyScan', 'PrivacyApply', 'PrivacyRevert')]
    [string]$Mode,
    [string]$StateDir,
    [string]$OperationId,
    [string]$UpdateIDsCsv,
    [string]$WingetIds,
    [string]$BackupDir,
    [string]$CleanCategoriesCsv,
    [string]$Query,
    [string]$DriverInfs,
    [string]$AppxNames,
    [string]$RestoreKeys,
    [string]$IsoPath,
    [string]$UsbDiskNumber,
    [string]$RepairTool,
    [string]$Description,
    [string]$NetAction,
    [string]$Tweaks,
    [string]$StartupName,
    [string]$StartupEnabled,
    [switch]$CreateRestorePoint
)

$ErrorActionPreference = 'Stop'
# Konsol/stderr çıktısını UTF-8 yap: Electron tarafı boru hattını UTF-8 okur, oysa
# Windows PowerShell 5.1 varsayılan olarak OEM kod sayfasıyla (ör. cp857) yazar ve
# Türkçe hata mesajları bozuk görünür. Yalnızca konsol kodlamasını etkiler; JSON
# sonuç dosyaları zaten açık kodlamayla (UTF-8 BOM) yazılır, etkilenmez.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { $OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$MicrosoftUpdateServiceId = '7971f918-a847-4430-9279-4a52d1efe18d'

if (-not $StateDir) { $StateDir = Join-Path $env:LOCALAPPDATA 'Cboinn Driver Scanner\state' }
if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
$stateItem = Get-Item -LiteralPath $StateDir -Force
if (($stateItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Durum klasoru bir yeniden yonlendirme (reparse point) olamaz.'
}
if (-not $OperationId) { $OperationId = [guid]::NewGuid().ToString('N') }
$LogFile = Join-Path $StateDir 'worker.log'

function Write-Log {
    param([string]$Message)
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mode, $Message
    try {
        if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 5MB) {
            $archive = Join-Path $StateDir 'worker.1.log'
            Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
            Move-Item -LiteralPath $LogFile -Destination $archive -Force
        }
        Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    } catch {}
}

function Write-AtomicText {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
    $tmp = '{0}.{1}.tmp' -f $Path, ([guid]::NewGuid().ToString('N'))
    try {
        Set-Content -LiteralPath $tmp -Value $Value -Encoding UTF8
        Move-Item -LiteralPath $tmp -Destination $Path -Force
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Set-Status {
    param([string]$Phase = $Mode, [string]$Message = '', [int]$Percent = 0, [bool]$Done = $false, [string]$ErrorText = $null, [hashtable]$Extra)
    $dst = Join-Path $StateDir 'status.json'
    try {
        $obj = [ordered]@{
            operationId = $OperationId
            phase = $Phase
            message = $Message
            percent = $Percent
            done = $Done
            error = $ErrorText
            ts = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        }
        if ($Extra) { foreach ($k in $Extra.Keys) { $obj[$k] = $Extra[$k] } }
        $json = $obj | ConvertTo-Json -Depth 5
        Write-AtomicText -Path $dst -Value $json
    } catch {
        # Durum yazımı operasyonu ASLA öldürmemeli. ConvertTo-Json veya geçici
        # dosya kilidi (ör. antivirüs) hata verirse, elle kurulmuş minimal JSON
        # ile en azından done/percent bilgisini yaz — aksi halde arayüz hiç
        # 'done:true' görmez ve tam timeout süresince bekler.
        try {
            $clean = { param($s) ('{0}' -f $s) -replace '[\\"\r\n\t]', ' ' }
            $safePhase = (& $clean $Phase)
            $safeErr   = (& $clean $_.Exception.Message)
            $doneStr   = if ($Done) { 'true' } else { 'false' }
            $fallback  = '{"operationId":"' + $OperationId + '","phase":"' + $safePhase + '","percent":' + $Percent + ',"done":' + $doneStr + ',"error":"durum-yazma-hatasi: ' + $safeErr + '","ts":"' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '"}'
            [System.IO.File]::WriteAllText($dst, $fallback, (New-Object System.Text.UTF8Encoding($true)))
        } catch {}
    }
}

function ConvertTo-JsonArray {
    param($List)
    $parts = New-Object System.Collections.Generic.List[string]
    if ($null -ne $List) { foreach ($x in $List) { $parts.Add(($x | ConvertTo-Json -Depth 6 -Compress)) } }
    return '[' + [string]::Join(',', $parts) + ']'
}

function Format-WmiDate {
    param($Value)
    if ($null -eq $Value) { return '' }
    try { return ([datetime]$Value).ToString('yyyy-MM-dd') } catch { return '' }
}

function Get-DriverInventory {
    Write-Log 'Win32_PnPSignedDriver ile sürücü envanteri toplanıyor'
    $items = Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction Stop
    $list = New-Object System.Collections.Generic.List[object]
    $now = Get-Date
    foreach ($d in $items) {
        if ([string]::IsNullOrWhiteSpace($d.DeviceName)) { continue }
        $hw = @()
        if ($d.HardWareID) { $hw = @($d.HardWareID) }
        $ageYears = ''
        $isOld = $false
        if ($d.DriverDate) {
            try {
                $ageYears = [math]::Round((($now - [datetime]$d.DriverDate).TotalDays / 365.25), 1)
                $isOld = ($ageYears -ge 4) -and ($d.DriverProviderName -notmatch '^(Microsoft|Standard|Standart)')
            } catch {}
        }
        $list.Add([ordered]@{
            DeviceName   = $d.DeviceName
            DeviceClass  = $d.DeviceClass
            Manufacturer = $d.Manufacturer
            Provider     = $d.DriverProviderName
            Version      = $d.DriverVersion
            Date         = (Format-WmiDate $d.DriverDate)
            AgeYears     = $ageYears
            Old          = $isOld
            OldText      = $(if ($isOld) { 'EVET' } else { '' })
            InfName      = $d.InfName
            DeviceID     = $d.DeviceID
            HardwareIDs  = $hw
        }) | Out-Null
    }
    Write-Log ('Envanter: {0} sürücü' -f $list.Count)
    return $list
}

function New-WuaSession {
    Write-Log 'Windows Update Agent oturumu oluşturuluyor'
    $session = New-Object -ComObject Microsoft.Update.Session
    $session.ClientApplicationID = 'CboinnDriverScanner'
    try {
        $sm = New-Object -ComObject Microsoft.Update.ServiceManager
        $sm.AddService2($MicrosoftUpdateServiceId, 7, '') | Out-Null
        Write-Log 'Microsoft Update hizmeti kaydedildi'
    } catch {
        Write-Log ('Microsoft Update kaydı atlandı: {0}' -f $_.Exception.Message)
    }
    return $session
}

function Search-DriverUpdates {
    param($Session)
    $searcher = $Session.CreateUpdateSearcher()
    try { $searcher.Online = $true } catch {}
    $criteria = "IsInstalled=0 and Type='Driver'"
    Write-Log ('Arama ölçütü: {0}' -f $criteria)
    return $searcher.Search($criteria)
}

function Invoke-InventoryMode {
    Set-Status -Message 'Sürücüler okunuyor...' -Percent 20
    $inv = Get-DriverInventory
    Write-AtomicText -Path (Join-Path $StateDir 'inventory.json') -Value (ConvertTo-JsonArray $inv)
    Set-Status -Message ('{0} sürücü bulundu.' -f $inv.Count) -Percent 100 -Done $true -Extra @{ count = $inv.Count }
}

function Invoke-ScanMode {
    Set-Status -Message 'Sürücü envanteri toplanıyor...' -Percent 8
    $inv = Get-DriverInventory
    Write-AtomicText -Path (Join-Path $StateDir 'inventory.json') -Value (ConvertTo-JsonArray $inv)

    $hwLookup = @{}
    foreach ($it in $inv) {
        foreach ($h in $it.HardwareIDs) {
            if ($h) { $key = $h.ToString().ToLowerInvariant(); if (-not $hwLookup.ContainsKey($key)) { $hwLookup[$key] = $it } }
        }
    }

    Set-Status -Message 'Windows Update sürücü kataloğu sorgulanıyor (1-2 dakika sürebilir)...' -Percent 30
    $session = New-WuaSession
    $result = Search-DriverUpdates -Session $session
    Write-Log ('Arama {0} güncelleme döndürdü' -f $result.Updates.Count)

    Set-Status -Message 'Sonuçlar işleniyor...' -Percent 80
    $updates = New-Object System.Collections.Generic.List[object]
    foreach ($u in $result.Updates) {
        $row = [ordered]@{
            UpdateID = $u.Identity.UpdateID; Title = $u.Title; Provider = ''; DriverClass = ''; DriverModel = ''
            NewDate = ''; CurrentVersion = ''; CurrentDate = ''; MatchedDevice = ''; HardwareID = ''
            SizeMB = 0; KB = ''; MoreInfo = ''; IsDownloaded = [bool]$u.IsDownloaded
        }
        try { $row.SizeMB = [math]::Round(($u.MaxDownloadSize / 1MB), 2) } catch {}
        try { $row.Provider = [string]$u.DriverProvider } catch {}
        try { $row.DriverClass = [string]$u.DriverClass } catch {}
        try { $row.DriverModel = [string]$u.DriverModel } catch {}
        try { if ($u.DriverVerDate) { $row.NewDate = ([datetime]$u.DriverVerDate).ToString('yyyy-MM-dd') } } catch {}
        try { if ($u.MoreInfoUrls -and $u.MoreInfoUrls.Count -gt 0) { $row.MoreInfo = [string]$u.MoreInfoUrls.Item(0) } } catch {}
        $kbList = New-Object System.Collections.Generic.List[string]
        try { foreach ($kb in $u.KBArticleIDs) { if ($kb) { $kbList.Add([string]$kb) } } } catch {}
        $row.KB = [string]::Join(',', $kbList)
        $hwid = ''
        try { $hwid = [string]$u.DriverHardwareID } catch {}
        if ($hwid) {
            $row.HardwareID = $hwid
            $k = $hwid.ToLowerInvariant()
            if ($hwLookup.ContainsKey($k)) { $m = $hwLookup[$k]; $row.MatchedDevice = $m.DeviceName; $row.CurrentVersion = $m.Version; $row.CurrentDate = $m.Date }
        }
        if (-not $row.MatchedDevice) { $row.MatchedDevice = if ($row.DriverModel) { $row.DriverModel } else { $row.Title } }
        $updates.Add($row) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'updates.json') -Value (ConvertTo-JsonArray $updates)
    Set-Status -Message ('Tarama tamamlandı. {0} sürücü güncellemesi bulundu.' -f $updates.Count) -Percent 100 -Done $true -Extra @{ count = $updates.Count }
}

function Invoke-InstallMode {
    $ids = @()
    if ($UpdateIDsCsv) { $ids = $UpdateIDsCsv -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    if ($ids.Count -eq 0) { throw 'Yüklenecek güncelleme seçilmedi.' }
    foreach ($id in $ids) {
        $parsed = [guid]::Empty
        if (-not [guid]::TryParse($id, [ref]$parsed)) { throw ('Geçersiz Windows Update kimliği: {0}' -f $id) }
    }

    if ($CreateRestorePoint) {
        Set-Status -Message 'Sistem geri yükleme noktası oluşturuluyor...' -Percent 5
        try {
            Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue
            Checkpoint-Computer -Description 'CboinnDriverScanner - güncelleme öncesi' -RestorePointType 'DEVICE_DRIVER_INSTALL' -ErrorAction Stop
            Write-Log 'Geri yükleme noktası oluşturuldu'
        } catch {
            Write-Log ('Geri yükleme noktası başarısız: {0}' -f $_.Exception.Message)
            throw ('Geri yükleme noktası oluşturulamadığı için sürücü kurulumu durduruldu: {0}' -f $_.Exception.Message)
        }
    }

    Set-Status -Message 'Güncellemeler katalogda bulunuyor...' -Percent 15
    $session = New-WuaSession
    $result = Search-DriverUpdates -Session $session
    $wanted = @{}
    foreach ($id in $ids) { $wanted[$id] = $true }
    $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
    foreach ($u in $result.Updates) {
        if ($wanted.ContainsKey($u.Identity.UpdateID)) {
            try { if (-not $u.EulaAccepted) { $u.AcceptEula() } } catch {}
            $toInstall.Add($u) | Out-Null
        }
    }
    if ($toInstall.Count -eq 0) { throw 'Seçilen güncellemeler katalogda bulunamadı. Lütfen yeniden tarayın.' }

    Set-Status -Message ('{0} güncelleme indiriliyor...' -f $toInstall.Count) -Percent 35
    $downloader = $session.CreateUpdateDownloader()
    $downloader.Updates = $toInstall
    $dres = $downloader.Download()
    Write-Log ('İndirme sonuç kodu: {0}' -f $dres.ResultCode)
    $downloadFailures = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $toInstall.Count; $i++) {
        $dr = $dres.GetUpdateResult($i)
        if ($dr.ResultCode -ne 2) {
            $downloadFailures.Add(('{0} (kod {1}, HRESULT {2})' -f $toInstall.Item($i).Title, $dr.ResultCode, $dr.HResult))
        }
    }
    if ($downloadFailures.Count -gt 0) {
        throw ('Bir veya daha fazla sürücü indirilemedi; kurulum başlatılmadı: {0}' -f ([string]::Join(' | ', $downloadFailures)))
    }

    Set-Status -Message 'Sürücüler kuruluyor (lütfen bekleyin)...' -Percent 70
    $installer = $session.CreateUpdateInstaller()
    $installer.Updates = $toInstall
    $ires = $installer.Install()
    Write-Log ('Kurulum sonuç kodu: {0}, yeniden başlatma: {1}' -f $ires.ResultCode, $ires.RebootRequired)

    $results = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $toInstall.Count; $i++) {
        $u = $toInstall.Item($i)
        $ur = $ires.GetUpdateResult($i)
        $results.Add([ordered]@{ updateId = $u.Identity.UpdateID; title = $u.Title; resultCode = $ur.ResultCode; hresult = $ur.HResult }) | Out-Null
    }
    $payload = [ordered]@{ results = $results; rebootRequired = [bool]$ires.RebootRequired; installResult = $ires.ResultCode }
    Write-AtomicText -Path (Join-Path $StateDir 'install.result.json') -Value ($payload | ConvertTo-Json -Depth 6)
    $succeeded = @($results | Where-Object { $_.resultCode -eq 2 }).Count
    Set-Status -Message ('Kurulum bitti. Başarılı: {0}/{1}' -f $succeeded, $toInstall.Count) -Percent 100 -Done $true -Extra @{ rebootRequired = [bool]$ires.RebootRequired; succeeded = $succeeded; total = $toInstall.Count }
}

# ---- Program (winget) ----
function Test-WingetAvailable { return [bool](Get-Command winget -ErrorAction SilentlyContinue) }

function Invoke-WingetCommand {
    param([string[]]$WingetArgs)
    $prev = $null
    try { $prev = [Console]::OutputEncoding; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
    $argsWithLocale = @($WingetArgs)
    # --locale is only valid for install/upgrade/show/download — NOT search/list/uninstall.
    $wgCmd = if (@($WingetArgs).Count -gt 0) { [string]$WingetArgs[0] } else { '' }
    if ((@('install', 'upgrade', 'show', 'download') -contains $wgCmd) -and ($argsWithLocale -notcontains '--locale')) {
        $argsWithLocale += @('--locale', 'en-US')
    }
    try {
        $out = @(& winget @argsWithLocale 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
    } finally {
        if ($prev) { try { [Console]::OutputEncoding = $prev } catch {} }
    }
    return [pscustomobject]@{
        ExitCode = $code
        Lines = @($out)
        Text = [string]::Join("`n", @($out))
    }
}

# DİL-BAĞIMSIZ winget tablo ayrıştırıcı: başlık METNİNE değil, başlığın altındaki
# kesik-çizgi (---) satırına + sütun başlangıç konumlarına dayanır → Türkçe dahil
# her dilde çalışır. Sütun SIRASI: Name, Id, Version, [Available|Match], Source.
function Get-WingetRows {
    param([string[]]$Lines, [bool]$WithAvailable)
    $clean = New-Object System.Collections.Generic.List[string]
    foreach ($ln in $Lines) {
        if ($null -eq $ln) { continue }
        if ($ln -match '[▒█]') { continue }
        if ($ln -match '^\s*[-\\|/]\s*$') { continue }
        $clean.Add($ln)
    }
    $list = New-Object System.Collections.Generic.List[object]
    $di = -1
    for ($i = 1; $i -lt $clean.Count; $i++) {
        if ($clean[$i] -match '^\s*-{5,}\s*$') { $di = $i; break }
    }
    if ($di -lt 1) { return , $list.ToArray() }
    $header = $clean[$di - 1]
    $starts = @()
    foreach ($m in [regex]::Matches($header, '\S+')) { $starts += [int]$m.Index }
    $nCol = $starts.Count
    if ($nCol -lt 2) { return , $list.ToArray() }
    $slice = {
        param($s, $a, $b)
        if ($a -ge $s.Length) { return '' }
        $end = if ($b -lt 0 -or $b -gt $s.Length) { $s.Length } else { $b }
        if ($end -le $a) { return '' }
        return $s.Substring($a, $end - $a).Trim()
    }
    for ($i = $di + 1; $i -lt $clean.Count; $i++) {
        $ln = $clean[$i]
        if ([string]::IsNullOrWhiteSpace($ln)) { continue }
        if ($ln -match '^\s*-{5,}') { continue }
        if ($ln -match '^\s*\d+\s+(upgrade|yükselt|package|paket|available|kullan)') { continue }
        if ($ln.Length -le $starts[1]) { continue }
        $cols = @()
        for ($c = 0; $c -lt $nCol; $c++) {
            $a = $starts[$c]
            $b = if ($c + 1 -lt $nCol) { $starts[$c + 1] } else { -1 }
            $cols += (& $slice $ln $a $b)
        }
        $name = $cols[0]; $id = $cols[1]
        $ver = if ($nCol -ge 3) { $cols[2] } else { '' }
        $src = $cols[$nCol - 1]
        $avail = if ($WithAvailable -and $nCol -ge 5) { $cols[3] } else { '' }
        if ($id) { $list.Add([ordered]@{ Name = $name; Id = $id; Version = $ver; Available = $avail; Source = $src }) | Out-Null }
    }
    return , $list.ToArray()
}

function Get-WingetUpgrades {
    $result = Invoke-WingetCommand @('upgrade', '--include-unknown', '--accept-source-agreements', '--disable-interactivity')
    if ($result.ExitCode -ne 0) {
        throw ('winget taraması başarısız (çıkış kodu {0}): {1}' -f $result.ExitCode, $result.Text)
    }
    if ($result.Text -match 'No applicable upgrade found|No installed package found') { return , @() }
    return , (Get-WingetRows $result.Lines $true)
}

# list/search için dil-bağımsız ayrıştırma (Available gerekmez).
function Get-WingetTable {
    param([string[]]$Lines)
    return , (Get-WingetRows $Lines $false)
}

function Invoke-SoftwareScanMode {
    if (-not (Test-WingetAvailable)) {
        Write-AtomicText -Path (Join-Path $StateDir 'software.json') -Value '[]'
        Set-Status -Message 'winget bulunamadı. Microsoft Store''dan "App Installer" yükleyin.' -Percent 100 -Done $true -ErrorText 'winget bulunamadı'
        return
    }
    Set-Status -Message 'Programlar winget ile taranıyor (ilk taramada kaynak indirilir)...' -Percent 25
    $ups = Get-WingetUpgrades
    Write-Log ('winget {0} güncellenebilir program buldu' -f $ups.Count)
    Set-Status -Message 'Sonuçlar işleniyor...' -Percent 85
    Write-AtomicText -Path (Join-Path $StateDir 'software.json') -Value (ConvertTo-JsonArray $ups)
    Set-Status -Message ('Program taraması tamamlandı. {0} güncellenebilir program bulundu.' -f $ups.Count) -Percent 100 -Done $true -Extra @{ count = $ups.Count }
}

function Invoke-SoftwareInstallMode {
    if (-not (Test-WingetAvailable)) { throw 'winget bulunamadı.' }
    $ids = @()
    if ($WingetIds) { $ids = $WingetIds -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    foreach ($id in $ids) {
        if ($id -notmatch '^[A-Za-z0-9][A-Za-z0-9._+\-]{0,255}$') { throw ('Geçersiz winget paket kimliği: {0}' -f $id) }
    }
    $all = (@($ids).Count -eq 0)
    $results = New-Object System.Collections.Generic.List[object]
    if ($all) {
        Set-Status -Message 'Tüm programlar güncelleniyor (winget --all)...' -Percent 20
        $wr = Invoke-WingetCommand @('upgrade', '--all', '--include-unknown', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
        $code = $wr.ExitCode
        Write-Log ('winget --all çıkış kodu: {0}' -f $code)
        $results.Add([ordered]@{ id = 'ALL'; exit = $code; details = $wr.Text }) | Out-Null
    } else {
        $n = 0
        foreach ($id in $ids) {
            $n++
            $pct = [int](10 + (80.0 * $n / @($ids).Count))
            Set-Status -Message ('Güncelleniyor: {0} ({1}/{2})' -f $id, $n, @($ids).Count) -Percent $pct
            $wr = Invoke-WingetCommand @('upgrade', '--id', $id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
            $code = $wr.ExitCode
            Write-Log ('winget upgrade --id {0} çıkış kodu: {1}' -f $id, $code)
            $results.Add([ordered]@{ id = $id; exit = $code; details = $wr.Text }) | Out-Null
        }
    }
    Write-AtomicText -Path (Join-Path $StateDir 'software.install.result.json') -Value (ConvertTo-JsonArray $results)
    $ok = @($results | Where-Object { $_.exit -eq 0 }).Count
    Set-Status -Message ('Program güncelleme bitti. Başarılı: {0}/{1}' -f $ok, $results.Count) -Percent 100 -Done $true -Extra @{ succeeded = $ok; total = $results.Count }
}

# ---- Uygulama yönetimi: liste / ara / kaldır / kur ----
function Test-WingetId {
    param([string]$Id)
    return ($Id -match '^[A-Za-z0-9{][A-Za-z0-9 ._+\-{}\\]{0,255}$')
}

function Invoke-SoftwareInventoryMode {
    if (-not (Test-WingetAvailable)) {
        Write-AtomicText -Path (Join-Path $StateDir 'installed.json') -Value '[]'
        Set-Status -Message 'winget bulunamadı. Microsoft Store''dan "App Installer" yükleyin.' -Percent 100 -Done $true -ErrorText 'winget bulunamadı'
        return
    }
    Set-Status -Message 'Yüklü programlar listeleniyor (winget list)...' -Percent 30
    $res = Invoke-WingetCommand @('list', '--accept-source-agreements', '--disable-interactivity')
    $apps = Get-WingetTable $res.Lines
    Write-AtomicText -Path (Join-Path $StateDir 'installed.json') -Value (ConvertTo-JsonArray $apps)
    Set-Status -Message ('{0} yüklü program bulundu.' -f @($apps).Count) -Percent 100 -Done $true -Extra @{ count = @($apps).Count }
}

function Invoke-SoftwareSearchMode {
    if (-not (Test-WingetAvailable)) { throw 'winget bulunamadı.' }
    if ([string]::IsNullOrWhiteSpace($Query)) {
        Write-AtomicText -Path (Join-Path $StateDir 'search.json') -Value '[]'
        Set-Status -Message 'Arama terimi boş.' -Percent 100 -Done $true -Extra @{ count = 0 }
        return
    }
    $q = ([string]$Query).Trim() -replace '[\x00-\x1F]', ''
    if ($q.Length -gt 200) { $q = $q.Substring(0, 200) }
    Set-Status -Message ('Aranıyor: {0}' -f $q) -Percent 30
    # --query ile bağla: sorgu '-' ile başlasa bile bayrak (flag) olarak yorumlanmaz.
    $res = Invoke-WingetCommand @('search', '--query', $q, '--accept-source-agreements', '--disable-interactivity')
    $apps = Get-WingetTable $res.Lines
    Write-AtomicText -Path (Join-Path $StateDir 'search.json') -Value (ConvertTo-JsonArray $apps)
    Set-Status -Message ('{0} sonuç bulundu.' -f @($apps).Count) -Percent 100 -Done $true -Extra @{ count = @($apps).Count }
}

function Invoke-SoftwareUninstallMode {
    if (-not (Test-WingetAvailable)) { throw 'winget bulunamadı.' }
    $ids = @()
    if ($WingetIds) { $ids = $WingetIds -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    if (@($ids).Count -eq 0) { throw 'Kaldırılacak program seçilmedi.' }
    foreach ($id in $ids) { if (-not (Test-WingetId $id)) { throw ('Geçersiz paket kimliği: {0}' -f $id) } }
    $results = New-Object System.Collections.Generic.List[object]
    $n = 0
    foreach ($id in $ids) {
        $n++
        Set-Status -Message ('Kaldırılıyor: {0} ({1}/{2})' -f $id, $n, @($ids).Count) -Percent ([int](10 + 80.0 * $n / @($ids).Count))
        $wr = Invoke-WingetCommand @('uninstall', '--id', $id, '--exact', '--silent', '--accept-source-agreements', '--disable-interactivity')
        Write-Log ('winget uninstall --id {0} çıkış kodu: {1}' -f $id, $wr.ExitCode)
        $results.Add([ordered]@{ id = $id; exit = $wr.ExitCode; details = $wr.Text }) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'software.uninstall.result.json') -Value (ConvertTo-JsonArray $results)
    $ok = @($results | Where-Object { $_.exit -eq 0 }).Count
    Set-Status -Message ('Kaldırma bitti. Başarılı: {0}/{1}' -f $ok, $results.Count) -Percent 100 -Done $true -Extra @{ succeeded = $ok; total = $results.Count }
}

function Invoke-SoftwareInstallNewMode {
    if (-not (Test-WingetAvailable)) { throw 'winget bulunamadı.' }
    $ids = @()
    if ($WingetIds) { $ids = $WingetIds -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    if (@($ids).Count -eq 0) { throw 'Kurulacak program seçilmedi.' }
    foreach ($id in $ids) { if (-not (Test-WingetId $id)) { throw ('Geçersiz paket kimliği: {0}' -f $id) } }
    $results = New-Object System.Collections.Generic.List[object]
    $n = 0
    foreach ($id in $ids) {
        $n++
        Set-Status -Message ('Kuruluyor: {0} ({1}/{2})' -f $id, $n, @($ids).Count) -Percent ([int](10 + 80.0 * $n / @($ids).Count))
        $wr = Invoke-WingetCommand @('install', '--id', $id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
        Write-Log ('winget install --id {0} çıkış kodu: {1}' -f $id, $wr.ExitCode)
        $results.Add([ordered]@{ id = $id; exit = $wr.ExitCode; details = $wr.Text }) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'software.installnew.result.json') -Value (ConvertTo-JsonArray $results)
    $ok = @($results | Where-Object { $_.exit -eq 0 }).Count
    Set-Status -Message ('Kurulum bitti. Başarılı: {0}/{1}' -f $ok, $results.Count) -Percent 100 -Done $true -Extra @{ succeeded = $ok; total = $results.Count }
}

# ---- Sistem bilgisi / Yedekleme ----
function Get-PendingReboot {
    $pending = $false
    $reasons = New-Object System.Collections.Generic.List[string]
    try { if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') { $pending = $true; $reasons.Add('Bileşen bakımı') } } catch {}
    try { if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') { $pending = $true; $reasons.Add('Windows Update') } } catch {}
    try {
        $smk = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue
        if ($smk -and $smk.PendingFileRenameOperations) { $pending = $true; $reasons.Add('Bekleyen dosya işlemleri') }
    } catch {}
    return [pscustomobject]@{ Pending = $pending; Reasons = [string]::Join(', ', $reasons) }
}

function Get-SystemInfoObject {
    $now = Get-Date
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    $cpu = ''
    try { $cpu = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1).Name } catch {}
    $gpus = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($g in Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue) {
            $age = ''
            if ($g.DriverDate) { try { $age = [math]::Round((($now - [datetime]$g.DriverDate).TotalDays / 365.25), 1) } catch {} }
            $gpus.Add([ordered]@{ Name = $g.Name; DriverVersion = $g.DriverVersion; DriverDate = (Format-WmiDate $g.DriverDate); AgeYears = $age }) | Out-Null
        }
    } catch {}
    $freeGB = 0; $sizeGB = 0
    try {
        $disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='{0}'" -f $env:SystemDrive) -ErrorAction SilentlyContinue
        if ($disk) { $freeGB = [math]::Round($disk.FreeSpace / 1GB, 1); $sizeGB = [math]::Round($disk.Size / 1GB, 1) }
    } catch {}
    $ramGB = 0
    try { if ($cs) { $ramGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) } } catch {}
    $lastBootStr = ''; $uptimeH = ''
    try {
        if ($os -and $os.LastBootUpTime) {
            $lb = [datetime]$os.LastBootUpTime
            $lastBootStr = $lb.ToString('yyyy-MM-dd HH:mm')
            $uptimeH = [math]::Round((($now - $lb).TotalHours), 1)
        }
    } catch {}
    $restore = '?'
    try {
        $rp = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore' -Name RPSessionInterval -ErrorAction SilentlyContinue
        if ($null -ne $rp) { $restore = if ($rp.RPSessionInterval -gt 0) { 'Açık' } else { 'Kapalı' } }
    } catch {}
    $reboot = Get-PendingReboot
    return [ordered]@{
        ComputerName   = $env:COMPUTERNAME
        OS             = $(if ($os) { [string]$os.Caption } else { '' })
        OSVersion      = $(if ($os) { ('{0} (Build {1})' -f $os.Version, $os.BuildNumber) } else { '' })
        CPU            = $cpu
        RAMGB          = $ramGB
        GPUs           = $gpus
        SysDriveFreeGB = $freeGB
        SysDriveSizeGB = $sizeGB
        LastBoot       = $lastBootStr
        UptimeHours    = $uptimeH
        RestoreStatus  = $restore
        PendingReboot  = $reboot.Pending
        PendingReasons = $reboot.Reasons
    }
}

function Invoke-SysInfoMode {
    Set-Status -Message 'Sistem bilgileri toplanıyor...' -Percent 40
    $info = Get-SystemInfoObject
    Write-AtomicText -Path (Join-Path $StateDir 'sysinfo.json') -Value ($info | ConvertTo-Json -Depth 6)
    Set-Status -Message 'Sistem bilgileri hazır.' -Percent 100 -Done $true
}

function Invoke-BackupDriversMode {
    $dir = $BackupDir
    if (-not $dir) {
        $documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
        $dir = Join-Path $documents ('Cboinn Driver Backups\' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
    }
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Set-Status -Message ('Sürücüler yedekleniyor (pnputil): {0}' -f $dir) -Percent 35
    $null = & pnputil.exe /export-driver * "$dir" 2>&1
    $code = $LASTEXITCODE
    Write-Log ('pnputil /export-driver çıkış kodu: {0}' -f $code)
    $count = @(Get-ChildItem -Path $dir -Directory -ErrorAction SilentlyContinue).Count
    Write-AtomicText -Path (Join-Path $StateDir 'backup.result.json') -Value ([ordered]@{ folder = $dir; exit = $code; count = $count } | ConvertTo-Json)
    if ($code -ne 0) { throw ('Sürücü yedekleme başarısız (pnputil kodu {0}). Yönetici olarak çalıştırmayı deneyin.' -f $code) }
    Set-Status -Message ('Sürücü yedeği alındı: {0} paket -> {1}' -f $count, $dir) -Percent 100 -Done $true -Extra @{ folder = $dir; count = $count }
}

function Get-ProblemDevices {
    Write-Log 'Win32_PnPEntity ile sorunlu/eksik aygıtlar taranıyor'
    $codes = @{
        1 = 'Yapılandırma eksik'; 3 = 'Sürücü bozuk veya bellek yetersiz'; 9 = 'Donanım düzgün bildirilemedi'
        10 = 'Aygıt başlatılamıyor'; 12 = 'Yeterli boş kaynak yok'; 14 = 'Yeniden başlatma gerekiyor'
        16 = 'Aygıt kaynakları tanımlanamadı'; 18 = 'Sürücüler yeniden yüklenmeli'; 19 = 'Kayıt defteri bozuk'
        21 = 'Sistem aygıtı kaldırıyor'; 24 = 'Aygıt yok veya düzgün çalışmıyor'; 28 = 'Sürücü YÜKLÜ DEĞİL'
        31 = 'Sürücü yüklenemedi (düzgün çalışmıyor)'; 32 = 'Sürücü hizmeti devre dışı'; 33 = 'Donanım hatası'
        35 = 'BIOS kaynak eksik'; 37 = 'Sürücü başlatılamadı'; 38 = 'Önceki sürücü örneği bellekte'
        39 = 'Sürücü bozuk veya eksik'; 40 = 'Hizmet anahtarı hatalı'; 41 = 'Sürücü yüklü ama aygıt yok'
        43 = 'Windows aygıtı durdurdu (sorun bildirdi)'; 44 = 'Uygulama/hizmet aygıtı kapattı'
        48 = 'Sürücü çalışması engellendi'; 52 = 'Sürücü imzası doğrulanamadı'
    }
    $skip = @(22, 45)  # 22=devre dışı (kasıtlı), 45=bağlı değil (hayalet) -> gürültü
    $list = New-Object System.Collections.Generic.List[object]
    $items = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
        Where-Object { $null -ne $_.ConfigManagerErrorCode -and ([int]$_.ConfigManagerErrorCode) -ne 0 -and $skip -notcontains ([int]$_.ConfigManagerErrorCode) }
    foreach ($d in $items) {
        if ([string]::IsNullOrWhiteSpace($d.Name)) { continue }
        $code = [int]$d.ConfigManagerErrorCode
        $hw = ''
        try { if ($d.HardwareID) { $hw = @($d.HardwareID)[0] } } catch {}
        $list.Add([ordered]@{
            Name         = $d.Name
            Class        = $d.PNPClass
            Manufacturer = $d.Manufacturer
            ErrorCode    = $code
            Problem      = $(if ($codes.ContainsKey($code)) { $codes[$code] } else { "Hata kodu $code" })
            Missing      = ($code -eq 28)
            MissingText  = $(if ($code -eq 28) { 'EKSİK SÜRÜCÜ' } else { '' })
            HardwareID   = $hw
            DeviceID     = $d.DeviceID
        }) | Out-Null
    }
    Write-Log ('Sorunlu aygıt: {0}' -f $list.Count)
    return $list
}

function Invoke-ProblemDevicesMode {
    Set-Status -Message 'Sorunlu/eksik aygıtlar taranıyor...' -Percent 40
    $probs = Get-ProblemDevices
    Write-AtomicText -Path (Join-Path $StateDir 'problems.json') -Value (ConvertTo-JsonArray $probs)
    Set-Status -Message ('{0} sorunlu aygıt bulundu.' -f @($probs).Count) -Percent 100 -Done $true -Extra @{ count = @($probs).Count }
}

# ---- Temizlik (CCleaner tarzı) ----
function Get-CleanTargets {
    $t = New-Object System.Collections.Generic.List[object]
    $t.Add([ordered]@{ Id = 'usertemp'; Label = 'Kullanıcı geçici dosyaları (%TEMP%)'; Paths = @($env:TEMP) }) | Out-Null
    $t.Add([ordered]@{ Id = 'wintemp'; Label = 'Windows geçici dosyaları'; Paths = @((Join-Path $env:SystemRoot 'Temp')) }) | Out-Null
    $t.Add([ordered]@{ Id = 'wucache'; Label = 'Windows Update önbelleği'; Paths = @((Join-Path $env:SystemRoot 'SoftwareDistribution\Download')) }) | Out-Null
    $t.Add([ordered]@{ Id = 'prefetch'; Label = 'Prefetch'; Paths = @((Join-Path $env:SystemRoot 'Prefetch')) }) | Out-Null
    $t.Add([ordered]@{ Id = 'thumb'; Label = 'Küçük resim önbelleği'; Paths = @((Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer')); Filter = 'thumbcache_*.db' }) | Out-Null
    $t.Add([ordered]@{ Id = 'cbslog'; Label = 'Windows günlükleri (CBS)'; Paths = @((Join-Path $env:SystemRoot 'Logs\CBS')) }) | Out-Null
    $t.Add([ordered]@{ Id = 'edge'; Label = 'Edge tarayıcı önbelleği'; Paths = @((Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Cache')) }) | Out-Null
    $t.Add([ordered]@{ Id = 'chrome'; Label = 'Chrome tarayıcı önbelleği'; Paths = @((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Cache')) }) | Out-Null
    $t.Add([ordered]@{ Id = 'recyclebin'; Label = 'Geri Dönüşüm Kutusu'; Recycle = $true }) | Out-Null
    return $t
}

function Measure-CleanPath {
    param([string[]]$Paths, [string]$Filter)
    $bytes = [int64]0; $count = 0
    foreach ($p in $Paths) {
        if (-not $p -or -not (Test-Path -LiteralPath $p)) { continue }
        try {
            $gi = @{ LiteralPath = $p; Recurse = $true; Force = $true; File = $true; ErrorAction = 'SilentlyContinue' }
            if ($Filter) { $gi['Filter'] = $Filter }
            foreach ($f in Get-ChildItem @gi) { $bytes += [int64]$f.Length; $count++ }
        } catch {}
    }
    return [pscustomobject]@{ Bytes = $bytes; Count = $count }
}

function Measure-RecycleBin {
    $bytes = [int64]0; $count = 0
    try {
        $shell = New-Object -ComObject Shell.Application
        $rb = $shell.Namespace(0xA)
        if ($rb) { foreach ($it in $rb.Items()) { try { $bytes += [int64]$it.Size; $count++ } catch {} } }
    } catch {}
    return [pscustomobject]@{ Bytes = $bytes; Count = $count }
}

function Invoke-CleanScanMode {
    Set-Status -Message 'Temizlenebilir alan hesaplanıyor...' -Percent 15
    $targets = Get-CleanTargets
    $list = New-Object System.Collections.Generic.List[object]
    $n = 0
    foreach ($t in $targets) {
        $n++
        Set-Status -Message ('Hesaplanıyor: {0}' -f $t.Label) -Percent ([int](15 + 80.0 * $n / $targets.Count))
        if ($t.Recycle) { $m = Measure-RecycleBin } else { $m = Measure-CleanPath -Paths $t.Paths -Filter $t.Filter }
        $list.Add([ordered]@{ Id = $t.Id; Label = $t.Label; SizeMB = [math]::Round($m.Bytes / 1MB, 1); Count = $m.Count }) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'cleanscan.json') -Value (ConvertTo-JsonArray $list)
    $total = [math]::Round((($list | Measure-Object -Property SizeMB -Sum).Sum), 1)
    Set-Status -Message ('Toplam temizlenebilir: {0} MB' -f $total) -Percent 100 -Done $true -Extra @{ totalMB = $total }
}

function Invoke-CleanApplyMode {
    $ids = @()
    if ($CleanCategoriesCsv) { $ids = $CleanCategoriesCsv -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    if (@($ids).Count -eq 0) { throw 'Temizlenecek kategori seçilmedi.' }
    $targets = Get-CleanTargets
    $sel = @{}; foreach ($id in $ids) { $sel[$id] = $true }
    $freed = [int64]0
    $done = New-Object System.Collections.Generic.List[object]
    $n = 0
    foreach ($t in $targets) {
        if (-not $sel.ContainsKey($t.Id)) { continue }
        $n++
        Set-Status -Message ('Temizleniyor: {0}' -f $t.Label) -Percent ([int](10 + 80.0 * $n / @($ids).Count))
        if ($t.Recycle) {
            $before = (Measure-RecycleBin).Bytes
            try { Clear-RecycleBin -Force -ErrorAction Stop; $freed += $before } catch { Write-Log ('Geri dönüşüm kutusu: {0}' -f $_.Exception.Message) }
        } else {
            foreach ($p in $t.Paths) {
                if (-not $p -or -not (Test-Path -LiteralPath $p)) { continue }
                try {
                    $gi = @{ LiteralPath = $p; Recurse = $true; Force = $true; File = $true; ErrorAction = 'SilentlyContinue' }
                    if ($t.Filter) { $gi['Filter'] = $t.Filter }
                    foreach ($f in Get-ChildItem @gi) {
                        $sz = [int64]$f.Length
                        try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $freed += $sz } catch {}
                    }
                } catch {}
            }
        }
        $done.Add([ordered]@{ Id = $t.Id; Label = $t.Label }) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'cleanresult.json') -Value ([ordered]@{ freedMB = [math]::Round($freed / 1MB, 1); categories = $done } | ConvertTo-Json -Depth 5)
    Set-Status -Message ('Temizlik tamamlandı. Boşaltılan: {0} MB' -f [math]::Round($freed / 1MB, 1)) -Percent 100 -Done $true -Extra @{ freedMB = [math]::Round($freed / 1MB, 1) }
}

# ---- Sürücü deposu (pnputil): listele / sil ----
# Dil-bağımsız ayrıştırma: etiket metnine değil, kayıt sırasına ve "oemX.inf" desenine dayanır.
function Get-DriverStorePackages {
    $prev = $null
    try { $prev = [Console]::OutputEncoding; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
    try { $out = @(& pnputil.exe /enum-drivers 2>&1 | ForEach-Object { [string]$_ }) } finally { if ($prev) { try { [Console]::OutputEncoding = $prev } catch {} } }
    $list = New-Object System.Collections.Generic.List[object]
    $cur = $null
    $field = 0
    foreach ($ln in $out) {
        $ci = $ln.IndexOf(':')
        if ($ci -lt 0) { if ($cur) { $list.Add($cur) | Out-Null; $cur = $null }; continue }
        $val = $ln.Substring($ci + 1).Trim()
        if ($val -match '^oem\d+\.inf$') {
            if ($cur) { $list.Add($cur) | Out-Null }
            $cur = [ordered]@{ PublishedName = $val; OriginalName = ''; Provider = ''; ClassName = ''; ClassGuid = ''; Version = ''; Date = ''; Signer = ''; Old = $false; OldText = '' }
            $field = 0
        } elseif ($cur) {
            $field++
            switch ($field) {
                1 { $cur.OriginalName = $val }
                2 { $cur.Provider = $val }
                3 { $cur.ClassName = $val }
                4 { $cur.ClassGuid = $val }
                5 {
                    if ($val -match '^(\d{1,2}[/.]\d{1,2}[/.]\d{4})\s+(.+)$') { $cur.Date = $Matches[1]; $cur.Version = $Matches[2].Trim() }
                    else { $cur.Version = $val }
                }
                6 { $cur.Signer = $val }
            }
        }
    }
    if ($cur) { $list.Add($cur) | Out-Null }
    foreach ($g in ($list | Group-Object OriginalName)) {
        if ($g.Count -gt 1 -and $g.Name) {
            $sorted = @($g.Group | Sort-Object @{ Expression = { try { [version]$_.Version } catch { [version]'0.0.0.0' } } } -Descending)
            for ($i = 1; $i -lt $sorted.Count; $i++) { $sorted[$i].Old = $true; $sorted[$i].OldText = 'Eski kopya' }
        }
    }
    return , $list.ToArray()
}

function Invoke-DriverStoreMode {
    Set-Status -Message 'Sürücü deposu listeleniyor (pnputil)...' -Percent 30
    $pkgs = Get-DriverStorePackages
    Write-AtomicText -Path (Join-Path $StateDir 'driverstore.json') -Value (ConvertTo-JsonArray $pkgs)
    $old = @($pkgs | Where-Object { $_.Old }).Count
    Set-Status -Message ('{0} sürücü paketi bulundu ({1} eski kopya).' -f @($pkgs).Count, $old) -Percent 100 -Done $true -Extra @{ count = @($pkgs).Count; old = $old }
}

function Invoke-DriverStoreDeleteMode {
    $infs = @()
    if ($DriverInfs) { $infs = $DriverInfs -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    if (@($infs).Count -eq 0) { throw 'Silinecek sürücü paketi seçilmedi.' }
    foreach ($inf in $infs) { if ($inf -notmatch '^oem\d+\.inf$') { throw ('Geçersiz sürücü paketi adı: {0}' -f $inf) } }
    if ($CreateRestorePoint) {
        Set-Status -Message 'Geri yükleme noktası oluşturuluyor...' -Percent 5
        try {
            Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue
            Checkpoint-Computer -Description 'CboinnDriverScanner - sürücü deposu temizliği öncesi' -RestorePointType 'DEVICE_DRIVER_INSTALL' -ErrorAction Stop
            Write-Log 'Geri yükleme noktası oluşturuldu (sürücü deposu)'
        } catch { Write-Log ('Geri yükleme noktası atlandı (Sistem Koruması kapalı/günlük sınır olabilir): {0}' -f $_.Exception.Message) }
    }
    $results = New-Object System.Collections.Generic.List[object]
    $n = 0
    foreach ($inf in $infs) {
        $n++
        Set-Status -Message ('Siliniyor: {0} ({1}/{2})' -f $inf, $n, @($infs).Count) -Percent ([int](10 + 80.0 * $n / @($infs).Count))
        # /delete-driver WITHOUT /uninstall: kullanımdaki paketler korunur (silmeyi reddeder) → güvenli temizlik.
        $out = @(& pnputil.exe /delete-driver $inf 2>&1 | ForEach-Object { [string]$_ })
        $code = $LASTEXITCODE
        Write-Log ('pnputil /delete-driver {0} çıkış kodu: {1}' -f $inf, $code)
        $results.Add([ordered]@{ inf = $inf; exit = $code; details = [string]::Join("`n", @($out)) }) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'driverstore.delete.result.json') -Value (ConvertTo-JsonArray $results)
    $ok = @($results | Where-Object { $_.exit -eq 0 }).Count
    Set-Status -Message ('Silme bitti. Başarılı: {0}/{1} (kullanımdaki paketler korunur).' -f $ok, $results.Count) -Percent 100 -Done $true -Extra @{ succeeded = $ok; total = $results.Count }
}

# ---- Windows hafifletme (debloat): kaldırılabilir hazır UWP uygulamaları ----
# Yalnızca KÜRATÖRLÜ listedeki bilinen şişirme uygulamaları; kullanıcı bazında kaldırılır (geri kurulabilir). Kritik sistem uygulamalarına dokunulmaz.
function Get-BloatPatterns {
    return @(
        'Microsoft.3DBuilder', 'Microsoft.BingNews', 'Microsoft.BingWeather', 'Microsoft.BingFinance', 'Microsoft.BingSports', 'Microsoft.BingSearch',
        'Microsoft.GamingApp', 'Microsoft.XboxApp', 'Microsoft.XboxGamingOverlay', 'Microsoft.XboxGameOverlay', 'Microsoft.Xbox.TCUI', 'Microsoft.XboxSpeechToTextOverlay',
        'Microsoft.ZuneMusic', 'Microsoft.ZuneVideo', 'Microsoft.SkypeApp', 'Microsoft.MicrosoftSolitaireCollection',
        'Microsoft.People', 'Microsoft.windowscommunicationsapps', 'Microsoft.GetHelp', 'Microsoft.Getstarted',
        'Microsoft.MixedReality.Portal', 'Microsoft.WindowsFeedbackHub', 'Microsoft.YourPhone', 'Microsoft.Windows.Phone',
        'Microsoft.Todos', 'Microsoft.PowerAutomateDesktop', 'Microsoft.WindowsMaps', 'Microsoft.WindowsSoundRecorder',
        'Microsoft.MicrosoftOfficeHub', 'Microsoft.Office.OneNote', 'Microsoft.WindowsAlarms', 'Clipchamp.Clipchamp',
        'king.com.', 'SpotifyAB.', 'Disney.', 'Facebook.', 'BytedancePte.', 'Amazon.com.Amazon', 'Microsoft.Microsoft3DViewer'
    )
}

function Get-BloatFriendlyName {
    param([string]$Name)
    $map = @{
        'Microsoft.BingNews' = 'Haberler'; 'Microsoft.BingWeather' = 'Hava Durumu'; 'Microsoft.BingFinance' = 'Finans'; 'Microsoft.BingSports' = 'Spor'
        'Microsoft.GamingApp' = 'Xbox'; 'Microsoft.XboxApp' = 'Xbox (eski)'; 'Microsoft.XboxGamingOverlay' = 'Xbox Game Bar'; 'Microsoft.Xbox.TCUI' = 'Xbox TCUI'
        'Microsoft.ZuneMusic' = 'Media Player / Groove'; 'Microsoft.ZuneVideo' = 'Filmler ve TV'; 'Microsoft.SkypeApp' = 'Skype'
        'Microsoft.MicrosoftSolitaireCollection' = 'Solitaire Koleksiyonu'; 'Microsoft.People' = 'Kişiler'; 'Microsoft.windowscommunicationsapps' = 'Mail ve Takvim'
        'Microsoft.GetHelp' = 'Yardım Al'; 'Microsoft.Getstarted' = 'İpuçları'; 'Microsoft.YourPhone' = 'Telefonunuza Bağlanın'
        'Microsoft.Todos' = 'Microsoft To Do'; 'Microsoft.WindowsMaps' = 'Haritalar'; 'Microsoft.WindowsSoundRecorder' = 'Ses Kaydedici'
        'Microsoft.MicrosoftOfficeHub' = 'Office Hub'; 'Microsoft.Office.OneNote' = 'OneNote'; 'Microsoft.WindowsAlarms' = 'Saat / Alarm'
        'Clipchamp.Clipchamp' = 'Clipchamp'; 'Microsoft.3DBuilder' = '3D Builder'; 'Microsoft.MixedReality.Portal' = 'Karma Gerçeklik Portalı'
        'Microsoft.WindowsFeedbackHub' = 'Geri Bildirim Merkezi'; 'Microsoft.Microsoft3DViewer' = '3D Görüntüleyici'; 'Microsoft.PowerAutomateDesktop' = 'Power Automate'
    }
    if ($map.ContainsKey($Name)) { return $map[$Name] }
    if ($Name -match '\.([^.]+)$') { return $Matches[1] }
    return $Name
}

function Invoke-BloatScanMode {
    Set-Status -Message 'Kaldırılabilir hazır uygulamalar taranıyor...' -Percent 30
    $patterns = Get-BloatPatterns
    $all = @(Get-AppxPackage -ErrorAction SilentlyContinue)
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($p in $all) {
        if (-not $p.Name) { continue }
        if ($p.IsFramework) { continue }
        $match = $false
        foreach ($pat in $patterns) { if ($p.Name -like ($pat + '*')) { $match = $true; break } }
        if (-not $match) { continue }
        $list.Add([ordered]@{
                Name            = [string]$p.Name
                DisplayName     = (Get-BloatFriendlyName ([string]$p.Name))
                PackageFullName = [string]$p.PackageFullName
                Publisher       = [string]$p.Publisher
                Version         = [string]$p.Version
            }) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'bloat.json') -Value (ConvertTo-JsonArray $list)
    Set-Status -Message ('{0} kaldırılabilir uygulama bulundu.' -f $list.Count) -Percent 100 -Done $true -Extra @{ count = $list.Count }
}

function Invoke-BloatRemoveMode {
    $names = @()
    if ($AppxNames) { $names = $AppxNames -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    if (@($names).Count -eq 0) { throw 'Kaldırılacak uygulama seçilmedi.' }
    foreach ($pfn in $names) { if ($pfn -notmatch '^[A-Za-z0-9][A-Za-z0-9._\-+~]{0,300}$') { throw ('Geçersiz paket adı: {0}' -f $pfn) } }
    $results = New-Object System.Collections.Generic.List[object]
    $n = 0
    foreach ($pfn in $names) {
        $n++
        Set-Status -Message ('Kaldırılıyor: {0} ({1}/{2})' -f $pfn, $n, @($names).Count) -Percent ([int](10 + 80.0 * $n / @($names).Count))
        $okFlag = $true; $err = ''
        try { Remove-AppxPackage -Package $pfn -ErrorAction Stop } catch { $okFlag = $false; $err = $_.Exception.Message }
        Write-Log ('Remove-AppxPackage {0}: {1}' -f $pfn, $(if ($okFlag) { 'OK' } else { $err }))
        $results.Add([ordered]@{ package = $pfn; ok = $okFlag; error = $err }) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'bloat.remove.result.json') -Value (ConvertTo-JsonArray $results)
    $okc = @($results | Where-Object { $_.ok }).Count
    Set-Status -Message ('Kaldırma bitti. Başarılı: {0}/{1}' -f $okc, $results.Count) -Percent 100 -Done $true -Extra @{ succeeded = $okc; total = $results.Count }
}

# ---- Geri Dönüşüm Kutusu: listele / geri yükle (Shell COM Namespace 0xA) ----
function Get-RecycleItems {
    $list = New-Object System.Collections.Generic.List[object]
    try {
        $shell = New-Object -ComObject Shell.Application
        $rb = $shell.Namespace(0xA)
        if (-not $rb) { return , $list.ToArray() }
        foreach ($it in $rb.Items()) {
            $name = ''; $loc = ''; $del = ''; $sz = [int64]0
            try { $name = [string]$it.Name } catch {}
            try { $loc = [string]$rb.GetDetailsOf($it, 1) } catch {}   # Özgün konum
            try { $del = [string]$rb.GetDetailsOf($it, 2) } catch {}   # Silinme tarihi
            try { $sz = [int64]$it.Size } catch {}
            $list.Add([ordered]@{
                    Name             = $name
                    OriginalLocation = $loc
                    DateDeleted      = $del
                    SizeKB           = [math]::Round($sz / 1KB, 1)
                    Key              = ($loc + '\' + $name)
                }) | Out-Null
        }
    } catch {}
    return , $list.ToArray()
}

function Invoke-RecycleListMode {
    Set-Status -Message 'Geri dönüşüm kutusu okunuyor...' -Percent 40
    $items = Get-RecycleItems
    Write-AtomicText -Path (Join-Path $StateDir 'recycle.json') -Value (ConvertTo-JsonArray $items)
    Set-Status -Message ('{0} öğe bulundu.' -f @($items).Count) -Percent 100 -Done $true -Extra @{ count = @($items).Count }
}

function Invoke-RecycleRestoreMode {
    $keys = @()
    if ($RestoreKeys) { $keys = $RestoreKeys -split '\|' | Where-Object { $_ } }
    if (@($keys).Count -eq 0) { throw 'Geri yüklenecek öğe seçilmedi.' }
    $set = @{}; foreach ($k in $keys) { $set[$k] = $true }
    $restored = 0; $failed = 0
    $shell = New-Object -ComObject Shell.Application
    $rb = $shell.Namespace(0xA)
    if (-not $rb) { throw 'Geri dönüşüm kutusu okunamadı.' }
    $items = @(); foreach ($it in $rb.Items()) { $items += $it }
    $n = 0
    foreach ($it in $items) {
        $name = ''; $loc = ''
        try { $name = [string]$it.Name } catch {}
        try { $loc = [string]$rb.GetDetailsOf($it, 1) } catch {}
        $key = ($loc + '\' + $name)
        if (-not $set.ContainsKey($key)) { continue }
        $n++
        Set-Status -Message ('Geri yükleniyor: {0}' -f $name) -Percent ([int](10 + 80.0 * $n / @($keys).Count))
        $done = $false
        try {
            foreach ($v in $it.Verbs()) {
                $vn = ([string]$v.Name) -replace '&', ''
                if ($vn -match '^(Restore|Geri Yükle|Geri yükle|Geri Yukle|Restaurer|Wiederherstellen|Restaurar|Ripristina|Восстановить)$') {
                    $v.DoIt(); $done = $true; break
                }
            }
        } catch {}
        if (-not $done) { try { $it.InvokeVerb('undelete'); $done = $true } catch {} }
        if ($done) { $restored++ } else { $failed++ }
    }
    Write-AtomicText -Path (Join-Path $StateDir 'recycle.restore.result.json') -Value ([ordered]@{ restored = $restored; failed = $failed } | ConvertTo-Json)
    Set-Status -Message ('Geri yükleme bitti. Başarılı: {0}, başarısız: {1}' -f $restored, $failed) -Percent 100 -Done $true -Extra @{ succeeded = $restored; total = ($restored + $failed) }
}

# ---- Kurulum medyası: USB listele / bootable USB oluştur ----
function Get-UsbDisks {
    $list = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($d in (Get-Disk -ErrorAction SilentlyContinue | Where-Object { $_.BusType -eq 'USB' })) {
            $list.Add([ordered]@{
                    DiskNumber     = [int]$d.Number
                    FriendlyName   = [string]$d.FriendlyName
                    SizeGB         = [math]::Round($d.Size / 1GB, 1)
                    PartitionStyle = [string]$d.PartitionStyle
                }) | Out-Null
        }
    } catch {}
    return , $list.ToArray()
}

function Invoke-UsbListMode {
    Set-Status -Message 'USB diskleri listeleniyor...' -Percent 40
    $disks = Get-UsbDisks
    Write-AtomicText -Path (Join-Path $StateDir 'usb.json') -Value (ConvertTo-JsonArray $disks)
    Set-Status -Message ('{0} çıkarılabilir USB diski bulundu.' -f @($disks).Count) -Percent 100 -Done $true -Extra @{ count = @($disks).Count }
}

function Invoke-MakeBootableMode {
    if (-not $IsoPath -or -not (Test-Path -LiteralPath $IsoPath)) { throw 'ISO dosyası bulunamadı.' }
    if (-not $UsbDiskNumber) { throw 'Hedef USB diski seçilmedi.' }
    $dn = [int]$UsbDiskNumber
    $disk = Get-Disk -Number $dn -ErrorAction Stop
    # ---- GÜVENLİK KONTROLLERİ (yanlış disk silmeyi önler) ----
    if ($disk.BusType -ne 'USB') { throw 'GÜVENLİK: Hedef bir USB diski değil — işlem iptal edildi.' }
    if ($dn -eq 0) { throw 'GÜVENLİK: Disk 0 (sistem diski) hedeflenemez.' }
    if ($disk.IsBoot -or $disk.IsSystem) { throw 'GÜVENLİK: Sistem/açılış diski hedeflenemez.' }
    if ($disk.Size -gt 256GB) { throw 'GÜVENLİK: 256GB üstü disk hedeflenemez (USB olmayabilir).' }
    if ($disk.Size -gt 32GB) { throw '32GB üstü USB için FAT32 biçimlendirilemiyor. Daha küçük (≤32GB) bir USB kullanın veya Rufus önerilir.' }

    Set-Status -Message 'USB temizleniyor ve biçimlendiriliyor (FAT32)...' -Percent 12
    Clear-Disk -Number $dn -RemoveData -RemoveOEM -Confirm:$false -ErrorAction Stop
    try { Initialize-Disk -Number $dn -PartitionStyle MBR -ErrorAction Stop } catch {}
    $part = New-Partition -DiskNumber $dn -UseMaximumSize -IsActive -AssignDriveLetter -ErrorAction Stop
    Start-Sleep -Seconds 1
    Format-Volume -Partition $part -FileSystem FAT32 -NewFileSystemLabel 'CBOINN_WIN' -Confirm:$false -Force -ErrorAction Stop | Out-Null
    $usbRoot = ([string]$part.DriveLetter + ':\')

    Set-Status -Message 'ISO bağlanıyor...' -Percent 35
    $mount = Mount-DiskImage -ImagePath $IsoPath -PassThru -ErrorAction Stop
    Start-Sleep -Seconds 2
    $isoLetter = ($mount | Get-Volume).DriveLetter
    if (-not $isoLetter) { throw 'ISO bağlanamadı (sürücü harfi alınamadı).' }
    $isoRoot = ([string]$isoLetter + ':\')

    try {
        $wim = Join-Path $isoRoot 'sources\install.wim'
        $bigWim = (Test-Path -LiteralPath $wim) -and ((Get-Item -LiteralPath $wim).Length -gt 4000000000)
        Set-Status -Message 'Dosyalar kopyalanıyor (uzun sürebilir)...' -Percent 55
        $rcArgs = @($isoRoot, $usbRoot, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1')
        if ($bigWim) { $rcArgs += @('/XF', 'install.wim') }
        & robocopy.exe @rcArgs | Out-Null
        # Robocopy bit-kodlu çıkış kullanır: 0-7 = başarı (kopyalandı/atlandı),
        # >=8 = gerçek hata (ör. disk doldu). Kontrol etmezsek bozuk/eksik bir
        # USB'yi "hazır" diye bildiririz.
        $rc = $LASTEXITCODE
        if ($rc -ge 8) { throw ('Dosyalar kopyalanamadı (robocopy hata kodu: {0}). USB hazır değil.' -f $rc) }
        if ($bigWim) {
            Set-Status -Message 'install.wim FAT32 için bölünüyor (DISM)...' -Percent 82
            $srcDir = Join-Path $usbRoot 'sources'
            if (-not (Test-Path -LiteralPath $srcDir)) { New-Item -ItemType Directory -Path $srcDir -Force | Out-Null }
            & dism.exe /Split-Image /ImageFile:"$wim" /SWMFile:"$srcDir\install.swm" /FileSize:3800 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw ('install.wim bölünemedi (DISM hata kodu: {0}). USB hazır değil.' -f $LASTEXITCODE) }
        }
    } finally {
        Dismount-DiskImage -ImagePath $IsoPath -ErrorAction SilentlyContinue | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'bootable.result.json') -Value ([ordered]@{ drive = $usbRoot; iso = $IsoPath } | ConvertTo-Json)
    Set-Status -Message ('Bootable USB hazır: {0}' -f $usbRoot) -Percent 100 -Done $true -Extra @{ drive = $usbRoot }
}

# ---- Sistem sağlığı: disk SMART/sağlık + pil aşınması (salt-okunur) ----
function Get-SystemHealth {
    $disks = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($pd in (Get-PhysicalDisk -ErrorAction SilentlyContinue)) {
            $temp = $null; $wear = $null
            try { $rc = $pd | Get-StorageReliabilityCounter -ErrorAction Stop; if ($rc) { $temp = $rc.Temperature; $wear = $rc.Wear } } catch {}
            $disks.Add([ordered]@{
                    Name    = [string]$pd.FriendlyName
                    Media   = [string]$pd.MediaType
                    Health  = [string]$pd.HealthStatus
                    SizeGB  = [math]::Round($pd.Size / 1GB, 0)
                    TempC   = $temp
                    WearPct = $wear
                }) | Out-Null
        }
    } catch {}
    $battery = $null
    try {
        $b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($b) {
            $design = $null; $full = $null; $wearPct = $null
            try {
                $st = Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1
                $fc = Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($st) { $design = [int]$st.DesignedCapacity }
                if ($fc) { $full = [int]$fc.FullChargedCapacity }
                if ($design -and $full -and $design -gt 0) { $wearPct = [math]::Round(100 - ($full * 100.0 / $design), 1) }
            } catch {}
            $battery = [ordered]@{ ChargePct = [int]$b.EstimatedChargeRemaining; DesignCapacity = $design; FullCapacity = $full; WearPct = $wearPct }
        }
    } catch {}
    return [ordered]@{ disks = @($disks.ToArray()); battery = $battery }
}

function Invoke-SystemHealthMode {
    Set-Status -Message 'Sistem sağlığı kontrol ediliyor (disk SMART + pil)...' -Percent 40
    $h = Get-SystemHealth
    Write-AtomicText -Path (Join-Path $StateDir 'health.json') -Value ($h | ConvertTo-Json -Depth 6)
    Set-Status -Message ('{0} disk kontrol edildi.' -f @($h.disks).Count) -Percent 100 -Done $true -Extra @{ count = @($h.disks).Count }
}

# ---- Sistem onarımı: SFC / DISM / chkdsk (yükseltilmiş) ----
function Invoke-SystemRepairMode {
    $tool = ([string]$RepairTool).ToLower().Trim()
    if (@('sfc', 'dism', 'chkdsk') -notcontains $tool) { throw 'Geçersiz onarım aracı (sfc/dism/chkdsk).' }
    $prev = $null
    try { $prev = [Console]::OutputEncoding; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
    $out = @(); $code = 0
    try {
        if ($tool -eq 'sfc') {
            Set-Status -Message 'SFC /scannow çalışıyor (uzun sürebilir, lütfen bekleyin)...' -Percent 20
            $out = @(& sfc.exe /scannow 2>&1 | ForEach-Object { ([string]$_) -replace "`0", '' }); $code = $LASTEXITCODE
        } elseif ($tool -eq 'dism') {
            Set-Status -Message 'DISM /RestoreHealth çalışıyor (uzun sürebilir)...' -Percent 20
            $out = @(& dism.exe /online /cleanup-image /restorehealth 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE
        } else {
            Set-Status -Message 'chkdsk C: /scan çalışıyor (salt-okunur, güvenli)...' -Percent 20
            $out = @(& chkdsk.exe C: /scan 2>&1 | ForEach-Object { [string]$_ }); $code = $LASTEXITCODE
        }
    } finally { if ($prev) { try { [Console]::OutputEncoding = $prev } catch {} } }
    $tail = (@($out) | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 25) -join "`n"
    Write-AtomicText -Path (Join-Path $StateDir 'repair.result.json') -Value ([ordered]@{ tool = $tool; exit = $code; output = $tail } | ConvertTo-Json -Depth 4)
    Set-Status -Message ('{0} tamamlandı (çıkış kodu {1}).' -f $tool.ToUpper(), $code) -Percent 100 -Done $true -Extra @{ tool = $tool; exit = $code }
}

# ---- Geri yükleme noktaları (System Restore) ----
function Get-RestorePoints {
    $list = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($rp in (Get-ComputerRestorePoint -ErrorAction SilentlyContinue)) {
            $when = ''
            try { $when = ([System.Management.ManagementDateTimeConverter]::ToDateTime($rp.CreationTime)).ToString('yyyy-MM-dd HH:mm') } catch { $when = [string]$rp.CreationTime }
            $list.Add([ordered]@{ Seq = [int]$rp.SequenceNumber; Description = [string]$rp.Description; Created = $when; Type = [string]$rp.RestorePointType }) | Out-Null
        }
    } catch {}
    return , $list.ToArray()
}
function Invoke-RestoreListMode {
    Set-Status -Message 'Geri yükleme noktaları listeleniyor...' -Percent 40
    $rps = Get-RestorePoints
    Write-AtomicText -Path (Join-Path $StateDir 'restore.json') -Value (ConvertTo-JsonArray $rps)
    Set-Status -Message ('{0} geri yükleme noktası bulundu.' -f @($rps).Count) -Percent 100 -Done $true -Extra @{ count = @($rps).Count }
}
function Invoke-RestoreCreateMode {
    $desc = if ($Description) { $Description } else { 'Cboinn Driver Scanner' }
    Set-Status -Message 'Geri yükleme noktası oluşturuluyor...' -Percent 30
    try {
        try { Enable-ComputerRestore -Drive 'C:\' -ErrorAction SilentlyContinue } catch {}
        Checkpoint-Computer -Description $desc -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop
        Write-AtomicText -Path (Join-Path $StateDir 'restore.create.result.json') -Value ([ordered]@{ ok = $true; description = $desc } | ConvertTo-Json)
        Set-Status -Message 'Geri yükleme noktası oluşturuldu.' -Percent 100 -Done $true
    } catch {
        Write-AtomicText -Path (Join-Path $StateDir 'restore.create.result.json') -Value ([ordered]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json)
        throw ('Oluşturulamadı: {0} (Sistem Koruması kapalı olabilir veya günde tek nokta sınırı.)' -f $_.Exception.Message)
    }
}

# ---- Ağ araçları ----
function Get-NetworkInfo {
    $list = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($c in (Get-NetIPConfiguration -ErrorAction SilentlyContinue)) {
            $ipv4 = ''; $gw = ''; $dns = ''
            try { $ipv4 = (@($c.IPv4Address.IPAddress) -join ', ') } catch {}
            try { $gw = (@($c.IPv4DefaultGateway.NextHop) -join ', ') } catch {}
            try { $dns = (@($c.DNSServer | ForEach-Object { $_.ServerAddresses }) | Where-Object { $_ } | Select-Object -Unique) -join ', ' } catch {}
            $list.Add([ordered]@{ Name = [string]$c.InterfaceAlias; Status = [string]$c.NetAdapter.Status; IPv4 = $ipv4; Gateway = $gw; DNS = $dns }) | Out-Null
        }
    } catch {}
    return , $list.ToArray()
}
function Invoke-NetworkInfoMode {
    Set-Status -Message 'Ağ yapılandırması okunuyor...' -Percent 40
    $n = Get-NetworkInfo
    Write-AtomicText -Path (Join-Path $StateDir 'network.json') -Value (ConvertTo-JsonArray $n)
    Set-Status -Message ('{0} ağ adaptörü bulundu.' -f @($n).Count) -Percent 100 -Done $true -Extra @{ count = @($n).Count }
}
function Invoke-NetworkActionMode {
    $act = ([string]$NetAction).ToLower().Trim()
    if (@('flushdns', 'release', 'renew', 'winsock') -notcontains $act) { throw 'Geçersiz ağ işlemi.' }
    Set-Status -Message ('Ağ işlemi: {0}' -f $act) -Percent 30
    $out = @(); $msg = ''
    if ($act -eq 'flushdns') { $out = @(& ipconfig.exe /flushdns 2>&1 | ForEach-Object { [string]$_ }); $msg = 'DNS önbelleği temizlendi.' }
    elseif ($act -eq 'release') { $out = @(& ipconfig.exe /release 2>&1 | ForEach-Object { [string]$_ }); $msg = 'IP adresi bırakıldı.' }
    elseif ($act -eq 'renew') { $out = @(& ipconfig.exe /renew 2>&1 | ForEach-Object { [string]$_ }); $msg = 'IP adresi yenilendi.' }
    else { $out = @(& netsh.exe winsock reset 2>&1 | ForEach-Object { [string]$_ }); $msg = 'Winsock sıfırlandı (yeniden başlatma önerilir).' }
    Write-AtomicText -Path (Join-Path $StateDir 'network.action.result.json') -Value ([ordered]@{ action = $act; output = (@($out) -join "`n") } | ConvertTo-Json -Depth 4)
    Set-Status -Message $msg -Percent 100 -Done $true -Extra @{ action = $act }
}

# ---- Başlangıç programları (durum + yönetilebilirlik dahil) ----
$Script:StartupApprovedRun = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
function Get-StartupEnabledState {
    param([string]$Name)
    # StartupApproved\Run değeri yoksa = ETKIN. Varsa byte[0] tek (0x03/...) = devre dışı.
    try {
        $p = Get-ItemProperty -Path $Script:StartupApprovedRun -Name $Name -ErrorAction Stop
        $b = $p.$Name
        if ($b -and $b.Count -ge 1) { return ((([int]$b[0]) -band 1) -eq 0) }
    } catch {}
    return $true
}
function Get-StartupItems {
    $list = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($s in (Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue)) {
            $loc = [string]$s.Location
            $scope = 'other'
            if ($loc -match '^HKLM' -and $loc -match '\\Run$') { $scope = 'hklm-run' }
            elseif ($loc -match '^HKU' -and $loc -match '\\Run$') { $scope = 'hkcu-run' }
            elseif ($loc -eq 'Startup') { $scope = 'startup-folder' }
            elseif ($loc -eq 'Common Startup') { $scope = 'common-startup' }
            # v4.5: yalnız HKCU Run güvenli/admin'siz yönetilebilir (StartupApproved kapısı).
            $manageable = ($scope -eq 'hkcu-run')
            $enabled = if ($scope -eq 'hkcu-run') { Get-StartupEnabledState -Name ([string]$s.Name) } else { $true }
            $list.Add([ordered]@{ Name = [string]$s.Name; Command = [string]$s.Command; Location = $loc; User = [string]$s.User; Scope = $scope; Manageable = $manageable; Enabled = $enabled }) | Out-Null
        }
    } catch {}
    return , $list.ToArray()
}
function Invoke-StartupSetStateMode {
    $nm = if ($StartupName) { $StartupName.Trim() } else { '' }
    if (-not $nm) { throw 'Başlangıç öğesi belirtilmedi.' }
    if ($nm.Length -gt 260) { throw 'Geçersiz başlangıç öğesi adı.' }
    $enable = ($StartupEnabled -eq '1' -or $StartupEnabled -eq 'true')
    # StartupApproved ikili değeri (Görev Yöneticisi ile aynı kapı): byte[0]
    # 0x02 = etkin, 0x03 = devre dışı. Yalnız KAPI değişir; asıl Run komutuna
    # DOKUNULMAZ → tam geri-alınabilir, sistem bozulmaz.
    $bytes = if ($enable) { [byte[]](2,0,0,0,0,0,0,0,0,0,0,0) } else { [byte[]](3,0,0,0,0,0,0,0,0,0,0,0) }
    Set-Status -Message ('Başlangıç öğesi güncelleniyor: {0}' -f $nm) -Percent 40
    if (-not (Test-Path $Script:StartupApprovedRun)) { New-Item -Path $Script:StartupApprovedRun -Force | Out-Null }
    New-ItemProperty -Path $Script:StartupApprovedRun -Name $nm -Value $bytes -PropertyType Binary -Force | Out-Null
    $stateText = if ($enable) { 'etkinleştirildi' } else { 'devre dışı bırakıldı' }
    Write-AtomicText -Path (Join-Path $StateDir 'startup.setstate.result.json') -Value ([ordered]@{ name = $nm; enabled = $enable } | ConvertTo-Json)
    Set-Status -Message ('Başlangıç öğesi {0}.' -f $stateText) -Percent 100 -Done $true -Extra @{ enabled = $enable }
}
function Invoke-StartupListMode {
    Set-Status -Message 'Başlangıç programları listeleniyor...' -Percent 40
    $items = Get-StartupItems
    Write-AtomicText -Path (Join-Path $StateDir 'startup.json') -Value (ConvertTo-JsonArray $items)
    Set-Status -Message ('{0} başlangıç öğesi bulundu.' -f @($items).Count) -Percent 100 -Done $true -Extra @{ count = @($items).Count }
}

# ---- Gizlilik & Telemetri (küratörlü, GERİ-ALINABILIR HKCU tweak'leri) ----
function Get-PrivacyTweaks {
    return @(
        [ordered]@{ Id = 'adid'; Label = 'Reklam kimliği (kişiselleştirilmiş reklamlar)'; Path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\AdvertisingInfo'; Name = 'Enabled'; Off = 0; On = 1 },
        [ordered]@{ Id = 'tips'; Label = 'Windows ipuçları ve önerileri'; Path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'; Name = 'SubscribedContent-338389Enabled'; Off = 0; On = 1 },
        [ordered]@{ Id = 'startsuggest'; Label = 'Başlat menüsü uygulama önerileri'; Path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'; Name = 'SystemPaneSuggestionsEnabled'; Off = 0; On = 1 },
        [ordered]@{ Id = 'websearch'; Label = 'Başlat menüsünde web araması (Bing)'; Path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Search'; Name = 'BingSearchEnabled'; Off = 0; On = 1 },
        [ordered]@{ Id = 'lockfun'; Label = 'Kilit ekranında ipuçları/eğlence içeriği'; Path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'; Name = 'RotatingLockScreenOverlayEnabled'; Off = 0; On = 1 }
    )
}
function Invoke-PrivacyScanMode {
    Set-Status -Message 'Gizlilik ayarları okunuyor...' -Percent 40
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($t in (Get-PrivacyTweaks)) {
        $cur = $null
        try { $cur = (Get-ItemProperty -Path $t.Path -Name $t.Name -ErrorAction Stop).$($t.Name) } catch {}
        $applied = ($null -ne $cur -and [int]$cur -eq [int]$t.Off)
        $list.Add([ordered]@{ Id = $t.Id; Label = $t.Label; Applied = $applied }) | Out-Null
    }
    Write-AtomicText -Path (Join-Path $StateDir 'privacy.json') -Value (ConvertTo-JsonArray $list)
    Set-Status -Message 'Gizlilik durumu okundu.' -Percent 100 -Done $true -Extra @{ count = $list.Count }
}
function Set-PrivacyTweaks {
    param([string[]]$Ids, [bool]$Apply)
    $sel = @{}; foreach ($id in $Ids) { $sel[$id] = $true }
    $done = 0
    foreach ($t in (Get-PrivacyTweaks)) {
        if (-not $sel.ContainsKey($t.Id)) { continue }
        $val = if ($Apply) { [int]$t.Off } else { [int]$t.On }
        try {
            if (-not (Test-Path $t.Path)) { New-Item -Path $t.Path -Force | Out-Null }
            New-ItemProperty -Path $t.Path -Name $t.Name -Value $val -PropertyType DWord -Force | Out-Null
            $done++
        } catch { Write-Log ('Gizlilik {0}: {1}' -f $t.Id, $_.Exception.Message) }
    }
    return $done
}
function Invoke-PrivacyApplyMode {
    $ids = @(); if ($Tweaks) { $ids = $Tweaks -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    if (@($ids).Count -eq 0) { throw 'Ayar seçilmedi.' }
    Set-Status -Message 'Gizlilik ayarları uygulanıyor...' -Percent 40
    $n = Set-PrivacyTweaks -Ids $ids -Apply $true
    Write-AtomicText -Path (Join-Path $StateDir 'privacy.apply.result.json') -Value ([ordered]@{ changed = $n } | ConvertTo-Json)
    Set-Status -Message ('{0} gizlilik ayarı uygulandı.' -f $n) -Percent 100 -Done $true -Extra @{ count = $n }
}
function Invoke-PrivacyRevertMode {
    $ids = @(); if ($Tweaks) { $ids = $Tweaks -split ',' | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } }
    if (@($ids).Count -eq 0) { throw 'Ayar seçilmedi.' }
    Set-Status -Message 'Gizlilik ayarları geri alınıyor...' -Percent 40
    $n = Set-PrivacyTweaks -Ids $ids -Apply $false
    Write-AtomicText -Path (Join-Path $StateDir 'privacy.apply.result.json') -Value ([ordered]@{ changed = $n } | ConvertTo-Json)
    Set-Status -Message ('{0} gizlilik ayarı varsayılana döndürüldü.' -f $n) -Percent 100 -Done $true -Extra @{ count = $n }
}

try {
    Write-Log ('Worker başladı: mode={0}' -f $Mode)
    switch ($Mode) {
        'Inventory'       { Invoke-InventoryMode }
        'Scan'            { Invoke-ScanMode }
        'Install'         { Invoke-InstallMode }
        'SoftwareScan'    { Invoke-SoftwareScanMode }
        'SoftwareInstall' { Invoke-SoftwareInstallMode }
        'SysInfo'         { Invoke-SysInfoMode }
        'BackupDrivers'   { Invoke-BackupDriversMode }
        'ProblemDevices'  { Invoke-ProblemDevicesMode }
        'CleanScan'       { Invoke-CleanScanMode }
        'CleanApply'      { Invoke-CleanApplyMode }
        'SoftwareInventory'  { Invoke-SoftwareInventoryMode }
        'SoftwareSearch'     { Invoke-SoftwareSearchMode }
        'SoftwareUninstall'  { Invoke-SoftwareUninstallMode }
        'SoftwareInstallNew' { Invoke-SoftwareInstallNewMode }
        'DriverStore'        { Invoke-DriverStoreMode }
        'DriverStoreDelete'  { Invoke-DriverStoreDeleteMode }
        'BloatScan'          { Invoke-BloatScanMode }
        'BloatRemove'        { Invoke-BloatRemoveMode }
        'RecycleList'        { Invoke-RecycleListMode }
        'RecycleRestore'     { Invoke-RecycleRestoreMode }
        'UsbList'            { Invoke-UsbListMode }
        'MakeBootable'       { Invoke-MakeBootableMode }
        'SystemHealth'       { Invoke-SystemHealthMode }
        'SystemRepair'       { Invoke-SystemRepairMode }
        'RestoreList'        { Invoke-RestoreListMode }
        'RestoreCreate'      { Invoke-RestoreCreateMode }
        'NetworkInfo'        { Invoke-NetworkInfoMode }
        'NetworkAction'      { Invoke-NetworkActionMode }
        'StartupList'        { Invoke-StartupListMode }
        'StartupSetState'    { Invoke-StartupSetStateMode }
        'PrivacyScan'        { Invoke-PrivacyScanMode }
        'PrivacyApply'       { Invoke-PrivacyApplyMode }
        'PrivacyRevert'      { Invoke-PrivacyRevertMode }
    }
    Write-Log ('Worker bitti: mode={0}' -f $Mode)
} catch {
    $msg = $_.Exception.Message
    Write-Log ('HATA: {0}' -f $msg)
    if ($_.InvocationInfo) {
        Write-Log ('HATA-SATIR: {0}' -f $_.InvocationInfo.ScriptLineNumber)
        Write-Log ('HATA-KOD: {0}' -f $_.InvocationInfo.Line.Trim())
    }
    Set-Status -Message 'Hata oluştu.' -Percent 100 -Done $true -ErrorText $msg
    exit 1
}
