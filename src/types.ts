// JSON contracts produced by engine/Worker.ps1 (see analysis in repo notes).

export interface InventoryRow {
  DeviceName: string;
  DeviceClass: string;
  Manufacturer: string;
  Provider: string;
  Version: string;
  Date: string;
  AgeYears: number;
  Old: boolean;
  OldText: string;
  InfName: string;
  DeviceID: string;
  HardwareIDs: string[];
}

export interface UpdateRow {
  UpdateID: string;
  Title: string;
  Provider: string;
  DriverClass: string;
  DriverModel: string;
  NewDate: string;
  CurrentVersion: string;
  CurrentDate: string;
  MatchedDevice: string;
  HardwareID: string;
  SizeMB: number;
  KB: string;
  MoreInfo: string;
  IsDownloaded: boolean;
}

export interface SoftwareRow {
  Name: string;
  Id: string;
  Version: string;
  Available: string;
  Source: string;
}

export interface ProblemDeviceRow {
  Name: string;
  Class: string;
  Manufacturer: string;
  ErrorCode: number;
  Problem: string;
  Missing: boolean;
  MissingText: string;
  HardwareID: string;
  DeviceID: string;
}

export interface CleanItem {
  Id: string;
  Label: string;
  SizeMB: number;
  Count: number;
}

export interface DriverStoreRow {
  PublishedName: string;
  OriginalName: string;
  Provider: string;
  ClassName: string;
  ClassGuid: string;
  Version: string;
  Date: string;
  Signer: string;
  Old: boolean;
  OldText: string;
}

export interface BloatRow {
  Name: string;
  DisplayName: string;
  PackageFullName: string;
  Publisher: string;
  Version: string;
}

export interface UsbDiskRow {
  DiskNumber: number;
  FriendlyName: string;
  SizeGB: number;
  PartitionStyle: string;
}

export interface DiskHealthRow {
  Name: string;
  Media: string;
  Health: string;
  SizeGB: number;
  TempC: number | null;
  WearPct: number | null;
}

export interface BatteryHealth {
  ChargePct: number;
  DesignCapacity: number | null;
  FullCapacity: number | null;
  WearPct: number | null;
}

export interface SystemHealthData {
  disks: DiskHealthRow[];
  battery: BatteryHealth | null;
}

export interface RepairResult {
  tool: string;
  exit: number;
  output: string;
}

export interface RestoreRow {
  Seq: number;
  Description: string;
  Created: string;
  Type: string;
}

export interface NetworkRow {
  Name: string;
  Status: string;
  IPv4: string;
  Gateway: string;
  DNS: string;
}

export interface StartupRow {
  Name: string;
  Command: string;
  Location: string;
  User: string;
  Scope?: string;
  Manageable?: boolean;
  Enabled?: boolean;
}

export interface PrivacyRow {
  Id: string;
  Label: string;
  Applied: boolean;
}

export interface RecycleRow {
  Name: string;
  OriginalLocation: string;
  DateDeleted: string;
  SizeKB: number;
  Key: string;
}

export interface AppSettings {
  autoScan: boolean;
  intervalHours: number;
  notify: boolean;
  startAtLogin: boolean;
  closeToTray: boolean;
  theme: 'dark' | 'light';
  lang: 'tr' | 'en' | 'de' | 'ru' | 'ar';
}

export interface GpuInfo {
  Name: string;
  DriverVersion: string;
  DriverDate: string;
  AgeYears: number;
}

export interface SysInfo {
  ComputerName: string;
  OS: string;
  OSVersion: string;
  CPU: string;
  RAMGB: number;
  GPUs: GpuInfo[];
  SysDriveFreeGB: number;
  SysDriveSizeGB: number;
  LastBoot: string;
  UptimeHours: number;
  RestoreStatus: string;
  PendingReboot: boolean;
  PendingReasons: string;
}

/** One point in the local scan-history trend (stored in userData/state/history.json). */
export interface HistoryEntry {
  ts: number;
  score: number;
  updates: number;
  problems: number;
  oldDrivers: number;
  software: number;
  cleanableMB: number;
  diskFreePct: number;
}

export interface EngineStatus {
  operationId?: string;
  phase?: string;
  message?: string;
  percent?: number;
  done?: boolean;
  error?: string;
  ts?: string;
  count?: number;
  rebootRequired?: boolean;
  succeeded?: number;
  total?: number;
  folder?: string;
  drive?: string;
}

export type EngineMode =
  | 'Inventory'
  | 'Scan'
  | 'SysInfo'
  | 'SoftwareScan'
  | 'Install'
  | 'SoftwareInstall'
  | 'BackupDrivers'
  | 'ProblemDevices'
  | 'CleanScan'
  | 'CleanApply'
  | 'SoftwareInventory'
  | 'SoftwareSearch'
  | 'SoftwareUninstall'
  | 'SoftwareInstallNew'
  | 'DriverStore'
  | 'DriverStoreDelete'
  | 'BloatScan'
  | 'BloatRemove'
  | 'RecycleList'
  | 'RecycleRestore'
  | 'UsbList'
  | 'MakeBootable'
  | 'SystemHealth'
  | 'SystemRepair'
  | 'RestoreList'
  | 'RestoreCreate'
  | 'NetworkInfo'
  | 'NetworkAction'
  | 'StartupList'
  | 'StartupSetState'
  | 'PrivacyScan'
  | 'PrivacyApply'
  | 'PrivacyRevert';

export interface RunOpts {
  updateIds?: string[];
  wingetIds?: string[];
  backupDir?: string;
  cleanCategories?: string[];
  query?: string;
  driverInfs?: string[];
  appxNames?: string[];
  restoreKeys?: string[];
  isoPath?: string;
  usbDiskNumber?: number;
  repairTool?: string;
  description?: string;
  netAction?: string;
  tweaks?: string[];
  startupName?: string;
  startupEnabled?: boolean;
  createRestorePoint?: boolean;
}

export interface RunResult {
  ok: boolean;
  error: string | null;
  status?: EngineStatus | null;
  results?: Record<string, unknown> | null;
}

export interface ProgressEvent {
  operationId: string;
  phase: string;
  message: string;
  percent: number;
}
