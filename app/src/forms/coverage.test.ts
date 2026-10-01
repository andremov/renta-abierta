// The web forms must expose every input the Excel file lets a person fill in, or the
// Form 210 could differ from Excel's. This test fails if any input cell is unreachable.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Model } from '../engine/workbook';
import { parseA1 } from '../engine/types';
import { EXTRA_INPUTS, gatedRows } from '../app/rules';
import { buildSpec, type Block, type Section } from './spec';
import { inputSheets } from './pages';

const model: Model = JSON.parse(readFileSync(new URL('../../public/model.json', import.meta.url), 'utf8'));
const INPUT_SHEETS = inputSheets(model);

/** Input cells a person can reach in Excel: unlocked, in a visible (or rule-controlled) row, left of the helper columns. */
function reachableInExcel(sheet: string): string[] {
  const sh = model.sheets.find((s) => s.name === sheet)!;
  const hidden = new Set(sh.hiddenRows);
  const gated = gatedRows(sheet);
  const cells = Object.entries(sh.cells)
    .filter(([a1, c]) => {
      if (!c.in) return false;
      const [r, col] = parseA1(a1);
      return col < 25 && (!hidden.has(r + 1) || gated.has(r + 1));
    })
    .map(([a1]) => a1);
  return [...cells, ...EXTRA_INPUTS.filter((x) => x.sheet === sheet).map((x) => x.cell)];
}

function covered(blocks: Block[], out: Set<string>) {
  for (const b of blocks) {
    if (b.t === 'fields') b.fields.forEach((f) => f.kind === 'input' && out.add(f.a1));
    if (b.t === 'table') {
      for (const r of b.rows) for (const c of b.columns) if (c.kind === 'input') out.add(`${colName(c.c)}${r + 1}`);
      b.extras.forEach((x) => out.add(x.cell));
    }
  }
}
const colName = (c: number) => {
  let s = '';
  for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
};

describe('form coverage', () => {
  it.each(INPUT_SHEETS)('%s exposes every Excel input', (sheet) => {
    const sh = model.sheets.find((s) => s.name === sheet)!;
    const spec = buildSpec(model, sh, sheet);
    const got = new Set<string>();
    for (const p of spec.parts) {
      const secs: Section[] = 't' in p ? p.items : [p];
      secs.forEach((s) => covered(s.blocks, got));
    }
    const missing = reachableInExcel(sheet).filter((a1) => !got.has(a1));
    expect(missing).toEqual([]);
  });
});
