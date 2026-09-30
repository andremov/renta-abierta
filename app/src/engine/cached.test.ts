// Recalculating the untouched workbook must reproduce every value Excel cached.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromModel, Model, Workbook } from './workbook';
import { XErr, Scalar } from './types';

const model: Model = JSON.parse(readFileSync(new URL('../../../build/model.json', import.meta.url), 'utf8'));

export function same(a: Scalar, b: Scalar): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  if (a instanceof XErr && b instanceof XErr) return a.code === b.code;
  if (a === '' && b === null) return true;
  return a === b;
}

describe('cached values', () => {
  it('parses every formula and reproduces Excel results', () => {
    const wb = new Workbook(model);
    // TODAY() cached the save date
    wb.today = 46273;
    const t0 = performance.now();
    wb.recalc();
    const ms = performance.now() - t0;
    const bad: string[] = [];
    for (const [si, sh] of model.sheets.entries()) {
      for (const [a1, cell] of Object.entries(sh.cells)) {
        if (cell.f === undefined) continue;
        const got = wb.value(si, a1);
        const want = fromModel(cell.cv);
        if (!same(got, want)) bad.push(`${sh.name}!${a1}  got=${String(got)} want=${String(want)}  =${cell.f.slice(0, 120)}`);
      }
    }
    console.log(`recalc ${ms.toFixed(0)} ms, ${wb.formulas.length} formulas, cycles: ${wb.cycles().length}`);
    for (const c of wb.cycles()) console.log('  cycle:', c.slice(0, 8).join(', '), c.length > 8 ? `(+${c.length - 8})` : '');
    console.log(`${bad.length} mismatches`);
    console.log(bad.slice(0, 60).join('\n'));
    expect(bad).toEqual([]);
  });
});
