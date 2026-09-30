// Differential test: random input scenarios vs. results computed by real Excel
// (see tools/gen_cases.py and tools/excel_oracle.py).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromModel, Model, Workbook } from './workbook';
import { same } from './cached.test';

const build = new URL('../../../build/', import.meta.url);
const model: Model = JSON.parse(readFileSync(new URL('model.json', build), 'utf8'));
const oracleDir = new URL('oracle/', build);
const cases = existsSync(oracleDir) ? readdirSync(oracleDir).filter((f) => f.endsWith('.json')).sort() : [];

describe.skipIf(!cases.length)('excel oracle', () => {
  it.each(cases)('%s', (name) => {
    const input = JSON.parse(readFileSync(new URL(`cases/${name}`, build), 'utf8'));
    const want: Record<string, Record<string, never>> = JSON.parse(readFileSync(new URL(name, oracleDir), 'utf8'));
    const wb = new Workbook(model);
    wb.today = 46273;
    for (const [sheet, a1, v] of input.inputs) wb.set(sheet, a1, v);
    wb.recalc();
    const bad: string[] = [];
    for (const [sheet, cells] of Object.entries(want)) {
      const si = wb.sheetIndex(sheet);
      for (const [a1, cv] of Object.entries(cells)) {
        const f = model.sheets[si].cells[a1].f!;
        if (/TODAY\(\)|TEXT\(/.test(f)) continue; // date- and locale-dependent
        const got = wb.value(si, a1);
        const exp = fromModel(cv);
        // labels built with TEXT(): Excel's decimal separator depends on the OS locale
        const label = (s: unknown) => typeof s === 'string' && /\$ [\d.,]*$/.test(s);
        if (label(got) && label(exp)) continue;
        if (!same(got, exp)) bad.push(`${sheet}!${a1} got=${String(got)} want=${String(exp)}  =${f.slice(0, 140)}`);
      }
    }
    if (bad.length) console.log(`${name}: ${bad.length} mismatches\n` + bad.slice(0, 25).join('\n'));
    expect(bad.length).toBe(0);
  });
});
