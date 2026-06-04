<#
    Cboinn Driver Scanner - WPF arayüzü (v2)
    Çekirdek motoru (engine\Worker.ps1) ayrı süreç olarak başlatır, ilerlemeyi
    state\status.json'u DispatcherTimer ile yoklayarak gösterir.
#>

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

# ---- Yollar ----
$script:Root       = $PSScriptRoot
$script:WorkerPath = Join-Path $script:Root 'engine\Worker.ps1'
$script:StateDir   = Join-Path $env:LOCALAPPDATA 'Cboinn Driver Scanner\state'
$script:XamlPath   = Join-Path $script:Root 'ui.xaml'
if (-not (Test-Path $script:StateDir)) { New-Item -ItemType Directory -Path $script:StateDir -Force | Out-Null }

# ---- Tek uygulama örneği ----
$createdNew = $false
$script:AppMutex = [System.Threading.Mutex]::new($true, 'Local\CboinnDriverScanner.UI', [ref]$createdNew)
if (-not $createdNew) {
    [System.Windows.MessageBox]::Show('Cboinn Driver Scanner zaten çalışıyor.', 'Bilgi', 'OK', 'Information') | Out-Null
    return
}

# ---- Durum değişkenleri ----
$script:AllUpdates       = @()
$script:AllInventory     = @()
$script:AllSoftware      = @()
$script:SysInfo          = $null
$script:CurrentMode      = $null
$script:Timer            = $null
$script:WorkerProc       = $null
$script:CurrentOperationId = $null
$script:OperationStartedAt = $null
$script:OperationTimeout   = [TimeSpan]::Zero
$script:DriversScanned   = $false
$script:SoftwareScanned  = $false
$script:StartupPending     = $false
$script:ScanAllPending     = $false
$script:ApplyProgramsAfter = $false

# ---- Yönetici mi? ----
$script:IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
                  ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)

# ---- XAML yükle ----
if (-not (Test-Path $script:XamlPath)) { throw "Arayüz dosyası bulunamadı: $script:XamlPath" }
[xml]$xaml = [System.IO.File]::ReadAllText($script:XamlPath)
$reader = New-Object System.Xml.XmlNodeReader $xaml
$script:Window = [Windows.Markup.XamlReader]::Load($reader)

# ---- Kontrolleri yakala ----
foreach ($name in 'LogoImg','AdminBadge','AdminBadgeText','BtnAdmin','RebootBanner','RebootBannerText',
                  'BtnScanAll','BtnApplyRecommended','BtnBackup','BtnHtml','BtnCancel','TxtFilter',
                  'BtnClearData',
                  'TxtSysName','TxtSysOS','TxtSysCpu','TxtSysRam','TxtSysDisk','TxtSysGpu','TxtSysBoot',
                  'TxtCardDrivers','TxtCardPrograms','TxtCardOld','TxtCardReboot','TxtCardRestore','TxtRecommend',
                  'BtnScan','GridUpdates','BtnInstallSel','BtnInstallAll','BtnSelAllUpd','BtnCatalog','ChkRestore',
                  'BtnRefresh','GridInventory','ChkOldOnly',
                  'BtnSwScan','GridSoftware','BtnSwUpdateSel','BtnSwUpdateAll','BtnSelAllSw',
                  'TxtLog','BtnClearLog','TxtStatus','Bar','Tabs') {
    Set-Variable -Name $name -Scope script -Value $script:Window.FindName($name)
}

# ---- Logo (üst başlık görseli + pencere/görev çubuğu ikonu) ----
$script:LogoPath = Join-Path $script:Root 'logo.png'
if (Test-Path $script:LogoPath) {
    try {
        $bi = New-Object System.Windows.Media.Imaging.BitmapImage
        $bi.BeginInit()
        $bi.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bi.UriSource = [Uri]$script:LogoPath
        $bi.EndInit()
        if ($script:LogoImg) { $script:LogoImg.Source = $bi }
        $icoPath = Join-Path $script:Root 'icon.ico'
        if (Test-Path $icoPath) {
            $ico = New-Object System.Windows.Media.Imaging.BitmapImage
            $ico.BeginInit()
            $ico.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
            $ico.UriSource = [Uri]$icoPath
            $ico.EndInit()
            $script:Window.Icon = $ico
        } else { $script:Window.Icon = $bi }
    } catch {}
}

# ---- Yardımcılar ----
function Add-Log {
    param([string]$Message)
    $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message)
    try { $script:TxtLog.AppendText($line + "`r`n"); $script:TxtLog.ScrollToEnd() } catch {}
}

