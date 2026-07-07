// Cboinn Driver Scanner — Electron main process.
//
// The proven scanning/install engine lives untouched in engine/Worker.ps1.
// This process owns the window, spawns the PowerShell engine per operation,
// watches its atomic status.json for progress, streams that to the renderer
// over IPC, and reads the engine's JSON result files when an operation ends.
// Install / SoftwareInstall / BackupDrivers require admin, so those launch
// elevated via Start-Process -Verb RunAs (a UAC prompt); we then track them
// purely through the shared status.json file.

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');

let mainWindow = null;
let currentChild = null;
let currentPoll = null;
let tray = null;
let isQuitting = false;
let scanTimer = null;
let backgroundRunning = false;
let opChain = Promise.resolve();

const ELEVATED_MODES = new Set(['Install', 'SoftwareInstall', 'BackupDrivers', 'CleanApply', 'SoftwareUninstall', 'SoftwareInstallNew', 'DriverStoreDelete', 'MakeBootable', 'SystemRepair', 'RestoreCreate', 'NetworkAction']);

// Always use PowerShell's absolute path. A packaged Electron app can have a
// minimal PATH, so bare 'powershell.exe' may fail to spawn (ENOENT) — which
// previously surfaced as a generic "engine closed unexpectedly".
const PWSH = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

// Bu süreç yükseltilmiş (yönetici) mi? Başlangıçta bir kez, senkron belirlenir.
// fltmc yalnızca yöneticide 0 döner; aksi halde Access Denied ile hata verir.
function detectElevated() {
  if (process.platform !== 'win32') return false;
  try { execFileSync('fltmc', [], { windowsHide: true, stdio: 'ignore' }); return true; }
  catch { return false; }
}
const ELEVATED = detectElevated();

const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const SCHTASKS = path.join(SYS32, 'schtasks.exe');
const SCHED_TASK = 'Cboinn Driver Scanner Tarama';

// Per-mode hard timeouts (ms) mirroring the original UI's expectations.
const MAX_MS = {
  Inventory: 5 * 60_000,
  SysInfo: 5 * 60_000,
  Scan: 20 * 60_000,
  SoftwareScan: 12 * 60_000,
  Install: 30 * 60_000,
  SoftwareInstall: 30 * 60_000,
  BackupDrivers: 45 * 60_000,
  ProblemDevices: 5 * 60_000,
  CleanScan: 8 * 60_000,
  CleanApply: 20 * 60_000,
  SoftwareInventory: 8 * 60_000,
  SoftwareSearch: 5 * 60_000,
  SoftwareUninstall: 30 * 60_000,
  SoftwareInstallNew: 30 * 60_000,
  DriverStore: 5 * 60_000,
  DriverStoreDelete: 15 * 60_000,
  BloatScan: 5 * 60_000,
  BloatRemove: 15 * 60_000,
  RecycleList: 5 * 60_000,
  RecycleRestore: 10 * 60_000,
  UsbList: 5 * 60_000,
  MakeBootable: 60 * 60_000,
  SystemHealth: 5 * 60_000,
  SystemRepair: 60 * 60_000,
  RestoreList: 5 * 60_000,
  RestoreCreate: 10 * 60_000,
  NetworkInfo: 5 * 60_000,
  NetworkAction: 10 * 60_000,
  StartupList: 5 * 60_000,
  StartupSetState: 60_000,
  PrivacyScan: 5 * 60_000,
  PrivacyApply: 5 * 60_000,
  PrivacyRevert: 5 * 60_000,
};
// If an elevated op never produces a status (UAC cancelled / failed to launch).
const FIRST_STATUS_GRACE = 35_000;

function enginePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'engine', 'Worker.ps1')
    : path.join(__dirname, '..', 'engine', 'Worker.ps1');
}

