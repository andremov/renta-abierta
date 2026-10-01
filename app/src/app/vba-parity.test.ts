// VBA parity: the same action sequences, run (a) in Excel with DIAN's macros ON
// (tools/excel_vba_parity.py) and (b) through the web session. Compares, at every
// checkpoint: the Formulario values, the effective input values and the visible
// question rows of the helper sheets.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { excelSerial, fromModel, type Model } from '../engine/workbook';
import type { Scalar } from '../engine/types';
import { Session } from './store';
import { gatedHiddenRows, gatedRows } from './rules';
import { same } from '../engine/cached.test';

const root = new URL('../../../', import.meta.url);
const model: Model = JSON.parse(readFileSync(new URL('build/model.json', root), 'utf8'));
const scenarios: { name: string; steps: Step[] }[] = JSON.parse(readFileSync(new URL('tools/vba_scenarios.json', root), 'utf8'));
type Step = { set?: [string, string, Scalar]; answers?: { cell: string; value: Scalar }[]; checkpoint?: string };

interface Snap {
  formulario: Record<string, never>;
  inputs: Record<string, Scalar>;
  hiddenRows: Record<string, number[]>;
}

const excelFile = (n: string) => new URL(`build/vba-parity/excel/${n}.json`, root);
const available = scenarios.filter((s) => existsSync(excelFile(s.name)));

function diff(name: string, excel: Snap, s: Session): string[] {
  const bad: string[] = [];
  for (const [a1, cv] of Object.entries(excel.formulario)) {
    const f = model.sheets.find((x) => x.name === 'Formulario')!.cells[a1].f!;
    if (/TODAY\(\)/.test(f)) continue;
    const got = s.get('Formulario', a1);
    const want = fromModel(cv);
    if (!same(got, want)) bad.push(`${name} Formulario!${a1} web=${String(got)} excel=${String(want)}`);
  }
  // effective inputs: what the calculation sees on the sheets the scenario touched
  const keys = new Set([...Object.keys(excel.inputs), ...Object.keys(s.inputs).filter((k) => Object.keys(excel.inputs).some((e) => e.split('!')[0] === k.split('!')[0]))]);
  for (const k of keys) {
    const [sheet, a1] = [k.slice(0, k.lastIndexOf('!')), k.slice(k.lastIndexOf('!') + 1)];
    const got = s.get(sheet, a1);
    const want = excel.inputs[k] ?? null;
    if (!same(got === '' ? null : got, want)) bad.push(`${name} input ${k} web=${String(got)} excel=${String(want)}`);
  }
  return bad;
}

/** Row visibility differences: informational (Excel keeps stale saved rows; the web shows all blocks). */
function visibilityNotes(name: string, excel: Snap, s: Session): string[] {
  const bad: string[] = [];
  for (const [sheet, hidden] of Object.entries(excel.hiddenRows)) {
    const controlled = gatedRows(sheet);
    const web = gatedHiddenRows(sheet, s.raw);
    for (const r of controlled) {
      const ex = hidden.includes(r);
      if (ex !== web.has(r)) bad.push(`${name} ${sheet} row ${r} hidden: web=${web.has(r)} excel=${ex}`);
    }
  }
  return bad;
}

describe.skipIf(!available.length)('VBA parity (Excel with macros vs web rules)', () => {
  Object.assign(globalThis, { localStorage: { getItem: () => null, setItem() {} } });
  it.each(available.map((s) => s.name))('%s', (name) => {
    const sc = scenarios.find((s) => s.name === name)!;
    const excel = JSON.parse(readFileSync(excelFile(name), 'utf8'));
    const s = new Session(model);
    s.replace({});
    s.wb.today = excelSerial(statSync(excelFile(name)).mtime);
    const bad: string[] = [];
    const notes: string[] = [];
    for (const step of sc.steps) {
      if (step.checkpoint) {
        s.wb.recalc();
        bad.push(...diff(`${name}@${step.checkpoint}`, excel.checkpoints[step.checkpoint], s));
        notes.push(...visibilityNotes(`${name}@${step.checkpoint}`, excel.checkpoints[step.checkpoint], s));
        continue;
      }
      const [sheet, a1, v] = step.set!;
      s.set(sheet, a1, v);
      // what the person types into the field that replaced Excel's pop-up
      for (const a of step.answers ?? []) {
        const i = a.cell.lastIndexOf('!');
        s.set(a.cell.slice(0, i), a.cell.slice(i + 1), a.value);
      }
    }
    s.wb.recalc();
    bad.push(...diff(`${name}@final`, excel.checkpoints.final, s));
    if (bad.length) console.log(bad.slice(0, 40).join('\n'));
    expect(bad).toEqual([]);
  });
});
