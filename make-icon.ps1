# make-icon.ps1 - logo.png'den COK BOYUTLU icon.ico uretir (16,24,32,48,64,128,256).
# Tek-boyutlu (sadece 256) ICO kucuk gorunumlerde (kisayol/masaustu) bos cikar; cok
# boyutlu olunca her yerde logo gorunur.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Add-Type -AssemblyName System.Drawing
$logo = Join-Path $root 'logo.png'
if (-not (Test-Path $logo)) { throw 'logo.png bulunamadi' }
$src = [System.Drawing.Image]::FromFile($logo)

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = New-Object System.Collections.Generic.List[byte[]]
foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $ratio = [Math]::Min($s / $src.Width, $s / $src.Height)
    $w = [int][Math]::Round($src.Width * $ratio)
    $h = [int][Math]::Round($src.Height * $ratio)
    $x = [int][Math]::Round(($s - $w) / 2)
    $y = [int][Math]::Round(($s - $h) / 2)
    $g.DrawImage($src, $x, $y, $w, $h)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs.Add($ms.ToArray())
    $ms.Dispose(); $bmp.Dispose()
}
$src.Dispose()

$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$n = $sizes.Count
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$n)   # ICONDIR
$offset = 6 + (16 * $n)
for ($i = 0; $i -lt $n; $i++) {
    $s = $sizes[$i]; $len = $pngs[$i].Length
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim)     # width, height (0 => 256)
    $bw.Write([byte]0); $bw.Write([byte]0)           # palette, reserved
    $bw.Write([uint16]1); $bw.Write([uint16]32)      # planes, bpp
    $bw.Write([uint32]$len); $bw.Write([uint32]$offset)
    $offset += $len
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Flush()
[IO.File]::WriteAllBytes((Join-Path $root 'icon.ico'), $out.ToArray())
$bw.Dispose(); $out.Dispose()
Write-Output ("Cok boyutlu icon.ico uretildi: {0} boyut ({1}), {2:N0} bayt" -f $n, ($sizes -join ','), (Get-Item (Join-Path $root 'icon.ico')).Length)