// CLI modunda farklı bir klasör kullanılır ki GUI açıkken status.json çakışmasın.
let stateDirOverride = null;
function stateDir() {
  const dir = stateDirOverride || path.join(app.getPath('userData'), 'state');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function readJsonSafe(file) {
  try {
    let raw = fs.readFileSync(file, 'utf8');
    if (!raw) return null;
    // PowerShell 5.1 writes UTF-8 *with BOM*; JSON.parse chokes on the leading
    // U+FEFF, so strip it. This was the root cause of "engine closed
    // unexpectedly" — status.json had done:true but failed to parse.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildArgs(mode, opts, operationId) {
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', enginePath(),
    '-Mode', mode,
    '-StateDir', stateDir(),
    '-OperationId', operationId,
  ];
  if (opts.updateIds && opts.updateIds.length) args.push('-UpdateIDsCsv', opts.updateIds.join(','));
  if (opts.wingetIds && opts.wingetIds.length) args.push('-WingetIds', opts.wingetIds.join(','));
  if (opts.backupDir) args.push('-BackupDir', opts.backupDir);
  if (opts.cleanCategories && opts.cleanCategories.length) args.push('-CleanCategoriesCsv', opts.cleanCategories.join(','));
  if (opts.query) args.push('-Query', opts.query);
  if (opts.driverInfs && opts.driverInfs.length) args.push('-DriverInfs', opts.driverInfs.join(','));
  if (opts.appxNames && opts.appxNames.length) args.push('-AppxNames', opts.appxNames.join(','));
  if (opts.restoreKeys && opts.restoreKeys.length) args.push('-RestoreKeys', opts.restoreKeys.join('|'));
  if (opts.isoPath) args.push('-IsoPath', opts.isoPath);
  if (opts.usbDiskNumber !== undefined && opts.usbDiskNumber !== null) args.push('-UsbDiskNumber', String(opts.usbDiskNumber));
  if (opts.repairTool) args.push('-RepairTool', opts.repairTool);
  if (opts.description) args.push('-Description', opts.description);
  if (opts.netAction) args.push('-NetAction', opts.netAction);
  if (opts.tweaks && opts.tweaks.length) args.push('-Tweaks', opts.tweaks.join(','));
  if (opts.startupName) args.push('-StartupName', opts.startupName);
  if (opts.startupEnabled !== undefined) args.push('-StartupEnabled', opts.startupEnabled ? '1' : '0');
  if (opts.createRestorePoint) args.push('-CreateRestorePoint');
  return args;
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function startWorker(mode, opts, operationId) {
  const args = buildArgs(mode, opts, operationId);
  // Zaten yükseltilmişsek ikinci bir UAC açma — motoru DOĞRUDAN çalıştır
  // (izlenebilir alt süreç). Yalnızca yükseltilmemişken RunAs ile UAC tetikle.
  if (ELEVATED_MODES.has(mode) && !ELEVATED) {
    // Elevate. The inner powershell runs the engine; Start-Process -Verb RunAs
    // triggers UAC. Detached from us — tracked through status.json only.
    const argList = args.map(psQuote).join(',');
    const psCmd =
      `Start-Process -FilePath '${PWSH}' -Verb RunAs -WindowStyle Hidden -ArgumentList ${argList}`;
    return spawn(PWSH, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
      windowsHide: true,
    });
  }
  return spawn(PWSH, args, { windowsHide: true });
}

function resultFilesFor(mode) {
  switch (mode) {
    case 'Inventory': return { inventory: 'inventory.json' };
    case 'Scan': return { inventory: 'inventory.json', updates: 'updates.json' };
    case 'SysInfo': return { sysinfo: 'sysinfo.json' };
    case 'SoftwareScan': return { software: 'software.json' };
    case 'Install': return { installResult: 'install.result.json' };
    case 'SoftwareInstall': return { softwareInstallResult: 'software.install.result.json' };
    case 'BackupDrivers': return { backupResult: 'backup.result.json' };
    case 'ProblemDevices': return { problems: 'problems.json' };
    case 'CleanScan': return { clean: 'cleanscan.json' };
    case 'CleanApply': return { cleanResult: 'cleanresult.json' };
    case 'SoftwareInventory': return { installed: 'installed.json' };
    case 'SoftwareSearch': return { search: 'search.json' };
    case 'SoftwareUninstall': return { uninstallResult: 'software.uninstall.result.json' };
    case 'SoftwareInstallNew': return { installNewResult: 'software.installnew.result.json' };
    case 'DriverStore': return { driverStore: 'driverstore.json' };
    case 'DriverStoreDelete': return { driverStoreDeleteResult: 'driverstore.delete.result.json' };
    case 'BloatScan': return { bloat: 'bloat.json' };
    case 'BloatRemove': return { bloatResult: 'bloat.remove.result.json' };
    case 'RecycleList': return { recycle: 'recycle.json' };
    case 'RecycleRestore': return { recycleRestoreResult: 'recycle.restore.result.json' };
    case 'UsbList': return { usb: 'usb.json' };
    case 'MakeBootable': return { bootableResult: 'bootable.result.json' };
    case 'SystemHealth': return { health: 'health.json' };
    case 'SystemRepair': return { repairResult: 'repair.result.json' };
    case 'RestoreList': return { restore: 'restore.json' };
    case 'RestoreCreate': return { restoreCreateResult: 'restore.create.result.json' };
    case 'NetworkInfo': return { network: 'network.json' };
    case 'NetworkAction': return { networkActionResult: 'network.action.result.json' };
    case 'StartupList': return { startup: 'startup.json' };
    case 'StartupSetState': return { startupSetStateResult: 'startup.setstate.result.json' };
    case 'PrivacyScan': return { privacy: 'privacy.json' };
    case 'PrivacyApply': return { privacyResult: 'privacy.apply.result.json' };
    case 'PrivacyRevert': return { privacyResult: 'privacy.apply.result.json' };
    default: return {};
  }
}

function readResults(mode) {
  const dir = stateDir();
  const out = {};
  const files = resultFilesFor(mode);
  for (const [key, file] of Object.entries(files)) {
    out[key] = readJsonSafe(path.join(dir, file));
  }
  return out;
}

function sendProgress(operationId, st) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('engine:progress', {
      operationId,
      phase: st.phase || '',
      message: st.message || '',
      percent: typeof st.percent === 'number' ? st.percent : 0,
    });
  }
}

