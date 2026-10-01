// End-to-end smoke test on a build: CSP clean, a form input flows to the Form 210 output,
// the pop-up input appears when its trigger is set, nothing is requested from other hosts.
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(e.message));
const external = [];
page.on('request', (r) => !r.url().startsWith(base) && !r.url().startsWith('data:') && external.push(r.url()));

await page.goto(`${base}#/p/datos-generales`);
await page.waitForSelector('.step-body');
const nit = page.getByLabel('Número de Identificación Tributaria (NIT)').first();
await nit.fill('80123456');
await nit.press('Enter');
// the wizard shows a few fields per step: continue until the question appears
const years = page.getByLabel(/número de años que ha declarado/);
for (let i = 0; i < 8 && !(await years.count()); i++) {
  await page.locator('.pager .primary').click();
  await page.waitForTimeout(80);
}
await years.fill('3');
await years.press('Enter');
const popup = await page.getByLabel('Impuesto neto de renta del año 2024').count();

await page.goto(`${base}#/resultado`);
await page.waitForSelector('.results');
await page.getByLabel('Mostrar casillas en cero').check();
const box5 = await page.locator('tr', { has: page.locator('td.n', { hasText: /^5$/ }) }).locator('td').nth(2).innerText();

await page.goto(`${base}#/formulario`);
await page.waitForSelector('.sheet-grid');
const printable = (await page.locator('.print-page').innerText()).includes('80123456');
console.log(JSON.stringify({ popupShown: popup > 0, box5, printableHasNit: printable, problems, external }, null, 1));
await browser.close();
