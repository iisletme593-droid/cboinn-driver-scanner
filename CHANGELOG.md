# Changelog

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

