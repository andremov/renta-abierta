// Realistic taxpayer scenarios for differential testing against Excel.
// Fills pages the way a person would through the web forms: a coherent profile, valid
// dropdown values, pop-up values only when their trigger applies, and edge cases
// (late filing, audit benefit, foreign currency, losses, many records).
// usage: npx tsx scripts/gen-profiles.ts <count> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Workbook, type Model } from '../src/engine/workbook';
import { parseA1, toA1, type Scalar } from '../src/engine/types';
import { buildSpec, type Field, type Section, type TableColumn } from '../src/forms/spec';
import { ALL_PAGES, QUESTIONS } from '../src/forms/pages';
import { listOptions, validationAt, checkValidation } from '../src/app/validation';
import { inactiveKeys } from '../src/app/rules';

const [countArg = '200', outDir = '../build/cases2'] = process.argv.slice(2);
const model: Model = JSON.parse(readFileSync(new URL('../public/model.json', import.meta.url), 'utf8'));
const wb = new Workbook(model);

// deterministic PRNG
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const int = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

const PROB: Record<string, number> = {
  salario: 0.8, independiente: 0.3, pension: 0.15, intereses: 0.5, arriendos: 0.2, ventas: 0.1, dividendos: 0.15,
  venta_activos: 0.15, herencias: 0.06, premios: 0.06, seguros: 0.04, cuentas: 0.9, inversiones: 0.3, activos_fijos: 0.6,
  exterior: 0.15, otros_activos: 0.15, deudas: 0.5, vivienda: 0.25, salud: 0.3, icetex: 0.1, aportes_voluntarios: 0.3,
  gmf: 0.5, facturas: 0.4, impuestos_exterior: 0.06, donaciones: 0.08, perdidas: 0.05, ece: 0.03,
  inversiones_especiales: 0.04, correcciones: 0.04, otros_descuentos: 0.03, exentas: 0.05,
};

function moneyFor(label: string): number {
  const l = label.toLowerCase();
  let base: number;
  if (/salario|honorario|ingresos? (por|brutos)|pensi[oó]n/.test(l)) base = 2e6 + rnd() * 3e8;
  else if (/aporte|retenci[oó]n|cesant/.test(l)) base = 1e5 + rnd() * 2e7;
  else if (/aval[uú]o|compra|costo fiscal|valor (de|del) (la )?(compra|venta|adquisici)/.test(l)) base = 2e7 + rnd() * 9e8;
  else if (/inter[eé]s|rendimiento|gmf|gravamen/.test(l)) base = 1e4 + rnd() * 2e7;
  else base = 1e5 + rnd() * 1.5e8;
  if (chance(0.03)) base *= 50; // occasional very large amount
  return roundTo(base, chance(0.5) ? 1000 : 1);
}

function valueFor(sheet: string, a1: string, type: string, label: string): Scalar | undefined {
  const si = wb.sheetIndex(sheet);
  const dv = validationAt(model.sheets[si], a1);
  if (dv?.type === 'list') {
    const opts = listOptions(wb, si, a1, dv) ?? [];
    if (!opts.length) return undefined;
    const o = pick(opts);
    // options are rendered text; dates and numbers go back as numbers
    if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(o)) return Number(o.replace(/\./g, ''));
    return o;
  }
  switch (type) {
    case 'money':
      return moneyFor(label);
    case 'number':
      return /a[ñn]o/i.test(label) ? int(1990, 2025) : /mes/i.test(label) ? int(1, 12) : int(1, 30);
    case 'percent':
      return Math.round(rnd() * 100) / 100;
    case 'id':
      return int(1_000_000, 1_099_999_999);
    case 'date':
      return int(45658, 46022); // during 2025
    case 'check':
      return chance(0.3) ? 'X' : undefined;
    case 'yesno':
      return pick(['Si', 'No']);
    default:
      return /nombre|raz[oó]n|entidad|sociedad/i.test(label) ? pick(['Banco Uno', 'Comercial S.A.S.', 'Ana Pérez', 'Fiduciaria Dos']) : 'Descripción';
  }
}

function fillFields(sheet: string, fields: Field[], out: Map<string, Scalar>, density: number) {
  for (const f of fields) {
    if (f.kind !== 'input' || f.extra) continue;
    if (!chance(density)) continue;
    const v = valueFor(sheet, f.a1, f.type, f.label);
    if (v !== undefined) out.set(`${sheet}!${f.a1}`, v);
  }
}

