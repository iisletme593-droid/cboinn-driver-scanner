<#
    Worker.ps1 - Cboinn Driver Scanner çekirdek motoru (UI'sız)
    Modlar: Inventory / Scan / Install / SoftwareScan / SoftwareInstall / SysInfo / BackupDrivers
    Arayüzle iletişim yalnızca $StateDir altındaki düz JSON dosyaları üzerinden olur.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Inventory', 'Scan', 'Install', 'SoftwareScan', 'SoftwareInstall', 'SysInfo', 'BackupDrivers')]
    [string]$Mode,
    [string]$StateDir,
    [string]$OperationId,
    [string]$UpdateIDsCsv,
    [string]$WingetIds,
    [string]$BackupDir,
    [switch]$CreateRestorePoint
)

$ErrorActionPreference = 'Stop'
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
    $dst = Join-Path $StateDir 'status.json'
    Write-AtomicText -Path $dst -Value $json
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
    if ($argsWithLocale -notcontains '--locale') { $argsWithLocale += @('--locale', 'en-US') }
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

function Get-WingetUpgrades {
    $result = Invoke-WingetCommand @('upgrade', '--include-unknown', '--accept-source-agreements', '--disable-interactivity')
    if ($result.ExitCode -ne 0) {
        throw ('winget taraması başarısız (çıkış kodu {0}): {1}' -f $result.ExitCode, $result.Text)
    }
    $lines = @($result.Lines)
    $clean = New-Object System.Collections.Generic.List[string]
    foreach ($ln in $lines) {
        if ($null -eq $ln) { continue }
        if ($ln -match '[▒█]') { continue }
        if ($ln -match '^\s*[-\\|/]\s*$') { continue }
        $clean.Add($ln)
    }
    $list = New-Object System.Collections.Generic.List[object]
    $hi = -1
    for ($i = 0; $i -lt $clean.Count; $i++) {
        $l = $clean[$i]
        if ($l -match 'Name' -and $l -match 'Id' -and $l -match 'Version' -and $l -match 'Available' -and $l -match 'Source') { $hi = $i; break }
    }
    if ($hi -lt 0) {
        if ($result.Text -match 'No applicable upgrade found|No installed package found') { return , $list.ToArray() }
        throw 'winget çıktısı ayrıştırılamadı. Lütfen App Installer/winget sürümünü güncelleyin.'
    }
    $h = $clean[$hi]
    $iName = $h.IndexOf('Name'); $iId = $h.IndexOf('Id'); $iVer = $h.IndexOf('Version'); $iAvail = $h.IndexOf('Available'); $iSrc = $h.IndexOf('Source')
    if ($iName -lt 0 -or $iId -le $iName -or $iVer -le $iId -or $iAvail -le $iVer -or $iSrc -le $iAvail) { return , $list.ToArray() }
    $slice = {
        param($s, $a, $b)
        if ($a -ge $s.Length) { return '' }
        $end = if ($b -gt $s.Length) { $s.Length } else { $b }
        return $s.Substring($a, $end - $a).Trim()
    }
    for ($i = $hi + 1; $i -lt $clean.Count; $i++) {
        $ln = $clean[$i]
        if ($ln -match '^\s*-{5,}') { continue }
        if ($ln -match '^\s*\d+\s+(upgrade|yükselt)') { break }
        if ([string]::IsNullOrWhiteSpace($ln)) { continue }
        if ($ln.Length -le $iId) { continue }
        $name = & $slice $ln $iName $iId
        $id = & $slice $ln $iId $iVer
        $ver = & $slice $ln $iVer $iAvail
        $avail = & $slice $ln $iAvail $iSrc
        $src = if ($iSrc -lt $ln.Length) { $ln.Substring($iSrc).Trim() } else { '' }
        if ($id) { $list.Add([ordered]@{ Name = $name; Id = $id; Version = $ver; Available = $avail; Source = $src }) | Out-Null }
    }
    return , $list.ToArray()
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
