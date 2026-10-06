// public/campos.json documents every input key for hand-made backups and the browser API.
// It must match the forms; regenerate with UPDATE_CAMPOS=1 npx vitest run catalog
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Model } from '../engine/workbook';
import { FILE_KIND } from '../app/store';
import { fieldCatalog } from './catalog';
import { QUESTIONS } from './pages';
import CASILLAS from './casillas.json';

const model: Model = JSON.parse(readFileSync(new URL('../../public/model.json', import.meta.url), 'utf8'));
const OUT = new URL('../../public/campos.json', import.meta.url);

function campos() {
  return {
    about: 'Campos de Renta abierta (formulario 210, año gravable 2025). Formato del respaldo: docs/respaldo.md en el repositorio.',
    backup: { kind: FILE_KIND, version: 1 },
    questions: QUESTIONS.map(({ id, text, advanced }) => ({ id, text, ...(advanced ? { advanced } : {}) })),
    fields: fieldCatalog(model),
    casillas: (CASILLAS as { n: number; concept: string; cell: string | null }[]).map((b) => ({
      n: b.n,
      concept: b.concept,
      cell: b.cell ? `Formulario!${b.cell}` : null,
    })),
  };
}

describe('field catalog', () => {
  const data = campos();
  it('lists each input once, with a label', () => {
    const keys = data.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(data.fields.every((f) => f.label.trim())).toBe(true);
    expect(keys).toContain('DatosGenerales!E8');
  });
  it('public/campos.json is up to date', () => {
    // one entry per line: readable diffs, a fraction of the size of indented JSON
    const list = (xs: unknown[]) => `[\n${xs.map((x) => JSON.stringify(x)).join(',\n')}\n]`;
    const text = `{\n"about": ${JSON.stringify(data.about)},\n"backup": ${JSON.stringify(data.backup)},\n"questions": ${list(data.questions)},\n"fields": ${list(data.fields)},\n"casillas": ${list(data.casillas)}\n}\n`;
    if (process.env.UPDATE_CAMPOS) writeFileSync(OUT, text);
    expect(readFileSync(OUT, 'utf8')).toBe(text);
  });
});