function runOperation(mode, opts) {
  return new Promise((resolve) => {
    const operationId = crypto.randomUUID();
    const sFile = path.join(stateDir(), 'status.json');
    // UAC yalnızca yükseltilmemişken + elevated modda kullanılır; aksi halde
    // (zaten yükseltilmiş) elevated mod DOĞRUDAN izlenebilir alt süreç olur.
    const usesUac = ELEVATED_MODES.has(mode) && !ELEVATED;
    // Drop any stale status so we never read a previous run's "done".
    try { fs.unlinkSync(sFile); } catch { /* ignore */ }

    let child;
    try {
      child = startWorker(mode, opts, operationId);
    } catch (e) {
      resolve({ ok: false, error: 'Motor başlatılamadı: ' + String(e), results: null });
      return;
    }
    currentChild = child;

    let exited = false;
    let exitCode = null;
    let spawnError = null;
    let stderrBuf = '';
    child.on('exit', (code) => { exited = true; exitCode = code; });
    child.on('error', (err) => {
      exited = true;
      spawnError = err && err.message ? err.message : String(err);
    });
    if (child.stderr) child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

    const started = Date.now();
    const finish = (payload) => {
      if (currentPoll) { clearInterval(currentPoll); currentPoll = null; }
      currentChild = null;
      resolve(payload);
    };

    currentPoll = setInterval(() => {
      const st = readJsonSafe(sFile);

      // TAZELIK: unlink (209) başarısız olursa (dosya kilitli / AV) ÖNCEKİ
      // çalışmanın bayat status.json'u (done:true) anında okunup sahte/eski
      // sonuç dönebilirdi. Bu çalışmaya ait mi? operationId eşleşmeli; bazı
      // elevated yollar operationId yazmazsa dosya mtime'ı >= started olmalı.
      let fresh = false;
      if (st) {
        if (st.operationId && st.operationId === operationId) fresh = true;
        else if (!st.operationId) {
          try { fresh = fs.statSync(sFile).mtimeMs >= started; } catch { fresh = false; }
        }
      }

      if (st && fresh) {
        sendProgress(operationId, st);
        if (st.done) {
          finish({
            ok: !st.error,
            error: st.error || null,
            status: st,
            results: readResults(mode),
          });
          return;
        }
      }

      // Crash detection: directly-tracked child gone but no FRESH "done".
      // (UAC kullanmayan tüm modlar — yükseltilmemiş modlar + yükseltilmiş
      //  app'te doğrudan çalışan elevated modlar.)
      if (exited && !usesUac) {
        if (!(st && fresh && st.done)) {
          const detail = spawnError
            ? ` (${spawnError})`
            : stderrBuf.trim()
              ? ` (${stderrBuf.trim().split('\n').slice(-3).join(' ').slice(0, 300)})`
              : ` (çıkış kodu ${exitCode})`;
          finish({
            ok: false,
            error: 'Motor beklenmedik biçimde kapandı' + detail + '.',
            status: (st && fresh) ? st : null,
            results: null,
          });
        }
        return;
      }

      // UAC op never produced a FRESH status → UAC cancelled / launch failed.
      if (!(st && fresh) && usesUac && (Date.now() - started) > FIRST_STATUS_GRACE) {
        finish({
          ok: false,
          error: 'Yönetici izni verilmedi veya işlem başlatılamadı.',
          status: null,
          results: null,
        });
        return;
      }

      // Hard timeout.
      if ((Date.now() - started) > (MAX_MS[mode] || 10 * 60_000)) {
        try { if (currentChild) currentChild.kill(); } catch { /* ignore */ }
        finish({ ok: false, error: 'İşlem zaman aşımına uğradı.', status: (st && fresh) ? st : null, results: null });
        return;
      }
    }, 400);
  });
}

// ── Settings (persisted in userData/settings.json) ────────────────────────
const DEFAULT_SETTINGS = {
  autoScan: false,
  intervalHours: 24,
  notify: true,
  startAtLogin: false,
  closeToTray: true,
  theme: 'dark',
  lang: 'tr',
};
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function readSettings() {
  const s = readJsonSafe(settingsPath());
  return { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
}
function writeSettings(s) {
  // Yalnızca bilinen anahtarları al (içe-aktarmada çöp anahtar saklanmasın).
  const src = s && typeof s === 'object' ? s : {};
  const merged = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) merged[k] = (k in src) ? src[k] : DEFAULT_SETTINGS[k];
  merged.intervalHours = Math.max(1, Math.min(168, Number(merged.intervalHours) || 24));
  if (merged.theme !== 'light') merged.theme = 'dark';
  if (!['tr', 'en', 'de', 'ru', 'ar'].includes(merged.lang)) merged.lang = 'tr';
  merged.autoScan = !!merged.autoScan;
  merged.notify = !!merged.notify;
  merged.startAtLogin = !!merged.startAtLogin;
  merged.closeToTray = !!merged.closeToTray;
  // Atomik yazım: yarıda kesilirse (örn. güncelleme sonrası ~1.2sn'de quit)
  // settings.json truncate olup TÜM ayarlar varsayılana dönmesin.
  try {
    const p = settingsPath();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
    fs.renameSync(tmp, p);
  } catch { /* ignore */ }
  return merged;
}
function applySettings(s) {
  try { app.setLoginItemSettings({ openAtLogin: !!s.startAtLogin }); } catch { /* ignore */ }
  restartScanTimer(s);
}

// First existing icon among candidates (dev vs packaged paths).
function iconFile() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico'),
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return candidates[0];
}

// Serialize all engine operations (user + background) so they never clash
// over the shared status.json / currentChild.
function runOperationQueued(mode, opts) {
  const next = opChain.then(() => runOperation(mode, opts));
  opChain = next.catch(() => {});
  return next;
}

function restartScanTimer(s) {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (s.autoScan) {
    const ms = Math.max(1, Math.min(168, Number(s.intervalHours) || 24)) * 3600_000;
    scanTimer = setInterval(() => { runBackgroundScan(false); }, ms);
  }
}

async function runBackgroundScan() {
  if (backgroundRunning) return;
  backgroundRunning = true;
  try {
    const drv = await runOperationQueued('Scan', {});
    const sw = await runOperationQueued('SoftwareScan', {});
    const updates = Array.isArray(drv && drv.results && drv.results.updates) ? drv.results.updates.length : 0;
    const software = Array.isArray(sw && sw.results && sw.results.software) ? sw.results.software.length : 0;
    const s = readSettings();
    if (s.notify && updates + software > 0) {
      notify('Güncelleme bulundu', `${updates} sürücü, ${software} program güncellemesi mevcut.`);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engine:background', { updates, software });
    }
  } catch { /* ignore */ } finally {
    backgroundRunning = false;
  }
}

