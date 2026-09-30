// Debug helper: npx tsx src/engine/debug.ts <case> <Sheet!A1:B2> ...
// Prints engine vs Excel oracle values (and formulas) for the given ranges.
import { readFileSync, existsSync } from 'node:fs';
import { Model, Workbook } from './workbook';
import { parseA1, toA1 } from './types';

const build = new URL('../../../build/', import.meta.url);
const model: Model = JSON.parse(readFileSync(new URL('model.json', build), 'utf8'));
const [name, ...ranges] = process.argv.slice(2);
const wb = new Workbook(model);
wb.today = 46273;
const input = JSON.parse(readFileSync(new URL(`cases/${name}.json`, build), 'utf8'));
const inputs = new Map<string, unknown>();
for (const [sheet, a1, v] of input.inputs) {
  wb.set(sheet, a1, v);
  inputs.set(`${sheet}!${a1}`, v);
}
wb.recalc();
const oraclePath = new URL(`oracle/${name}.json`, build);
const oracle = existsSync(oraclePath) ? JSON.parse(readFileSync(oraclePath, 'utf8')) : {};

for (const spec of ranges) {
  const [sheet, rg] = spec.split('!');
  const [a, b = a] = rg.split(':');
  const [r1, c1] = parseA1(a);
  const [r2, c2] = parseA1(b);
  const si = wb.sheetIndex(sheet);
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) {
      const a1 = toA1(r, c);
      const cell = model.sheets[si].cells[a1];
      const got = wb.get(si, r, c);
      const ex = oracle[sheet]?.[a1];
      const inp = inputs.has(`${sheet}!${a1}`) ? ' [INPUT]' : '';
      if (got === null && !cell) continue;
      console.log(
        `${sheet}!${a1}${inp} engine=${JSON.stringify(got)}${ex !== undefined ? ` excel=${JSON.stringify(ex)}` : ''}${cell?.f ? `  =${cell.f}` : ''}`,
      );
    }
}
