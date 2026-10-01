// Derives a web form from a worksheet's structure: labels, inputs, calculated cells,
// repeating tables and repeated blocks. The workbook stays the source of truth: every
// field reads and writes a real cell, so the calculation engine is unchanged.
import type { Model, ModelCell, ModelSheet } from '../engine/workbook';
import { parseA1, toA1 } from '../engine/types';
import { validationAt, type Validation } from '../app/validation';
import { EXTRA_INPUTS, gatedRows, type ExtraInput } from '../app/rules';
import { isDateFormat, isPercentFormat, isTextFormat } from '../app/format';

export type FieldType = 'money' | 'number' | 'id' | 'percent' | 'text' | 'date' | 'select' | 'yesno' | 'check';

export interface Field {
  sheet: string;
  a1: string;
  r: number; // 0-based
  c: number;
  label: string;
  /** "input" = the person types it; "calc" = computed by the workbook, shown read-only */
  kind: 'input' | 'calc';
  type: FieldType;
  nf?: string;
  dv?: Validation | null;
  extra?: ExtraInput;
  /** 1-based row controlled by a question rule (shown only when the rule allows) */
  gatedRow?: number;
}

export interface TableColumn {
  c: number;
  label: string;
  kind: 'input' | 'calc';
  type: FieldType;
  nf?: string;
}

export type Block =
  | { t: 'heading'; text: string }
  | { t: 'text'; text: string }
  | { t: 'fields'; fields: Field[] }
  | { t: 'table'; sheet: string; columns: TableColumn[]; rows: number[]; extras: ExtraInput[] };

export interface Section {
  title: string;
  blocks: Block[];
}

/** A run of sections with the same shape (employer 1/2/3, dependent 1..5). */
export interface RepeatGroup {
  t: 'repeat';
  noun: string;
  items: Section[];
}

export interface FormSpec {
  sheet: string;
  title: string;
  intro: string;
  parts: (Section | RepeatGroup)[];
}

const HELPER_COL = 25; // column Z onward: help lookups and dropdown sources

/** Section breaks the sheet does not mark with a plain label (its heading is a formula). 1-based rows. */
const EXTRA_HEADINGS: Record<string, Record<number, string>> = {
  DatosGenerales: { 33: 'Dependiente económico 2', 51: 'Dependiente económico 5' },
};

type Item = { c: number; kind: 'L' | 'I' | 'F'; a1: string; text: string; cell?: ModelCell; extra?: ExtraInput };

const tidy = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\s*[=\-]{2,}>?\s*$/, '')
    .replace(/,?\s*pulse aqu[ií] para ingresar datos/i, '')
    .trim();
const isExplanationWord = (s: string) => /^explicaci[oó]n:?$/i.test(s.trim());

