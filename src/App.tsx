import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { DataTable, type Column } from './components/DataTable';
import { StatCard } from './components/StatCard';
import {
  IconApp,
  IconBackup,
  IconBolt,
  IconChip,
  IconCog,
  IconDashboard,
  IconDownload,
  IconDriver,
  IconExternal,
  IconPackage,
  IconRefresh,
  IconRocket,
  IconScan,
  IconSearch,
  IconShield,
  IconTrash,
  IconUndo,
  IconPulse,
  IconWrench,
  IconClock,
  IconNetwork,
  IconPower,
  IconLock,
} from './components/icons';
import type {
  AppSettings,
  BloatRow,
  CleanItem,
  DriverStoreRow,
  EngineMode,
  HistoryEntry,
  InventoryRow,
  ProblemDeviceRow,
  RecycleRow,
  RepairResult,
  RunOpts,
  RunResult,
  SoftwareRow,
  SysInfo,
  SystemHealthData,
  NetworkRow,
  PrivacyRow,
  RestoreRow,
  StartupRow,
  UpdateRow,
  UsbDiskRow,
} from './types';
import logoUrl from './assets/cboinn-logo.png';
import { t, setLang, useLang, getLang, LANGS, isRtl, type Lang } from './i18n';

type Tab = 'overview' | 'updates' | 'inventory' | 'software' | 'problems' | 'clean' | 'apps' | 'driverstore' | 'debloat' | 'recycle' | 'media' | 'health' | 'repair' | 'restore' | 'network' | 'startup' | 'privacy' | 'settings';

const DEFAULT_UI_SETTINGS: AppSettings = {
  autoScan: false,
  intervalHours: 24,
  notify: true,
  startAtLogin: false,
  closeToTray: true,
  theme: 'dark',
  lang: 'tr',
};

const NAV_COMMANDS: { tab: Tab; label: string }[] = [
  { tab: 'overview', label: 'Genel Bakış' },
  { tab: 'updates', label: 'Sürücü Güncellemeleri' },
  { tab: 'inventory', label: 'Sürücü Envanteri' },
  { tab: 'software', label: 'Programlar' },
  { tab: 'problems', label: 'Sorunlu Aygıtlar' },
  { tab: 'clean', label: 'Temizlik' },
  { tab: 'apps', label: 'Uygulama Yönetimi' },
  { tab: 'driverstore', label: 'Sürücü Deposu' },
  { tab: 'debloat', label: 'Windows Hafifletme' },
  { tab: 'recycle', label: 'Geri Dönüşüm Kutusu' },
  { tab: 'media', label: 'Kurulum Medyası' },
  { tab: 'health', label: 'Sistem Sağlığı' },
  { tab: 'repair', label: 'Sistem Onarım' },
  { tab: 'restore', label: 'Geri Yükleme Noktaları' },
  { tab: 'network', label: 'Ağ Araçları' },
  { tab: 'startup', label: 'Başlangıç' },
  { tab: 'privacy', label: 'Gizlilik & Telemetri' },
  { tab: 'settings', label: 'Ayarlar' },
];

type Toast = { kind: 'ok' | 'error' | 'info'; text: string } | null;

function filterRows<T>(rows: T[], q: string, fields: (keyof T)[]): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(s)));
}

