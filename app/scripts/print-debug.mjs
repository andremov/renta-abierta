import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const [base, caseFile] = process.argv.slice(2);
const inputs = {};
for (const [s, a, v] of JSON.parse(readFileSync(caseFile, 'utf8')).inputs) inputs[`${s}!${a}`] = v;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
await p.goto(base);
await p.evaluate((i) => localStorage.setItem('renta-ag2025:inputs:v1', JSON.stringify(i)), inputs);
await p.goto(`${base}#/formulario`);
await p.reload();
await p.waitForSelector('.sheet-grid');
await p.emulateMedia({ media: 'print' });
console.log(await p.evaluate(() => JSON.stringify({
  zoomVar: getComputedStyle(document.querySelector('.print-page')).getPropertyValue('--print-zoom'),
  gridZoom: getComputedStyle(document.querySelector('.sheet-grid')).zoom,
  sheets: [...document.querySelectorAll('.print-sheet')].map((s) => Math.round(s.getBoundingClientRect().height)),
  gridW: Math.round(document.querySelector('.sheet-grid').getBoundingClientRect().width),
})));
await b.close();
