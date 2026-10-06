// Filling the forms the way assistants and automation do: values set without blur, list fields
// by code, the window.rentaAbierta API, pending marks and the exógena report. Run on a build:
// node scripts/external-fill.mjs [url]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(e.message));
const out = {};
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('renta-ag2025:inputs:v1') ?? '{}'));
// what form_input-style tools do: native value setter + input/change events, no blur
const setNoBlur = (sel, value) =>
  page.evaluate(
    ([sel, value]) => {
      const el = document.querySelector(sel);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [sel, value],
  );

// landing button is a visible primary button
await page.goto(base);
const start = page.getByRole('button', { name: 'Empezar' });
await start.waitFor();
out.empezarColors = await start.evaluate((b) => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color]);
await start.click();
await page.waitForSelector('.profile');
out.profileCounter = await page.locator('.profile .actions .muted').innerText();

// five fields set without blur, then Continuar right away
await page.goto(`${base}#/p/datos-generales`);
await page.waitForSelector('[name="DatosGenerales!C6"]');
const five = { 'DatosGenerales!C6': '80123456', 'DatosGenerales!B8': 'PEREZ', 'DatosGenerales!C8': 'GOMEZ', 'DatosGenerales!D8': 'ANA', 'DatosGenerales!E8': 'FELIPE' };
for (const [k, v] of Object.entries(five)) await setNoBlur(`[name="${k}"]`, v);
await page.locator('.pager .primary').click();
await page.waitForTimeout(100);
const s1 = await stored();
out.fiveSavedOnContinue = Object.keys(five).every((k) => String(s1[k]) === five[k]);

// set without blur and just wait (debounced save)
await page.goto(`${base}#/p/datos-generales`);
await page.waitForSelector('[name="DatosGenerales!E8"]');
await setNoBlur('[name="DatosGenerales!E8"]', 'ANDRES');
await page.waitForTimeout(700);
out.savedWithoutBlur = (await stored())['DatosGenerales!E8'] === 'ANDRES';

// seccional by code, by padded text; activity code 0010
for (let i = 0; i < 4 && !(await page.locator('[name="DatosGenerales!C9"]').count()); i++) {
  await page.locator('.pager .primary').click();
  await page.waitForTimeout(150);
}
const sec = page.locator('[name="DatosGenerales!C9"]');
await sec.fill('2');
await sec.press('Tab');
out.seccionalByCode = [(await stored())['DatosGenerales!C9'], await page.locator('.field-error').count()];
await sec.fill('4   Impuestos y Aduanas de Bucaramanga  ');
await sec.press('Tab');
out.seccionalPadded = [(await stored())['DatosGenerales!C9'], await page.locator('.field-error').count()];
const act = page.locator('[name="DatosGenerales!E9"]');
await act.fill('0010');
await act.press('Tab');
out.activity0010 = [(await stored())['DatosGenerales!E9'], await page.locator('.field-error').count()];

// pending mark on a field shows on the results page
await page.locator('.field', { has: sec }).getByRole('button', { name: 'Pendiente' }).click();
await page.locator('.pending-note').fill('confirmar con el RUT');

// browser API
out.api = await page.evaluate(() => {
  const r = window.rentaAbierta;
  const bad = r.setInput('DatosGenerales!E9', '9999');
  const many = r.setInputs({ 'DatosGenerales!C10': 150000000, 'DatosGenerales!E10': '120.000.000', 'DatosGenerales!C11': 3 });
  const prior = r.setPriorYear({ 126: 1000000 });
  return {
    fields: r.fields().length,
    badRejected: bad.ok === false,
    many,
    prior,
    h11: r.getInput('DatosGenerales!H11'),
    box5: r.casillas().find((b) => b.n === 5)?.valor,
    seccionalOptions: r.options('DatosGenerales!C9').length,
  };
});
await page.goto(`${base}#/resultado`);
await page.waitForSelector('.results');
out.pendingOnResults = await page.locator('.pending li', { hasText: 'Por confirmar' }).innerText();
out.casillaAttr = await page.locator('[data-casilla]').count();

// honorarios guide
await page.goto(`${base}#/p/independiente`);
await page.waitForSelector('.step-body');
out.honorariosGuide = await page.locator('.page-guide').count();

// exógena report (CSV) next to the return
await page.goto(`${base}#/exogena`);
await page.waitForSelector('.exogena');
await page.locator('.exogena input[type=file]').setInputFiles({
  name: 'exogena.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from('NIT;Nombre o razón social;Detalle;Valor;Uso declaración sugerida\n860034313;BANCO;Saldo;1.234.567;R29\n900123456;EMPLEADOR;Salarios;45.000.000;R32\n'),
});
await page.waitForSelector('.exogena .box-section');
out.exogenaSections = await page.locator('.exogena .box-section h2').allInnerTexts();
await page.locator('.exogena .seg button', { hasText: 'Incluido' }).first().click();
out.exogenaReviewed = (await page.locator('.exogena > p.muted').innerText()).match(/\d+ revisados/)?.[0];

const campos = await page.evaluate(async (b) => (await fetch(`${b}campos.json`)).json(), base);
out.camposFields = campos.fields.length;
out.backupHasAll = await page.evaluate(() => {
  const b = JSON.parse(window.rentaAbierta.exportBackup());
  return [Object.keys(b.inputs).length > 5, Object.keys(b.pending).length, b.exogena?.rows.length];
});

console.log(JSON.stringify({ ...out, problems }, null, 1));
await browser.close();
