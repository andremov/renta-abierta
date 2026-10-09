// Walk the wizard with Continuar to the end and back with Atrás; report the titles and any errors.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const [base, caseFile] = process.argv.slice(2);
const inputs = {};
if (caseFile) for (const [s, a, v] of JSON.parse(readFileSync(caseFile, 'utf8')).inputs) inputs[`${s}!${a}`] = v;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(base);
await p.evaluate((i) => localStorage.setItem('renta-ag2025:inputs:v1', JSON.stringify(i)), inputs);
await p.goto(`${base}#/perfil`);
await p.reload();
await p.waitForSelector('.profile');
const titles = [];
for (let i = 0; i < 200; i++) {
  const next = p.locator('[data-pager=next]');
  if (!(await next.count())) break;
  await next.click();
  await p.waitForTimeout(60);
  titles.push(await p.locator('.main h2').first().innerText());
  if (await p.locator('.results').count()) break;
}
let back = 0;
for (let i = 0; i < 200; i++) {
  const prev = p.locator('[data-pager=prev]');
  if (!(await prev.count())) break;
  await prev.click();
  await p.waitForTimeout(40);
  back++;
  if (await p.locator('.profile').count()) break;
}
console.log(JSON.stringify({ forward: titles.length, back, reachedProfileAgain: (await p.locator('.profile').count()) > 0, titles, errors }, null, 1));
await b.close();