export function buildSpec(model: Model, sh: ModelSheet, title: string): FormSpec {
  currentModel = model;
  const hiddenStatic = new Set(sh.hiddenRows);
  const gated = gatedRows(sh.name);
  const extras = EXTRA_INPUTS.filter((x) => x.sheet === sh.name);
  const extraAt = new Map(extras.map((x) => [x.cell, x]));

  // merged label extents, so a header covers every column it spans
  const spanEnd = new Map<string, number>();
  for (const ref of sh.merges) {
    const [a, b] = ref.split(':');
    const [, cb] = parseA1(b);
    spanEnd.set(a, cb);
  }

  // ---- collect visible items per row
  const rows = new Map<number, Item[]>();
  const add = (r: number, it: Item) => {
    let list = rows.get(r);
    if (!list) rows.set(r, (list = []));
    list.push(it);
  };
  for (const [a1, cell] of Object.entries(sh.cells)) {
    const [r, c] = parseA1(a1);
    const x = extraAt.get(a1);
    if (c >= HELPER_COL && !x) continue;
    if (hiddenStatic.has(r + 1) && !gated.has(r + 1)) continue;
    if (x) add(r, { c, kind: 'I', a1, text: '', cell, extra: x });
    else if (cell.in) add(r, { c, kind: 'I', a1, text: '', cell });
    else if (cell.f !== undefined) add(r, { c, kind: 'F', a1, text: '', cell });
    else if (typeof cell.v === 'string' && tidy(cell.v) && !/^\d+$/.test(cell.v.trim())) add(r, { c, kind: 'L', a1, text: tidy(cell.v), cell });
  }
  for (const x of extras)
    if (!sh.cells[x.cell]) {
      const [r, c] = parseA1(x.cell);
      add(r, { c, kind: 'I', a1: x.cell, text: '', extra: x });
    }
  for (const list of rows.values()) list.sort((a, b) => a.c - b.c);
  const order = [...rows.keys()].sort((a, b) => a - b);

  const labelCovering = (r: number, c: number): string | undefined => {
    const list = rows.get(r);
    if (!list) return undefined;
    let best: Item | undefined;
    for (const it of list) {
      if (it.kind !== 'L' || it.c > c) continue;
      const end = spanEnd.get(it.a1) ?? it.c;
      if (it.c === c || end >= c) best = it;
    }
    return best?.text;
  };

  // ---- tables: >=3 consecutive rows with (mostly) the same input columns and no row labels
  const inputCols = (r: number): number[] | null => {
    const list = rows.get(r) ?? [];
    const ins = list.filter((i) => i.kind === 'I' && !i.extra);
    if (!ins.length) return null;
    if (list.some((i) => i.kind === 'L' && i.c < ins[0].c)) return null;
    return ins.map((i) => i.c);
  };
  const similar = (a: number[], b: number[]) => {
    const sa = new Set(a);
    const inter = b.filter((x) => sa.has(x)).length;
    return inter / new Set([...a, ...b]).size >= 0.6;
  };
  const tableOf = new Map<number, number>(); // row -> first row of its table
  for (let i = 0; i < order.length; ) {
    const s0 = inputCols(order[i]);
    let j = i + 1;
    while (s0 && j < order.length && order[j] === order[j - 1] + 1) {
      const sj = inputCols(order[j]);
      if (!sj || !similar(s0, sj)) break;
      j++;
    }
    if (s0 && j - i >= 3) for (let k = i; k < j; k++) tableOf.set(order[k], order[i]);
    i = Math.max(j, i + 1);
  }
  /** The heading row of a table: nearest row above with 2+ labels and no inputs. */
  const tableHeaderRow = (t0: number): number | undefined => {
    for (let k = t0 - 1; k >= Math.max(0, t0 - 10); k--) {
      const list = rows.get(k);
      if (!list) continue;
      if (list.filter((i) => i.kind === 'L').length >= 2 && !list.some((i) => i.kind === 'I')) return k;
    }
    return undefined;
  };

  // header rows: label-only rows directly above inputs that lack a left label
  const headerRows = new Set<number>();
  for (const r of order) {
    const list = rows.get(r)!;
    if (list.some((i) => i.kind !== 'L')) continue;
    const next = order.find((x) => x > r);
    if (next === undefined || next - r > 2) continue;
    const nl = rows.get(next)!;
    const firstIn = nl.findIndex((i) => i.kind === 'I');
    if (firstIn < 0) continue;
    if (tableOf.get(next) === next || !nl.slice(0, firstIn).some((i) => i.kind === 'L')) headerRows.add(r);
  }
  const headerAbove = (r: number, c: number): string | undefined => {
    for (let k = r - 1; k >= Math.max(0, r - 4); k--) {
      if (!rows.has(k)) continue;
      const l = labelCovering(k, c);
      if (l) return l;
      if (!headerRows.has(k)) break;
    }
    return undefined;
  };

  // ---- walk rows into blocks
  let intro = '';
  const sections: Section[] = [{ title: '', blocks: [] }];
  const cur = () => sections[sections.length - 1];
  const pushFields = (fs: Field[]) => {
    if (!fs.length) return;
    const last = cur().blocks[cur().blocks.length - 1];
    if (last?.t === 'fields') last.fields.push(...fs);
    else cur().blocks.push({ t: 'fields', fields: fs });
  };
  const fieldOf = (it: Item, r: number, label: string, kind: 'input' | 'calc'): Field => {
    const dv = kind === 'input' ? validationAt(sh, it.a1) : null;
    const f: Field = {
      sheet: sh.name,
      a1: it.a1,
      r,
      c: it.c,
      label: it.extra ? it.extra.label : label,
      kind,
      type: it.extra ? (it.extra.kind === 'percent' ? 'number' : 'money') : inferType(it.cell?.nf, dv, label),
      nf: it.extra ? (it.extra.kind === 'money' ? '"$"\\ #,##0' : '0') : it.cell?.nf,
      dv,
      extra: it.extra,
    };
    if (gated.has(r + 1)) f.gatedRow = r + 1;
    return f;
  };

  let firstTitle = true;
  const extraHeadings = EXTRA_HEADINGS[sh.name] ?? {};
  for (let idx = 0; idx < order.length; idx++) {
    const r = order[idx];
    const list = rows.get(r)!;
    if (extraHeadings[r + 1]) sections.push({ title: extraHeadings[r + 1], blocks: [] });
    const t0 = tableOf.get(r);
    if (t0 !== undefined) {
      if (t0 !== r) continue;
      const dataRows = order.filter((x) => tableOf.get(x) === t0);
      const hdr = tableHeaderRow(t0);
      const byCol = new Map<number, Item>();
      for (const dr of dataRows)
        for (const it of rows.get(dr)!) {
          if (it.kind === 'L' || it.extra) continue;
          const prev = byCol.get(it.c);
          if (!prev || (prev.kind === 'F' && it.kind === 'I')) byCol.set(it.c, it);
        }
      const cols = [...byCol.values()].sort((a, b) => a.c - b.c);
      const firstInput = cols.find((i) => i.kind === 'I')!.c;
      const lastInput = Math.max(...cols.filter((i) => i.kind === 'I').map((i) => i.c));
      const lastCol = cols.find((i) => i.kind === 'F' && i.c > lastInput)?.c ?? lastInput;
      const columns: TableColumn[] = [];
      for (const it of cols) {
        if (it.c < firstInput || it.c > lastCol) continue;
        let label = hdr !== undefined ? (labelCovering(hdr, it.c) ?? (hdr > 0 ? labelCovering(hdr - 1, it.c) : undefined)) : undefined;
        label ??= headerAbove(t0, it.c);
        const kind = it.kind === 'I' ? 'input' : 'calc';
        if (!label) {
          if (kind === 'calc') continue; // unlabeled helper columns
          const dv = validationAt(sh, it.a1);
          label = tidy(dv?.promptTitle || dv?.prompt?.slice(0, 60) || `Dato ${columns.length + 1}`);
        }
        const dv = kind === 'input' ? validationAt(sh, it.a1) : null;
        columns.push({ c: it.c, label, kind, type: kind === 'calc' ? 'money' : inferType(it.cell?.nf, dv, label), nf: it.cell?.nf });
      }
      // calc columns that just repeat an input are noise; keep inputs + headed calcs
      const tExtras = extras.filter((x) => dataRows.includes(parseA1(x.cell)[0]));
      cur().blocks.push({ t: 'table', sheet: sh.name, columns, rows: dataRows, extras: tExtras });
      continue;
    }
    if (headerRows.has(r)) continue;

    const hasData = list.some((i) => i.kind !== 'L');
    if (!hasData) {
      // text-only row: title, heading, explanation or note
      const texts = list.filter((i) => !(i.c === 0 && list.length > 1)).map((i) => i.text);
      const useful = texts.filter((t) => !isExplanationWord(t));
      const text = useful.find((t) => t.length > 160) ?? useful[0] ?? '';
      if (!text) continue;
      if (firstTitle) {
        firstTitle = false;
        continue; // sheet title, e.g. "2.1.3. Efectivo, bancos…" (we show our own title)
      }
      if (text.length > 160 || /^(advertencia|nota|importante)\b/i.test(text) || text.length > 120) {
        if (!intro && sections.length === 1 && !cur().blocks.length) intro = text;
        else cur().blocks.push({ t: 'text', text });
      } else if (/^totales?$/i.test(text)) {
        continue;
      } else {
        sections.push({ title: cleanHeading(text), blocks: [] });
      }
      continue;
    }

    const fs: Field[] = [];
    let pending: string | undefined;
    for (const it of list) {
      if (it.kind === 'L') {
        if (it.c === 0) continue; // column A holds margin captions and list sources
        pending = pending && it.text.length > 120 ? pending : it.text;
        continue;
      }
      if (it.kind === 'I') {
        const label = pending ?? headerAbove(r, it.c) ?? `Casilla ${it.a1}`;
        fs.push(fieldOf(it, r, label, 'input'));
        pending = undefined;
      } else if (pending) {
        // calculated value next to its label; numbered captions are headings, not values
        if (!/^\d+(\.\d+)+\.?\s/.test(pending) && typeof it.cell?.cv !== 'string') fs.push(fieldOf(it, r, pending, 'calc'));
        pending = undefined;
      }
    }
    if (pending && pending.length > 60) cur().blocks.push({ t: 'text', text: pending });
    pushFields(fs);
  }

  return { sheet: sh.name, title, intro, parts: groupRepeats(sections.filter((s) => s.blocks.length)) };
}

