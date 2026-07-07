// Build a multi-size Windows .ico from the official CBOINN brand PNGs.
const mod = require('png-to-ico');
const pngToIco = mod.default || mod;
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sources = ['ico-16.png', 'ico-32.png', 'ico-48.png', 'ico-256.png'].map((f) =>
  path.join(root, 'build', f),
);

pngToIco(sources)
  .then((buf) => {
    fs.writeFileSync(path.join(root, 'build', 'icon.ico'), buf);
    console.log('icon.ico uretildi:', buf.length, 'bytes');
  })
  .catch((e) => {
    console.error('HATA', e && e.message ? e.message : e);
    process.exit(1);
  });
