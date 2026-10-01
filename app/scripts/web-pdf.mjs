// Print the web app's Formulario 210 to PDF for a test scenario (headless Chrome).
// usage: node scripts/web-pdf.mjs <baseUrl> <case.json> <out.pdf>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const [base, caseFile, out] = process.argv.slice(2);
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
await p.pdf({ path: out, format: 'Letter', printBackground: true, preferCSSPageSize: true });
console.log('wrote', out);
await b.close();