function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: iconFile() });
    n.on('click', () => showWindow());
    n.show();
  } catch { /* ignore */ }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(iconFile());
    tray = new Tray(img && !img.isEmpty() ? img : iconFile());
  } catch { tray = null; return; }
  tray.setToolTip('Cboinn Driver Scanner');
  const menu = Menu.buildFromTemplate([
    { label: 'Göster', click: () => showWindow() },
    { label: 'Şimdi Tara', click: () => runBackgroundScan() },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0a0e1a',
    title: 'Cboinn Driver Scanner',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // ── Güvenlik: uygulamadan dışarı gezinmeyi engelle + popup'ları reddet ──
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.VITE_DEV_SERVER_URL;
    const ok = dev ? url.startsWith(dev) : url.startsWith('file:');
    if (!ok) e.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault());

  // Close → minimize to tray (unless quitting or disabled in settings).
  mainWindow.on('close', (e) => {
    if (!isQuitting && readSettings().closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle('engine:run', (_e, mode, opts) => {
  // Modu bilinen mod listesine göre doğrula; bilinmeyen bir mod sessizce
  // yükseltilmemiş + varsayılan zaman aşımıyla çalışmasın.
  if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(MAX_MS, mode)) {
    return Promise.resolve({ ok: false, error: 'Geçersiz işlem modu: ' + String(mode), results: null });
  }
  return runOperationQueued(mode, (opts && typeof opts === 'object') ? opts : {});
});
ipcMain.handle('engine:read', (_e, file) => {
  // Yalnızca state dizinindeki düz dosya adlarına izin ver (path traversal engeli).
  if (typeof file !== 'string' || file.includes('..') || file !== path.basename(file)) return null;
  return readJsonSafe(path.join(stateDir(), file));
});
ipcMain.handle('engine:cancel', () => {
  try { if (currentChild) currentChild.kill(); } catch { /* ignore */ }
  if (currentPoll) { clearInterval(currentPoll); currentPoll = null; }
  currentChild = null;
  return true;
});
ipcMain.handle('engine:stateDir', () => stateDir());
ipcMain.handle('sys:openExternal', (_e, url) => {
  // Yalnızca http/https şemalarına izin ver (file:/javascript: vb. engellenir).
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) { shell.openExternal(url); return true; }
  return false;
});
ipcMain.handle('sys:openPath', (_e, p) => {
  if (typeof p !== 'string' || !p) return false;
  // Keyfi yürütülebilir dosya açmayı engelle; klasörler/raporlar + birkaç bilinen araç serbest.
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const allowedExes = [
    path.join(sys32, 'rstrui.exe').toLowerCase(),
    path.join(sys32, 'taskmgr.exe').toLowerCase(),
  ];
  const ext = path.extname(p).toLowerCase();
  const dangerous = ['.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.ps1', '.vbs', '.js', '.jse', '.wsf', '.lnk', '.hta'];
  if (dangerous.includes(ext) && !allowedExes.includes(p.toLowerCase())) return false;
  shell.openPath(p);
  return true;
});
ipcMain.handle('sys:pickFile', async (_e, filters) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'ISO görüntüsü', extensions: ['iso'] }],
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, s) => { const merged = writeSettings(s); applySettings(merged); return merged; });
ipcMain.handle('settings:export', async () => {
  try {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'cboinn-ayarlar.json',
      filters: [{ name: 'Cboinn ayarları', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    const payload = {
      app: 'Cboinn Driver Scanner', kind: 'settings', version: app.getVersion(),
      exportedAt: new Date().toISOString(), settings: readSettings(),
    };
    fs.writeFileSync(r.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
ipcMain.handle('settings:import', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Cboinn ayarları', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths.length) return { ok: false };
    let raw = fs.readFileSync(r.filePaths[0], 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    const incoming = parsed && parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : parsed;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return { ok: false, error: 'Geçersiz ayar dosyası.' };
    }
    // writeSettings yalnızca bilinen anahtarları alıp clamp/coerce eder → güvenli.
    const merged = writeSettings(incoming);
    applySettings(merged);
    return { ok: true, settings: merged };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// Ağ isteklerini zaman aşımına bağla (captive portal / yarı-açık TCP'de UI'ın
// dakikalarca takılı kalmasını önler). aiDiagnose'daki kanıtlı kalıbın paylaşımı.
async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...(opts || {}), signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}
function netErrMsg(e) {
  return e && e.name === 'AbortError' ? 'İstek zaman aşımına uğradı.' : String((e && e.message) || e);
}
ipcMain.handle('app:checkUpdate', async () => {
  try {
    const res = await fetchWithTimeout('https://api.github.com/repos/iisletme593-droid/cboinn-driver-scanner/releases/latest', {
      headers: { 'User-Agent': 'Cboinn-Driver-Scanner', Accept: 'application/vnd.github+json' },
    }, 20000);
    if (!res.ok) return { error: 'GitHub: HTTP ' + res.status };
    const j = await res.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    const current = app.getVersion();
    const pa = latest.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = current.split('.').map((n) => parseInt(n, 10) || 0);
    let updateAvailable = false;
    for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d !== 0) { updateAvailable = d > 0; break; } }
    return { current, latest, updateAvailable, url: j.html_url || 'https://github.com/iisletme593-droid/cboinn-driver-scanner/releases/latest' };
  } catch (e) { return { error: netErrMsg(e) }; }
});
ipcMain.handle('app:isElevated', () => ELEVATED);
ipcMain.handle('app:relaunchAsAdmin', async () => {
  if (ELEVATED) return { ok: true, already: true };
  try {
    await new Promise((resolve, reject) => {
      const exe = String(process.execPath).replace(/'/g, "''");
      // -ErrorAction Stop → UAC iptal edilirse terminating hata → exit != 0.
      const ps = `Start-Process -FilePath '${exe}' -Verb RunAs -ErrorAction Stop`;
      const child = spawn(PWSH, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
      let err = '';
      if (child.stderr) child.stderr.on('data', (d) => { err += d.toString(); });
      child.on('error', reject);
      child.on('exit', (code) => { if (code === 0) resolve(); else reject(new Error(err.trim() || ('exit ' + code))); });
    });
    // Yükseltilmiş örnek başlatıldı → tek-örnek kilidini serbest bırakmak için
    // bu (yükseltilmemiş) örneği kapat; yükseltilmiş örnek kilidi alıp açılır.
    isQuitting = true;
    setTimeout(() => app.quit(), 500);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Yönetici olarak başlatılamadı (UAC iptal edilmiş olabilir).' };
  }
});
ipcMain.handle('app:downloadAndInstall', async () => {
  const ua = { 'User-Agent': 'Cboinn-Driver-Scanner' };
  const urlOk = (u) => typeof u === 'string' && /^https:\/\/(github\.com|objects\.githubusercontent\.com)\//i.test(u);
  try {
    const rel = await fetchWithTimeout('https://api.github.com/repos/iisletme593-droid/cboinn-driver-scanner/releases/latest', {
      headers: { ...ua, Accept: 'application/vnd.github+json' },
    }, 20000);
    if (!rel.ok) return { ok: false, error: 'GitHub: HTTP ' + rel.status };
    const j = await rel.json();
    const assets = Array.isArray(j.assets) ? j.assets : [];
    const exeAsset = assets.find((a) => /^Cboinn-Driver-Scanner-Setup-[\d.]+\.exe$/i.test(a.name || ''));
    const shaAsset = assets.find((a) => /^Cboinn-Driver-Scanner-Setup-[\d.]+\.exe\.sha256$/i.test(a.name || ''));
    const url = exeAsset && exeAsset.browser_download_url;
    if (!urlOk(url)) return { ok: false, error: 'Geçerli kurulum dosyası bulunamadı.' };
    // ── FAIL-CLOSED SHA256 ──
    // .sha256 yan-dosyası YOKSA veya geçerli bir hash okunamıyorsa kurulumu
    // REDDET. Aksi halde (eski davranış) doğrulanmamış binary çalıştırılırdı.
    const shaUrl = shaAsset && shaAsset.browser_download_url;
    if (!urlOk(shaUrl)) {
      return { ok: false, error: 'Güvenlik: SHA256 doğrulama dosyası bulunamadı — kurulum iptal edildi.' };
    }
    const s = await fetchWithTimeout(shaUrl, { headers: ua }, 20000);
    const expected = s.ok ? (await s.text()).trim().split(/\s+/)[0].toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      return { ok: false, error: 'Güvenlik: SHA256 değeri okunamadı — kurulum iptal edildi.' };
    }
    const dl = await fetchWithTimeout(url, { headers: ua }, 180000);
    if (!dl.ok) return { ok: false, error: 'İndirme: HTTP ' + dl.status };
    const buf = Buffer.from(await dl.arrayBuffer());
    const got = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
    if (got !== expected) {
      return { ok: false, error: 'SHA256 doğrulaması BAŞARISIZ — güvenlik nedeniyle kurulum iptal edildi.' };
    }
    const tmp = path.join(app.getPath('temp'), exeAsset.name);
    fs.writeFileSync(tmp, buf);
    // Installer'ı başlat — yalnızca BAŞARILI spawn olursa uygulamadan çık.
    // (Eskiden 1.2sn sonra koşulsuz quit yapıyordu; spawn başarısızsa kullanıcı
    //  hem uygulamasız hem güncellemesiz kalıyordu + geçici .exe temizlenmiyordu.)
    return await new Promise((resolve) => {
      let settled = false;
      const succeed = () => {
        if (settled) return; settled = true;
        try { child.unref(); } catch { /* ignore */ }
        setTimeout(() => { isQuitting = true; app.quit(); }, 1200);
        resolve({ ok: true, verified: true, version: String(j.tag_name || '') });
      };
      let child;
      try { child = spawn(tmp, [], { detached: true, stdio: 'ignore' }); }
      catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        resolve({ ok: false, error: 'Kurulum başlatılamadı: ' + String((e && e.message) || e) });
        return;
      }
      child.on('error', (err) => {
        if (settled) return; settled = true;
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        resolve({ ok: false, error: 'Kurulum başlatılamadı: ' + String((err && err.message) || err) });
      });
      child.on('spawn', succeed);
      // 'spawn' bazı sürümlerde gecikirse güvenlik ağı.
      setTimeout(succeed, 2500);
    });
  } catch (e) { return { ok: false, error: netErrMsg(e) }; }
});
ipcMain.handle('app:aiDiagnose', async (_e, summary) => {
  // Yalnızca TOPLU (kişisel olmayan) sağlık özeti cboinn.com'a (yayıncının kendi
  // sunucusu) gönderilir; donanım kimliği/seri no/kullanıcı adı/dosya yolu YOK.
  // Ağ çağrısı ANA SÜREÇTEN yapılır → renderer CSP (connect-src 'none') korunur.
  try {
    const s = summary && typeof summary === 'object' ? summary : {};
    const num = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };
    const str = (v, cap) => (typeof v === 'string' ? v : '').slice(0, cap).replace(/[<>]/g, '');
    const payload = {
      score: num(s.score, 0, 100),
      verdict: str(s.verdict, 40),
      updates: num(s.updates, 0, 9999),
      problems: num(s.problems, 0, 9999),
      missing: num(s.missing, 0, 9999),
      oldDrivers: num(s.oldDrivers, 0, 9999),
      software: num(s.software, 0, 99999),
      diskFreePct: num(s.diskFreePct, 0, 100),
      cleanableMB: num(s.cleanableMB, 0, 9999999),
      rebootPending: s.rebootPending === true,
      os: str(s.os, 60),
      problemClasses: Array.isArray(s.problemClasses)
        ? s.problemClasses.filter((x) => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 40).replace(/[<>]/g, ''))
        : [],
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch('https://cboinn.com/api/app/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Cboinn-Driver-Scanner' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) return { ok: false, error: 'AI sunucusu: HTTP ' + res.status };
    const j = await res.json();
    if (j && j.status === 'ok' && typeof j.diagnosis === 'string' && j.diagnosis.trim()) {
      return { ok: true, diagnosis: j.diagnosis.trim() };
    }
    return { ok: false, error: 'AI yanıtı alınamadı' + (j && j.code ? ' (' + j.code + ')' : '') };
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'AI isteği zaman aşımına uğradı (30sn).' : String((e && e.message) || e);
    return { ok: false, error: msg };
  }
});
ipcMain.handle('app:saveReport', async (_e, html) => {
  try {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'cboinn-rapor.html',
      filters: [{ name: 'HTML raporu', extensions: ['html'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, html, 'utf8');
    shell.openPath(r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});
// ── Zamanlanmış tarama (Windows Görev Zamanlayıcı, KULLANICI-BAZLI, admin yok) ──
// Mevcut --cli motorunu çağırır → reboot/quit sonrası da çalışır (in-process
// setInterval yalnızca GUI tepsideyken çalışıyordu).
function scheduleOutPath() { return path.join(app.getPath('userData'), 'schedule-last.json'); }
function scheduleArgsFor(intervalHours) {
  const h = Math.max(1, Math.min(168, Number(intervalHours) || 24));
  if (h < 24) return ['/sc', 'HOURLY', '/mo', String(h)];
  if (h === 24) return ['/sc', 'DAILY', '/st', '12:00'];
  if (h < 168) return ['/sc', 'DAILY', '/mo', String(Math.max(1, Math.round(h / 24))), '/st', '12:00'];
  return ['/sc', 'WEEKLY', '/st', '12:00'];
}
function runSchtasks(args) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let c;
    try { c = spawn(SCHTASKS, args, { windowsHide: true }); }
    catch (e) { resolve({ code: -1, out: '', err: String((e && e.message) || e) }); return; }
    if (c.stdout) c.stdout.on('data', (d) => { out += d.toString(); });
    if (c.stderr) c.stderr.on('data', (d) => { err += d.toString(); });
    c.on('error', (e) => resolve({ code: -1, out, err: String((e && e.message) || e) }));
    c.on('exit', (code) => resolve({ code, out, err }));
  });
}
ipcMain.handle('app:notify', (_e, title, body) => {
  // Renderer, uzun süren akışlar (optimizasyon/bakım) bitince bildirim isteyebilir;
  // yalnızca kullanıcı bildirimleri açıksa masaüstü bildirimi göster.
  try { if (readSettings().notify) notify(String(title || ''), String(body || '')); } catch { /* ignore */ }
  return true;
});
ipcMain.handle('app:scheduleStatus', async () => {
  const r = await runSchtasks(['/query', '/tn', SCHED_TASK]);
  return { exists: r.code === 0 };
});
ipcMain.handle('app:scheduleCreate', async (_e, intervalHours) => {
  // /tr argümanını Node'un Windows arg-tırnaklama'sı doğru kaçırır (exe yolu + iç tırnaklar).
  const tr = `"${process.execPath}" --cli full --out "${scheduleOutPath()}" --quiet`;
  const args = ['/create', '/tn', SCHED_TASK, '/tr', tr, ...scheduleArgsFor(intervalHours), '/f'];
  const r = await runSchtasks(args);
  if (r.code === 0) return { ok: true };
  return { ok: false, error: (r.err || r.out || ('schtasks çıkış ' + r.code)).trim().slice(0, 300) };
});
ipcMain.handle('app:scheduleRemove', async () => {
  const r = await runSchtasks(['/delete', '/tn', SCHED_TASK, '/f']);
  if (r.code === 0) return { ok: true };
  return { ok: false, error: (r.err || r.out || ('schtasks çıkış ' + r.code)).trim().slice(0, 300) };
});
ipcMain.handle('engine:readLog', () => {
  try {
    const p = path.join(stateDir(), 'worker.log');
    if (!fs.existsSync(p)) return '';
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return raw.split(/\r?\n/).slice(-250).join('\n');
  } catch { return ''; }
});

// ── Scan-history trend (local only, userData/state/history.json) ──
const HISTORY_MAX = 60;
function historyPath() { return path.join(stateDir(), 'history.json'); }
function readHistoryArr() {
  try {
    const p = historyPath();
    if (!fs.existsSync(p)) return [];
    let raw = fs.readFileSync(p, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
ipcMain.handle('app:historyRead', () => readHistoryArr());
ipcMain.handle('app:historyAppend', (_e, entry) => {
  try {
    const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };
    const e = {
      ts: Number(entry && entry.ts) || Date.now(),
      score: num(entry && entry.score, 0, 100),
      updates: num(entry && entry.updates, 0, 99999),
      problems: num(entry && entry.problems, 0, 99999),
      oldDrivers: num(entry && entry.oldDrivers, 0, 99999),
      software: num(entry && entry.software, 0, 99999),
      cleanableMB: num(entry && entry.cleanableMB, 0, 99999999),
      diskFreePct: num(entry && entry.diskFreePct, 0, 100),
    };
    let arr = readHistoryArr();
    const last = arr.length ? arr[arr.length - 1] : null;
    // Son kayıtla TÜM metrikler aynıysa yeni nokta ekleme (uygulama her
    // açılışında veya değişmeyen taramada gürültü birikmesin).
    const sameAsLast = last && last.score === e.score && last.updates === e.updates &&
      last.problems === e.problems && last.oldDrivers === e.oldDrivers &&
      last.software === e.software && last.cleanableMB === e.cleanableMB &&
      last.diskFreePct === e.diskFreePct;
    if (sameAsLast) return arr;
    // Aynı taramanın art arda gelen güncellemelerini tek noktaya topla (60sn).
    if (last && e.ts - (Number(last.ts) || 0) < 60000) arr[arr.length - 1] = e;
    else arr.push(e);
    if (arr.length > HISTORY_MAX) arr = arr.slice(arr.length - HISTORY_MAX);
    const p = historyPath();
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr), 'utf8');
    fs.renameSync(tmp, p);
    return arr;
  } catch { return readHistoryArr(); }
});

// ── CLI / sessiz mod ────────────────────────────────────────────────────────
// Örnek: "Cboinn Driver Scanner.exe" --cli full --out C:\rapor\tarama.json
// Pencere açılmaz; salt-okunur taramalar çalışır, JSON sonuç + çıkış kodu döner.
// Zamanlanmış görev / betik otomasyonu içindir.
function parseCliArgs(argv) {
  const i = argv.indexOf('--cli');
  if (i === -1) return null;
  const rest = argv.slice(i + 1);
  const cli = { command: null, out: null, quiet: false };
  for (let j = 0; j < rest.length; j++) {
    const a = rest[j];
    if (a === '--out') { cli.out = rest[j + 1] || null; j += 1; }
    else if (a === '--quiet') cli.quiet = true;
    else if (!cli.command && a && !a.startsWith('-')) cli.command = a.toLowerCase();
  }
  if (!cli.command) cli.command = 'help';
  return cli;
}
const CLI = parseCliArgs(process.argv);
if (CLI) app.disableHardwareAcceleration();

// Yalnızca SALT-OKUNUR modlar — kurulum/silme bilinçli olarak arayüzde kaldı
// (UAC ister; gözetimsiz otomasyonda sessizce sistem değiştirmek istemiyoruz).
const CLI_COMMANDS = {
  sysinfo: ['SysInfo'],
  scan: ['Scan'],
  software: ['SoftwareScan'],
  problems: ['ProblemDevices'],
  'clean-scan': ['CleanScan'],
  health: ['SystemHealth'],
  full: ['SysInfo', 'Scan', 'SoftwareScan', 'ProblemDevices', 'CleanScan', 'SystemHealth'],
};

function cliHelpText() {
  return [
    `Cboinn Driver Scanner ${app.getVersion()} — CLI / sessiz mod`,
    '',
    'Kullanım:',
    '  "Cboinn Driver Scanner.exe" --cli <komut> [--out <dosya.json>] [--quiet]',
    '',
    'Komutlar (salt-okunur, pencere açılmaz):',
    '  scan         Sürücü güncellemelerini tara (Windows Update)',
    '  software     Program güncellemelerini tara (winget)',
    '  problems     Sorunlu / eksik aygıtları tara',
    '  clean-scan   Temizlenebilir alanı hesapla (hiçbir şey silmez)',
    '  health       Disk SMART + pil sağlığı',
    '  sysinfo      Sistem bilgisi',
    '  full         Hepsini sırayla çalıştır (tam sessiz tarama)',
    '  version      Sürüm numarasını yaz',
    '  help         Bu yardım',
    '',
    'Seçenekler:',
    '  --out <dosya>  JSON sonucu dosyaya yaz (zamanlanmış görev için önerilir)',
    '  --quiet        İlerleme satırlarını gizle (yalnızca sonuç)',
    '',
    'Notlar:',
    '  - Konsolda görmek için yönlendirin:  --cli full > sonuc.json',
    '  - Kurulum/silme gibi değişiklik yapan işlemler güvenlik gereği arayüzdedir.',
    '  - Çıkış kodları: 0 başarı · 1 motor hatası · 2 kullanım hatası',
    '',
    'Örnek:',
    '  "Cboinn Driver Scanner.exe" --cli full --out "%TEMP%\\cboinn-tarama.json" --quiet',
  ].join('\n');
}

function cliPrint(line) {
  try { process.stdout.write(line + '\n'); } catch { /* stdout bağlı olmayabilir */ }
}

async function runCli(cli) {
  if (cli.command === 'help') { cliPrint(cliHelpText()); return 0; }
  if (cli.command === 'version') { cliPrint(app.getVersion()); return 0; }
  const modes = CLI_COMMANDS[cli.command];
  if (!modes) {
    cliPrint('Bilinmeyen komut: ' + cli.command);
    cliPrint('');
    cliPrint(cliHelpText());
    return 2;
  }
  // GUI açıkken paylaşılan status.json'a çarpmamak için ayrı state klasörü.
  stateDirOverride = path.join(app.getPath('userData'), 'state-cli');
  const summary = {
    app: 'Cboinn Driver Scanner',
    version: app.getVersion(),
    command: cli.command,
    startedAt: new Date().toISOString(),
    ok: false,
    steps: [],
    counts: {},
  };
  const res = {};
  let ok = true;
  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    if (!cli.quiet) cliPrint(`[${i + 1}/${modes.length}] ${mode} çalışıyor…`);
    const t0 = Date.now();
    let r;
    try { r = await runOperation(mode, {}); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e), results: null }; }
    const secs = Number(((Date.now() - t0) / 1000).toFixed(1));
    summary.steps.push({ mode, ok: !!r.ok, seconds: secs, error: r.error || null });
    if (r.results) Object.assign(res, r.results);
    if (!r.ok) ok = false;
    if (!cli.quiet) cliPrint(`[${i + 1}/${modes.length}] ${mode}: ${r.ok ? 'OK' : 'HATA — ' + (r.error || '?')} (${secs}sn)`);
  }
  if (Array.isArray(res.inventory)) summary.counts.drivers = res.inventory.length;
  if (Array.isArray(res.updates)) summary.counts.driverUpdates = res.updates.length;
  if (Array.isArray(res.software)) summary.counts.softwareUpdates = res.software.length;
  if (Array.isArray(res.problems)) {
    summary.counts.problemDevices = res.problems.length;
    summary.counts.missingDrivers = res.problems.filter((p) => p && p.Missing).length;
  }
  if (Array.isArray(res.clean)) {
    summary.counts.cleanableMB = Math.round(res.clean.reduce((s, c) => s + ((c && c.SizeMB) || 0), 0));
  }
  summary.finishedAt = new Date().toISOString();
  summary.ok = ok;
  summary.results = res;
  const json = JSON.stringify(summary, null, 2);
  if (cli.out) {
    const outPath = path.resolve(cli.out);
    try {
      fs.writeFileSync(outPath, json, 'utf8');
      if (!cli.quiet) cliPrint('Sonuç yazıldı: ' + outPath);
    } catch (e) {
      cliPrint('HATA: çıktı dosyası yazılamadı: ' + String((e && e.message) || e));
      return 1;
    }
  } else {
    cliPrint(json);
  }
  return ok ? 0 : 1;
}

// Headless self-test: `SELFTEST_MODE=Scan electron .` runs a single operation
// with no window and writes selftest-result.json — for diagnostics without GUI.
if (process.env.SELFTEST_MODE) {
  app.whenReady().then(async () => {
    const mode = process.env.SELFTEST_MODE;
    let payload;
    try {
      payload = await runOperation(mode, {});
    } catch (e) {
      payload = { ok: false, error: 'selftest exception: ' + String(e) };
    }
    try {
      fs.writeFileSync(
        path.join(stateDir(), 'selftest-result.json'),
        JSON.stringify({ mode, enginePath: enginePath(), pwsh: PWSH, ...payload }, null, 2),
      );
    } catch { /* ignore */ }
    app.quit();
  });
} else if (CLI) {
  // CLI modu: tek-örnek kilidi İSTENMEZ (GUI açıkken de çalışabilsin; state
  // zaten ayrı klasörde). Pencere/tepsi oluşturulmaz; iş bitince çıkış kodu döner.
  app.whenReady().then(async () => {
    let code = 3;
    try { code = await runCli(CLI); }
    catch (e) { cliPrint('HATA: ' + String((e && e.message) || e)); }
    app.exit(code);
  });
} else {
  // ── Tek-örnek + YÖNETİCİ DEVRALMA ──
  // closeToTray yüzünden tepside YÜKSELTİLMEMİŞ bir örnek kilidi tutabilir;
  // kullanıcı "Yönetici olarak çalıştır" deyince yükseltilmiş örnek kilidi DOLU
  // görüp sessizce ölüyordu (kök neden). Çözüm: yükseltilmiş örnek kazanır —
  // requestSingleInstanceLock'a {elevated:true} verir, primary bunu second-instance
  // ile alıp (yükseltilmemişse) çıkar, kilit boşalınca yükseltilmiş örnek devralır.
  const startApp = () => {
    createWindow();
    createTray();
    applySettings(readSettings());
  };
  const onSecondInstance = (_e, _argv, _cwd, data) => {
    // Yükseltilmiş bir örnek devralmak istiyorsa ve biz yükseltilmemişsek çık.
    if (data && data.elevated && !ELEVATED) { isQuitting = true; app.quit(); return; }
    showWindow();
  };
  const gotLock = app.requestSingleInstanceLock({ elevated: ELEVATED });
  if (gotLock) {
    app.on('second-instance', onSecondInstance);
    app.whenReady().then(startApp);
  } else if (!ELEVATED) {
    // Normal ikinci örnek: var olanı öne getir (sinyal gönderildi), bunu kapat.
    app.quit();
  } else {
    // Yükseltilmiş ama kilit başka örnekte. Sinyal gönderildi; primary
    // yükseltilmemişse çıkacak → kilit boşalınca devral. Boşalmazsa (primary
    // zaten yükseltilmiş) çık — böylece asla iki örnek olmaz.
    app.whenReady().then(() => {
      let tries = 0;
      const takeover = () => {
        if (app.requestSingleInstanceLock({ elevated: ELEVATED })) {
          app.on('second-instance', onSecondInstance);
          startApp();
        } else if (tries++ < 20) {
          setTimeout(takeover, 150);
        } else {
          app.quit();
        }
      };
      takeover();
    });
  }
}
app.on('before-quit', () => {
  isQuitting = true;
  // Çalışan motoru ve zamanlayıcıları temizle; aksi halde uygulama kapanınca
  // arka planda orphan powershell.exe (ve winget/pnputil torunları) çalışmaya
  // devam edebilir. child.kill() yalnızca doğrudan çocuğu öldürdüğü için tüm
  // ağacı taskkill /T ile sonlandırıyoruz. (Yükseltilmiş/detached işlemlerde
  // çocuk yalnızca başlatıcıdır; bu en iyi çaba temizliğidir.)
  try {
    if (currentChild && currentChild.pid) {
      try { execFileSync('taskkill', ['/PID', String(currentChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
      catch { try { currentChild.kill(); } catch { /* ignore */ } }
    }
  } catch { /* ignore */ }
  currentChild = null;
  try { if (currentPoll) { clearInterval(currentPoll); currentPoll = null; } } catch { /* ignore */ }
  try { if (scanTimer) { clearInterval(scanTimer); scanTimer = null; } } catch { /* ignore */ }
  try { if (tray) { tray.destroy(); tray = null; } } catch { /* ignore */ }
});
app.on('window-all-closed', () => {
  // Stay alive in the tray on Windows; quit only when explicitly requested
  // or when close-to-tray is disabled.
  if (process.platform === 'darwin') return;
  if (isQuitting || !readSettings().closeToTray) app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
