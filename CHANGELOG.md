# Changelog

> Beginning with the 4.x series, Cboinn Driver Scanner was rebuilt as an
> Electron + React desktop app. Entries at 2.1.0 and below refer to the earlier
> PowerShell/WPF version.

## 4.6.1 - 2026-06-28

### Added

- Three additional UI languages — German, Russian and Arabic (right-to-left) —
  for a total of five (Türkçe · English · Deutsch · Русский · العربية).
- One-Click Optimize: a full scan followed by safe temp/cache cleanup (excluding
  the Recycle Bin) and a desktop notification on completion.
- Localized, print-friendly HTML report with the system health score and a
  health-trend chart.

### Fixed

- Bootable-USB creation now verifies robocopy/DISM exit codes — a failed copy is
  no longer reported as "ready".
- Background engine processes (and their winget/pnputil children) are terminated
  when the app quits — no orphaned processes.
- Engine status writes always complete (no stuck "waiting" UI); the race between
  scheduled and foreground scans is resolved; the UI is hardened against
  malformed engine data; console output is UTF-8 so Turkish error messages render
  correctly.

## 2.1.0 - 2026-06-04

### Security

- Install application code under protected Program Files.
- Block elevated operations when launched from an unprotected folder.
- Stop modifying machine-wide Root and TrustedPublisher stores during signing.
- Validate update/package identifiers before invoking privileged operations.
- Reject reparse-point state directories.

### Reliability

- Add operation IDs, worker crash detection and timeouts.
- Write state JSON atomically and rotate worker logs.
- Preserve driver backups and reports during uninstall.
- Fail closed when a requested restore point cannot be created.
- Verify every WUA download result before installation.
- Capture winget exit codes and diagnostic output.

### Product

- Store runtime data under LocalAppData.
- Store backups and reports under Documents.
- Add local-data cleanup and report computer-name redaction.
- Add centralized version metadata, release packaging, checksums and CI.
