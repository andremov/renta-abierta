// Headless profiling of the app with the installed Chrome (separate temporary profile).
import { chromium } from 'playwright-core';
const inputs = { 'DatosGenerales!C6': 80123456, 'DatosGenerales!C10': 260000000, 'DatosGenerales!C11': 3, 'DatosGenerales!E10': 200000000 };
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED ? false : true });
const page = await browser.newPage({ viewport: { width: 1568, height: 744 }, colorScheme: process.env.SCHEME ?? 'light' });
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await page.goto('http://localhost:5173/#/Pagos');
await page.evaluate((i) => localStorage.setItem('renta-ag2025:inputs:v1', JSON.stringify(i)), inputs);
await page.reload();
await page.waitForFunction(() => window.__session);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
const t = Date.now();
await page.evaluate(() => { location.hash = '/DatosGenerales'; });
await page.waitForSelector('.sheet-grid', { timeout: 120000 });
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
console.log('navigate ms', Date.now() - t);
for (const v of [210000000, 220000000]) {
  const t2 = Date.now();
  await page.evaluate((v) => window.__session.set('DatosGenerales', 'E10', v), v);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  console.log('edit ms', Date.now() - t2);
}
const { profile } = await cdp.send('Profiler.stop');
// aggregate self time by function
const self = new Map();
const dt = profile.timeDeltas;
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
  self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
});
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(v.toFixed(0).padStart(7), 'ms', k));
await browser.close();