function Set-Busy {
    param([bool]$Busy)
    foreach ($b in $script:BtnScanAll, $script:BtnApplyRecommended, $script:BtnBackup, $script:BtnHtml,
                   $script:BtnClearData,
                   $script:BtnScan, $script:BtnRefresh, $script:BtnInstallSel, $script:BtnInstallAll,
                   $script:BtnSelAllUpd, $script:BtnCatalog,
                   $script:BtnSwScan, $script:BtnSwUpdateSel, $script:BtnSwUpdateAll, $script:BtnSelAllSw) {
        if ($b) { $b.IsEnabled = -not $Busy }
    }
    if ($script:BtnCancel) {
        $script:BtnCancel.IsEnabled = $Busy -and $script:CurrentMode -notin @('Install', 'SoftwareInstall')
    }
    $script:Window.Cursor = if ($Busy) { [System.Windows.Input.Cursors]::Wait } else { $null }
}

function Test-ProtectedInstallLocation {
    try {
        $rootFull = [IO.Path]::GetFullPath($script:Root).TrimEnd('\') + '\'
        foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            if (-not $base) { continue }
            $baseFull = [IO.Path]::GetFullPath($base).TrimEnd('\') + '\'
            if ($rootFull.StartsWith($baseFull, [StringComparison]::OrdinalIgnoreCase)) { return $true }
        }
    } catch {}
    return $false
}

function Get-OperationTimeout {
    param([string]$WMode)
    switch ($WMode) {
        'Scan'         { return [TimeSpan]::FromMinutes(20) }
        'SoftwareScan' { return [TimeSpan]::FromMinutes(10) }
        'Inventory'    { return [TimeSpan]::FromMinutes(5) }
        'SysInfo'      { return [TimeSpan]::FromMinutes(5) }
        'BackupDrivers'{ return [TimeSpan]::FromMinutes(45) }
        default        { return [TimeSpan]::Zero }
    }
}

function Fail-Worker {
    param([string]$Message)
    if ($script:Timer) { $script:Timer.Stop() }
    $script:ScanAllPending = $false
    $script:ApplyProgramsAfter = $false
    $script:StartupPending = $false
    Add-Log ('HATA: ' + $Message)
    Set-Busy $false
    $script:TxtStatus.Text = 'Hata oluştu.'
    [System.Windows.MessageBox]::Show($Message, 'Hata', 'OK', 'Error') | Out-Null
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    try {
        $children = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId={0}" -f $ProcessId) -ErrorAction SilentlyContinue)
        foreach ($child in $children) { Stop-ProcessTree -ProcessId ([int]$child.ProcessId) }
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    } catch {}
}

function Read-Json {
    param([string]$File)
    $path = Join-Path $script:StateDir $File
    if (-not (Test-Path $path)) { return @() }
    try { return @(Get-Content -Path $path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return @() }
}

function Apply-Filter {
    $q = $script:TxtFilter.Text
    $invSrc = $script:AllInventory
    if ($script:ChkOldOnly.IsChecked -eq $true) { $invSrc = @($script:AllInventory | Where-Object { $_.Old -eq $true }) }
    if ([string]::IsNullOrWhiteSpace($q)) {
        $script:GridUpdates.ItemsSource   = $script:AllUpdates
        $script:GridInventory.ItemsSource = $invSrc
        $script:GridSoftware.ItemsSource  = $script:AllSoftware
        return
    }
    $ql = $q.ToLowerInvariant()
    $script:GridUpdates.ItemsSource = @($script:AllUpdates | Where-Object {
        (@($_.MatchedDevice, $_.Provider, $_.DriverClass) -join ' ').ToLowerInvariant().Contains($ql) })
    $script:GridInventory.ItemsSource = @($invSrc | Where-Object {
        (@($_.DeviceName, $_.DeviceClass, $_.Provider, $_.Version) -join ' ').ToLowerInvariant().Contains($ql) })
    $script:GridSoftware.ItemsSource = @($script:AllSoftware | Where-Object {
        (@($_.Name, $_.Id) -join ' ').ToLowerInvariant().Contains($ql) })
}

function Load-Inventory { $script:AllInventory = Read-Json 'inventory.json'; Apply-Filter }
function Load-Updates   { $script:AllUpdates = Read-Json 'updates.json'; $script:DriversScanned = $true; Apply-Filter }
function Load-Software  { $script:AllSoftware = Read-Json 'software.json'; $script:SoftwareScanned = $true; Apply-Filter }

function Load-SysInfo {
    $si = $null
    try { $si = Get-Content (Join-Path $script:StateDir 'sysinfo.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
    if (-not $si) { return }
    $script:SysInfo = $si
    $script:TxtSysName.Text = 'Bilgisayar: ' + $si.ComputerName
    $script:TxtSysOS.Text   = 'İşletim Sistemi: ' + $si.OS + '  —  ' + $si.OSVersion
    $script:TxtSysCpu.Text  = 'İşlemci: ' + $si.CPU
    $script:TxtSysRam.Text  = 'Bellek (RAM): ' + $si.RAMGB + ' GB'
    $script:TxtSysDisk.Text = ('Sistem diski: {0} / {1} GB boş' -f $si.SysDriveFreeGB, $si.SysDriveSizeGB)
    $gpuTxt = 'Ekran kartı: '
    if ($si.GPUs) { $gpuTxt += ([string]::Join(' ; ', @($si.GPUs | ForEach-Object { '{0} (sürücü {1}, {2} yıl)' -f $_.Name, $_.DriverDate, $_.AgeYears }))) }
    $script:TxtSysGpu.Text = $gpuTxt
    $script:TxtSysBoot.Text = ('Son açılış: {0}   •   Çalışma süresi: {1} saat' -f $si.LastBoot, $si.UptimeHours)
    $script:TxtCardReboot.Text  = 'Yeniden başlatma: ' + $(if ($si.PendingReboot) { 'BEKLİYOR (' + $si.PendingReasons + ')' } else { 'gerekmiyor' })
    $script:TxtCardRestore.Text = 'Sistem geri yükleme: ' + $si.RestoreStatus
    $script:RebootBanner.Visibility = $(if ($si.PendingReboot) { 'Visible' } else { 'Collapsed' })
}

function Update-DashboardCounts {
    $du  = @($script:AllUpdates).Count
    $sw  = @($script:AllSoftware).Count
    $old = @($script:AllInventory | Where-Object { $_.Old -eq $true }).Count
    $script:TxtCardDrivers.Text  = 'Sürücü güncellemesi (Windows Update): ' + $(if ($script:DriversScanned)  { $du } else { '— (taranmadı)' })
    $script:TxtCardPrograms.Text = 'Program güncellemesi (winget): '        + $(if ($script:SoftwareScanned) { $sw } else { '— (taranmadı)' })
    $script:TxtCardOld.Text      = 'İncelenmesi önerilen sürücü (4+ yıl, üretici): ' + $old
    $parts = New-Object System.Collections.Generic.List[string]
    if ($script:DriversScanned -and $du -gt 0)  { $parts.Add("$du sürücü güncellemesi") }
    if ($script:SoftwareScanned -and $sw -gt 0) { $parts.Add("$sw program güncellemesi") }
    if ($parts.Count -gt 0) {
        $script:TxtRecommend.Text = 'Önerilen: ' + [string]::Join(' ve ', $parts) +
            " mevcut. 'Önerilenleri Uygula' ile donanımınıza uygun sürümleri tek seferde kurabilirsiniz."
    } elseif ($script:DriversScanned -or $script:SoftwareScanned) {
        $script:TxtRecommend.Text = 'Sisteminiz güncel görünüyor. Tarihi eski görünen sürücüler her zaman sorunlu değildir; ' +
            "'Tüm Sürücüler' sekmesindeki işaretli kayıtları üretici desteği veya Update Kataloğu üzerinden kontrol edebilirsiniz."
    }
}

# ---- Worker süreci ----
function Start-Worker {
    param([string]$WMode, [string]$IdsCsv, [bool]$Elevated, [bool]$Restore)
    if ($Elevated -and -not (Test-ProtectedInstallLocation)) {
        Set-Busy $false
        [System.Windows.MessageBox]::Show(
            "Yönetici yetkisi gereken işlemler yalnızca korumalı kurulum klasöründen çalıştırılır.`n`nLütfen Setup.exe ile uygulamayı kurup Başlat menüsündeki kısayoldan açın.",
            'Güvenli Kurulum Gerekli', 'OK', 'Warning'
        ) | Out-Null
        return $false
    }
    foreach ($f in 'status.json','install.result.json','software.install.result.json','backup.result.json') {
        Remove-Item (Join-Path $script:StateDir $f) -Force -ErrorAction SilentlyContinue
    }
    # Yolları tırnakla (kurulum klasörü "Cboinn Driver Scanner" gibi boşluk içerebilir).
    $argStr = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Mode {1} -StateDir "{2}" -OperationId "{3}"' -f $script:WorkerPath, $WMode, $script:StateDir, $script:CurrentOperationId
    if ($IdsCsv) {
        if ($WMode -eq 'SoftwareInstall') { $argStr += (' -WingetIds "{0}"' -f $IdsCsv) }
        else { $argStr += (' -UpdateIDsCsv "{0}"' -f $IdsCsv) }
    }
    if ($Restore) { $argStr += ' -CreateRestorePoint' }
    try {
        if ($Elevated) {
            # Yükseltme UAC (ShellExecute) gerektirir; pencere gizli açılır.
            $script:WorkerProc = Start-Process powershell.exe -ArgumentList $argStr -Verb RunAs -WindowStyle Hidden -PassThru
        } else {
            # Penceresiz (tamamen gizli): CreateNoWindow ile konsol hiç oluşturulmaz.
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = 'powershell.exe'
            $psi.Arguments = $argStr
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $true
            $psi.WorkingDirectory = $script:Root
            $script:WorkerProc = [System.Diagnostics.Process]::Start($psi)
        }
    } catch {
        Fail-Worker ("İşlem başlatılamadı:`n$($_.Exception.Message)")
        return $false
    }
    return $true
}

function On-WorkerDone {
    param($Status)
    switch ($script:CurrentMode) {
        'SysInfo' {
            Load-SysInfo
            if ($script:StartupPending) { $script:StartupPending = $false; Invoke-Operation -WMode 'Inventory'; return }
        }
        'Inventory' { Load-Inventory; Update-DashboardCounts }
        'Scan' {
            Load-Inventory; Load-Updates; Update-DashboardCounts
            Add-Log ('Sürücü taraması: {0} güncelleme bulundu.' -f @($script:AllUpdates).Count)
            if ($script:ScanAllPending) { $script:ScanAllPending = $false; Invoke-Operation -WMode 'SoftwareScan'; return }
        }
        'SoftwareScan' {
            Load-Software; Update-DashboardCounts
            Add-Log ('Program taraması: {0} güncelleme bulundu.' -f @($script:AllSoftware).Count)
        }
        'Install' {
            Load-Inventory
            $res = $null
            try { $res = Get-Content (Join-Path $script:StateDir 'install.result.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
            $ok = 0; $tot = 0; $reboot = $false
            if ($res) { $ok = @($res.results | Where-Object { $_.resultCode -eq 2 }).Count; $tot = @($res.results).Count; if ($res.rebootRequired) { $reboot = $true } }
            Add-Log ('Sürücü kurulumu: başarılı {0}/{1}{2}' -f $ok, $tot, $(if ($reboot) { ' (yeniden başlatma gerekli)' } else { '' }))
            if ($script:ApplyProgramsAfter) {
                $script:ApplyProgramsAfter = $false
                Add-Log 'Önerilen programlar kuruluyor...'
                Invoke-Operation -WMode 'SoftwareInstall'
                return
            }
            $summary = "Sürücü kurulumu tamamlandı.`nBaşarılı: $ok / $tot"
            if ($reboot) { $summary += "`n`nDeğişikliklerin tamamlanması için bilgisayarı YENİDEN BAŞLATIN." }
            [System.Windows.MessageBox]::Show($summary, 'Kurulum Sonucu', 'OK', 'Information') | Out-Null
            Invoke-Operation -WMode 'Scan'
            return
        }
        'SoftwareInstall' {
            $res = $null
            try { $res = Get-Content (Join-Path $script:StateDir 'software.install.result.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
            $ok = 0; $tot = 0
            if ($res) { $ok = @($res | Where-Object { $_.exit -eq 0 }).Count; $tot = @($res).Count }
            Add-Log ('Program güncelleme: başarılı {0}/{1}' -f $ok, $tot)
            [System.Windows.MessageBox]::Show("Program güncelleme tamamlandı.`nBaşarılı: $ok / $tot", 'Sonuç', 'OK', 'Information') | Out-Null
            Invoke-Operation -WMode 'SoftwareScan'
            return
        }
        'BackupDrivers' {
            $res = $null
            try { $res = Get-Content (Join-Path $script:StateDir 'backup.result.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
            $folder = ''; $cnt = 0
            if ($res) { $folder = $res.folder; $cnt = $res.count }
            Add-Log ('Sürücü yedeği: {0} paket -> {1}' -f $cnt, $folder)
            $r = [System.Windows.MessageBox]::Show(("Sürücü yedeği alındı: {0} paket.`n`nKlasör: {1}`n`nKlasörü açmak ister misiniz?" -f $cnt, $folder), 'Yedekleme', 'YesNo', 'Information')
            if ($r -eq 'Yes' -and $folder) { try { Start-Process explorer.exe $folder } catch {} }
        }
    }
    Set-Busy $false
}

function Start-Polling {
    if ($script:Timer) { $script:Timer.Stop() }
    $script:Timer = New-Object System.Windows.Threading.DispatcherTimer
    $script:Timer.Interval = [TimeSpan]::FromMilliseconds(500)
    $script:Timer.Add_Tick({
        $sf = Join-Path $script:StateDir 'status.json'
        if (-not (Test-Path $sf)) {
            try {
                if ($script:WorkerProc -and $script:WorkerProc.HasExited) {
                    Fail-Worker ('Worker beklenmedik biçimde kapandı (çıkış kodu {0}). Ayrıntı: {1}' -f $script:WorkerProc.ExitCode, (Join-Path $script:StateDir 'worker.log'))
                }
            } catch {}
            return
        }
        $st = $null
        try { $st = Get-Content -Path $sf -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return }
        if ($null -eq $st) { return }
        if ([string]$st.operationId -ne [string]$script:CurrentOperationId) { return }
        $script:TxtStatus.Text = [string]$st.message
        try { $script:Bar.Value = [double]$st.percent } catch {}
        if ($st.done) {
            $script:Timer.Stop()
            if ($st.error) {
                Fail-Worker ([string]$st.error)
                return
            }
            On-WorkerDone -Status $st
            return
        }
        if ($script:OperationTimeout -ne [TimeSpan]::Zero -and ((Get-Date) - $script:OperationStartedAt) -gt $script:OperationTimeout) {
            try { if ($script:WorkerProc -and -not $script:WorkerProc.HasExited) { Stop-ProcessTree -ProcessId $script:WorkerProc.Id } } catch {}
            Fail-Worker ('İşlem zaman aşımına uğradı. Ayrıntı: {0}' -f (Join-Path $script:StateDir 'worker.log'))
            return
        }
        try {
            if ($script:WorkerProc -and $script:WorkerProc.HasExited) {
                Fail-Worker ('Worker tamamlanma durumu yazmadan kapandı (çıkış kodu {0}). Ayrıntı: {1}' -f $script:WorkerProc.ExitCode, (Join-Path $script:StateDir 'worker.log'))
            }
        } catch {
        }
    })
    $script:Timer.Start()
}

function Invoke-Operation {
    param([string]$WMode, [string]$IdsCsv)
    $script:CurrentMode = $WMode
    $script:CurrentOperationId = [guid]::NewGuid().ToString('N')
    $script:OperationStartedAt = Get-Date
    $script:OperationTimeout = Get-OperationTimeout -WMode $WMode
    Set-Busy $true
    $script:TxtStatus.Text = 'Başlatılıyor...'
    $script:Bar.Value = 0
    $elevated = $false
    if ($WMode -eq 'Install' -or $WMode -eq 'SoftwareInstall' -or $WMode -eq 'BackupDrivers') { $elevated = (-not $script:IsAdmin) }
    $restore = ($script:ChkRestore.IsChecked -eq $true)
    if (Start-Worker -WMode $WMode -IdsCsv $IdsCsv -Elevated $elevated -Restore $restore) { Start-Polling }
}

# ---- Seçim / kurulum ----
function Get-SelectedUpdateIds {
    param([switch]$All)
    $src = if ($All) { $script:AllUpdates } else { $script:GridUpdates.SelectedItems }
    $ids = New-Object System.Collections.Generic.List[string]
    if ($null -ne $src) { foreach ($it in $src) { if ($it -and $it.UpdateID) { $ids.Add([string]$it.UpdateID) } } }
    return , $ids.ToArray()
}

function Get-SelectedSoftwareIds {
    param([switch]$All)
    $src = if ($All) { $script:AllSoftware } else { $script:GridSoftware.SelectedItems }
    $ids = New-Object System.Collections.Generic.List[string]
    if ($null -ne $src) { foreach ($it in $src) { if ($it -and $it.Id) { $ids.Add([string]$it.Id) } } }
    return , $ids.ToArray()
}

function Invoke-Install {
    param([switch]$All)
    $ids = Get-SelectedUpdateIds -All:$All
    if ($ids.Count -eq 0) {
        [System.Windows.MessageBox]::Show('Önce listeden bir veya birden fazla güncelleme seçin (Ctrl/Shift).', 'Seçim Yok', 'OK', 'Information') | Out-Null
        return
    }
    $msg = "$($ids.Count) sürücü güncellemesi indirilip kurulacak.`n`n" +
           "• Kaynak: Windows Update — donanımınıza uygun, doğru sürümler.`n" +
           "• Yönetici izni gerekebilir (UAC).`n• Bazı sürücüler için yeniden başlatma gerekebilir.`n`nDevam edilsin mi?"
    if (([System.Windows.MessageBox]::Show($msg, 'Sürücü Kurulumu', 'YesNo', 'Warning')) -ne 'Yes') { return }
    Invoke-Operation -WMode 'Install' -IdsCsv ($ids -join ',')
}

function Invoke-SoftwareUpdate {
    param([switch]$All)
    $ids = Get-SelectedSoftwareIds -All:$All
    if (-not $All -and $ids.Count -eq 0) {
        [System.Windows.MessageBox]::Show('Önce listeden bir veya birden fazla program seçin (Ctrl/Shift).', 'Seçim Yok', 'OK', 'Information') | Out-Null
        return
    }
    $adet = if ($All) { 'TÜM güncellenebilir' } else { [string]$ids.Count }
    $msg = "$adet program winget ile güncellenecek.`n`n• Kaynak: winget (Microsoft resmî paket yöneticisi).`n• Yönetici izni gerekebilir.`n`nDevam edilsin mi?"
    if (([System.Windows.MessageBox]::Show($msg, 'Program Güncelleme', 'YesNo', 'Warning')) -ne 'Yes') { return }
    $csv = if ($All) { '' } else { ($ids -join ',') }
    Invoke-Operation -WMode 'SoftwareInstall' -IdsCsv $csv
}

function Apply-Recommended {
    if (-not $script:DriversScanned -and -not $script:SoftwareScanned) {
        [System.Windows.MessageBox]::Show("Önce 'Her Şeyi Tara' ile tarama yapın.", 'Tarama Gerekli', 'OK', 'Information') | Out-Null
        return
    }
    $du = @($script:AllUpdates).Count
    $sw = @($script:AllSoftware).Count
    if ($du -eq 0 -and $sw -eq 0) {
        [System.Windows.MessageBox]::Show('Uygulanacak güncelleme yok — sistem güncel görünüyor.', 'Bilgi', 'OK', 'Information') | Out-Null
        return
    }
    $msg = "Önerilen güncellemeler uygulanacak:`n`n" +
           "• $du sürücü (Windows Update — donanıma uygun sürümler)`n" +
           "• $sw program (winget — resmî sürümler)`n`n" +
           "Sürücüler için önce sistem geri yükleme noktası oluşturulur. Yönetici izni gerekebilir.`n`nDevam edilsin mi?"
    if (([System.Windows.MessageBox]::Show($msg, 'Önerilenleri Uygula', 'YesNo', 'Warning')) -ne 'Yes') { return }
    Add-Log 'Önerilenleri uygula başlatıldı.'
    if ($du -gt 0) {
        $ids = Get-SelectedUpdateIds -All
        $script:ApplyProgramsAfter = ($sw -gt 0)
        Invoke-Operation -WMode 'Install' -IdsCsv ($ids -join ',')
    } elseif ($sw -gt 0) {
        Invoke-Operation -WMode 'SoftwareInstall'
    }
}

function Backup-Drivers {
    $msg = "Yüklü üçüncü-parti sürücüler bir klasöre yedeklenecek (pnputil).`nYönetici izni gerekebilir.`n`nDevam edilsin mi?"
    if (([System.Windows.MessageBox]::Show($msg, 'Sürücüleri Yedekle', 'YesNo', 'Information')) -ne 'Yes') { return }
    Invoke-Operation -WMode 'BackupDrivers'
}

function Open-Catalog {
    $sel = $script:GridUpdates.SelectedItems
    if ($null -eq $sel -or $sel.Count -eq 0) { $sel = $script:GridInventory.SelectedItems }
    if ($null -eq $sel -or $sel.Count -eq 0) {
        [System.Windows.MessageBox]::Show('Katalogda aramak için bir satır seçin (Sürücü Güncellemeleri veya Tüm Sürücüler).', 'Seçim Yok', 'OK', 'Information') | Out-Null
        return
    }
    $row = $sel[0]
    $q = if ($row.HardwareID) { $row.HardwareID } elseif ($row.DriverModel) { $row.DriverModel } elseif ($row.MatchedDevice) { $row.MatchedDevice } else { $row.DeviceName }
    $url = 'https://www.catalog.update.microsoft.com/Search.aspx?q=' + [uri]::EscapeDataString([string]$q)
    Start-Process $url
}

function Cancel-Operation {
    if ($script:CurrentMode -in @('Install', 'SoftwareInstall')) {
        [System.Windows.MessageBox]::Show('Kurulum işlemi güvenliğiniz için zorla durdurulamaz. Tamamlanmasını bekleyin.', 'İptal Edilemez', 'OK', 'Warning') | Out-Null
        return
    }
    if ($script:Timer) { $script:Timer.Stop() }
    try { if ($script:WorkerProc -and -not $script:WorkerProc.HasExited) { Stop-ProcessTree -ProcessId $script:WorkerProc.Id } } catch {}
    $script:ScanAllPending = $false
    $script:ApplyProgramsAfter = $false
    $script:StartupPending = $false
    Set-Busy $false
    $script:TxtStatus.Text = 'İptal edildi.'
    Add-Log 'İşlem iptal edildi.'
}

function Restart-AsAdmin {
    if (-not (Test-ProtectedInstallLocation)) {
        [System.Windows.MessageBox]::Show('Yönetici olarak yeniden başlatma yalnızca Setup.exe ile kurulan korumalı sürümde kullanılabilir.', 'Güvenli Kurulum Gerekli', 'OK', 'Warning') | Out-Null
        return
    }
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -File "{0}"' -f (Join-Path $script:Root 'DriverScanner.ps1'))
        $script:Window.Close()
    } catch {
        [System.Windows.MessageBox]::Show("Yükseltilemedi:`n$($_.Exception.Message)", 'Hata', 'OK', 'Error') | Out-Null
    }
}

# ---- HTML rapor ----
function HtmlEnc { param($s) if ($null -eq $s) { return '' } return ([string]$s).Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;') }

function Build-HtmlTable {
    param($rows, [string[]]$props, [string[]]$headers)
    $rows = @($rows)
    if ($rows.Count -eq 0) { return "<p class='muted'>(kayıt yok)</p>" }
    $t = New-Object System.Text.StringBuilder
    [void]$t.Append('<table><tr>')
    foreach ($h in $headers) { [void]$t.Append('<th>' + (HtmlEnc $h) + '</th>') }
    [void]$t.Append('</tr>')
    foreach ($r in $rows) {
        [void]$t.Append('<tr>')
        foreach ($p in $props) { [void]$t.Append('<td>' + (HtmlEnc $r.$p) + '</td>') }
        [void]$t.Append('</tr>')
    }
    [void]$t.Append('</table>')
    return $t.ToString()
}

function Export-Html {
    $privacyChoice = [System.Windows.MessageBox]::Show(
        "Rapor donanım ve yazılım bilgilerinizi içerir.`n`nBilgisayar adı rapora eklensin mi?`nEvet: ekle  •  Hayır: gizle  •  İptal: rapor oluşturma",
        'Rapor Gizliliği', 'YesNoCancel', 'Question'
    )
    if ($privacyChoice -eq 'Cancel') { return }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("<!DOCTYPE html><html lang='tr'><head><meta charset='utf-8'><title>Cboinn Driver Scanner Raporu</title>")
    [void]$sb.Append("<style>body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#111827}h1{font-size:22px}h2{font-size:16px;margin-top:24px;border-bottom:2px solid #2563eb;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #e5e7eb;padding:6px 8px;font-size:13px;text-align:left}th{background:#f3f4f6}.muted{color:#6b7280}</style></head><body>")
    [void]$sb.Append('<h1>Cboinn Driver Scanner Raporu</h1>')
    [void]$sb.Append("<p class='muted'>Oluşturulma: " + (HtmlEnc (Get-Date -Format 'yyyy-MM-dd HH:mm')) + '</p>')
    if ($script:SysInfo) {
        $si = $script:SysInfo
        [void]$sb.Append('<h2>Sistem</h2><table>')
        $computerName = if ($privacyChoice -eq 'Yes') { $si.ComputerName } else { '(gizlendi)' }
        [void]$sb.Append('<tr><th>Bilgisayar</th><td>' + (HtmlEnc $computerName) + '</td></tr>')
        [void]$sb.Append('<tr><th>İşletim Sistemi</th><td>' + (HtmlEnc ($si.OS + ' ' + $si.OSVersion)) + '</td></tr>')
        [void]$sb.Append('<tr><th>İşlemci</th><td>' + (HtmlEnc $si.CPU) + '</td></tr>')
        [void]$sb.Append('<tr><th>RAM</th><td>' + (HtmlEnc ([string]$si.RAMGB + ' GB')) + '</td></tr>')
        [void]$sb.Append('<tr><th>Yeniden başlatma</th><td>' + (HtmlEnc $(if ($si.PendingReboot) { 'BEKLİYOR' } else { 'gerekmiyor' })) + '</td></tr>')
        [void]$sb.Append('</table>')
    }
    [void]$sb.Append('<h2>Sürücü Güncellemeleri (' + @($script:AllUpdates).Count + ')</h2>')
    [void]$sb.Append((Build-HtmlTable $script:AllUpdates @('MatchedDevice','Provider','DriverClass','CurrentVersion','CurrentDate','NewDate','SizeMB') @('Aygıt','Sağlayıcı','Sınıf','Mevcut','Mevcut Tarih','Önerilen Tarih','MB')))
    $old = @($script:AllInventory | Where-Object { $_.Old -eq $true })
    [void]$sb.Append('<h2>Eski Sürücüler — 4+ yıl (' + $old.Count + ')</h2>')
    [void]$sb.Append((Build-HtmlTable $old @('DeviceName','Provider','Version','Date','AgeYears') @('Aygıt','Sağlayıcı','Sürüm','Tarih','Yaş (yıl)')))
    [void]$sb.Append('<h2>Program Güncellemeleri (' + @($script:AllSoftware).Count + ')</h2>')
    [void]$sb.Append((Build-HtmlTable $script:AllSoftware @('Name','Id','Version','Available','Source') @('Program','Kimlik','Mevcut','Önerilen','Kaynak')))
    [void]$sb.Append('</body></html>')
    $reportDir = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)) 'Cboinn Driver Scanner Reports'
    if (-not (Test-Path $reportDir)) { New-Item -ItemType Directory -Path $reportDir -Force | Out-Null }
    $path = Join-Path $reportDir ('CboinnRapor_{0}.html' -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
    Set-Content -Path $path -Value $sb.ToString() -Encoding UTF8
    Add-Log ('HTML rapor oluşturuldu: ' + $path)
    try { Start-Process $path } catch {}
}

function Clear-AppData {
    if (([System.Windows.MessageBox]::Show('Tarama sonuçları ve günlükler temizlensin mi? Sürücü yedekleri ve HTML raporları korunur.', 'Verileri Temizle', 'YesNo', 'Warning')) -ne 'Yes') { return }
    foreach ($pattern in '*.json','worker*.log') {
        Get-ChildItem -LiteralPath $script:StateDir -Filter $pattern -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
    $script:AllUpdates = @()
    $script:AllInventory = @()
    $script:AllSoftware = @()
    $script:SysInfo = $null
    $script:DriversScanned = $false
    $script:SoftwareScanned = $false
    $script:TxtLog.Clear()
    Apply-Filter
    Update-DashboardCounts
    Add-Log 'Yerel tarama verileri temizlendi.'
}

function Clear-Logs {
    $script:TxtLog.Clear()
    Get-ChildItem -LiteralPath $script:StateDir -Filter 'worker*.log' -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

# ---- Yönetici rozeti ----
if ($script:IsAdmin) {
    $script:AdminBadgeText.Text = 'Yönetici: Evet'
    $script:AdminBadge.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(5, 150, 105))
} else {
    $script:AdminBadgeText.Text = 'Yönetici: Hayır'
    $script:BtnAdmin.Visibility = $(if (Test-ProtectedInstallLocation) { 'Visible' } else { 'Collapsed' })
}

# ---- Olaylar ----
$script:BtnScanAll.Add_Click({          $script:ScanAllPending = $true; Add-Log 'Her şey taranıyor...'; Invoke-Operation -WMode 'Scan' })
$script:BtnApplyRecommended.Add_Click({ Apply-Recommended })
$script:BtnBackup.Add_Click({           Backup-Drivers })
$script:BtnHtml.Add_Click({             Export-Html })
$script:BtnClearData.Add_Click({        Clear-AppData })
$script:BtnCancel.Add_Click({           Cancel-Operation })
$script:BtnScan.Add_Click({             Invoke-Operation -WMode 'Scan' })
$script:BtnRefresh.Add_Click({          Invoke-Operation -WMode 'Inventory' })
$script:BtnInstallSel.Add_Click({       Invoke-Install })
$script:BtnInstallAll.Add_Click({       Invoke-Install -All })
$script:BtnSelAllUpd.Add_Click({        $script:GridUpdates.SelectAll() })
$script:BtnCatalog.Add_Click({          Open-Catalog })
$script:BtnSwScan.Add_Click({           Invoke-Operation -WMode 'SoftwareScan' })
$script:BtnSwUpdateSel.Add_Click({      Invoke-SoftwareUpdate })
$script:BtnSwUpdateAll.Add_Click({      Invoke-SoftwareUpdate -All })
$script:BtnSelAllSw.Add_Click({         $script:GridSoftware.SelectAll() })
$script:BtnAdmin.Add_Click({            Restart-AsAdmin })
$script:BtnClearLog.Add_Click({         Clear-Logs })
$script:TxtFilter.Add_TextChanged({     Apply-Filter })
$script:ChkOldOnly.Add_Click({          Apply-Filter })
$script:Window.Add_Closing({
    param($sender, $e)
    if (-not $script:WorkerProc) { return }
    try { if ($script:WorkerProc.HasExited) { return } } catch { return }
    if ($env:DRIVERSCANNER_SELFTEST -eq '1') {
        if ($script:Timer) { $script:Timer.Stop() }
        try { Stop-ProcessTree -ProcessId $script:WorkerProc.Id } catch {}
        return
    }
    if ($script:CurrentMode -in @('Install', 'SoftwareInstall')) {
        [System.Windows.MessageBox]::Show('Kurulum devam ederken uygulama kapatılamaz. İşlemin tamamlanmasını bekleyin.', 'İşlem Devam Ediyor', 'OK', 'Warning') | Out-Null
        $e.Cancel = $true
        return
    }
    if (([System.Windows.MessageBox]::Show('Çalışan tarama iptal edilip uygulama kapatılsın mı?', 'İşlem Devam Ediyor', 'YesNo', 'Warning')) -ne 'Yes') {
        $e.Cancel = $true
        return
    }
    Cancel-Operation
})
$script:Window.Add_Closed({ if ($script:Timer) { $script:Timer.Stop() } })

# ---- Açılışta: sistem bilgisi + envanter ----
$script:Window.Add_ContentRendered({ $script:StartupPending = $true; Invoke-Operation -WMode 'SysInfo' })

# ---- Kendi kendine test (DRIVERSCANNER_SELFTEST=1): 4 sn sonra kapat ----
if ($env:DRIVERSCANNER_SELFTEST -eq '1') {
    $script:SelfTestTimer = New-Object System.Windows.Threading.DispatcherTimer
    $script:SelfTestTimer.Interval = [TimeSpan]::FromSeconds(4)
    $script:SelfTestTimer.Add_Tick({ $script:SelfTestTimer.Stop(); $script:Window.Close() })
    $script:SelfTestTimer.Start()
}

$null = $script:Window.ShowDialog()
try { $script:AppMutex.ReleaseMutex(); $script:AppMutex.Dispose() } catch {}
