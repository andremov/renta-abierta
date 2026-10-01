// Differential test: input scenarios vs. results computed by real Excel.
//  - build/cases  + build/oracle : random inputs (tools/gen_cases.py), evaluated by the bare engine
//  - build/cases2 + build/oracle2: realistic profiles (scripts/gen-profiles.ts), evaluated through the
//    web app's Session, i.e. with the VBA rules layer applied exactly as for a real user
// Oracle results come from tools/excel_oracle.py (Excel with macros force-disabled).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { excelSerial, fromModel, Workbook, type Model } from './workbook';
import type { Scalar } from './types';
import { same } from './cached.test';
import { Session } from '../app/store';

const build = new URL('../../../build/', import.meta.url);
const model: Model = JSON.parse(readFileSync(new URL('model.json', build), 'utf8'));

const list = (dir: string) => {
  const u = new URL(`${dir}/`, build);
  return existsSync(u) ? readdirSync(u).filter((f) => f.endsWith('.json')).sort() : [];
};

// labels built with TEXT(): Excel's decimal separator depends on the OS locale
const label = (s: unknown) => typeof s === 'string' && /\$ [\d.,]*$/.test(s);

/**
 * Differences fail the test, except annex cells inside the iteration region (cycles and their
 * dependents) when a cycle oscillates: there Excel's result depends on its run-time chain order,
 * which the file does not record. Those are reported, and the Form 210 itself must still match.
 */
function compare(
  name: string,
  want: Record<string, Record<string, never>>,
  get: (si: number, a1: string) => Scalar,
  sheetIndex: (s: string) => number,
  region: Set<string> = new Set(),
) {
  const bad: string[] = [];
  const artifacts: string[] = [];
  for (const [sheet, cells] of Object.entries(want)) {
    const si = sheetIndex(sheet);
    for (const [a1, cv] of Object.entries(cells)) {
      const f = model.sheets[si].cells[a1].f!;
      if (/TODAY\(\)|TEXT\(/.test(f)) continue; // date- and locale-dependent
      const got = get(si, a1);
      const exp = fromModel(cv);
      if (label(got) && label(exp)) continue;
      if (same(got, exp)) continue;
      const line = `${sheet}!${a1} got=${String(got)} want=${String(exp)}  =${f.slice(0, 140)}`;
      if (sheet !== 'Formulario' && region.has(`${sheet}!${a1}`)) artifacts.push(line);
      else bad.push(line);
    }
  }
  if (artifacts.length) console.log(`${name}: ${artifacts.length} oscillation artifacts outside the form\n` + artifacts.join('\n'));
  if (bad.length) console.log(`${name}: ${bad.length} mismatches\n` + bad.slice(0, 25).join('\n'));
  return bad.length;
}

describe.skipIf(!list('oracle').length)('excel oracle: random inputs', () => {
  it.each(list('oracle'))('%s', (name) => {
    const input = JSON.parse(readFileSync(new URL(`cases/${name}`, build), 'utf8'));
    const want = JSON.parse(readFileSync(new URL(`oracle/${name}`, build), 'utf8'));
    const wb = new Workbook(model);
    wb.today = 46273;
    for (const [sheet, a1, v] of input.inputs) wb.set(sheet, a1, v);
    wb.recalc();
    expect(compare(name, want, (si, a1) => wb.value(si, a1), (s) => wb.sheetIndex(s))).toBe(0);
  });
});

describe.skipIf(!list('oracle2').length)('excel oracle: realistic profiles through the web session', () => {
  Object.assign(globalThis, { localStorage: { getItem: () => null, setItem() {} } });
  it.each(list('oracle2'))('%s', (name) => {
    const input = JSON.parse(readFileSync(new URL(`cases2/${name}`, build), 'utf8'));
    const want = JSON.parse(readFileSync(new URL(`oracle2/${name}`, build), 'utf8'));
    const s = new Session(model);
    s.replace(Object.fromEntries(input.inputs.map(([sh, a1, v]: [string, string, Scalar]) => [`${sh}!${a1}`, v])));
    // TODAY() as Excel saw it: the day the oracle file was written
    s.wb.today = excelSerial(statSync(new URL(`oracle2/${name}`, build)).mtime);
    s.wb.recalc();
    expect(compare(name, want, (si, a1) => s.wb.value(si, a1), (n) => s.wb.sheetIndex(n), s.wb.regionCells)).toBe(0);
  });
});
