# Security Policy

## Supported version

Only the latest GitHub release is supported.

## Trust model

- Install with `Setup.exe`. It requests administrator approval and installs
  application code under `%ProgramFiles%\Cboinn Driver Scanner`.
- Elevated driver/update operations are blocked when the UI is launched from
  an unprotected source or extracted folder.
- Runtime scan data is stored under
  `%LOCALAPPDATA%\Cboinn Driver Scanner\state`.
- Driver backups and HTML reports are stored in the user's Documents folder
  and are preserved during uninstall.
- The project never installs a self-signed certificate into machine-wide trust
  stores. Release checksums are published with every ZIP.

## Reporting a vulnerability

Do not publish exploitable details in a public issue. Report suspected
vulnerabilities through the repository's private vulnerability reporting
feature or email `contact@cboinn.com`.

Include the affected version, reproduction steps, expected behavior and impact.