function cleanHeading(s: string): string {
  const dep = /dependiente econ[oó]mico\s*#\s*(\d)/i.exec(s);
  if (dep) return `Dependiente económico ${dep[1]}`;
  return s.replace(/^\s*(\d+(\.\d+)*\.?|[a-z]\.)\s+/i, '').replace(/\s+—\s+$/, '');
}

function inferType(nf: string | undefined, dv: Validation | null, label: string): FieldType {
  if (dv?.type === 'list' && listOfDates(dv)) return 'date';
  if (dv?.type === 'list') {
    const lit = dv.f1?.startsWith('"') ? dv.f1.slice(1, -1).split(',').map((s) => s.trim().toUpperCase()) : null;
    if (lit && lit.length === 2 && lit.includes('SI') && lit.includes('NO')) return 'yesno';
    if (lit && lit.length === 1 && lit[0] === 'X') return 'check';
    return 'select';
  }
  if (/\(marque\s*x\)|marque \(x\)/i.test(label)) return 'check';
  if (/\bnit\b|identificaci[oó]n|c\.c\./i.test(label) && !/valor/i.test(label)) return 'id';
  if (/nombre|raz[oó]n social|descripci[oó]n|direcci[oó]n|entidad|concepto|ubicaci[oó]n|pa[ií]s|ciudad|apellido|sociedad/i.test(label) && !(nf && nf.includes('$')))
    return 'text';
  if (dv?.type === 'date' || isDateFormat(nf)) return 'date';
  if (isPercentFormat(nf)) return 'percent';
  if (isTextFormat(nf)) return 'text';
  if (nf && nf.includes('$')) return 'money';
  if (nf && /[#0]/.test(nf)) return /valor|saldo|total|ingreso|pago|costo|deuda/i.test(label) ? 'money' : 'number';
  if (dv?.type === 'whole' || dv?.type === 'decimal') return /a[ñn]o|meses|n[uú]mero de/i.test(label) ? 'number' : 'money';
  if (/nombre|raz[oó]n social|nit|identificaci[oó]n|descripci[oó]n|direcci[oó]n|entidad|concepto|ubicaci[oó]n|pa[ií]s|ciudad|apellido|sociedad/i.test(label))
    return 'text';
  if (/valor|saldo|monto|ingreso|pago|costo|deuda|precio/i.test(label)) return 'money';
  return 'text';
}

/** True when a list validation draws its options from date cells (e.g. the daily TRM table). */
let currentModel: Model | null = null;
function listOfDates(dv: Validation): boolean {
  const m = /^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+)/.exec(dv.f1 ?? '');
  if (!m || !currentModel || !m[1]) return false;
  const src = currentModel.sheets.find((x) => x.name === m[1]);
  return isDateFormat(src?.cells[`${m[2]}${m[3]}`]?.nf);
}

// ---------------------------------------------------------------- repeats

const ORDINALS = /\b(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|sext[oa]|1|2|3|4|5|6|#\s*\d+)\b/gi;
const shape = (s: Section) =>
  s.blocks
    .flatMap((b) => (b.t === 'fields' ? b.fields.map((f) => `${f.kind}:${f.label.replace(ORDINALS, '').trim()}`) : [b.t]))
    .join('|');

function groupRepeats(sections: Section[]): (Section | RepeatGroup)[] {
  const out: (Section | RepeatGroup)[] = [];
  for (let i = 0; i < sections.length; ) {
    let j = i + 1;
    const s = shape(sections[i]);
    while (j < sections.length && shape(sections[j]) === s && s.includes('input:')) j++;
    if (j - i >= 2) {
      out.push({ t: 'repeat', noun: repeatNoun(sections[i].title), items: sections.slice(i, j) });
    } else out.push(sections[i]);
    i = j;
  }
  return out;
}

function repeatNoun(title: string): string {
  if (/dependiente/i.test(title)) return 'dependiente';
  if (/emplead|pagador|contratante/i.test(title)) return 'empleador o contratante';
  return 'registro';
}

/** Rows of a table that hold any data. */
export function filledRows(rows: number[], cols: TableColumn[], extras: ExtraInput[], raw: (a1: string) => unknown): number[] {
  return rows.filter(
    (r) =>
      cols.some((c) => c.kind === 'input' && raw(toA1(r, c.c)) != null && raw(toA1(r, c.c)) !== '') ||
      extras.some((x) => parseA1(x.cell)[0] === r && raw(x.cell) != null),
  );
}

export function sectionHasData(s: Section, raw: (sheet: string, a1: string) => unknown): boolean {
  return s.blocks.some((b) =>
    b.t === 'fields'
      ? b.fields.some((f) => f.kind === 'input' && raw(f.sheet, f.a1) != null && raw(f.sheet, f.a1) !== '')
      : b.t === 'table'
        ? filledRows(b.rows, b.columns, b.extras, (a1) => raw(b.sheet, a1)).length > 0
        : false,
  );
}
