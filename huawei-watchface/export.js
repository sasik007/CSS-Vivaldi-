// Renderuje warstwy tarczy do PNG 466x466: node export.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 466, height: 466 } });
  const url = 'file://' + path.join(__dirname, 'watchface.html');
  for (const layer of ['bg', 'hour', 'minute', 'second']) {
    await p.goto(url + '?layer=' + layer);
    await p.locator('.watch').screenshot({ path: path.join(__dirname, 'png', layer + '.png'), omitBackground: layer !== 'bg' });
  }
  const pv = await b.newPage({ viewport: { width: 560, height: 600 }, deviceScaleFactor: 2 });
  await pv.goto(url); await pv.waitForTimeout(300);
  await pv.locator('.watch').screenshot({ path: path.join(__dirname, 'png', 'preview.png') });
  await b.close();
})();
