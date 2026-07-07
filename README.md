# Cboinn Driver Scanner

Cboinn Driver Scanner is a free Windows 10/11 desktop app (Electron + React) that
keeps your drivers and programs up to date and bundles a full set of system
maintenance tools — all from official sources, no sign-up.

**Current version: 4.6.1** · UI in 5 languages: Türkçe · English · Deutsch · Русский · العربية (Arabic RTL).

## Features

- **Driver updates** — inventories installed drivers (WMI/CIM) and finds
  applicable updates through the Windows Update Agent.
- **Program updates** — finds and installs application updates via `winget`.
- **Problem / missing device** detection with one-click driver install.
- **Disk cleanup** — safe temp/cache cleanup, plus a one-click **Optimize** flow
  (scan + safe cleanup + health check).
- **Driver backup** with `pnputil`, and a driver-store manager.
- **Windows debloat**, Recycle-Bin recovery, startup manager, privacy/telemetry
  tweaks.
- **System health score + trend**, system repair (SFC / DISM / chkdsk), restore
  points, network tools, and a bootable-USB creator.
- **Localized, print-friendly HTML reports** with the health score.

## Download and install

Download **`Cboinn-Driver-Scanner-Setup-4.6.1.exe`** from the
[latest release](https://github.com/iisletme593-droid/cboinn-driver-scanner/releases/latest)
and run it. It installs per-user (no administrator needed for setup); UAC is
requested only for operations that change drivers, update programs, clean
protected locations, or create bootable media. A portable build
(`Cboinn-Driver-Scanner-4.6.1-win-x64-portable.zip`) is also in the release.

The app **auto-updates** from GitHub releases with fail-closed SHA256
verification.

### Or via winget

```
winget install Cboinn.DriverScanner
```

## Data locations

```
Settings / scan history:   %APPDATA%\cboinn-driver-scanner
Engine state / logs:       %LOCALAPPDATA%\Cboinn Driver Scanner\state
```

## Architecture

- `src/` — React + TypeScript UI (Vite, Tailwind).
- `electron/` — Electron main process + preload (context-isolated, sandboxed; a
  strict CSP is set in `index.html`).
- `engine/Worker.ps1` — the PowerShell engine that performs the actual system
  operations. The main process runs it per-operation and streams progress to the
  UI through an atomic `status.json`.

## Build from source

```
npm ci
npm run build                    # vite → dist/
npx electron-builder --win --dir # → release-build/win-unpacked/
```

The distributed installer is produced by compiling `installer.iss` with
[Inno Setup](https://jrsoftware.org/isinfo.php) (it packages
`release-build/win-unpacked/`).

## Security

See [SECURITY.md](SECURITY.md). Only aggregate, non-identifying summary figures
are ever sent off-device (for the optional AI diagnosis); no personal data, file
names, or hardware identifiers leave the machine.

## License

See [LICENSE](LICENSE).
