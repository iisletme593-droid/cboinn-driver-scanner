import type { EngineMode, RunOpts, RunResult, ProgressEvent, AppSettings, HistoryEntry } from './types';

/** Aggregate, non-identifying PC health summary sent to the AI diagnosis endpoint. */
export interface AiDiagnoseSummary {
  score: number;
  verdict: string;
  updates: number;
  problems: number;
  missing: number;
  oldDrivers: number;
  software: number;
  diskFreePct: number;
  cleanableMB: number;
  rebootPending: boolean;
  os: string;
  problemClasses: string[];
}

declare global {
  interface Window {
    engine: {
      run: (mode: EngineMode, opts?: RunOpts) => Promise<RunResult>;
      read: (file: string) => Promise<unknown>;
      cancel: () => Promise<boolean>;
      stateDir: () => Promise<string>;
      onProgress: (cb: (data: ProgressEvent) => void) => () => void;
      onBackgroundResult: (cb: (data: { updates: number; software: number }) => void) => () => void;
      readLog: () => Promise<string>;
    };
    app: {
      checkUpdate: () => Promise<{
        current?: string;
        latest?: string;
        updateAvailable?: boolean;
        url?: string;
        error?: string;
      }>;
      isElevated: () => Promise<boolean>;
      relaunchAsAdmin: () => Promise<{ ok: boolean; already?: boolean; error?: string }>;
      downloadAndInstall: () => Promise<{ ok: boolean; verified?: boolean; version?: string; error?: string }>;
      aiDiagnose: (summary: AiDiagnoseSummary) => Promise<{ ok: boolean; diagnosis?: string; error?: string }>;
      saveReport: (html: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      notify: (title: string, body: string) => Promise<boolean>;
      historyRead: () => Promise<HistoryEntry[]>;
      historyAppend: (entry: HistoryEntry) => Promise<HistoryEntry[]>;
      scheduleStatus: () => Promise<{ exists: boolean }>;
      scheduleCreate: (intervalHours: number) => Promise<{ ok: boolean; error?: string }>;
      scheduleRemove: () => Promise<{ ok: boolean; error?: string }>;
    };
    sys: {
      openExternal: (url: string) => Promise<boolean>;
      openPath: (p: string) => Promise<boolean>;
      pickFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>;
    };
    settings: {
      get: () => Promise<AppSettings>;
      set: (s: AppSettings) => Promise<AppSettings>;
      export: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      import: () => Promise<{ ok: boolean; settings?: AppSettings; error?: string }>;
    };
  }
}

export {};
