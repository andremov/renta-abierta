// Navigation tree and contextual help, derived from the workbook itself.
import type { Model, ModelSheet } from '../engine/workbook';
import { parseA1 } from '../engine/types';

export interface NavNode {
  sheet: string;
  label: string;
  children: NavNode[];
}

export const FORM_SHEET = 'Formulario';

export function sheetByName(model: Model, name: string): ModelSheet | undefined {
  const u = name.toUpperCase();
  return model.sheets.find((s) => s.name.toUpperCase() === u);
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Buttons of a sheet in reading order: [target, caption]. */
function buttons(sh: ModelSheet): [string, string][] {
  return (sh.controls ?? [])
    .filter((c) => c.kind === 'button' && c.target && c.from)
    .sort((a, b) => a.from![1] - b.from![1] || a.from![0] - b.from![0])
    .map((c) => [c.target!, tidy(c.text)]);
}

export function buildNav(model: Model): NavNode[] {
  const nav = sheetByName(model, 'Navegacion')!;
  const roots: NavNode[] = [];
  for (let r = 2; r < 40; r++) {
    const label = nav.cells[`A${r}`]?.v;
    const target = nav.cells[`B${r}`]?.v;
    if (typeof label !== 'string' || typeof target !== 'string') continue;
    const sh = sheetByName(model, target);
    if (sh) roots.push({ sheet: sh.name, label: tidy(label), children: [] });
  }
  const top = new Set(roots.map((n) => n.sheet.toUpperCase()).concat(FORM_SHEET.toUpperCase()));
  const placed = new Set<string>(top);
  for (const node of roots) {
    const sh = sheetByName(model, node.sheet)!;
    for (const [target, caption] of buttons(sh)) {
      const t = sheetByName(model, target);
      if (!t || placed.has(t.name.toUpperCase())) continue;
      placed.add(t.name.toUpperCase());
      node.children.push({ sheet: t.name, label: caption || prettify(t.name), children: [] });
    }
  }
  return roots;
}

export const prettify = (name: string) => tidy(name.replace(/_/g, ' '));

/** Title for any sheet: the caption of the first button that opens it, else its name. */
export function sheetTitles(model: Model, nav: NavNode[]): Map<string, string> {
  const titles = new Map<string, string>();
  const walk = (ns: NavNode[]) =>
    ns.forEach((n) => {
      titles.set(n.sheet, n.label);
      walk(n.children);
    });
  walk(nav);
  titles.set(FORM_SHEET, 'Formulario 210');
  for (const sh of model.sheets)
    for (const [target, caption] of buttons(sh)) {
      const t = sheetByName(model, target);
      if (t && !titles.has(t.name) && caption) titles.set(t.name, caption);
    }
  return titles;
}

export interface CellHelp {
  title: string;
  text: string;
  norms: string;
}

/** Per-cell help from the sheet's AY_* table (named in the sheet's Z4 cell). */
export function helpTable(model: Model, sh: ModelSheet): Map<string, CellHelp> {
  const out = new Map<string, CellHelp>();
  const ayName = sh.cells.Z4?.v;
  const ay = typeof ayName === 'string' ? sheetByName(model, ayName) : undefined;
  if (!ay) return out;
  for (const [a1, cell] of Object.entries(ay.cells)) {
    const [r, c] = parseA1(a1);
    if (c !== 0 || r === 0 || typeof cell.v !== 'string') continue;
    const target = cell.v.replace(/\$/g, '').toUpperCase();
    const get = (col: string) => {
      const v = ay.cells[`${col}${r + 1}`]?.v;
      return typeof v === 'string' ? v.trim() : '';
    };
    out.set(target, { title: get('B'), text: get('C'), norms: get('D') });
  }
  return out;
}

/** Sheet-level legal references ("Normas relacionadas" panel). */
export function sheetNorms(sh: ModelSheet): string {
  const box = (sh.controls ?? []).find((c) => c.kind === 'textbox' && /normas/i.test(c.name));
  return box?.text.trim() ?? '';
}

/** Section introductions from the "msg" sheet. */
const SECTION_MSG: Record<string, string> = {
  DatosGenerales: 'B10',
  Patrimonio: 'B12',
  Renta_Presuntiva: 'B15',
  Liquidacion_Privada: 'B17',
  Pagos: 'B27',
};

export function sectionIntro(model: Model, sheet: string): string {
  const key = SECTION_MSG[sheet];
  const msg = sheetByName(model, 'msg');
  if (!key || !msg) return '';
  const v = msg.cells[key.replace('B', 'C')]?.v;
  return typeof v === 'string' ? v.trim() : '';
}