function buildReportHtml(d: {
  sysInfo: SysInfo | null;
  oldCount: number;
  updates: UpdateRow[];
  software: SoftwareRow[];
  problems: ProblemDeviceRow[];
  cleanTotalMB: number;
  installedCount: number;
  driverStoreCount: number;
  bloatCount: number;
  score: number | null;
  scoreVerdict: string;
  scoreColor: string;
  history: HistoryEntry[];
}): string {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] || c);
  // Rapor, oluşturulduğu andaki UI diline göre yerelleştirilir (Arapça'da RTL).
  const lang = getLang();
  const rtl = isRtl(lang);
  const locale =
    ({ tr: 'tr-TR', en: 'en-US', de: 'de-DE', ru: 'ru-RU', ar: 'ar' } as Record<string, string>)[lang] || 'tr-TR';
  const when = new Date().toLocaleString(locale);
  const sysRows = d.sysInfo
    ? [
        [t('Bilgisayar'), d.sysInfo.ComputerName],
        [t('İşletim Sistemi'), `${d.sysInfo.OS} (${d.sysInfo.OSVersion})`],
        [t('İşlemci'), d.sysInfo.CPU],
        [t('Bellek'), `${d.sysInfo.RAMGB} GB`],
        [t('Sistem Diski'), `${d.sysInfo.SysDriveFreeGB} / ${d.sysInfo.SysDriveSizeGB} ${t('GB boş')}`],
        [t('Yeniden başlatma'), d.sysInfo.PendingReboot ? t('Bekliyor') : t('Gerekmiyor')],
      ]
        .map((r) => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`)
        .join('')
    : `<tr><td>${esc(t('Sistem bilgisi yok'))}</td></tr>`;
  const summary = [
    [t('Sürücü güncellemesi'), d.updates.length],
    [t('Program güncellemesi'), d.software.length],
    [t('İncelenecek (eski) sürücü'), d.oldCount],
    [t('Sorunlu / eksik aygıt'), d.problems.length],
    [t('Temizlenebilir alan'), `${d.cleanTotalMB.toFixed(0)} MB`],
    [t('Yüklü program'), d.installedCount],
    [t('Sürücü paketi (depo)'), d.driverStoreCount],
    [t('Kaldırılabilir uygulama'), d.bloatCount],
  ]
    .map((r) => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`)
    .join('');
  const upRows = d.updates
    .slice(0, 80)
    .map((u) => `<tr><td>${esc(u.MatchedDevice || u.Title)}</td><td>${esc(u.Provider)}</td><td>${esc(u.NewDate)}</td></tr>`)
    .join('');
  const probRows = d.problems
    .slice(0, 80)
    .map((p) => `<tr><td>${esc(p.Name)}</td><td>${esc(p.Class)}</td><td>${esc(p.Problem)}</td></tr>`)
    .join('');
  const none = `<tr><td colspan=3>${esc(t('Yok'))}</td></tr>`;
  const scoreBlock =
    d.score != null
      ? `<h2>${esc(t('Sistem Sağlık Skoru'))}</h2><div class="score" style="border-inline-start:4px solid ${esc(d.scoreColor)}"><span class="big" style="color:${esc(d.scoreColor)}">${d.score}</span>/100 — ${esc(d.scoreVerdict)}</div>`
      : '';
  let trendBlock = '';
  if (d.history.length >= 2) {
    const hs = d.history.slice(-30);
    const first = hs[0];
    const lastH = hs[hs.length - 1];
    const delta = lastH.score - first.score;
    const arrow = delta === 0 ? '±0' : `${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`;
    const W = 600;
    const H = 90;
    const pad = 8;
    const xs = (i: number) => pad + (i / (hs.length - 1)) * (W - 2 * pad);
    const ys = (s: number) => pad + (1 - Math.max(0, Math.min(100, s)) / 100) * (H - 2 * pad);
    const pts = hs.map((h, i) => `${xs(i).toFixed(1)},${ys(h.score).toFixed(1)}`).join(' ');
    trendBlock =
      `<h2>${esc(t('Sağlık Trendi'))}</h2>` +
      `<div class="muted">${esc(t('Skor:'))} ${first.score} → ${lastH.score} (${esc(arrow)}) · ${hs.length} ${esc(t('tarama'))}</div>` +
      `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:600px;height:90px;margin-top:8px" preserveAspectRatio="none">` +
      `<polyline points="${pts}" fill="none" stroke="#7cc4ff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  return `<!doctype html><html lang="${lang}"${rtl ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><title>Cboinn Driver Scanner — ${esc(t('Sistem Raporu'))}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;background:#0a0e1a;color:#e8edf6;margin:0;padding:32px}
h1{color:#7cc4ff}h2{color:#9fb4d4;border-bottom:1px solid #25324a;padding-bottom:6px;margin-top:32px}
table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #25324a;padding:7px 10px;text-align:${rtl ? 'right' : 'left'};font-size:13px}
th{background:#121a2c;color:#9fb4d4;width:30%}.muted{color:#6b7a93;font-size:12px}
.score{background:#121a2c;padding:14px 16px;border-radius:8px;margin-top:12px;font-size:15px}.score .big{font-size:30px;font-weight:700;margin-inline-end:4px}
.noprint{margin-top:28px}.noprint button{background:#1d4ed8;color:#fff;border:0;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer}
@media print{.noprint{display:none}body{background:#fff;color:#111}h1{color:#0b3a66}h2{color:#234;border-color:#bcd}th{background:#eef;color:#234}td,th{border-color:#bcd}.score{background:#f3f6ff}}</style></head>
<body><h1>Cboinn Driver Scanner — ${esc(t('Sistem Raporu'))}</h1><div class="muted">${esc(t('Oluşturulma:'))} ${esc(when)}</div>
${scoreBlock}
${trendBlock}
<h2>${esc(t('Sistem Bilgisi'))}</h2><table>${sysRows}</table>
<h2>${esc(t('Özet'))}</h2><table>${summary}</table>
<h2>${esc(t('Sürücü Güncellemeleri'))} (${d.updates.length})</h2><table><tr><th>${esc(t('Aygıt'))}</th><th>${esc(t('Sağlayıcı'))}</th><th>${esc(t('Tarih'))}</th></tr>${upRows || none}</table>
<h2>${esc(t('Sorunlu / Eksik Aygıtlar'))} (${d.problems.length})</h2><table><tr><th>${esc(t('Aygıt'))}</th><th>${esc(t('Sınıf'))}</th><th>${esc(t('Sorun'))}</th></tr>${probRows || none}</table>
<div class="noprint"><button onclick="window.print()">${esc(t('Rapor Yazdır'))}</button></div>
</body></html>`;
}

function computeHealthScore(o: {
  driversScanned: boolean;
  softwareScanned: boolean;
  problemsScanned: boolean;
  updatesCount: number;
  softwareCount: number;
  oldCount: number;
  problemsCount: number;
  missingCount: number;
  sysInfo: SysInfo | null;
}): { score: number; verdict: string; color: string; factors: string[] } {
  let score = 100;
  const factors: string[] = [];
  if (o.problemsScanned && o.missingCount > 0) {
    score -= o.missingCount * 8;
    factors.push(`${o.missingCount} ${t('eksik sürücü')}`);
  }
  const otherProblems = o.problemsCount - o.missingCount;
  if (o.problemsScanned && otherProblems > 0) {
    score -= otherProblems * 4;
    factors.push(`${otherProblems} ${t('sorunlu aygıt')}`);
  }
  if (o.driversScanned && o.updatesCount > 0) {
    score -= Math.min(20, o.updatesCount * 3);
    factors.push(`${o.updatesCount} ${t('sürücü güncellemesi')}`);
  }
  if (o.softwareScanned && o.softwareCount > 0) {
    score -= Math.min(15, o.softwareCount * 2);
    factors.push(`${o.softwareCount} ${t('program güncellemesi')}`);
  }
  if (o.oldCount > 0) {
    score -= Math.min(15, Math.round(o.oldCount * 1.5));
    factors.push(`${o.oldCount} ${t('eski sürücü')}`);
  }
  if (o.sysInfo?.PendingReboot) {
    score -= 8;
    factors.push(t('Yeniden başlatma bekliyor'));
  }
  if (o.sysInfo && o.sysInfo.SysDriveSizeGB > 0) {
    const freePct = (o.sysInfo.SysDriveFreeGB / o.sysInfo.SysDriveSizeGB) * 100;
    if (freePct < 10) {
      score -= 15;
      factors.push(t('Disk %90+ dolu'));
    } else if (freePct < 20) {
      score -= 7;
      factors.push(t('Disk alanı azalıyor'));
    }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  let verdict = t('Mükemmel');
  let color = '#34d399';
  if (score < 50) {
    verdict = t('Kritik');
    color = '#ef4444';
  } else if (score < 70) {
    verdict = t('Dikkat');
    color = '#f59e0b';
  } else if (score < 90) {
    verdict = t('İyi');
    color = '#22d3ee';
  }
  return { score, verdict, color, factors: factors.slice(0, 4) };
}

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  useLang(); // dil değişiminde tüm arayüzü yeniler
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [sysInfo, setSysInfo] = useState<SysInfo | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [software, setSoftware] = useState<SoftwareRow[]>([]);
  const [problems, setProblems] = useState<ProblemDeviceRow[]>([]);
  const [cleanItems, setCleanItems] = useState<CleanItem[]>([]);
  const [installed, setInstalled] = useState<SoftwareRow[]>([]);
  const [searchResults, setSearchResults] = useState<SoftwareRow[]>([]);
  const [driverStore, setDriverStore] = useState<DriverStoreRow[]>([]);
  const [bloat, setBloat] = useState<BloatRow[]>([]);
  const [recycle, setRecycle] = useState<RecycleRow[]>([]);
  const [usbDisks, setUsbDisks] = useState<UsbDiskRow[]>([]);

  const [driversScanned, setDriversScanned] = useState(false);
  const [softwareScanned, setSoftwareScanned] = useState(false);
  const [problemsScanned, setProblemsScanned] = useState(false);
  const [cleanScanned, setCleanScanned] = useState(false);
  const [installedScanned, setInstalledScanned] = useState(false);
  const [searched, setSearched] = useState(false);
  const [appsMode, setAppsMode] = useState<'installed' | 'search'>('installed');
  const [wingetQuery, setWingetQuery] = useState('');
  const [driverStoreScanned, setDriverStoreScanned] = useState(false);
  const [oldDriversOnly, setOldDriversOnly] = useState(false);
  const [bloatScanned, setBloatScanned] = useState(false);
  const [recycleScanned, setRecycleScanned] = useState(false);
  const [usbScanned, setUsbScanned] = useState(false);
  const [selectedUsb, setSelectedUsb] = useState<number | null>(null);
  const [isoPath, setIsoPath] = useState('');
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [healthScanned, setHealthScanned] = useState(false);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [restorePoints, setRestorePoints] = useState<RestoreRow[]>([]);
  const [restoreScanned, setRestoreScanned] = useState(false);
  const [netAdapters, setNetAdapters] = useState<NetworkRow[]>([]);
  const [netScanned, setNetScanned] = useState(false);
  const [startup, setStartup] = useState<StartupRow[]>([]);
  const [startupScanned, setStartupScanned] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyRow[]>([]);
  const [privacyScanned, setPrivacyScanned] = useState(false);
  const [selPrivacy, setSelPrivacy] = useState<Set<string>>(new Set());
  const [updateText, setUpdateText] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [logText, setLogText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDiagnosis, setAiDiagnosis] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isElevated, setIsElevated] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  // `busy` durumunun ref aynası: asenkron IPC geri çağrıları (özellikle
  // zamanlanmış arka plan taraması) kapanışta eski `busy` değerini yakalamasın
  // ve ön plandaki taze sonucu eski veriyle ezmesin diye kullanılır.
  const busyRef = useRef(false);
  // Aktif toast'ın otomatik-kapanma zamanlayıcısı; üst üste gelen toast'larda
  // öncekini iptal etmek için tutulur.
  const toastTimer = useRef<number | null>(null);
  const [progress, setProgress] = useState<{ percent: number; message: string }>({
    percent: 0,
    message: '',
  });
  const [toast, setToast] = useState<Toast>(null);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [oldOnly, setOldOnly] = useState(false);
  const [createRestorePoint, setCreateRestorePoint] = useState(true);

  const [selUpdates, setSelUpdates] = useState<Set<string>>(new Set());
  const [selSoftware, setSelSoftware] = useState<Set<string>>(new Set());
  const [selClean, setSelClean] = useState<Set<string>>(new Set());
  const [selInstalled, setSelInstalled] = useState<Set<string>>(new Set());
  const [selSearch, setSelSearch] = useState<Set<string>>(new Set());
  const [selDriverStore, setSelDriverStore] = useState<Set<string>>(new Set());
  const [selBloat, setSelBloat] = useState<Set<string>>(new Set());
  const [selRecycle, setSelRecycle] = useState<Set<string>>(new Set());

  // Live progress from the engine.
  useEffect(() => {
    const off = window.engine.onProgress((p) => {
      setProgress({ percent: p.percent ?? 0, message: p.message ?? '' });
    });
    return off;
  }, []);

  // Trend geçmişini yükle (yerel, userData/state/history.json).
  useEffect(() => {
    let cancelled = false;
    window.app
      .historyRead()
      .then((h) => { if (!cancelled && Array.isArray(h)) setHistory(h); })
      .catch(() => {});
    window.app
      .isElevated()
      .then((v) => { if (!cancelled) setIsElevated(!!v); })
      .catch(() => {});
    window.app
      .scheduleStatus()
      .then((r) => { if (!cancelled) setScheduleEnabled(!!(r && r.exists)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load cached results instantly on startup; refresh system info if missing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [inv, upd, sw, si, pr, cl] = await Promise.all([
        window.engine.read('inventory.json'),
        window.engine.read('updates.json'),
        window.engine.read('software.json'),
        window.engine.read('sysinfo.json'),
        window.engine.read('problems.json'),
        window.engine.read('cleanscan.json'),
      ]);
      if (cancelled) return;
      // Kullanıcı yükleme sırasında elle bir tarama başlattıysa (busy), önbellekteki
      // eski sonuçları taze sonucun üstüne yazma.
      if (busyRef.current) return;
      if (Array.isArray(cl)) {
        setCleanItems(cl as CleanItem[]);
        setCleanScanned(true);
      }
      const ins = await window.engine.read('installed.json');
      if (!cancelled && Array.isArray(ins)) {
        setInstalled(ins as SoftwareRow[]);
        setInstalledScanned(true);
      }
      const ds = await window.engine.read('driverstore.json');
      if (!cancelled && Array.isArray(ds)) {
        setDriverStore(ds as DriverStoreRow[]);
        setDriverStoreScanned(true);
      }
      const bl = await window.engine.read('bloat.json');
      if (!cancelled && Array.isArray(bl)) {
        setBloat(bl as BloatRow[]);
        setBloatScanned(true);
      }
      const rc = await window.engine.read('recycle.json');
      if (!cancelled && Array.isArray(rc)) {
        setRecycle(rc as RecycleRow[]);
        setRecycleScanned(true);
      }
      const hl = await window.engine.read('health.json');
      if (!cancelled && hl && typeof hl === 'object' && !Array.isArray(hl)) {
        setHealth(hl as SystemHealthData);
        setHealthScanned(true);
      }
      const rp = await window.engine.read('restore.json');
      if (!cancelled && Array.isArray(rp)) { setRestorePoints(rp as RestoreRow[]); setRestoreScanned(true); }
      const nw = await window.engine.read('network.json');
      if (!cancelled && Array.isArray(nw)) { setNetAdapters(nw as NetworkRow[]); setNetScanned(true); }
      const su = await window.engine.read('startup.json');
      if (!cancelled && Array.isArray(su)) { setStartup(su as StartupRow[]); setStartupScanned(true); }
      if (Array.isArray(pr)) {
        setProblems(pr as ProblemDeviceRow[]);
        setProblemsScanned(true);
      }
      if (Array.isArray(inv)) setInventory(inv as InventoryRow[]);
      if (Array.isArray(upd)) {
        setUpdates(upd as UpdateRow[]);
        if ((upd as UpdateRow[]).length) setDriversScanned(true);
      }
      if (Array.isArray(sw)) {
        setSoftware(sw as SoftwareRow[]);
        if ((sw as SoftwareRow[]).length) setSoftwareScanned(true);
      }
      if (si && typeof si === 'object') setSysInfo(si as SysInfo);
      else void refresh('SysInfo');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = useCallback((next: Toast) => {
    // Önceki zamanlayıcıyı temizle ki üst üste gelen toast'lar birbirini erken
    // kapatmasın. (Parametre `next` — i18n `t`'yi gölgelememek için.)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(next);
    if (next) {
      toastTimer.current = window.setTimeout(() => {
        setToast(null);
        toastTimer.current = null;
      }, 5000);
    }
  }, []);

  // Load settings + react to background (scheduled) scan completions.
  useEffect(() => {
    window.settings
      .get()
      .then((s) => setSettings(s))
      .catch(() => setSettings(DEFAULT_UI_SETTINGS));
    const off = window.engine.onBackgroundResult(async (d) => {
      // Ön planda elle bir işlem çalışıyorsa, zamanlanmış arka plan taramasının
      // sonucunu state'e yazma — taze veriyi eski veriyle ezme riski (race).
      if (busyRef.current) return;
      const [upd, sw] = await Promise.all([
        window.engine.read('updates.json'),
        window.engine.read('software.json'),
      ]);
      if (busyRef.current) return;
      if (Array.isArray(upd)) {
        setUpdates(upd as UpdateRow[]);
        setDriversScanned(true);
      }
      if (Array.isArray(sw)) {
        setSoftware(sw as SoftwareRow[]);
        setSoftwareScanned(true);
      }
      showToast({
        kind: d.updates + d.software > 0 ? 'info' : 'ok',
        text: `${t('Otomatik tarama bitti —')} ${d.updates} ${t('sürücü,')} ${d.software} ${t('program güncellemesi.')}`,
      });
    });
    return off;
  }, [showToast]);

  // Apply light/dark theme + language (+ Arapça için RTL yön).
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings?.theme === 'light' ? 'light' : 'dark');
    const lang: Lang = settings?.lang ?? 'tr';
    setLang(lang);
    root.setAttribute('lang', lang);
    root.setAttribute('dir', isRtl(lang) ? 'rtl' : 'ltr');
  }, [settings?.theme, settings?.lang]);

  // Komut paleti kısayolu (Ctrl/Cmd+K) + Esc ile kapat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const runOp = useCallback(
    async (mode: EngineMode, opts?: RunOpts): Promise<RunResult> => {
      setBusy(true);
      busyRef.current = true;
      setProgress({ percent: 0, message: t('Başlatılıyor…') });
      let res: RunResult;
      try {
        res = await window.engine.run(mode, opts);
      } catch (e) {
        res = { ok: false, error: String(e), results: null };
      }
      setBusy(false);
      busyRef.current = false;
      setProgress({ percent: 0, message: '' });
      if (!res.ok) showToast({ kind: 'error', text: res.error || t('İşlem başarısız.') });
      return res;
    },
    [showToast],
  );

  // Refresh wrappers that fold engine results back into state.
  const refresh = useCallback(
    async (mode: EngineMode) => {
      const res = await runOp(mode);
      if (!res.ok || !res.results) return res;
      const r = res.results as Record<string, unknown>;
      if (Array.isArray(r.clean)) {
        setCleanItems(r.clean as CleanItem[]);
        setCleanScanned(true);
      }
      if (Array.isArray(r.installed)) {
        setInstalled(r.installed as SoftwareRow[]);
        setInstalledScanned(true);
      }
      if (Array.isArray(r.driverStore)) {
        setDriverStore(r.driverStore as DriverStoreRow[]);
        setDriverStoreScanned(true);
      }
      if (Array.isArray(r.bloat)) {
        setBloat(r.bloat as BloatRow[]);
        setBloatScanned(true);
      }
      if (Array.isArray(r.recycle)) {
        setRecycle(r.recycle as RecycleRow[]);
        setRecycleScanned(true);
      }
      if (Array.isArray(r.usb)) {
        setUsbDisks(r.usb as UsbDiskRow[]);
        setUsbScanned(true);
      }
      if (Array.isArray(r.restore)) { setRestorePoints(r.restore as RestoreRow[]); setRestoreScanned(true); }
      if (Array.isArray(r.network)) { setNetAdapters(r.network as NetworkRow[]); setNetScanned(true); }
      if (Array.isArray(r.startup)) { setStartup(r.startup as StartupRow[]); setStartupScanned(true); }
      if (Array.isArray(r.privacy)) { setPrivacy(r.privacy as PrivacyRow[]); setPrivacyScanned(true); }
      if (Array.isArray(r.problems)) {
        setProblems(r.problems as ProblemDeviceRow[]);
        setProblemsScanned(true);
      }
      if (Array.isArray(r.inventory)) setInventory(r.inventory as InventoryRow[]);
      if (Array.isArray(r.updates)) {
        setUpdates(r.updates as UpdateRow[]);
        setDriversScanned(true);
      }
      if (Array.isArray(r.software)) {
        setSoftware(r.software as SoftwareRow[]);
        setSoftwareScanned(true);
      }
      if (r.sysinfo && typeof r.sysinfo === 'object') setSysInfo(r.sysinfo as SysInfo);
      return res;
    },
    [runOp],
  );

  // ── Actions ──────────────────────────────────────────────────────────
  const scanDrivers = useCallback(async () => {
    const res = await refresh('Scan');
    if (res.ok) {
      const n = (res.results?.updates as UpdateRow[] | undefined)?.length ?? 0;
      showToast({ kind: 'ok', text: `${t('Sürücü taraması bitti —')} ${n} ${t('güncelleme bulundu.')}` });
    }
  }, [refresh, showToast]);

  const scanSoftware = useCallback(async () => {
    const res = await refresh('SoftwareScan');
    if (res.ok) {
      const n = (res.results?.software as SoftwareRow[] | undefined)?.length ?? 0;
      showToast({ kind: 'ok', text: `${t('Program taraması bitti —')} ${n} ${t('güncelleme bulundu.')}` });
    }
  }, [refresh, showToast]);

  const scanProblems = useCallback(async () => {
    const res = await refresh('ProblemDevices');
    if (res.ok) {
      const n = (res.results?.problems as ProblemDeviceRow[] | undefined)?.length ?? 0;
      showToast({
        kind: n > 0 ? 'info' : 'ok',
        text: n > 0 ? `${n} ${t('sorunlu/eksik aygıt bulundu.')}` : t('Sorunlu aygıt yok — her şey yolunda.'),
      });
    }
  }, [refresh, showToast]);

  const scanClean = useCallback(async () => {
    const res = await refresh('CleanScan');
    if (res.ok) {
      const items = (res.results?.clean as CleanItem[] | undefined) ?? [];
      setSelClean(new Set(items.map((c) => c.Id)));
      const total = items.reduce((s, c) => s + (c.SizeMB || 0), 0);
      showToast({ kind: 'ok', text: `${t('Temizlenebilir alan:')} ${total.toFixed(1)} MB (${items.length} ${t('kategori).')}` });
    }
  }, [refresh, showToast]);

  const applyClean = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      if (!window.confirm(t('Seçili kategorilerdeki geçici dosyalar ve önbellekler kalıcı olarak silinecek. Devam edilsin mi?'))) return;
      const res = await runOp('CleanApply', { cleanCategories: ids });
      if (res.ok) {
        const freed = (res.results?.cleanResult as { freedMB?: number } | undefined)?.freedMB ?? 0;
        showToast({ kind: 'ok', text: `${t('Temizlik tamamlandı —')} ${freed.toFixed(1)} ${t('MB boşaltıldı.')}` });
        setSelClean(new Set());
        await refresh('CleanScan');
      }
    },
    [runOp, refresh, showToast],
  );

  const loadInstalled = useCallback(async () => {
    const res = await refresh('SoftwareInventory');
    if (res.ok) {
      const n = (res.results?.installed as SoftwareRow[] | undefined)?.length ?? 0;
      showToast({ kind: 'ok', text: `${n} ${t('yüklü program listelendi.')}` });
    }
  }, [refresh, showToast]);

  const uninstallApps = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      if (!window.confirm(`${ids.length} ${t('program kaldırılacak. Devam edilsin mi?')}`)) return;
      const res = await runOp('SoftwareUninstall', { wingetIds: ids });
      if (res.ok) {
        const ok = res.status?.succeeded ?? 0;
        const total = res.status?.total ?? ids.length;
        showToast({ kind: 'ok', text: `${t('Kaldırma bitti —')} ${ok}/${total} ${t('başarılı.')}` });
        setSelInstalled(new Set());
        await refresh('SoftwareInventory');
      }
    },
    [runOp, refresh, showToast],
  );

  const searchApps = useCallback(async () => {
    if (!wingetQuery.trim()) return;
    const res = await runOp('SoftwareSearch', { query: wingetQuery.trim() });
    if (res.ok) {
      const rows = (res.results?.search as SoftwareRow[] | undefined) ?? [];
      setSearchResults(rows);
      setSearched(true);
      setSelSearch(new Set());
      showToast({
        kind: rows.length ? 'ok' : 'info',
        text: rows.length ? `${rows.length} ${t('sonuç bulundu.')}` : t('Sonuç bulunamadı.'),
      });
    }
  }, [runOp, wingetQuery, showToast]);

  const installNewApps = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const res = await runOp('SoftwareInstallNew', { wingetIds: ids });
      if (res.ok) {
        const ok = res.status?.succeeded ?? 0;
        const total = res.status?.total ?? ids.length;
        showToast({ kind: 'ok', text: `${t('Kurulum bitti —')} ${ok}/${total} ${t('başarılı.')}` });
        setSelSearch(new Set());
      }
    },
    [runOp, showToast],
  );

  const scanDriverStore = useCallback(async () => {
    const res = await refresh('DriverStore');
    if (res.ok) {
      const rows = (res.results?.driverStore as DriverStoreRow[] | undefined) ?? [];
      const old = rows.filter((r) => r.Old).length;
      showToast({ kind: 'ok', text: `${rows.length} ${t('sürücü paketi listelendi (')}${old}${t(' eski kopya).')}` });
    }
  }, [refresh, showToast]);

  const deleteDriverStore = useCallback(
    async (infs: string[]) => {
      if (!infs.length) return;
      if (!window.confirm(`${infs.length} ${t('sürücü paketi depodan silinecek. Kullanımda olanlar korunur. Devam edilsin mi?')}`)) return;
      const res = await runOp('DriverStoreDelete', { driverInfs: infs, createRestorePoint: true });
      if (res.ok) {
        const ok = res.status?.succeeded ?? 0;
        const total = res.status?.total ?? infs.length;
        showToast({ kind: 'ok', text: `${t('Silme bitti —')} ${ok}/${total} ${t('başarılı (kullanımdaki paketler korundu).')}` });
        setSelDriverStore(new Set());
        await refresh('DriverStore');
      }
    },
    [runOp, refresh, showToast],
  );

  const scanBloat = useCallback(async () => {
    const res = await refresh('BloatScan');
    if (res.ok) {
      const n = (res.results?.bloat as BloatRow[] | undefined)?.length ?? 0;
      showToast({ kind: 'ok', text: `${n} ${t('kaldırılabilir uygulama bulundu.')}` });
    }
  }, [refresh, showToast]);

  const removeBloat = useCallback(
    async (pkgs: string[]) => {
      if (!pkgs.length) return;
      if (!window.confirm(`${pkgs.length} ${t("uygulama kaldırılacak. (Microsoft Store'dan tekrar kurulabilir.) Devam edilsin mi?")}`)) return;
      const res = await runOp('BloatRemove', { appxNames: pkgs });
      if (res.ok) {
        const ok = res.status?.succeeded ?? 0;
        const total = res.status?.total ?? pkgs.length;
        showToast({ kind: 'ok', text: `${t('Kaldırma bitti —')} ${ok}/${total} ${t('başarılı.')}` });
        setSelBloat(new Set());
        await refresh('BloatScan');
      }
    },
    [runOp, refresh, showToast],
  );

  const scanRecycle = useCallback(async () => {
    const res = await refresh('RecycleList');
    if (res.ok) {
      const n = (res.results?.recycle as RecycleRow[] | undefined)?.length ?? 0;
      showToast({ kind: 'ok', text: `${t('Geri dönüşüm kutusunda')} ${n} ${t('öğe.')}` });
    }
  }, [refresh, showToast]);

  const restoreRecycle = useCallback(
    async (keys: string[]) => {
      if (!keys.length) return;
      const res = await runOp('RecycleRestore', { restoreKeys: keys });
      if (res.ok) {
        const ok = res.status?.succeeded ?? 0;
        showToast({ kind: 'ok', text: `${ok} ${t('öğe geri yüklendi.')}` });
        setSelRecycle(new Set());
        await refresh('RecycleList');
      }
    },
    [runOp, refresh, showToast],
  );

  const scanUsb = useCallback(async () => {
    const res = await refresh('UsbList');
    if (res.ok) {
      const n = (res.results?.usb as UsbDiskRow[] | undefined)?.length ?? 0;
      showToast({ kind: n ? 'ok' : 'info', text: n ? `${n} ${t('USB diski bulundu.')}` : t('Çıkarılabilir USB bulunamadı.') });
    }
  }, [refresh, showToast]);

  const pickIso = useCallback(async () => {
    const p = await window.sys.pickFile([{ name: t('ISO görüntüsü'), extensions: ['iso'] }]);
    if (p) setIsoPath(p);
  }, []);

  const makeBootable = useCallback(async () => {
    if (!isoPath || selectedUsb === null) return;
    const disk = usbDisks.find((d) => d.DiskNumber === selectedUsb);
    const ok = window.confirm(
      `${t('DİKKAT:')} "${disk?.FriendlyName ?? t('Disk ') + selectedUsb}" (${disk?.SizeGB ?? '?'} GB) ${t("üzerindeki TÜM VERİLER SİLİNECEK ve önyüklenebilir Windows USB'sine dönüştürülecek. Emin misiniz?")}`,
    );
    if (!ok) return;
    const res = await runOp('MakeBootable', { isoPath, usbDiskNumber: selectedUsb });
    if (res.ok) {
      showToast({ kind: 'ok', text: `${t('Önyüklenebilir USB hazır:')} ${res.status?.drive ?? ''}` });
      setSelectedUsb(null);
    }
  }, [isoPath, selectedUsb, usbDisks, runOp, showToast]);

  const scanHealth = useCallback(async () => {
    const res = await runOp('SystemHealth');
    if (res.ok) {
      const h = res.results?.health as SystemHealthData | undefined;
      if (h) setHealth(h);
      setHealthScanned(true);
      showToast({ kind: 'ok', text: t('Sistem sağlığı kontrol edildi.') });
    }
  }, [runOp, showToast]);

  const runRepair = useCallback(
    async (tool: string) => {
      const res = await runOp('SystemRepair', { repairTool: tool });
      if (res.ok) {
        const r = res.results?.repairResult as RepairResult | undefined;
        if (r) setRepairResult(r);
        showToast({
          kind: r && r.exit === 0 ? 'ok' : 'info',
          text: `${tool.toUpperCase()} ${t('tamamlandı (çıkış kodu')} ${r?.exit ?? '?'}).`,
        });
      }
    },
    [runOp, showToast],
  );

  const scanRestore = useCallback(async () => {
    const res = await refresh('RestoreList');
    if (res.ok) {
      const n = (res.results?.restore as RestoreRow[] | undefined)?.length ?? 0;
      showToast({ kind: 'ok', text: `${n} ${t('geri yükleme noktası bulundu.')}` });
    }
  }, [refresh, showToast]);

  const createRestore = useCallback(async () => {
    const res = await runOp('RestoreCreate', { description: 'Cboinn Driver Scanner — elle' });
    if (res.ok) {
      showToast({ kind: 'ok', text: t('Geri yükleme noktası oluşturuldu.') });
      await refresh('RestoreList');
    }
  }, [runOp, refresh, showToast]);

  const scanNetwork = useCallback(async () => {
    const res = await refresh('NetworkInfo');
    if (res.ok) showToast({ kind: 'ok', text: t('Ağ yapılandırması güncellendi.') });
  }, [refresh, showToast]);

  const runNetAction = useCallback(
    async (action: string) => {
      const res = await runOp('NetworkAction', { netAction: action });
      if (res.ok) showToast({ kind: 'ok', text: res.status?.message || t('Ağ işlemi tamamlandı.') });
    },
    [runOp, showToast],
  );

  const scanStartup = useCallback(async () => {
    const res = await refresh('StartupList');
    if (res.ok) {
      const n = (res.results?.startup as StartupRow[] | undefined)?.length ?? 0;
      showToast({ kind: 'ok', text: `${n} ${t('başlangıç öğesi bulundu.')}` });
    }
  }, [refresh, showToast]);

  const setStartupState = useCallback(
    async (name: string, enabled: boolean) => {
      const res = await runOp('StartupSetState', { startupName: name, startupEnabled: enabled });
      if (res.ok) {
        showToast({ kind: 'ok', text: `"${name}" ${enabled ? t('etkinleştirildi') : t('devre dışı bırakıldı')}.` });
        await refresh('StartupList');
      }
    },
    [runOp, refresh, showToast],
  );

  const togglePrivacy = useCallback((id: string) => toggle(setSelPrivacy, id), []);
  const scanPrivacy = useCallback(async () => {
    const res = await refresh('PrivacyScan');
    if (res.ok) showToast({ kind: 'ok', text: t('Gizlilik ayarları okundu.') });
  }, [refresh, showToast]);
  const applyPrivacy = useCallback(async () => {
    const ids = [...selPrivacy];
    if (!ids.length) return;
    const res = await runOp('PrivacyApply', { tweaks: ids });
    if (res.ok) {
      showToast({ kind: 'ok', text: t('Gizlilik ayarları uygulandı.') });
      setSelPrivacy(new Set());
      await refresh('PrivacyScan');
    }
  }, [selPrivacy, runOp, refresh, showToast]);
  const revertPrivacy = useCallback(async () => {
    const ids = [...selPrivacy];
    if (!ids.length) return;
    const res = await runOp('PrivacyRevert', { tweaks: ids });
    if (res.ok) {
      showToast({ kind: 'ok', text: t('Varsayılana döndürüldü.') });
      setSelPrivacy(new Set());
      await refresh('PrivacyScan');
    }
  }, [selPrivacy, runOp, refresh, showToast]);

  const checkUpdate = useCallback(async () => {
    setUpdateText(t('Denetleniyor…'));
    setUpdateAvailable(false);
    const r = await window.app.checkUpdate();
    if (r.error) {
      setUpdateText(t('Denetlenemedi: ') + r.error);
    } else if (r.updateAvailable) {
      setUpdateText(`${t('Yeni sürüm mevcut: v')}${r.latest} (${t('yüklü: v')}${r.current}).`);
      setUpdateAvailable(true);
    } else {
      setUpdateText(`${t('En güncel sürümdesiniz (v')}${r.current}).`);
    }
  }, []);

  const downloadInstall = useCallback(async () => {
    setUpdateText(t('İndiriliyor ve SHA256 doğrulanıyor… (bitince uygulama kapanıp güncellenecek)'));
    const r = await window.app.downloadAndInstall();
    if (!r.ok) {
      setUpdateText(t('Güncelleme başarısız: ') + (r.error || t('bilinmeyen hata')));
      showToast({ kind: 'error', text: t('Güncelleme başarısız: ') + (r.error || '') });
    } else {
      setUpdateText(t('Doğrulandı ✓ Kurulum başlatılıyor, uygulama kapanıyor…'));
    }
  }, [showToast]);

  const relaunchAsAdmin = useCallback(async () => {
    showToast({ kind: 'info', text: t('Yönetici izni isteniyor (UAC)…') });
    const r = await window.app.relaunchAsAdmin();
    if (r.already) { showToast({ kind: 'ok', text: t('Uygulama zaten yönetici olarak çalışıyor.') }); return; }
    if (!r.ok) showToast({ kind: 'error', text: r.error || t('Yönetici olarak başlatılamadı.') });
    // Başarılıysa uygulama kapanıp yükseltilmiş olarak yeniden açılır.
  }, [showToast]);

  const exportSettings = useCallback(async () => {
    const r = await window.settings.export();
    if (r.ok) showToast({ kind: 'ok', text: t('Ayarlar dışa aktarıldı.') });
    else if (r.error) showToast({ kind: 'error', text: t('Dışa aktarılamadı: ') + r.error });
  }, [showToast]);

  const importSettings = useCallback(async () => {
    const r = await window.settings.import();
    if (r.ok && r.settings) {
      setSettings(r.settings);
      showToast({ kind: 'ok', text: t('Ayarlar içe aktarıldı ve uygulandı.') });
    } else if (r.error) {
      showToast({ kind: 'error', text: t('İçe aktarılamadı: ') + r.error });
    }
  }, [showToast]);

  const toggleSchedule = useCallback(
    async (enable: boolean) => {
      setScheduleBusy(true);
      try {
        if (enable) {
          const r = await window.app.scheduleCreate(settings?.intervalHours ?? 24);
          if (r.ok) { setScheduleEnabled(true); showToast({ kind: 'ok', text: t('Zamanlanmış tarama oluşturuldu (Görev Zamanlayıcı).') }); }
          else showToast({ kind: 'error', text: t('Görev oluşturulamadı: ') + (r.error || '') });
        } else {
          const r = await window.app.scheduleRemove();
          if (r.ok) { setScheduleEnabled(false); showToast({ kind: 'ok', text: t('Zamanlanmış tarama kaldırıldı.') }); }
          else showToast({ kind: 'error', text: t('Görev kaldırılamadı: ') + (r.error || '') });
        }
      } finally {
        setScheduleBusy(false);
      }
    },
    [settings, showToast],
  );

  const showLog = useCallback(async () => {
    const log = await window.engine.readLog();
    setLogText(log || t('(günlük boş)'));
  }, []);

  const exportReport = useCallback(async () => {
    const oldCount = inventory.filter((r) => r.Old).length;
    const sc = computeHealthScore({
      driversScanned,
      softwareScanned,
      problemsScanned,
      updatesCount: updates.length,
      softwareCount: software.length,
      oldCount,
      problemsCount: problems.length,
      missingCount: problems.filter((r) => r.Missing).length,
      sysInfo,
    });
    const anyScanned = driversScanned || softwareScanned || problemsScanned;
    const html = buildReportHtml({
      sysInfo,
      oldCount,
      updates,
      software,
      problems,
      cleanTotalMB: cleanItems.reduce((s, c) => s + (c.SizeMB || 0), 0),
      installedCount: installed.length,
      driverStoreCount: driverStore.length,
      bloatCount: bloat.length,
      score: anyScanned ? sc.score : null,
      scoreVerdict: sc.verdict,
      scoreColor: sc.color,
      history,
    });
    const r = await window.app.saveReport(html);
    if (r.ok) showToast({ kind: 'ok', text: t('Rapor kaydedildi ve açıldı.') });
  }, [
    sysInfo,
    inventory,
    updates,
    software,
    problems,
    cleanItems,
    installed,
    driverStore,
    bloat,
    history,
    driversScanned,
    softwareScanned,
    problemsScanned,
    showToast,
  ]);

  const installDrivers = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const res = await runOp('Install', { updateIds: ids, createRestorePoint });
      if (res.ok) {
        const reboot = res.status?.rebootRequired;
        showToast({
          kind: 'ok',
          text: reboot
            ? t('Sürücüler kuruldu. Yeniden başlatma gerekiyor.')
            : t('Sürücüler kuruldu.'),
        });
        setSelUpdates(new Set());
        await refresh('Scan');
      }
    },
    [runOp, refresh, createRestorePoint, showToast],
  );

  const installSoftware = useCallback(
    async (ids: string[], allowAll = false) => {
      // Boş liste motorda "winget upgrade --all" demek; bu yalnızca kullanıcı
      // bilinçli "Tümünü Güncelle" + onay verince (allowAll) tetiklenmeli —
      // aksi halde kazara hepsini güncellemeyi önle.
      if (ids.length === 0 && !allowAll) return;
      const res = await runOp('SoftwareInstall', { wingetIds: ids });
      if (res.ok) {
        showToast({ kind: 'ok', text: t('Program güncellemesi tamamlandı.') });
        setSelSoftware(new Set());
        await refresh('SoftwareScan');
      }
    },
    [runOp, refresh, showToast],
  );

  const backupDrivers = useCallback(async () => {
    const res = await runOp('BackupDrivers');
    if (res.ok) {
      const folder = res.status?.folder;
      showToast({ kind: 'ok', text: `${t('Sürücü yedeği alındı')}${folder ? ': ' + folder : ''}.` });
      if (folder) void window.sys.openPath(folder);
    }
  }, [runOp, showToast]);

  const updateSetting = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...(prev ?? DEFAULT_UI_SETTINGS), ...patch };
      window.settings.set(next).catch(() => {});
      return next;
    });
  }, []);

  const scanNow = useCallback(async () => {
    await refresh('Scan');
    await refresh('SoftwareScan');
    showToast({ kind: 'ok', text: t('Tam tarama tamamlandı.') });
  }, [refresh, showToast]);

  const quickMaintenance = useCallback(async () => {
    showToast({ kind: 'info', text: t('Tek tık bakım başladı: sürücü, program, aygıt, temizlik, sağlık…') });
    await refresh('Scan');
    await refresh('SoftwareScan');
    await refresh('ProblemDevices');
    await refresh('CleanScan');
    const res = await runOp('SystemHealth');
    if (res.ok) {
      const h = res.results?.health as SystemHealthData | undefined;
      if (h) setHealth(h);
      setHealthScanned(true);
    }
    showToast({ kind: 'ok', text: t('Tek tık bakım taraması tamamlandı — sağlık skoru güncellendi.') });
  }, [refresh, runOp, showToast]);

  // Tek Tık Optimizasyon: tam tarama + GÜVENLİ temizlik (temp/önbellek; Geri
  // Dönüşüm Kutusu hariç) + sağlık. Bitince masaüstü bildirimi gönderir.
  const quickOptimize = useCallback(async () => {
    if (
      !window.confirm(
        t(
          'Tek Tık Optimizasyon: önce tam tarama yapılır, sonra geçici dosyalar ve önbellekler (Geri Dönüşüm Kutusu hariç) temizlenir. Yönetici izni (UAC) istenebilir. Devam edilsin mi?',
        ),
      )
    )
      return;
    showToast({ kind: 'info', text: t('Optimizasyon başladı: tarama + güvenli temizlik…') });
    await refresh('Scan');
    await refresh('SoftwareScan');
    await refresh('ProblemDevices');
    const cleanRes = await refresh('CleanScan');
    // Geri Dönüşüm Kutusu kullanıcı verisidir — otomatik akışta hariç tut.
    const ids = ((cleanRes.results?.clean as CleanItem[] | undefined) ?? [])
      .map((c) => c.Id)
      .filter((id) => id && id !== 'recyclebin');
    let freed = 0;
    if (ids.length) {
      const ap = await runOp('CleanApply', { cleanCategories: ids });
      if (ap.ok) {
        freed = (ap.results?.cleanResult as { freedMB?: number } | undefined)?.freedMB ?? 0;
        await refresh('CleanScan');
      }
    }
    const hr = await runOp('SystemHealth');
    if (hr.ok) {
      const h = hr.results?.health as SystemHealthData | undefined;
      if (h) setHealth(h);
      setHealthScanned(true);
    }
    const msg = `${t('Optimizasyon tamamlandı —')} ${freed.toFixed(0)} ${t('MB boşaltıldı.')}`;
    showToast({ kind: 'ok', text: msg });
    void window.app.notify(t('Optimizasyon tamamlandı'), msg);
  }, [refresh, runOp, showToast]);

  // Yapay zekâ teşhisi: yalnızca TOPLU (kişisel olmayan) özet sayıları
  // yayıncının kendi sunucusuna (cboinn.com) gönderir; ağ çağrısı ANA SÜREÇTEN
  // yapıldığı için renderer CSP'si (connect-src 'none') korunur.
  const runAiDiagnose = useCallback(async () => {
    const health = computeHealthScore({
      driversScanned,
      softwareScanned,
      problemsScanned,
      updatesCount: updates.length,
      softwareCount: software.length,
      oldCount: inventory.filter((r) => r.Old).length,
      problemsCount: problems.length,
      missingCount: problems.filter((r) => r.Missing).length,
      sysInfo,
    });
    const diskFreePct =
      sysInfo && sysInfo.SysDriveSizeGB > 0
        ? Math.round((sysInfo.SysDriveFreeGB / sysInfo.SysDriveSizeGB) * 100)
        : 0;
    const problemClasses = Array.from(
      new Set(problems.map((p) => p.Class).filter((c): c is string => Boolean(c))),
    ).slice(0, 12);
    const summary = {
      score: health.score,
      verdict: health.verdict,
      updates: updates.length,
      problems: problems.length,
      missing: problems.filter((r) => r.Missing).length,
      oldDrivers: inventory.filter((r) => r.Old).length,
      software: software.length,
      diskFreePct,
      cleanableMB: Math.round(cleanItems.reduce((s, c) => s + (c.SizeMB || 0), 0)),
      rebootPending: Boolean(sysInfo?.PendingReboot),
      os: sysInfo ? `${sysInfo.OS} ${sysInfo.OSVersion}`.trim() : '',
      problemClasses,
    };
    setAiBusy(true);
    setAiError(null);
    setAiDiagnosis(null);
    try {
      const r = await window.app.aiDiagnose(summary);
      if (r.ok && r.diagnosis) {
        setAiDiagnosis(r.diagnosis);
      } else {
        setAiError(r.error || t('AI teşhisi alınamadı.'));
      }
    } catch (e) {
      setAiError(String((e as Error)?.message || e));
    } finally {
      setAiBusy(false);
    }
  }, [
    driversScanned,
    softwareScanned,
    problemsScanned,
    updates,
    software,
    inventory,
    problems,
    cleanItems,
    sysInfo,
  ]);

  // Trend kaydı: tarama durumu değişince (render sonrası taze veriyle) bir
  // anlık görüntü ekle. Özdeş/60sn-içi noktalar ana süreçte elenir.
  const recordHistory = useCallback(async () => {
    if (!(driversScanned || softwareScanned || problemsScanned)) return;
    const oldCnt = inventory.filter((r) => r.Old).length;
    const health = computeHealthScore({
      driversScanned,
      softwareScanned,
      problemsScanned,
      updatesCount: updates.length,
      softwareCount: software.length,
      oldCount: oldCnt,
      problemsCount: problems.length,
      missingCount: problems.filter((r) => r.Missing).length,
      sysInfo,
    });
    const diskFreePct =
      sysInfo && sysInfo.SysDriveSizeGB > 0
        ? Math.round((sysInfo.SysDriveFreeGB / sysInfo.SysDriveSizeGB) * 100)
        : 0;
    const entry: HistoryEntry = {
      ts: Date.now(),
      score: health.score,
      updates: updates.length,
      problems: problems.length,
      oldDrivers: oldCnt,
      software: software.length,
      cleanableMB: Math.round(cleanItems.reduce((s, c) => s + (c.SizeMB || 0), 0)),
      diskFreePct,
    };
    try {
      const arr = await window.app.historyAppend(entry);
      if (Array.isArray(arr)) setHistory(arr as HistoryEntry[]);
    } catch {
      /* yut */
    }
  }, [driversScanned, softwareScanned, problemsScanned, updates, software, inventory, problems, cleanItems, sysInfo]);

  useEffect(() => {
    const id = setTimeout(() => {
      void recordHistory();
    }, 1200);
    return () => clearTimeout(id);
  }, [recordHistory]);

  // ── Derived / filtered ───────────────────────────────────────────────
  const filteredUpdates = useMemo(
    () => filterRows(updates, deferredQuery, ['Title', 'MatchedDevice', 'Provider', 'DriverClass']),
    [updates, deferredQuery],
  );
  const filteredInventory = useMemo(() => {
    const base = oldOnly ? inventory.filter((r) => r.Old) : inventory;
    return filterRows(base, deferredQuery, ['DeviceName', 'DeviceClass', 'Provider', 'Version']);
  }, [inventory, oldOnly, deferredQuery]);
  const filteredSoftware = useMemo(
    () => filterRows(software, deferredQuery, ['Name', 'Id', 'Version']),
    [software, deferredQuery],
  );
  const filteredProblems = useMemo(
    () => filterRows(problems, deferredQuery, ['Name', 'Class', 'Problem', 'Manufacturer']),
    [problems, deferredQuery],
  );

  const filteredClean = useMemo(
    () => filterRows(cleanItems, deferredQuery, ['Label']),
    [cleanItems, deferredQuery],
  );
  const filteredInstalled = useMemo(
    () => filterRows(installed, deferredQuery, ['Name', 'Id', 'Version']),
    [installed, deferredQuery],
  );
  const filteredDriverStore = useMemo(() => {
    const base = oldDriversOnly ? driverStore.filter((r) => r.Old) : driverStore;
    return filterRows(base, deferredQuery, ['OriginalName', 'Provider', 'ClassName', 'Version']);
  }, [driverStore, oldDriversOnly, deferredQuery]);
  const filteredBloat = useMemo(
    () => filterRows(bloat, deferredQuery, ['DisplayName', 'Name', 'Publisher']),
    [bloat, deferredQuery],
  );
  const filteredRecycle = useMemo(
    () => filterRows(recycle, deferredQuery, ['Name', 'OriginalLocation']),
    [recycle, deferredQuery],
  );

  const oldCount = useMemo(() => inventory.filter((r) => r.Old).length, [inventory]);
  const missingCount = useMemo(() => problems.filter((r) => r.Missing).length, [problems]);
  const cleanTotalMB = useMemo(() => cleanItems.reduce((s, c) => s + (c.SizeMB || 0), 0), [cleanItems]);
  const selectedCleanMB = useMemo(
    () => cleanItems.filter((c) => selClean.has(c.Id)).reduce((s, c) => s + (c.SizeMB || 0), 0),
    [cleanItems, selClean],
  );

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-[#0a0e1a] text-white/90">
      {/* Top bar */}
      <header className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-white/10 bg-[#0b1120]">
        <img src={logoUrl} alt="Cboinn" className="h-9 w-9 rounded-lg shadow-lg" />
        <div className="leading-tight">
          <div className="font-bold text-[15px]">Cboinn Driver Scanner</div>
          <div className="text-[11px] text-white/45">{t('Sürücü & program güncelleyici')} · v4.6</div>
        </div>
        <div className="ml-auto flex items-center gap-3 min-w-0">
          {isElevated ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-300/90 border border-emerald-400/30 rounded-md px-2 py-1 shrink-0">
              <IconShield /> {t('Yönetici')}
            </span>
          ) : (
            <button
              onClick={relaunchAsAdmin}
              title={t('Uygulamayı yönetici (UAC) ile yeniden başlat — yükseltilmiş işlemler tek seferde, her seferinde UAC sormadan çalışır')}
              className="flex items-center gap-1.5 text-[11px] text-amber-200 border border-amber-400/40 hover:bg-amber-400/10 rounded-md px-2.5 py-1 transition-colors shrink-0"
            >
              <IconShield /> {t('Yönetici olarak yeniden başlat')}
            </button>
          )}
          <div className="text-[12px] text-white/45 truncate">
            {sysInfo ? `${sysInfo.ComputerName} · ${sysInfo.OS}` : ''}
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <nav className="w-56 shrink-0 border-r border-white/10 bg-[#0b1120] p-3 flex flex-col gap-1">
          <SideItem icon={<IconDashboard />} label={t('Genel Bakış')} active={tab === 'overview'} onClick={() => setTab('overview')} />
          <SideItem
            icon={<IconDriver />}
            label={t('Sürücü Güncellemeleri')}
            badge={driversScanned ? updates.length : undefined}
            active={tab === 'updates'}
            onClick={() => setTab('updates')}
          />
          <SideItem
            icon={<IconChip />}
            label={t('Sürücü Envanteri')}
            badge={inventory.length || undefined}
            active={tab === 'inventory'}
            onClick={() => setTab('inventory')}
          />
          <SideItem
            icon={<IconApp />}
            label={t('Programlar')}
            badge={softwareScanned ? software.length : undefined}
            active={tab === 'software'}
            onClick={() => setTab('software')}
          />
          <SideItem
            icon={<IconShield />}
            label={t('Sorunlu Aygıtlar')}
            badge={problemsScanned ? problems.length : undefined}
            active={tab === 'problems'}
            onClick={() => setTab('problems')}
          />
          <SideItem
            icon={<IconTrash />}
            label={t('Temizlik')}
            badge={cleanScanned ? cleanItems.length : undefined}
            active={tab === 'clean'}
            onClick={() => setTab('clean')}
          />
          <SideItem
            icon={<IconPackage />}
            label={t('Uygulama Yönetimi')}
            badge={installedScanned ? installed.length : undefined}
            active={tab === 'apps'}
            onClick={() => setTab('apps')}
          />
          <SideItem
            icon={<IconBackup />}
            label={t('Sürücü Deposu')}
            badge={driverStoreScanned ? driverStore.length : undefined}
            active={tab === 'driverstore'}
            onClick={() => setTab('driverstore')}
          />
          <SideItem
            icon={<IconBolt />}
            label={t('Windows Hafifletme')}
            badge={bloatScanned ? bloat.length : undefined}
            active={tab === 'debloat'}
            onClick={() => setTab('debloat')}
          />
          <SideItem
            icon={<IconUndo />}
            label={t('Geri Dönüşüm Kutusu')}
            badge={recycleScanned ? recycle.length : undefined}
            active={tab === 'recycle'}
            onClick={() => setTab('recycle')}
          />
          <SideItem
            icon={<IconDownload />}
            label={t('Kurulum Medyası')}
            active={tab === 'media'}
            onClick={() => setTab('media')}
          />
          <SideItem
            icon={<IconPulse />}
            label={t('Sistem Sağlığı')}
            active={tab === 'health'}
            onClick={() => setTab('health')}
          />
          <SideItem
            icon={<IconWrench />}
            label={t('Sistem Onarım')}
            active={tab === 'repair'}
            onClick={() => setTab('repair')}
          />
          <SideItem
            icon={<IconClock />}
            label={t('Geri Yükleme Noktaları')}
            badge={restoreScanned ? restorePoints.length : undefined}
            active={tab === 'restore'}
            onClick={() => setTab('restore')}
          />
          <SideItem
            icon={<IconNetwork />}
            label={t('Ağ Araçları')}
            active={tab === 'network'}
            onClick={() => setTab('network')}
          />
          <SideItem
            icon={<IconPower />}
            label={t('Başlangıç')}
            badge={startupScanned ? startup.length : undefined}
            active={tab === 'startup'}
            onClick={() => setTab('startup')}
          />
          <SideItem
            icon={<IconLock />}
            label={t('Gizlilik & Telemetri')}
            active={tab === 'privacy'}
            onClick={() => setTab('privacy')}
          />
          <SideItem
            icon={<IconCog />}
            label={t('Ayarlar')}
            active={tab === 'settings'}
            onClick={() => setTab('settings')}
          />
          <div className="mt-auto text-[11px] text-white/35 px-2 leading-relaxed">
            {sysInfo?.PendingReboot && (
              <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300/90">
                {t('Yeniden başlatma bekliyor.')}
              </div>
            )}
            {t('Güvenli · açık kaynaklı · ücretsiz')}
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1 min-w-0 flex flex-col p-4 gap-3">
          {tab === 'overview' && (
            <Overview
              sysInfo={sysInfo}
              driversScanned={driversScanned}
              softwareScanned={softwareScanned}
              problemsScanned={problemsScanned}
              updatesCount={updates.length}
              softwareCount={software.length}
              oldCount={oldCount}
              problemsCount={problems.length}
              missingCount={missingCount}
              cleanScanned={cleanScanned}
              cleanTotalMB={cleanTotalMB}
              busy={busy}
              onScanDrivers={scanDrivers}
              onScanSoftware={scanSoftware}
              onScanProblems={scanProblems}
              onScanClean={scanClean}
              onBackup={backupDrivers}
              onRefreshSys={() => refresh('SysInfo')}
              onExportReport={exportReport}
              onQuickMaintenance={quickMaintenance}
              onOptimize={quickOptimize}
              onAiDiagnose={runAiDiagnose}
              aiBusy={aiBusy}
              aiDiagnosis={aiDiagnosis}
              aiError={aiError}
              history={history}
            />
          )}

          {tab === 'settings' && (
            <SettingsPanel
              settings={settings}
              onChange={updateSetting}
              onScanNow={scanNow}
              onCheckUpdate={checkUpdate}
              updateText={updateText}
              updateAvailable={updateAvailable}
              onDownloadInstall={downloadInstall}
              onShowLog={showLog}
              logText={logText}
              busy={busy}
              scheduleEnabled={scheduleEnabled}
              scheduleBusy={scheduleBusy}
              onToggleSchedule={toggleSchedule}
              onExportSettings={exportSettings}
              onImportSettings={importSettings}
            />
          )}

          {tab === 'media' && (
            <MediaPanel
              usbDisks={usbDisks}
              usbScanned={usbScanned}
              selectedUsb={selectedUsb}
              onSelectUsb={setSelectedUsb}
              isoPath={isoPath}
              onPickIso={pickIso}
              onScanUsb={scanUsb}
              onMakeBootable={makeBootable}
              busy={busy}
            />
          )}

          {tab === 'health' && (
            <HealthPanel health={health} scanned={healthScanned} onScan={scanHealth} busy={busy} />
          )}

          {tab === 'repair' && (
            <RepairPanel result={repairResult} onRun={runRepair} busy={busy} />
          )}

          {tab === 'restore' && (
            <RestorePanel
              points={restorePoints}
              scanned={restoreScanned}
              onScan={scanRestore}
              onCreate={createRestore}
              busy={busy}
            />
          )}
          {tab === 'network' && (
            <NetworkPanel
              adapters={netAdapters}
              scanned={netScanned}
              onScan={scanNetwork}
              onAction={runNetAction}
              busy={busy}
            />
          )}
          {tab === 'startup' && (
            <StartupPanel items={startup} scanned={startupScanned} onScan={scanStartup} onSetState={setStartupState} busy={busy} />
          )}
          {tab === 'privacy' && (
            <PrivacyPanel
              items={privacy}
              scanned={privacyScanned}
              sel={selPrivacy}
              onToggle={togglePrivacy}
              onScan={scanPrivacy}
              onApply={applyPrivacy}
              onRevert={revertPrivacy}
              busy={busy}
            />
          )}

          {tab !== 'overview' && tab !== 'settings' && tab !== 'media' && tab !== 'health' && tab !== 'repair' && tab !== 'restore' && tab !== 'network' && tab !== 'startup' && tab !== 'privacy' && (
            <Toolbar
              query={query}
              onQuery={setQuery}
              right={
                tab === 'updates' ? (
                  <>
                    <label className="flex items-center gap-2 text-[12px] text-white/60 mr-1">
                      <input
                        type="checkbox"
                        checked={createRestorePoint}
                        onChange={(e) => setCreateRestorePoint(e.target.checked)}
                        className="accent-blue-500"
                      />
                      {t('Geri yükleme noktası')}
                    </label>
                    <Btn icon={<IconScan />} onClick={scanDrivers} disabled={busy}>
                      {t('Tara')}
                    </Btn>
                    <Btn
                      icon={<IconDownload />}
                      onClick={() => installDrivers([...selUpdates])}
                      disabled={busy || selUpdates.size === 0}
                      primary
                    >
                      {t('Seçilenleri Kur')} ({selUpdates.size})
                    </Btn>
                    <Btn
                      icon={<IconDownload />}
                      onClick={() => installDrivers(updates.map((u) => u.UpdateID))}
                      disabled={busy || updates.length === 0}
                    >
                      {t('Tümünü Kur')}
                    </Btn>
                  </>
                ) : tab === 'software' ? (
                  <>
                    <Btn icon={<IconScan />} onClick={scanSoftware} disabled={busy}>
                      {t('Tara')}
                    </Btn>
                    <Btn
                      icon={<IconDownload />}
                      onClick={() => installSoftware([...selSoftware])}
                      disabled={busy || selSoftware.size === 0}
                      primary
                    >
                      {t('Seçilenleri Güncelle')} ({selSoftware.size})
                    </Btn>
                    <Btn
                      icon={<IconDownload />}
                      onClick={() => {
                        if (window.confirm(`${software.length} ${t('programın tümü winget ile güncellenecek. Devam edilsin mi?')}`)) {
                          installSoftware([], true);
                        }
                      }}
                      disabled={busy || software.length === 0}
                    >
                      {t('Tümünü Güncelle')}
                    </Btn>
                  </>
                ) : tab === 'problems' ? (
                  <Btn icon={<IconScan />} onClick={scanProblems} disabled={busy}>
                    {t('Tara')}
                  </Btn>
                ) : tab === 'clean' ? (
                  <>
                    <span className="text-[12px] text-white/55 mr-1">
                      {t('Seçili:')} {selectedCleanMB.toFixed(1)} MB
                    </span>
                    <Btn icon={<IconScan />} onClick={scanClean} disabled={busy}>
                      {t('Tara')}
                    </Btn>
                    <Btn
                      icon={<IconTrash />}
                      onClick={() => applyClean([...selClean])}
                      disabled={busy || selClean.size === 0}
                      primary
                    >
                      {t('Seçilenleri Temizle')}
                    </Btn>
                  </>
                ) : tab === 'apps' ? (
                  <>
                    <div className="flex rounded-lg border border-white/12 overflow-hidden mr-1">
                      <button
                        onClick={() => setAppsMode('installed')}
                        className={'px-3 h-9 text-[12px] ' + (appsMode === 'installed' ? 'bg-blue-500/20 text-white' : 'text-white/55 hover:bg-white/5')}
                      >
                        {t('Yüklü')}
                      </button>
                      <button
                        onClick={() => setAppsMode('search')}
                        className={'px-3 h-9 text-[12px] ' + (appsMode === 'search' ? 'bg-blue-500/20 text-white' : 'text-white/55 hover:bg-white/5')}
                      >
                        {t('Ara & Kur')}
                      </button>
                    </div>
                    {appsMode === 'installed' ? (
                      <>
                        <Btn icon={<IconRefresh />} onClick={loadInstalled} disabled={busy}>
                          {installedScanned ? t('Yenile') : t('Listele')}
                        </Btn>
                        <Btn
                          icon={<IconTrash />}
                          onClick={() => uninstallApps([...selInstalled])}
                          disabled={busy || selInstalled.size === 0}
                          primary
                        >
                          {t('Kaldır')} ({selInstalled.size})
                        </Btn>
                      </>
                    ) : (
                      <>
                        <input
                          value={wingetQuery}
                          onChange={(e) => setWingetQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') searchApps();
                          }}
                          placeholder={t('Uygulama ara…')}
                          className="h-9 w-44 rounded-lg border border-white/10 bg-[#0f1626] px-3 text-[13px] outline-none focus:border-blue-500/50"
                        />
                        <Btn icon={<IconSearch />} onClick={searchApps} disabled={busy || !wingetQuery.trim()}>
                          {t('Ara')}
                        </Btn>
                        <Btn
                          icon={<IconDownload />}
                          onClick={() => installNewApps([...selSearch])}
                          disabled={busy || selSearch.size === 0}
                          primary
                        >
                          {t('Kur')} ({selSearch.size})
                        </Btn>
                      </>
                    )}
                  </>
                ) : tab === 'driverstore' ? (
                  <>
                    <label className="flex items-center gap-2 text-[12px] text-white/60 mr-1">
                      <input
                        type="checkbox"
                        checked={oldDriversOnly}
                        onChange={(e) => setOldDriversOnly(e.target.checked)}
                        className="accent-blue-500"
                      />
                      {t('Sadece eski kopyalar')}
                    </label>
                    <Btn icon={<IconRefresh />} onClick={scanDriverStore} disabled={busy}>
                      {driverStoreScanned ? t('Yenile') : t('Listele')}
                    </Btn>
                    <Btn
                      icon={<IconChip />}
                      onClick={() => setSelDriverStore(new Set(driverStore.filter((r) => r.Old).map((r) => r.PublishedName)))}
                      disabled={busy || driverStore.filter((r) => r.Old).length === 0}
                    >
                      {t('Eski Kopyaları Seç')}
                    </Btn>
                    <Btn
                      icon={<IconTrash />}
                      onClick={() => deleteDriverStore([...selDriverStore])}
                      disabled={busy || selDriverStore.size === 0}
                      primary
                    >
                      {t('Seçilenleri Sil')} ({selDriverStore.size})
                    </Btn>
                  </>
                ) : tab === 'debloat' ? (
                  <>
                    <Btn icon={<IconScan />} onClick={scanBloat} disabled={busy}>
                      {bloatScanned ? t('Yenile') : t('Tara')}
                    </Btn>
                    <Btn
                      icon={<IconTrash />}
                      onClick={() => removeBloat([...selBloat])}
                      disabled={busy || selBloat.size === 0}
                      primary
                    >
                      {t('Seçilenleri Kaldır')} ({selBloat.size})
                    </Btn>
                  </>
                ) : tab === 'recycle' ? (
                  <>
                    <Btn icon={<IconRefresh />} onClick={scanRecycle} disabled={busy}>
                      {recycleScanned ? t('Yenile') : t('Listele')}
                    </Btn>
                    <Btn
                      icon={<IconUndo />}
                      onClick={() => restoreRecycle([...selRecycle])}
                      disabled={busy || selRecycle.size === 0}
                      primary
                    >
                      {t('Seçilenleri Geri Yükle')} ({selRecycle.size})
                    </Btn>
                  </>
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-[12px] text-white/60 mr-1">
                      <input
                        type="checkbox"
                        checked={oldOnly}
                        onChange={(e) => setOldOnly(e.target.checked)}
                        className="accent-blue-500"
                      />
                      {t('Sadece eski (4+ yıl)')}
                    </label>
                    <Btn icon={<IconRefresh />} onClick={() => refresh('Inventory')} disabled={busy}>
                      {t('Yenile')}
                    </Btn>
                    <Btn icon={<IconBackup />} onClick={backupDrivers} disabled={busy}>
                      {t('Yedekle')}
                    </Btn>
                  </>
                )
              }
            />
          )}

          {tab === 'updates' && (
            <DataTable<UpdateRow>
              columns={updateColumns}
              rows={filteredUpdates}
              rowKey={(r) => r.UpdateID}
              selectable
              selected={selUpdates}
              onToggle={(k) => toggle(setSelUpdates, k)}
              onToggleAll={(c) => toggleAll(setSelUpdates, c, filteredUpdates.map((r) => r.UpdateID))}
              emptyText={driversScanned ? t('Güncelleme bulunamadı — sisteminiz güncel.') : t("Henüz taranmadı. 'Tara' ile başlayın.")}
            />
          )}
          {tab === 'inventory' && (
            <DataTable<InventoryRow>
              columns={inventoryColumns}
              rows={filteredInventory}
              rowKey={(r) => r.DeviceID || r.DeviceName + r.Version}
              emptyText={inventory.length ? t('Eşleşen kayıt yok.') : t('Envanter yükleniyor…')}
            />
          )}
          {tab === 'software' && (
            <DataTable<SoftwareRow>
              columns={softwareColumns}
              rows={filteredSoftware}
              rowKey={(r) => r.Id || r.Name}
              selectable
              selected={selSoftware}
              onToggle={(k) => toggle(setSelSoftware, k)}
              onToggleAll={(c) => toggleAll(setSelSoftware, c, filteredSoftware.map((r) => r.Id))}
              emptyText={softwareScanned ? t('Tüm programlar güncel.') : t("Henüz taranmadı. 'Tara' ile başlayın.")}
            />
          )}
          {tab === 'problems' && (
            <DataTable<ProblemDeviceRow>
              columns={problemColumns}
              rows={filteredProblems}
              rowKey={(r) => r.DeviceID || r.Name}
              emptyText={problemsScanned ? t('Sorunlu aygıt bulunamadı — her şey yolunda.') : t("Henüz taranmadı. 'Tara' ile başlayın.")}
            />
          )}
          {tab === 'clean' && (
            <DataTable<CleanItem>
              columns={cleanColumns}
              rows={filteredClean}
              rowKey={(r) => r.Id}
              selectable
              selected={selClean}
              onToggle={(k) => toggle(setSelClean, k)}
              onToggleAll={(c) => toggleAll(setSelClean, c, filteredClean.map((r) => r.Id))}
              emptyText={cleanScanned ? t('Temizlenecek bir şey yok.') : t("Henüz taranmadı. 'Tara' ile başlayın.")}
            />
          )}
          {tab === 'apps' && appsMode === 'installed' && (
            <DataTable<SoftwareRow>
              columns={appColumns}
              rows={filteredInstalled}
              rowKey={(r) => r.Id || r.Name}
              selectable
              selected={selInstalled}
              onToggle={(k) => toggle(setSelInstalled, k)}
              onToggleAll={(c) => toggleAll(setSelInstalled, c, filteredInstalled.map((r) => r.Id))}
              emptyText={installedScanned ? t('Program bulunamadı.') : t("Henüz listelenmedi. 'Listele' ile başlayın.")}
            />
          )}
          {tab === 'apps' && appsMode === 'search' && (
            <DataTable<SoftwareRow>
              columns={appColumns}
              rows={searchResults}
              rowKey={(r) => r.Id || r.Name}
              selectable
              selected={selSearch}
              onToggle={(k) => toggle(setSelSearch, k)}
              onToggleAll={(c) => toggleAll(setSelSearch, c, searchResults.map((r) => r.Id))}
              emptyText={searched ? t('Sonuç yok.') : t('Yukarıdaki kutudan bir uygulama arayın.')}
            />
          )}
          {tab === 'driverstore' && (
            <DataTable<DriverStoreRow>
              columns={driverStoreColumns}
              rows={filteredDriverStore}
              rowKey={(r) => r.PublishedName}
              selectable
              selected={selDriverStore}
              onToggle={(k) => toggle(setSelDriverStore, k)}
              onToggleAll={(c) => toggleAll(setSelDriverStore, c, filteredDriverStore.map((r) => r.PublishedName))}
              emptyText={driverStoreScanned ? t('Sürücü paketi bulunamadı.') : t("Henüz listelenmedi. 'Listele' ile başlayın.")}
            />
          )}
          {tab === 'debloat' && (
            <DataTable<BloatRow>
              columns={bloatColumns}
              rows={filteredBloat}
              rowKey={(r) => r.PackageFullName}
              selectable
              selected={selBloat}
              onToggle={(k) => toggle(setSelBloat, k)}
              onToggleAll={(c) => toggleAll(setSelBloat, c, filteredBloat.map((r) => r.PackageFullName))}
              emptyText={bloatScanned ? t('Kaldırılabilir hazır uygulama bulunamadı.') : t("Henüz taranmadı. 'Tara' ile başlayın.")}
            />
          )}
          {tab === 'recycle' && (
            <DataTable<RecycleRow>
              columns={recycleColumns}
              rows={filteredRecycle}
              rowKey={(r) => r.Key}
              selectable
              selected={selRecycle}
              onToggle={(k) => toggle(setSelRecycle, k)}
              onToggleAll={(c) => toggleAll(setSelRecycle, c, filteredRecycle.map((r) => r.Key))}
              emptyText={recycleScanned ? t('Geri dönüşüm kutusu boş.') : t("Henüz listelenmedi. 'Listele' ile başlayın.")}
            />
          )}
        </main>
      </div>

      {/* Status / progress bar */}
      {busy && (
        <div className="shrink-0 border-t border-white/10 bg-[#0b1120] px-4 py-2.5 flex items-center gap-3">
          <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-blue-400 spin" />
          <div className="text-[13px] text-white/80 truncate flex-1">
            {progress.message || t('Çalışıyor…')}
          </div>
          <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300"
              style={{ width: `${Math.max(3, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <div className="text-[12px] text-white/50 w-9 text-right">{Math.round(progress.percent)}%</div>
          <button
            onClick={() => window.engine.cancel()}
            className="text-[12px] text-white/50 hover:text-white/90 px-2"
          >
            {t('İptal')}
          </button>
        </div>
      )}

      {paletteOpen && (
        <CommandPalette
          onPick={(tb) => {
            setTab(tb);
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={
            'fixed bottom-4 right-4 max-w-sm rounded-xl border px-4 py-3 text-[13px] shadow-xl ' +
            (toast.kind === 'error'
              ? 'border-red-500/40 bg-red-950/80 text-red-200'
              : toast.kind === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/80 text-emerald-200'
                : 'border-white/15 bg-[#0f1626] text-white/85')
          }
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ── Helpers for selection sets ─────────────────────────────────────────
function toggle(setter: Dispatch<SetStateAction<Set<string>>>, key: string) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}
function toggleAll(
  setter: Dispatch<SetStateAction<Set<string>>>,
  checked: boolean,
  keys: string[],
) {
  setter(() => (checked ? new Set(keys) : new Set()));
}

// ── Sub-components ─────────────────────────────────────────────────────
function SideItem({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ' +
        (active ? 'bg-blue-500/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/90')
      }
    >
      <span className={active ? 'text-blue-400' : 'text-white/50'}>{icon}</span>
      <span className="truncate">{label}</span>
      {badge !== undefined && (
        <span className="ml-auto text-[11px] rounded-full bg-white/10 px-1.5 py-0.5 text-white/70">
          {badge}
        </span>
      )}
    </button>
  );
}

function Toolbar({
  query,
  onQuery,
  right,
}: {
  query: string;
  onQuery: (v: string) => void;
  right: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="relative flex-1 max-w-md">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35">
          <IconSearch />
        </span>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('Ara…')}
          className="w-full h-9 rounded-lg border border-white/10 bg-[#0f1626] pl-10 pr-3 text-[13px] outline-none focus:border-blue-500/50"
        />
      </div>
      <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">{right}</div>
    </div>
  );
}

function Btn({
  children,
  icon,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'flex items-center gap-1.5 rounded-lg px-3 h-9 text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ' +
        (primary
          ? 'bg-blue-500 hover:bg-blue-400 text-white'
          : 'border border-white/12 bg-white/5 hover:bg-white/10 text-white/85')
      }
    >
      {icon}
      {children}
    </button>
  );
}

function trendColor(score: number): string {
  if (score < 50) return '#ef4444';
  if (score < 70) return '#f59e0b';
  if (score < 90) return '#22d3ee';
  return '#34d399';
}

function fmtTrendTs(ts: number): string {
  try {
    const d = new Date(ts);
    return (
      d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }) +
      ' ' +
      d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    );
  } catch {
    return '';
  }
}

function TrendDelta({
  label,
  cur,
  prev,
  lowerBetter,
}: {
  label: string;
  cur: number;
  prev: number;
  lowerBetter: boolean;
}) {
  const d = cur - prev;
  const better = d === 0 ? null : lowerBetter ? d < 0 : d > 0;
  const cls = better === null ? 'text-white/35' : better ? 'text-emerald-400' : 'text-red-400';
  const arrow = d === 0 ? '±0' : `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`;
  return (
    <span>
      {label}: <span className="text-white/80">{cur}</span> <span className={cls}>{arrow}</span>
    </span>
  );
}

/** Sağlık skorunun zaman içindeki seyri (bağımsız SVG çizgi grafiği). */
function TrendCard({ history }: { history: HistoryEntry[] }) {
  if (!history || history.length < 2) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
        <div className="flex items-center gap-2 mb-2 text-white/70 font-semibold text-[13px]">
          <IconPulse className="text-emerald-400" />
          {t('Sağlık Trendi')}
        </div>
        <div className="text-[12px] text-white/45">
          {t('Trend grafiği için en az 2 tarama gerekli. Tek Tık Bakım veya taramaları çalıştırdıkça sağlık skorunuzun zaman içindeki değişimi burada görünecek.')}
        </div>
      </div>
    );
  }
  const data = history.slice(-30);
  const n = data.length;
  const W = 640;
  const H = 150;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (s: number) => padT + (1 - Math.max(0, Math.min(100, s)) / 100) * innerH;
  const pts = data.map((h, i) => `${x(i).toFixed(1)},${y(h.score).toFixed(1)}`).join(' ');
  const baseline = (padT + innerH).toFixed(1);
  const areaPath =
    `M ${x(0).toFixed(1)},${baseline} ` +
    data.map((h, i) => `L ${x(i).toFixed(1)},${y(h.score).toFixed(1)}`).join(' ') +
    ` L ${x(n - 1).toFixed(1)},${baseline} Z`;
  const last = data[n - 1];
  const prev = data[n - 2];
  const col = trendColor(last.score);
  const scoreDelta = last.score - prev.score;
  const scoreArrow = scoreDelta === 0 ? '±0' : `${scoreDelta > 0 ? '▲' : '▼'}${Math.abs(scoreDelta)}`;
  const scoreCls = scoreDelta === 0 ? 'text-white/40' : scoreDelta > 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
      <div className="flex items-center gap-2 mb-3 text-white/70 font-semibold text-[13px]">
        <IconPulse className="text-emerald-400" />
        {t('Sağlık Trendi')}
        <span className="text-[11px] text-white/35 font-normal">({t('son')} {n} {t('tarama')})</span>
        <span className="ml-auto text-[12px] font-normal text-white/55">
          {t('Skor:')}{' '}
          <span style={{ color: col }} className="font-semibold">
            {last.score}
          </span>{' '}
          <span className={scoreCls}>{scoreArrow}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
            <text x={4} y={y(g) + 3} fontSize={9} fill="rgba(255,255,255,0.35)">
              {g}
            </text>
          </g>
        ))}
        <path d={areaPath} fill={col} fillOpacity={0.12} />
        <polyline points={pts} fill="none" stroke={col} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(n - 1)} cy={y(last.score)} r={3.5} fill={col} />
        <text x={padL} y={H - 6} fontSize={9} fill="rgba(255,255,255,0.4)">
          {fmtTrendTs(data[0].ts)}
        </text>
        <text x={W - padR} y={H - 6} fontSize={9} fill="rgba(255,255,255,0.4)" textAnchor="end">
          {fmtTrendTs(last.ts)}
        </text>
      </svg>
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px] text-white/55">
        <TrendDelta label={t('Sürücü güncel.')} cur={last.updates} prev={prev.updates} lowerBetter />
        <TrendDelta label={t('Sorunlu aygıt')} cur={last.problems} prev={prev.problems} lowerBetter />
        <TrendDelta label={t('Eski sürücü')} cur={last.oldDrivers} prev={prev.oldDrivers} lowerBetter />
        <TrendDelta label={t('Temizlenebilir MB')} cur={last.cleanableMB} prev={prev.cleanableMB} lowerBetter />
      </div>
    </div>
  );
}

