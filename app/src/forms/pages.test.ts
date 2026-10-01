import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { Model } from '../engine/workbook';
import { ALL_PAGES, QUESTIONS, inputSheets } from './pages';

const model: Model = JSON.parse(readFileSync(new URL('../../public/model.json', import.meta.url), 'utf8'));

it('every input sheet belongs to exactly one page', () => {
  const placed = ALL_PAGES.flatMap((p) => p.sheets.map((s) => s.sheet));
  const dupes = placed.filter((s, i) => placed.indexOf(s) !== i);
  const missing = inputSheets(model).filter((s) => !placed.includes(s));
  const unknown = placed.filter((s) => !model.sheets.some((m) => m.name === s));
  expect({ dupes, missing, unknown }).toEqual({ dupes: [], missing: [], unknown: [] });
});

it('every page condition refers to a real question', () => {
  const ids = new Set(QUESTIONS.map((q) => q.id));
  expect(ALL_PAGES.flatMap((p) => p.when ?? []).filter((w) => !ids.has(w))).toEqual([]);
});
