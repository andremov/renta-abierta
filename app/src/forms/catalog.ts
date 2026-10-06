// Every input of the wizard as a flat list: the "Sheet!A1" key used in backups and in the
// browser API, with the page, section and label a person sees. Published as /campos.json.
import type { Model } from '../engine/workbook';
import { toA1 } from '../engine/types';
import { sheetByName } from '../app/nav';
import { ALL_PAGES } from './pages';
import { specFor } from './steps';
import type { FieldType, Section } from './spec';

export interface CatalogEntry {
  key: string;
  page: string;
  pageTitle: string;
  /** questionnaire answers that open the page (any of them); absent = always shown */
  when?: string[];
  section: string;
  label: string;
  type: FieldType;
  /** value comes from a fixed list (see `options` in the browser API) */
  list?: boolean;
}

export function fieldCatalog(model: Model): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const p of ALL_PAGES)
    for (const { sheet, title, when } of p.sheets) {
      const sh = sheetByName(model, sheet);
      if (!sh) continue;
      const spec = specFor(model, sheet);
      const base = { page: p.id, pageTitle: title ? `${p.title} › ${title}` : p.title, when: when ?? p.when };
      const add = (a1: string, section: string, label: string, type: FieldType, list = false) => {
        const key = `${sheet}!${a1}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ key, ...base, section, label, type, ...(list ? { list } : {}) });
      };
      const walk = (s: Section) => {
        let heading = s.title;
        for (const b of s.blocks) {
          if (b.t === 'heading') heading = b.text;
          if (b.t === 'fields')
            for (const f of b.fields) if (f.kind === 'input') add(f.a1, heading, f.label, f.type, f.dv?.type === 'list');
          if (b.t === 'table') {
            b.rows.forEach((r, i) => {
              for (const c of b.columns) {
                const a1 = toA1(r, c.c);
                if (c.kind === 'input' && sh.cells[a1]?.in) add(a1, heading, `${c.label} (registro ${i + 1})`, c.type, c.type === 'select');
              }
            });
            for (const x of b.extras) add(x.cell, heading, x.label, x.kind);
          }
        }
      };
      for (const part of spec.parts) ('t' in part ? part.items : [part]).forEach(walk);
    }
  return out;
}

const cache = new WeakMap<Model, CatalogEntry[]>();
export function catalogFor(model: Model): CatalogEntry[] {
  let c = cache.get(model);
  if (!c) cache.set(model, (c = fieldCatalog(model)));
  return c;
}

const types = new WeakMap<Model, Map<string, FieldType>>();
/** The form's field type for an input key (how typed text is read). */
export function fieldType(model: Model, key: string): FieldType | undefined {
  let t = types.get(model);
  if (!t) types.set(model, (t = new Map(catalogFor(model).map((e) => [e.key, e.type]))));
  return t.get(key);
}