function Overview({
  sysInfo,
  driversScanned,
  softwareScanned,
  problemsScanned,
  updatesCount,
  softwareCount,
  oldCount,
  problemsCount,
  missingCount,
  cleanScanned,
  cleanTotalMB,
  busy,
  onScanDrivers,
  onScanSoftware,
  onScanProblems,
  onScanClean,
  onBackup,
  onRefreshSys,
  onExportReport,
  onQuickMaintenance,
  onOptimize,
  onAiDiagnose,
  aiBusy,
  aiDiagnosis,
  aiError,
  history,
}: {
  sysInfo: SysInfo | null;
  driversScanned: boolean;
  softwareScanned: boolean;
  problemsScanned: boolean;
  updatesCount: number;
  softwareCount: number;
  oldCount: number;
  problemsCount: number;
  missingCount: number;
  cleanScanned: boolean;
  cleanTotalMB: number;
  busy: boolean;
  onScanDrivers: () => void;
  onScanSoftware: () => void;
  onScanProblems: () => void;
  onScanClean: () => void;
  onBackup: () => void;
  onRefreshSys: () => void;
  onExportReport: () => void;
  onQuickMaintenance: () => void;
  onOptimize: () => void;
  onAiDiagnose: () => void;
  aiBusy: boolean;
  aiDiagnosis: string | null;
  aiError: string | null;
  history: HistoryEntry[];
}) {
  const anyScanned = driversScanned || softwareScanned || problemsScanned;
  const health = computeHealthScore({
    driversScanned,
    softwareScanned,
    problemsScanned,
    updatesCount,
    softwareCount,
    oldCount,
    problemsCount,
    missingCount,
    sysInfo,
  });
  const dash = ((anyScanned ? health.score : 0) / 100) * 100.5;
  return (
    <div className="flex flex-col gap-4 overflow-auto">
      {/* Sağlık skoru */}
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex items-center gap-5">
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              stroke={anyScanned ? health.color : 'rgba(255,255,255,0.15)'}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${dash} 100.5`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[20px] font-bold">
            {anyScanned ? health.score : '—'}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[12px] text-white/45">{t('Sistem Sağlık Skoru')}</div>
          <div className="text-[18px] font-semibold" style={{ color: anyScanned ? health.color : undefined }}>
            {anyScanned ? health.verdict : t('Tarama bekleniyor')}
          </div>
          <div className="text-[12px] text-white/55 mt-1">
            {anyScanned
              ? health.factors.length
                ? health.factors.join(' · ')
                : t('Sorun bulunamadı 🎉')
              : t('Sürücü / program / aygıt taraması yapınca skor hesaplanır.')}
          </div>
        </div>
        <div className="ml-auto self-start">
          <Btn
            icon={
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
                <path d="M12 2l1.8 4.9L18.7 8l-4.9 1.8L12 14l-1.8-4.2L5.3 8l4.9-1.1L12 2z" />
                <path d="M19 13l.9 2.3L22 16l-2.1.7L19 19l-.9-2.3L16 16l2.1-.7L19 13z" opacity="0.7" />
              </svg>
            }
            onClick={onAiDiagnose}
            disabled={busy || aiBusy || !anyScanned}
            primary
          >
            {aiBusy ? t('AI düşünüyor…') : t('AI Teşhisi')}
          </Btn>
        </div>
      </div>

      {/* AI teşhisi sonucu */}
      {(aiBusy || aiDiagnosis || aiError) && (
        <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-semibold text-white/85">{t('🤖 Yapay Zekâ Teşhisi')}</span>
            <span className="text-[11px] text-white/35">CBOINN AI · Cloudflare</span>
          </div>
          {aiBusy && <div className="text-[13px] text-white/55">{t('AI özetinizi inceliyor…')}</div>}
          {aiError && !aiBusy && (
            <div className="text-[13px] text-red-300">{t('Teşhis alınamadı:')} {aiError}</div>
          )}
          {aiDiagnosis && !aiBusy && (
            <div className="text-[13px] leading-relaxed text-white/80 whitespace-pre-wrap">{aiDiagnosis}</div>
          )}
          <div className="text-[11px] text-white/35 mt-3">
            {t('Yalnızca özet sayılar (skor, sayımlar, disk %, işletim sistemi) gönderilir — kişisel veri, dosya adı veya donanım kimliği gönderilmez.')}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Btn icon={<IconBolt />} onClick={onQuickMaintenance} disabled={busy} primary>
          {t('Tek Tık Bakım')}
        </Btn>
        <Btn icon={<IconRocket />} onClick={onOptimize} disabled={busy} primary>
          {t('Tek Tık Optimizasyon')}
        </Btn>
        <Btn icon={<IconScan />} onClick={onScanDrivers} disabled={busy}>
          {t('Sürücüleri Tara')}
        </Btn>
        <Btn icon={<IconScan />} onClick={onScanSoftware} disabled={busy} primary>
          {t('Programları Tara')}
        </Btn>
        <Btn icon={<IconShield />} onClick={onScanProblems} disabled={busy}>
          {t('Sorunlu Aygıtları Tara')}
        </Btn>
        <Btn icon={<IconTrash />} onClick={onScanClean} disabled={busy}>
          {t('Temizlik Taraması')}
        </Btn>
        <Btn icon={<IconBackup />} onClick={onBackup} disabled={busy}>
          {t('Sürücüleri Yedekle')}
        </Btn>
        <Btn icon={<IconRefresh />} onClick={onRefreshSys} disabled={busy}>
          {t('Sistem Bilgisini Yenile')}
        </Btn>
        <Btn icon={<IconExternal />} onClick={onExportReport} disabled={busy}>
          {t('Rapor Oluştur')}
        </Btn>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          label={t('Sürücü güncellemesi')}
          value={driversScanned ? updatesCount : '—'}
          hint={driversScanned ? 'Windows Update' : t('Henüz taranmadı')}
          accent={updatesCount > 0 ? '#22d3ee' : undefined}
        />
        <StatCard
          label={t('Program güncellemesi')}
          value={softwareScanned ? softwareCount : '—'}
          hint={softwareScanned ? 'winget' : t('Henüz taranmadı')}
          accent={softwareCount > 0 ? '#22d3ee' : undefined}
        />
        <StatCard
          label={t('İncelenecek sürücü')}
          value={oldCount}
          hint={t('4+ yıl, üretici sürücüsü')}
          accent={oldCount > 0 ? '#f59e0b' : undefined}
        />
        <StatCard
          label={t('Sorunlu / eksik aygıt')}
          value={problemsScanned ? problemsCount : '—'}
          hint={problemsScanned ? (missingCount > 0 ? `${missingCount} ${t('eksik sürücü')}` : t('Aygıt Yöneticisi')) : t('Henüz taranmadı')}
          accent={problemsCount > 0 ? '#ef4444' : undefined}
        />
        <StatCard
          label={t('Temizlenebilir alan')}
          value={cleanScanned ? `${cleanTotalMB.toFixed(0)} MB` : '—'}
          hint={cleanScanned ? t('geçici dosya + önbellek') : t('Henüz taranmadı')}
          accent={cleanTotalMB > 0 ? '#a78bfa' : undefined}
        />
        <StatCard
          label={t('Yeniden başlatma')}
          value={sysInfo ? (sysInfo.PendingReboot ? t('Bekliyor') : t('Gerekmiyor')) : '—'}
          hint={sysInfo?.PendingReboot ? sysInfo.PendingReasons : ''}
          accent={sysInfo?.PendingReboot ? '#f59e0b' : '#34d399'}
        />
      </div>

      {/* Sağlık trendi */}
      <TrendCard history={history} />

      {/* System info */}
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
        <div className="flex items-center gap-2 mb-4 text-white/70 font-semibold text-[13px]">
          <IconShield className="text-blue-400" />
          {t('Sistem Bilgisi')}
        </div>
        {sysInfo ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-[13px]">
            <Info label={t('Bilgisayar')} value={sysInfo.ComputerName} />
            <Info label={t('İşletim Sistemi')} value={`${sysInfo.OS} (${sysInfo.OSVersion})`} />
            <Info label={t('İşlemci')} value={sysInfo.CPU} />
            <Info label={t('Bellek (RAM)')} value={`${sysInfo.RAMGB} GB`} />
            <Info
              label={t('Sistem Diski')}
              value={`${sysInfo.SysDriveFreeGB} / ${sysInfo.SysDriveSizeGB} ${t('GB boş')}`}
            />
            <Info label={t('Çalışma Süresi')} value={`${sysInfo.UptimeHours} ${t('saat')}`} />
            <Info
              label={t('Ekran Kartı')}
              value={sysInfo.GPUs?.map((g) => g.Name).join(', ') || '—'}
              wide
            />
            <Info label={t('Son Açılış')} value={sysInfo.LastBoot} />
            <Info label={t('Sistem Geri Yükleme')} value={sysInfo.RestoreStatus} />
          </div>
        ) : (
          <div className="text-white/40 text-sm">{t('Sistem bilgisi yükleniyor…')}</div>
        )}
      </div>

      <div className="text-[12px] text-white/40 flex items-center gap-1.5">
        <IconExternal className="opacity-60" />
        {t('Bu araç ücretsizdir. Sürücüler Windows Update, programlar winget üzerinden — resmi kaynaklardan güncellenir.')}
      </div>
    </div>
  );
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 lg:col-span-3 min-w-0' : 'min-w-0'}>
      <div className="text-[11px] text-white/40">{label}</div>
      <div className="text-white/85 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onScanNow,
  onCheckUpdate,
  updateText,
  updateAvailable,
  onDownloadInstall,
  onShowLog,
  logText,
  busy,
  scheduleEnabled,
  scheduleBusy,
  onToggleSchedule,
  onExportSettings,
  onImportSettings,
}: {
  settings: AppSettings | null;
  onChange: (patch: Partial<AppSettings>) => void;
  onScanNow: () => void;
  onCheckUpdate: () => void;
  updateText: string | null;
  updateAvailable: boolean;
  onDownloadInstall: () => void;
  onShowLog: () => void;
  logText: string | null;
  busy: boolean;
  scheduleEnabled: boolean;
  scheduleBusy: boolean;
  onToggleSchedule: (enable: boolean) => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
}) {
  if (!settings) return <div className="text-white/40 text-sm">{t('Ayarlar yükleniyor…')}</div>;
  return (
    <div className="flex flex-col gap-4 overflow-auto max-w-2xl">
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col">
        <div className="text-white/70 font-semibold text-[13px] mb-1">{t('Otomatik Tarama')}</div>
        <ToggleRow
          label={t('Otomatik taramayı etkinleştir')}
          hint={t('Uygulama sistem tepsisinde açıkken belirli aralıklarla sürücü ve program taraması yapar.')}
          checked={settings.autoScan}
          onChange={(v) => onChange({ autoScan: v })}
        />
        <div className="flex items-center justify-between py-2.5 border-t border-white/5">
          <div className="pr-4">
            <div className="text-[13px]">{t('Tarama aralığı')}</div>
            <div className="text-[11px] text-white/40">{t('Otomatik tarama açıkken ne sıklıkla')}</div>
          </div>
          <select
            value={settings.intervalHours}
            onChange={(e) => onChange({ intervalHours: Number(e.target.value) })}
            disabled={!settings.autoScan}
            className="h-9 rounded-lg border border-white/10 bg-[#0b1120] px-3 text-[13px] outline-none focus:border-blue-500/50 disabled:opacity-40"
          >
            <option value={6}>{t('6 saat')}</option>
            <option value={12}>{t('12 saat')}</option>
            <option value={24}>{t('24 saat (günlük)')}</option>
            <option value={48}>{t('2 gün')}</option>
            <option value={168}>{t('Haftalık')}</option>
          </select>
        </div>
        <ToggleRow
          label={t('Güncelleme bildirimleri')}
          hint={t('Tarama güncelleme bulduğunda Windows bildirimi gösterir.')}
          checked={settings.notify}
          onChange={(v) => onChange({ notify: v })}
        />
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col">
        <div className="text-white/70 font-semibold text-[13px] mb-1">{t('Zamanlanmış Tarama (Görev Zamanlayıcı)')}</div>
        <ToggleRow
          label={t('Windows Görev Zamanlayıcı ile otomatik tarama')}
          hint={t('Uygulama KAPALIYKEN ve yeniden başlatma sonrası da çalışır (yukarıdaki aralık kullanılır). Kullanıcı bazında — yönetici gerekmez. Sessiz tam tarama yapıp sonucu kaydeder.')}
          checked={scheduleEnabled}
          onChange={(v) => onToggleSchedule(v)}
          disabled={scheduleBusy}
        />
        <div className="text-[11px] text-white/40 mt-1">
          {t('Aralığı değiştirdiyseniz görevi kapatıp tekrar açın (yeni aralık uygulanır).')}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col">
        <div className="text-white/70 font-semibold text-[13px] mb-1">{t('Sistem')}</div>
        <ToggleRow
          label={t('Oturum açılışında başlat')}
          hint={t("Windows'a giriş yapıldığında uygulama sistem tepsisinde otomatik başlar.")}
          checked={settings.startAtLogin}
          onChange={(v) => onChange({ startAtLogin: v })}
        />
        <ToggleRow
          label={t('Pencere kapatılınca tepsiye küçült')}
          hint={t("X'e basınca uygulama kapanmaz, sistem tepsisinde çalışmaya devam eder.")}
          checked={settings.closeToTray}
          onChange={(v) => onChange({ closeToTray: v })}
        />
        <div className="flex items-center justify-between py-2.5 border-t border-white/5">
          <div className="pr-4">
            <div className="text-[13px]">{t('Tema')}</div>
            <div className="text-[11px] text-white/40">{t('Koyu (varsayılan) veya açık')}</div>
          </div>
          <select
            value={settings.theme}
            onChange={(e) => onChange({ theme: e.target.value === 'light' ? 'light' : 'dark' })}
            className="h-9 rounded-lg border border-white/10 bg-[#0b1120] px-3 text-[13px] outline-none focus:border-blue-500/50"
          >
            <option value="dark">{t('Koyu')}</option>
            <option value="light">{t('Açık')}</option>
          </select>
        </div>
        <div className="flex items-center justify-between py-2.5 border-t border-white/5">
          <div className="pr-4">
            <div className="text-[13px]">{t('Dil')}</div>
            <div className="text-[11px] text-white/40">{LANGS.map((l) => l.label).join(' · ')}</div>
          </div>
          <select
            value={settings.lang}
            onChange={(e) => onChange({ lang: e.target.value as AppSettings['lang'] })}
            className="h-9 rounded-lg border border-white/10 bg-[#0b1120] px-3 text-[13px] outline-none focus:border-blue-500/50"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col gap-3">
        <div className="text-white/70 font-semibold text-[13px]">{t('Güncelleme & Günlük')}</div>
        <div className="flex gap-2 flex-wrap">
          <Btn icon={<IconRefresh />} onClick={onCheckUpdate} disabled={busy}>
            {t('Güncellemeleri Denetle')}
          </Btn>
          {updateAvailable && (
            <Btn icon={<IconDownload />} onClick={onDownloadInstall} disabled={busy} primary>
              {t('İndir ve Kur')}
            </Btn>
          )}
          <Btn icon={<IconExternal />} onClick={onShowLog} disabled={busy}>
            {t('Günlüğü Göster')}
          </Btn>
        </div>
        {updateText && <div className="text-[12px] text-white/60">{updateText}</div>}
        {logText && (
          <pre className="text-[11px] text-white/55 whitespace-pre-wrap break-words max-h-72 overflow-auto bg-black/30 rounded-lg p-3">
            {logText}
          </pre>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col gap-3">
        <div className="text-white/70 font-semibold text-[13px]">{t('Ayar Yedekleme')}</div>
        <div className="text-[11px] text-white/40 -mt-1">
          {t('Tüm ayarları doğrulanmış bir .json dosyasına aktarın veya başka bir bilgisayardan içe alın.')}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn icon={<IconExternal />} onClick={onExportSettings} disabled={busy}>
            {t('Dışa Aktar')}
          </Btn>
          <Btn icon={<IconDownload />} onClick={onImportSettings} disabled={busy}>
            {t('İçe Aktar')}
          </Btn>
        </div>
      </div>

      <div>
        <Btn icon={<IconScan />} onClick={onScanNow} disabled={busy} primary>
          {t('Şimdi Tam Tarama Yap')}
        </Btn>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between py-2.5 border-t border-white/5 first:border-t-0 cursor-pointer">
      <div className="pr-4">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11px] text-white/40 leading-snug">{hint}</div>}
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500 w-4 h-4 shrink-0 disabled:opacity-40"
      />
    </label>
  );
}

function MediaPanel({
  usbDisks,
  usbScanned,
  selectedUsb,
  onSelectUsb,
  isoPath,
  onPickIso,
  onScanUsb,
  onMakeBootable,
  busy,
}: {
  usbDisks: UsbDiskRow[];
  usbScanned: boolean;
  selectedUsb: number | null;
  onSelectUsb: (n: number) => void;
  isoPath: string;
  onPickIso: () => void;
  onScanUsb: () => void;
  onMakeBootable: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 overflow-auto max-w-3xl">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-200/90 leading-relaxed">
        {t("⚠️ Önyüklenebilir USB oluşturma, seçilen USB'deki tüm verileri kalıcı olarak siler. Deneyseldir; yalnızca ≤32 GB USB destekler. Daha güvenilir sonuç için")}{' '}
        <span className="underline cursor-pointer" onClick={() => window.sys.openExternal('https://rufus.ie')}>
          Rufus
        </span>{' '}
        {t('önerilir.')}
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col gap-3">
        <div className="text-white/70 font-semibold text-[13px]">{t('1 · Windows ISO indir (resmî kaynak)')}</div>
        <div className="flex gap-2 flex-wrap">
          <Btn icon={<IconExternal />} onClick={() => window.sys.openExternal('https://www.microsoft.com/software-download/windows11')}>
            {t('Windows 11 İndir')}
          </Btn>
          <Btn icon={<IconExternal />} onClick={() => window.sys.openExternal('https://www.microsoft.com/software-download/windows10')}>
            {t('Windows 10 İndir')}
          </Btn>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col gap-3">
        <div className="text-white/70 font-semibold text-[13px]">{t('2 · ISO dosyasını seç')}</div>
        <div className="flex items-center gap-3">
          <Btn icon={<IconDownload />} onClick={onPickIso} disabled={busy}>
            {t('ISO Seç…')}
          </Btn>
          <span className="text-[12px] text-white/55 truncate" title={isoPath}>
            {isoPath || t('Henüz seçilmedi')}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-white/70 font-semibold text-[13px]">{t('3 · Hedef USB diski')}</div>
          <Btn icon={<IconRefresh />} onClick={onScanUsb} disabled={busy}>
            {t("USB'leri Listele")}
          </Btn>
        </div>
        {usbDisks.length === 0 ? (
          <div className="text-[12px] text-white/40">
            {usbScanned ? t('Çıkarılabilir USB bulunamadı.') : t("Listelemek için 'USB'leri Listele'e basın.")}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {usbDisks.map((d) => (
              <label
                key={d.DiskNumber}
                className={
                  'flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ' +
                  (selectedUsb === d.DiskNumber ? 'border-blue-500/50 bg-blue-500/10' : 'border-white/10 hover:bg-white/5')
                }
              >
                <input
                  type="radio"
                  name="usb"
                  checked={selectedUsb === d.DiskNumber}
                  onChange={() => onSelectUsb(d.DiskNumber)}
                  className="accent-blue-500"
                />
                <span className="text-[13px] flex-1 truncate">
                  {d.FriendlyName || 'USB'} <span className="text-white/40">· {t('Disk')} {d.DiskNumber}</span>
                </span>
                <span className="text-[12px] text-white/55">{d.SizeGB} GB</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <Btn icon={<IconDownload />} onClick={onMakeBootable} disabled={busy || !isoPath || selectedUsb === null} primary>
          {t('Önyüklenebilir USB Oluştur')}
        </Btn>
      </div>
    </div>
  );
}

function HealthPanel({
  health,
  scanned,
  onScan,
  busy,
}: {
  health: SystemHealthData | null;
  scanned: boolean;
  onScan: () => void;
  busy: boolean;
}) {
  const healthColor = (h: string) =>
    h === 'Healthy' ? 'text-emerald-400' : h === 'Warning' ? 'text-amber-400' : h ? 'text-red-400' : 'text-white/40';
  return (
    <div className="flex flex-col gap-4 overflow-auto max-w-3xl">
      <div>
        <Btn icon={<IconRefresh />} onClick={onScan} disabled={busy} primary>
          {scanned ? t('Yeniden Kontrol Et') : t('Sağlığı Kontrol Et')}
        </Btn>
      </div>
      {!health ? (
        <div className="text-white/40 text-sm">
          {scanned ? t('Veri yok.') : t("Başlamak için 'Sağlığı Kontrol Et'e basın.")}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
            <div className="text-white/70 font-semibold text-[13px] mb-3">{t('Diskler (SMART)')}</div>
            {(health.disks ?? []).length === 0 ? (
              <div className="text-white/40 text-[13px]">{t('Disk bulunamadı.')}</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(health.disks ?? []).map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 text-[13px] border-t border-white/5 pt-2 first:border-t-0 first:pt-0"
                  >
                    <span className="flex-1 truncate">
                      {d.Name} <span className="text-white/40">· {d.Media} · {d.SizeGB} GB</span>
                    </span>
                    {d.TempC != null && <span className="text-white/55">{d.TempC}°C</span>}
                    {d.WearPct != null && <span className="text-white/55">{t('aşınma %')}{d.WearPct}</span>}
                    <span className={'font-medium ' + healthColor(d.Health)}>{d.Health || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
            <div className="text-white/70 font-semibold text-[13px] mb-3">{t('Pil')}</div>
            {health.battery ? (
              <div className="flex items-center gap-6 text-[13px]">
                <span>
                  {t('Şarj:')} <b>%{health.battery.ChargePct}</b>
                </span>
                {health.battery.WearPct != null ? (
                  <span>
                    {t('Aşınma:')}{' '}
                    <b className={health.battery.WearPct > 30 ? 'text-amber-400' : 'text-emerald-400'}>
                      %{health.battery.WearPct}
                    </b>
                  </span>
                ) : (
                  <span className="text-white/40">{t('Aşınma verisi yok')}</span>
                )}
              </div>
            ) : (
              <div className="text-white/40 text-[13px]">{t('Pil yok (masaüstü) veya okunamadı.')}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RepairPanel({
  result,
  onRun,
  busy,
}: {
  result: RepairResult | null;
  onRun: (tool: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 overflow-auto max-w-3xl">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-200/90 leading-relaxed">
        {t('⚠️ Bu araçlar yönetici izni ister ve uzun sürebilir (SFC/DISM 10–30 dk). Sistem dosyalarını onarır; işlemler güvenlidir.')}
      </div>
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col gap-3">
        <div className="text-white/70 font-semibold text-[13px]">{t('Onarım araçları')}</div>
        <div className="flex gap-2 flex-wrap">
          <Btn icon={<IconWrench />} onClick={() => onRun('sfc')} disabled={busy} primary>
            SFC /scannow
          </Btn>
          <Btn icon={<IconWrench />} onClick={() => onRun('dism')} disabled={busy}>
            DISM RestoreHealth
          </Btn>
          <Btn icon={<IconWrench />} onClick={() => onRun('chkdsk')} disabled={busy}>
            chkdsk /scan
          </Btn>
        </div>
        <div className="text-[11px] text-white/40 leading-snug">
          {t('SFC: bozuk sistem dosyalarını onarır · DISM: Windows imajını onarır · chkdsk: diski tarar (salt-okunur, güvenli).')}
        </div>
      </div>
      {result && (
        <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
          <div className="text-white/70 font-semibold text-[13px] mb-2">
            {result.tool.toUpperCase()} {t('sonucu (çıkış kodu')} {result.exit})
          </div>
          <pre className="text-[11px] text-white/60 whitespace-pre-wrap break-words max-h-72 overflow-auto bg-black/30 rounded-lg p-3">
            {result.output || t('(çıktı yok)')}
          </pre>
        </div>
      )}
    </div>
  );
}

function RestorePanel({
  points,
  scanned,
  onScan,
  onCreate,
  busy,
}: {
  points: RestoreRow[];
  scanned: boolean;
  onScan: () => void;
  onCreate: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 overflow-auto max-w-3xl">
      <div className="flex gap-2 flex-wrap">
        <Btn icon={<IconRefresh />} onClick={onScan} disabled={busy}>
          {scanned ? t('Yenile') : t('Listele')}
        </Btn>
        <Btn icon={<IconClock />} onClick={onCreate} disabled={busy} primary>
          {t('Yeni Nokta Oluştur')}
        </Btn>
        <Btn icon={<IconExternal />} onClick={() => window.sys.openPath('C:\\Windows\\System32\\rstrui.exe')}>
          {t("Sistem Geri Yükleme'yi Aç")}
        </Btn>
      </div>
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
        {points.length === 0 ? (
          <div className="text-white/40 text-[13px]">
            {scanned ? t('Geri yükleme noktası yok (Sistem Koruması kapalı olabilir).') : t("Listelemek için 'Listele'ye basın.")}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {points.map((p) => (
              <div
                key={p.Seq}
                className="flex items-center gap-3 text-[13px] border-t border-white/5 pt-2 first:border-t-0 first:pt-0"
              >
                <span className="flex-1 truncate">{p.Description}</span>
                <span className="text-white/45">{p.Created}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NetworkPanel({
  adapters,
  scanned,
  onScan,
  onAction,
  busy,
}: {
  adapters: NetworkRow[];
  scanned: boolean;
  onScan: () => void;
  onAction: (a: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 overflow-auto max-w-3xl">
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5 flex flex-col gap-3">
        <div className="text-white/70 font-semibold text-[13px]">{t('Ağ işlemleri')}</div>
        <div className="flex gap-2 flex-wrap">
          <Btn icon={<IconNetwork />} onClick={() => onAction('flushdns')} disabled={busy} primary>
            {t('DNS Önbelleğini Temizle')}
          </Btn>
          <Btn icon={<IconNetwork />} onClick={() => onAction('renew')} disabled={busy}>
            {t('IP Yenile')}
          </Btn>
          <Btn icon={<IconNetwork />} onClick={() => onAction('release')} disabled={busy}>
            {t('IP Bırak')}
          </Btn>
          <Btn icon={<IconNetwork />} onClick={() => onAction('winsock')} disabled={busy}>
            {t('Winsock Sıfırla')}
          </Btn>
        </div>
        <div className="text-[11px] text-white/40">{t('Winsock sıfırlama yeniden başlatma gerektirebilir.')}</div>
      </div>
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-white/70 font-semibold text-[13px]">{t('Ağ adaptörleri')}</div>
          <Btn icon={<IconRefresh />} onClick={onScan} disabled={busy}>
            {t('Yenile')}
          </Btn>
        </div>
        {adapters.length === 0 ? (
          <div className="text-white/40 text-[13px]">{scanned ? t('Adaptör bulunamadı.') : t("Bilgi için 'Yenile'ye basın.")}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {adapters.map((a, i) => (
              <div key={i} className="text-[13px] border-t border-white/5 pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.Name}</span>
                  <span className="text-white/40">· {a.Status}</span>
                </div>
                <div className="text-[12px] text-white/55">
                  IP: {a.IPv4 || '—'} · {t('Ağ Geçidi:')} {a.Gateway || '—'} · DNS: {a.DNS || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StartupPanel({
  items,
  scanned,
  onScan,
  onSetState,
  busy,
}: {
  items: StartupRow[];
  scanned: boolean;
  onScan: () => void;
  onSetState: (name: string, enabled: boolean) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 overflow-auto max-w-3xl">
      <div className="flex gap-2 flex-wrap">
        <Btn icon={<IconRefresh />} onClick={onScan} disabled={busy}>
          {scanned ? t('Yenile') : t('Listele')}
        </Btn>
        <Btn icon={<IconExternal />} onClick={() => window.sys.openPath('C:\\Windows\\System32\\taskmgr.exe')}>
          {t("Görev Yöneticisi'ni Aç")}
        </Btn>
      </div>
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-[12px] text-emerald-200/90">
        {t('Kullanıcı başlangıç öğeleri tek tıkla geri-alınabilir şekilde açılıp kapatılabilir (yönetici gerekmez; Görev Yöneticisi ile aynı kapı kullanılır — komut silinmez). Makine geneli (HKLM) öğeleri burada salt-okunurdur.')}
      </div>
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
        {items.length === 0 ? (
          <div className="text-white/40 text-[13px]">{scanned ? t('Başlangıç öğesi yok.') : t("Listelemek için 'Listele'ye basın.")}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-[13px] border-t border-white/5 pt-2 first:border-t-0 first:pt-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{s.Name}</span>
                    {s.Enabled === false && (
                      <span className="text-[10px] text-red-300/90 border border-red-400/30 rounded px-1.5 py-0.5 shrink-0">{t('Devre dışı')}</span>
                    )}
                    <span className="text-white/35 text-[11px] truncate">· {s.Location}</span>
                  </div>
                  <div className="text-[11px] text-white/45 truncate" title={s.Command}>
                    {s.Command}
                  </div>
                </div>
                {s.Manageable ? (
                  <button
                    onClick={() => onSetState(s.Name, s.Enabled === false)}
                    disabled={busy}
                    className={`shrink-0 text-[11px] rounded-md px-2.5 py-1 border transition-colors disabled:opacity-40 ${
                      s.Enabled === false
                        ? 'text-emerald-200 border-emerald-400/40 hover:bg-emerald-400/10'
                        : 'text-amber-200 border-amber-400/40 hover:bg-amber-400/10'
                    }`}
                  >
                    {s.Enabled === false ? t('Etkinleştir') : t('Devre dışı bırak')}
                  </button>
                ) : (
                  <span className="shrink-0 text-[10px] text-white/30" title={t('Makine geneli öğe — yalnız Görev Yöneticisi (yönetici)')}>
                    {t('salt-okunur')}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PrivacyPanel({
  items,
  scanned,
  sel,
  onToggle,
  onScan,
  onApply,
  onRevert,
  busy,
}: {
  items: PrivacyRow[];
  scanned: boolean;
  sel: Set<string>;
  onToggle: (id: string) => void;
  onScan: () => void;
  onApply: () => void;
  onRevert: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 overflow-auto max-w-3xl">
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-[12px] text-emerald-200/90">
        {t('Tüm ayarlar geri-alınabilir (kullanıcı bazında, yönetici gerekmez). "Geri Al" varsayılana döndürür.')}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Btn icon={<IconRefresh />} onClick={onScan} disabled={busy}>
          {scanned ? t('Yenile') : t('Tara')}
        </Btn>
        <Btn icon={<IconLock />} onClick={onApply} disabled={busy || sel.size === 0} primary>
          {t('Seçilenleri Uygula')} ({sel.size})
        </Btn>
        <Btn icon={<IconUndo />} onClick={onRevert} disabled={busy || sel.size === 0}>
          {t('Seçilenleri Geri Al')}
        </Btn>
      </div>
      <div className="rounded-xl border border-white/10 bg-[#0f1626] p-5">
        {items.length === 0 ? (
          <div className="text-white/40 text-[13px]">{scanned ? t('Ayar bulunamadı.') : t("Başlamak için 'Tara'ya basın.")}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {items.map((p) => (
              <label
                key={p.Id}
                className="flex items-center gap-3 py-2 border-t border-white/5 first:border-t-0 cursor-pointer"
              >
                <input type="checkbox" checked={sel.has(p.Id)} onChange={() => onToggle(p.Id)} className="accent-blue-500" />
                <span className="flex-1 text-[13px]">{p.Label}</span>
                <span className={'text-[12px] ' + (p.Applied ? 'text-emerald-400' : 'text-white/40')}>
                  {p.Applied ? t('Gizlilik açık') : t('Varsayılan')}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Column definitions ─────────────────────────────────────────────────
function CommandPalette({ onPick, onClose }: { onPick: (tab: Tab) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const items = NAV_COMMANDS.map((c) => ({ tab: c.tab, text: t(c.label) })).filter((c) =>
    c.text.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const clamped = Math.min(sel, Math.max(0, items.length - 1));
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-xl border border-white/15 bg-[#0f1626] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (items[clamped]) onPick(items[clamped].tab);
            }
          }}
          placeholder={t('Komuta git') + '…'}
          className="w-full h-12 bg-transparent px-4 text-[14px] outline-none border-b border-white/10"
        />
        <div className="max-h-[50vh] overflow-auto py-1">
          {items.length === 0 ? (
            <div className="px-4 py-3 text-[13px] text-white/40">{t('Sonuç yok')}</div>
          ) : (
            items.map((c, i) => (
              <button
                key={c.tab}
                onClick={() => onPick(c.tab)}
                onMouseEnter={() => setSel(i)}
                className={
                  'w-full text-left px-4 py-2 text-[13px] ' +
                  (i === clamped ? 'bg-blue-500/20 text-white' : 'text-white/70 hover:bg-white/5')
                }
              >
                {c.text}
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2 text-[11px] text-white/35 border-t border-white/10">
          ↑↓ {t('gez')} · ↵ {t('aç')} · Esc {t('kapat')}
        </div>
      </div>
    </div>
  );
}

const updateColumns: Column<UpdateRow>[] = [
  { key: 'MatchedDevice', header: 'Aygıt / Güncelleme', width: 2.4, render: (r) => r.MatchedDevice || r.Title },
  { key: 'Provider', header: 'Sağlayıcı', width: 1.1 },
  { key: 'DriverClass', header: 'Sınıf', width: 1 },
  { key: 'CurrentVersion', header: 'Mevcut', width: 1 },
  { key: 'NewDate', header: 'Önerilen Tarih', width: 1 },
  { key: 'SizeMB', header: 'Boyut (MB)', width: 0.8, align: 'right' },
];

const inventoryColumns: Column<InventoryRow>[] = [
  { key: 'DeviceName', header: 'Aygıt', width: 2.4 },
  { key: 'DeviceClass', header: 'Sınıf', width: 1 },
  { key: 'Provider', header: 'Sağlayıcı', width: 1.2 },
  { key: 'Version', header: 'Sürüm', width: 1 },
  { key: 'Date', header: 'Tarih', width: 0.9 },
  {
    key: 'OldText',
    header: 'İncelenmeli?',
    width: 0.9,
    render: (r) =>
      r.Old ? <span className="text-amber-400 font-medium">{t('EVET')}</span> : <span className="text-white/30">—</span>,
  },
];

const softwareColumns: Column<SoftwareRow>[] = [
  { key: 'Name', header: 'Program', width: 2.6 },
  { key: 'Id', header: 'Kimlik (winget)', width: 1.8 },
  { key: 'Version', header: 'Mevcut', width: 1 },
  {
    key: 'Available',
    header: 'Önerilen',
    width: 1,
    render: (r) => <span className="text-cyan-300">{r.Available}</span>,
  },
];

const problemColumns: Column<ProblemDeviceRow>[] = [
  { key: 'Name', header: 'Aygıt', width: 2.4 },
  { key: 'Class', header: 'Sınıf', width: 1 },
  { key: 'Problem', header: 'Sorun', width: 1.8 },
  {
    key: 'MissingText',
    header: 'Durum',
    width: 1,
    render: (r) =>
      r.Missing ? (
        <span className="text-red-400 font-medium">{t('EKSİK SÜRÜCÜ')}</span>
      ) : (
        <span className="text-amber-400">{t('Sorun')}</span>
      ),
  },
  {
    key: 'HardwareID',
    header: 'İşlem',
    width: 1.2,
    render: (r) => (
      <button
        onClick={() =>
          window.sys.openExternal(
            'https://www.catalog.update.microsoft.com/Search.aspx?q=' +
              encodeURIComponent(String(r.HardwareID || r.Name)),
          )
        }
        className="text-blue-400 hover:underline"
      >
        {t('Katalogda ara')}
      </button>
    ),
  },
];

const cleanColumns: Column<CleanItem>[] = [
  { key: 'Label', header: 'Kategori', width: 3 },
  { key: 'Count', header: 'Öğe', width: 1, align: 'right' },
  {
    key: 'SizeMB',
    header: 'Boyut (MB)',
    width: 1,
    align: 'right',
    render: (r) => {
      // Motor bozuk/eksik satır döndürürse (SizeMB yok) .toFixed çökerdi; koru.
      const mb = Number(r.SizeMB) || 0;
      return <span className={mb > 0 ? 'text-cyan-300' : 'text-white/30'}>{mb.toFixed(1)}</span>;
    },
  },
];

const appColumns: Column<SoftwareRow>[] = [
  { key: 'Name', header: 'Program', width: 2.6 },
  { key: 'Id', header: 'Kimlik (winget)', width: 2 },
  { key: 'Version', header: 'Sürüm', width: 1 },
  { key: 'Source', header: 'Kaynak', width: 0.9 },
];

const driverStoreColumns: Column<DriverStoreRow>[] = [
  { key: 'OriginalName', header: 'Sürücü (.inf)', width: 1.6 },
  { key: 'Provider', header: 'Sağlayıcı', width: 1.5 },
  { key: 'ClassName', header: 'Sınıf', width: 1.3 },
  { key: 'Version', header: 'Sürüm', width: 1.2 },
  { key: 'Date', header: 'Tarih', width: 1 },
  {
    key: 'OldText',
    header: 'Durum',
    width: 1,
    render: (r) =>
      r.Old ? (
        <span className="text-amber-400 font-medium">{t('Eski kopya')}</span>
      ) : (
        <span className="text-white/30">—</span>
      ),
  },
];

const bloatColumns: Column<BloatRow>[] = [
  { key: 'DisplayName', header: 'Uygulama', width: 2 },
  {
    key: 'Name',
    header: 'Paket',
    width: 2.4,
    render: (r) => <span className="text-white/50 text-[12px]">{r.Name}</span>,
  },
  { key: 'Version', header: 'Sürüm', width: 1 },
];

const recycleColumns: Column<RecycleRow>[] = [
  { key: 'Name', header: 'Ad', width: 2 },
  { key: 'OriginalLocation', header: 'Özgün Konum', width: 3 },
  { key: 'DateDeleted', header: 'Silinme', width: 1.4 },
  {
    key: 'SizeKB',
    header: 'Boyut (KB)',
    width: 1,
    align: 'right',
    render: (r) => <span>{(Number(r.SizeKB) || 0).toFixed(1)}</span>,
  },
];
