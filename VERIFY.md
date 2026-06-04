# Verify a release

1. Download `Cboinn-Driver-Scanner.zip` and its `.sha256` file from the same
   GitHub release.
2. Run:

```powershell
(Get-FileHash .\Cboinn-Driver-Scanner.zip -Algorithm SHA256).Hash
```

3. Confirm the result matches the value in the `.sha256` file.
4. Extract the ZIP and inspect the included `SHA256SUMS.txt` before running
   `Setup.exe`.

The public source is available in the same GitHub repository.

