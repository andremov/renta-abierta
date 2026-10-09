// Screenshots of the running app for visual review (headless installed Chrome, clean profile).
// usage: node scripts/shots.mjs [baseUrl] [caseFile] -- sheet1 sheet2 ...
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const sep = args.indexOf('--');
const [base = 'http://localhost:4173/', caseFile] = sep < 0 ? args : args.slice(0, sep);
const sheets = sep < 0 ? ['', 'DatosGenerales'] : args.slice(sep + 1);
const out = new URL('../../build/shots/', import.meta.url);
mkdirSync(out, { recursive: true });

let inputs = {};
if (caseFile) for (const [s, a, v] of JSON.parse(readFileSync(caseFile, 'utf8')).inputs) inputs[`${s}!${a}`] = v;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [label, viewport, scheme] of [
  ['desk', { width: 1440, height: 900 }, 'light'],
  ['dark', { width: 1440, height: 900 }, 'dark'],
  ['phone', { width: 390, height: 844 }, 'light'],
]) {
  const page = await browser.newPage({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(base);
  await page.evaluate((i) => localStorage.setItem('renta-ag2025:inputs:v1', JSON.stringify(i)), inputs);
  for (const sh of sheets) {
    await page.goto(`${base}#/${sh}`);
    await page.reload();
    await page.waitForSelector('header', { timeout: 60000 });
    await page.waitForTimeout(300);
    const file = new URL(`${(sh || 'home').replace(/[^\w-]/g, '_')}-${label}.png`, out);
    if (process.env.FULL) await page.setViewportSize({ width: viewport.width, height: Math.min(6000, await page.evaluate(() => document.querySelector('main')?.scrollHeight ?? 900) + 120) });
    await page.screenshot({ path: fileURLToPath(file), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log('shot', file.pathname.split('/').pop(), overflow ? '(PAGE OVERFLOWS HORIZONTALLY)' : '');
  }
  await page.close();
}
await browser.close();