function fillTable(sheet: string, rows: number[], cols: TableColumn[], out: Map<string, Scalar>) {
  const n = chance(0.1) ? rows.length : int(1, Math.min(4, rows.length));
  for (const r of rows.slice(0, n))
    for (const c of cols) {
      if (c.kind !== 'input') continue;
      const a1 = toA1(r, c.c);
      if (!model.sheets[wb.sheetIndex(sheet)].cells[a1]?.in) continue;
      const v = valueFor(sheet, a1, c.type, c.label);
      if (v !== undefined) out.set(`${sheet}!${a1}`, v);
    }
}

function fillSheet(sheet: string, out: Map<string, Scalar>, density: number) {
  const spec = buildSpec(model, model.sheets[wb.sheetIndex(sheet)], sheet);
  const sections: Section[] = spec.parts.flatMap((p) => ('t' in p ? p.items.slice(0, int(1, p.items.length)) : [p]));
  for (const s of sections)
    for (const b of s.blocks) {
      if (b.t === 'fields') fillFields(sheet, b.fields, out, density);
      if (b.t === 'table') fillTable(sheet, b.rows, b.columns, out);
    }
}

function scenario(n: number): [string, string, Scalar][] {
  seed = 7919 * (n + 1);
  const out = new Map<string, Scalar>();
  const yes = new Set(QUESTIONS.filter((q) => chance(PROB[q.id] ?? 0.05)).map((q) => q.id));
  for (const p of ALL_PAGES) {
    if (p.when && !p.when.some((q) => yes.has(q))) continue;
    for (const { sheet } of p.sheets) fillSheet(sheet, out, p.id === 'datos-generales' ? 0.9 : 0.7);
  }
  // general data that drives deadlines, sanctions and the advance payment
  out.set('DatosGenerales!C11', pick([1, 2, 3, 3]));
  out.set('DatosGenerales!C10', moneyFor('patrimonio'));
  out.set('DatosGenerales!E10', Math.round((out.get('DatosGenerales!C10') as number) * rnd()));
  const late = chance(0.15);
  out.set('DatosGenerales!C60', late ? int(46300, 46700) : int(46240, 46310));
  if (chance(0.1)) out.set('DatosGenerales!C12', 'X');

  // pop-up values: only when their trigger is on (as the Excel prompts would)
  const raw = (s: string, a: string) => out.get(`${s}!${a}`) ?? null;
  if ((raw('DatosGenerales', 'C11') as number) > 1) out.set('DatosGenerales!H11', moneyFor('impuesto'));
  if (raw('DatosGenerales', 'C12') === 'X') out.set('Liquidacion_Privada!H26', moneyFor('impuesto'));
  for (let r = 7; r <= 29; r++) if (raw('Inversiones', `I${r}`) === 'Otro valor' && r !== 14) out.set(`Inversiones!Q${r}`, moneyFor('valor'));
  for (let r = 7; r <= 26; r++) if (raw('Activos_Fijos', `J${r}`) === 'Otro valor') out.set(`Activos_Fijos!AT${r}`, moneyFor('valor'));
  // drop anything the rules make inactive (hidden questions, pop-ups without trigger)
  const obj = Object.fromEntries(out);
  for (const k of inactiveKeys(obj, raw)) out.delete(k);
  // Excel bug kept fixed in the web version: never generate row 14 "Otro valor" (see QUIRKS.md)
  if (raw('Inversiones', 'I14') === 'Otro valor') out.delete('Inversiones!I14');
  // drop values the workbook's own validation would reject in Excel's UI
  for (const [k, v] of [...out]) {
    const [s, a] = [k.slice(0, k.lastIndexOf('!')), k.slice(k.lastIndexOf('!') + 1)];
    const si = wb.sheetIndex(s);
    const dv = validationAt(model.sheets[si], a);
    if (dv && dv.type !== 'list' && checkValidation(wb, si, a, dv, v)) out.delete(k);
    void parseA1;
  }
  return [...out].map(([k, v]) => [k.slice(0, k.lastIndexOf('!')), k.slice(k.lastIndexOf('!') + 1), v]);
}

const count = parseInt(countArg, 10);
const dir = new URL(`${outDir.replace(/\/?$/, '/')}`, new URL('../', import.meta.url));
mkdirSync(dir, { recursive: true });
for (let n = 0; n < count; n++) {
  const inputs = scenario(n);
  writeFileSync(new URL(`profile_${String(n).padStart(3, '0')}.json`, dir), JSON.stringify({ seed: n, inputs }));
  if (n % 25 === 0) console.log(`profile_${n}: ${inputs.length} inputs`);
}
