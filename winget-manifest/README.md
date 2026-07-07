# winget manifesti — Cboinn.DriverScanner 4.0.0

Bu klasördeki 3 YAML, paketi **winget**'e eklemek içindir.

## Gönderme adımları (senin yapman gereken)
1. `https://github.com/microsoft/winget-pkgs` deposunu fork'la.
2. Bu 3 dosyayı şu yola koy:
   `manifests/c/Cboinn/DriverScanner/4.0.0/`
3. Doğrula (isteğe bağlı, yerelde):
   `winget validate --manifest manifests/c/Cboinn/DriverScanner/4.0.0`
   `winget install --manifest manifests/c/Cboinn/DriverScanner/4.0.0` (test)
4. `microsoft/winget-pkgs`'a Pull Request aç. Otomatik bot doğrular.

Onaylanınca: `winget install Cboinn.DriverScanner`

## Notlar
- `InstallerSha256` v4.0 setup.exe'nin gerçek SHA256'sıdır (release ile eşleşir).
- `InstallerType: inno` → winget sessiz kurulum için `/VERYSILENT` kullanır.
- Yeni sürümde: PackageVersion + InstallerUrl + InstallerSha256 güncellenip yeni `<sürüm>/` klasörüyle tekrar PR.
- İmzasız installer için bot uyarı verebilir; OV/EV imza bunu da çözer.
