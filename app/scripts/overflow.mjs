// Phone-width overflow check: page scroll width and the right-most elements.
// usage: node scripts/overflow.mjs <baseUrl> <hash> [caseFile]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const [base, hash, caseFile] = process.argv.slice(2);
const inputs = {};
if (caseFile) for (const [s, a, v] of JSON.parse(readFileSync(caseFile, 'utf8')).inputs) inputs[`${s}!${a}`] = v;

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto(base);
await p.evaluate((i) => localStorage.setItem('renta-ag2025:inputs:v1', JSON.stringify(i)), inputs);
await p.goto(`${base}#/${hash}`);
await p.reload();
await p.waitForSelector('.topbar');
const report = await p.evaluate(() => {
  const els = [...document.querySelectorAll('body *')]
    .map((e) => ({ e, right: e.getBoundingClientRect().right }))
    .sort((a, b) => b.right - a.right)
    .slice(0, 6)
    .map(({ e, right }) => `${e.tagName}.${String(e.className).slice(0, 40)} right=${Math.round(right)}`);
  return [`scrollWidth=${document.documentElement.scrollWidth} innerWidth=${innerWidth}`, ...els].join('\n');
});
console.log(report);
await b.close();
