# Cboinn Driver Scanner

Cboinn Driver Scanner is a free Windows 10/11 utility that:

- inventories installed drivers with WMI/CIM;
- finds applicable driver updates through Windows Update Agent;
- finds application updates through Microsoft's `winget`;
- installs selected updates with clear status/result reporting;
- exports driver backups with `pnputil`;
- creates privacy-aware HTML reports.

Current version: **2.1.0**

## Download and install

Download `Cboinn-Driver-Scanner.zip` from the latest GitHub release, extract the
whole folder and run `Setup.exe`.

`Setup.exe` requests administrator approval and installs protected application
files under:

```text
%ProgramFiles%\Cboinn Driver Scanner
```

Start the application from the Start menu or desktop shortcut after setup.
Administrator approval is requested again only for operations that change
drivers, update applications or export driver packages.

## Data locations

```text
Runtime state/logs:
%LOCALAPPDATA%\Cboinn Driver Scanner\state

Driver backups:
Documents\Cboinn Driver Backups

HTML reports:
Documents\Cboinn Driver Scanner Reports
```

Uninstall preserves driver backups and HTML reports.

## Safety notes

- Windows Update matches updates against device applicability metadata.
  Review the selected update list before installation.
- Driver age is only a review hint. Some supported drivers intentionally carry
  old dates.
- When "create restore point" is enabled, driver installation stops if the
  restore point cannot be created.
- Driver and application installation cannot be force-cancelled midway.
- Release ZIP checksums are published next to the download.
- The project does not automatically trust a self-signed certificate or ask
  users to disable antivirus protection.

## Architecture

```text
DriverScanner.ps1       WPF UI and worker lifecycle
ui.xaml                 WPF layout
engine/Worker.ps1       Inventory, WUA, winget, backup and system-info engine
setupbuild/Launcher.cs  Protected-install launcher
setupbuild/Setup.cs     Installer/uninstaller
version.json            Single version source
build-setup.ps1         Launcher/setup build
build-release.ps1       Clean release ZIP + checksums
tests/Test-Scanner.ps1  Parse, XAML, build and optional runtime smoke tests
```

The UI and worker communicate through operation-scoped JSON status records.
The UI ignores stale operation IDs, detects unexpected worker exits and applies
timeouts to non-install operations.

## Build

Run from Windows PowerShell 5.1:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-Scanner.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-release.ps1
```

To run safe read-only runtime smoke tests as well:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-Scanner.ps1 -Runtime
```

## Signing

`sign-app.ps1` signs artifacts with an existing CurrentUser code-signing
certificate. It does not modify machine-wide trust stores.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\sign-app.ps1 `
  -CertificateThumbprint YOUR_THUMBPRINT `
  -ExportPublicCertificate
```

`-CreateDevCertificate` and `-InstallCurrentUserTrust` are development-only
options and should not be used as a substitute for a publicly trusted
code-signing certificate.

