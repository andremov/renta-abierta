// Turns a worksheet into a CSS-grid layout mirroring the original Excel sheet.
import type { ModelCell, ModelSheet } from '../engine/workbook';
import { parseA1, toA1 } from '../engine/types';

export interface Placed {
  a1: string;
  r: number;
  c: number;
  row: number; // grid line (1-based)
  col: number;
  rowSpan: number;
  colSpan: number;
  cell?: ModelCell;
  /** accessible name for input cells: row label and column heading */
  label?: string;
}

export interface PlacedControl {
  name: string;
  text: string;
  target: string;
  row: number;
  col: number;
  rowEnd: number;
  colEnd: number;
}

export interface SheetLayout {
  widths: number[];
  heights: number[];
  /** sheet row (0-based) of each grid row */
  rowIndex: number[];
  cells: Placed[];
  controls: PlacedControl[];
}

/** Columns from Z onward hold helper values (help lookups, dropdown sources). */
const HELPER_COL = 25;
/** Formulario is laid out for printing; its print area is B4:AS162. */
const PRINT_AREAS: Record<string, [number, number, number, number]> = { Formulario: [3, 1, 161, 44] };

const px = {
  width: (chars: number) => Math.round(chars * 7 + 5),
  height: (pt: number) => Math.round((pt * 4) / 3),
};

export function buildLayout(sh: ModelSheet, hiddenRows: Set<number>, rowRange?: [number, number]): SheetLayout {
  const entries = Object.entries(sh.cells).map(([a1, cell]) => {
    const [r, c] = parseA1(a1);
    return { a1, r, c, cell };
  });
  const hiddenCols = new Set<number>();
  for (const [a, b] of sh.hiddenCols) for (let c = a - 1; c <= b - 1; c++) hiddenCols.add(c);

  let [r0, c0, r1, c1] = PRINT_AREAS[sh.name] ?? [0, 0, -1, -1];
  if (r1 < 0) {
    for (const { r, c, cell } of entries) {
      if (c >= HELPER_COL) continue;
      if (cell.v !== undefined || cell.f !== undefined || cell.in || cell.s) r1 = Math.max(r1, r);
      // columns only extend as far as real content; styled blanks alone don't widen the sheet
      if (cell.v !== undefined || cell.in) c1 = Math.max(c1, c);
    }
    // merged areas starting inside the content keep their full width
    for (const ref of sh.merges) {
      const [a, b] = ref.split(':');
      const [, ca] = parseA1(a);
      const [, cb] = parseA1(b);
      if (ca <= c1 && cb < HELPER_COL) c1 = Math.max(c1, cb);
    }
    for (const ctl of sh.controls ?? []) if (ctl.to && ctl.to[1] < HELPER_COL) r1 = Math.max(r1, ctl.to[0]);
    c1 = Math.min(c1, HELPER_COL - 1);
  }

  if (rowRange) [r0, r1] = rowRange;
  const colWidth = (c: number) => {
    const spec = sh.cols.find(([a, b]) => c + 1 >= a && c + 1 <= b);
    return px.width(spec ? spec[2] : 8.43);
  };
  const rowHeight = (r: number) => px.height(sh.heights?.[r + 1] ?? 15);

  const colLine = new Map<number, number>();
  const widths: number[] = [];
  for (let c = c0; c <= c1; c++) {
    if (hiddenCols.has(c)) continue;
    const w = colWidth(c);
    if (w <= 5) continue;
    widths.push(w);
    colLine.set(c, widths.length);
  }
  const rowLine = new Map<number, number>();
  const heights: number[] = [];
  const rowIndex: number[] = [];
  for (let r = r0; r <= r1; r++) {
    if (hiddenRows.has(r + 1)) continue;
    const h = rowHeight(r);
    if (h <= 0) continue;
    heights.push(h);
    rowIndex.push(r);
    rowLine.set(r, heights.length);
  }

  // merged areas: anchor -> visible span; covered cells are skipped
  const spans = new Map<string, [number, number]>();
  const covered = new Set<string>();
  for (const ref of sh.merges) {
    const [a, b] = ref.split(':');
    const [ra, ca] = parseA1(a);
    const [rb, cb] = parseA1(b);
    let rs = 0;
    let cs = 0;
    for (let r = ra; r <= rb; r++) if (rowLine.has(r)) rs++;
    for (let c = ca; c <= cb; c++) if (colLine.has(c)) cs++;
    // anchor hidden but part of the merge visible: re-anchor on the first visible cell
    let ar = ra;
    let ac = ca;
    while (ar <= rb && !rowLine.has(ar)) ar++;
    while (ac <= cb && !colLine.has(ac)) ac++;
    for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) covered.add(toA1(r, c));
    if (rs && cs) {
      covered.delete(toA1(ar, ac));
      spans.set(toA1(ar, ac), [rs, cs]);
      if (ar !== ra || ac !== ca) spans.set(`@${toA1(ar, ac)}`, [ra, ca]);
    }
  }

  const cellAt = new Map(entries.map((e) => [e.a1, e.cell]));
  const placed: Placed[] = [];
  const seen = new Set<string>();
  const place = (r: number, c: number) => {
    const a1 = toA1(r, c);
    if (seen.has(a1) || covered.has(a1)) return;
    const row = rowLine.get(r);
    const col = colLine.get(c);
    if (!row || !col) return;
    seen.add(a1);
    const [rowSpan, colSpan] = spans.get(a1) ?? [1, 1];
    // a re-anchored merge shows the content of its real top-left cell
    const origin = spans.get(`@${a1}`);
    const cell = origin ? cellAt.get(toA1(origin[0], origin[1])) : cellAt.get(a1);
    placed.push({ a1: origin ? toA1(origin[0], origin[1]) : a1, r, c, row, col, rowSpan, colSpan, cell });
  };
  for (const a1 of spans.keys()) if (!a1.startsWith('@')) place(...parseA1(a1));
  for (const { r, c } of entries) place(r, c);

  const controls: PlacedControl[] = [];
  const firstLine = (m: Map<number, number>, from: number, to: number) => {
    for (let i = from; i <= to; i++) if (m.has(i)) return m.get(i)!;
    return 0;
  };
  const lastLine = (m: Map<number, number>, from: number, to: number) => {
    for (let i = to; i >= from; i--) if (m.has(i)) return m.get(i)!;
    return 0;
  };
  for (const ctl of sh.controls ?? []) {
    if (ctl.kind !== 'button' || !ctl.target || !ctl.from || !ctl.to) continue;
    const row = firstLine(rowLine, ctl.from[0], ctl.to[0]);
    const col = firstLine(colLine, ctl.from[1], ctl.to[1]);
    const rowEnd = lastLine(rowLine, ctl.from[0], ctl.to[0]);
    const colEnd = lastLine(colLine, ctl.from[1], ctl.to[1]);
    if (!row || !col || !rowEnd || !colEnd) continue;
    controls.push({ name: ctl.name, text: ctl.text, target: ctl.target, row, col, rowEnd, colEnd });
  }
  // accessible names: nearest text to the left (row label) and above (column heading)
  const text = new Map<string, string>();
  for (const p of placed) if (typeof p.cell?.v === 'string' && p.cell.v.trim()) text.set(`${p.r},${p.c}`, p.cell.v.trim());
  const clean = (t: string) => t.replace(/\s+/g, ' ').slice(0, 120);
  for (const p of placed) {
    if (!p.cell?.in) continue;
    let left: string | undefined;
    for (let c = p.c - 1; c >= Math.max(0, p.c - 12) && !left; c--) left = text.get(`${p.r},${c}`);
    // form-style rows have a label on the left; table cells take their column heading
    let up: string | undefined;
    if (!left)
      for (let r = p.r - 1; r >= Math.max(0, p.r - 25) && !up; r--) {
        for (let c = p.c; c >= Math.max(0, p.c - 3) && !up; c--) up = text.get(`${r},${c}`);
      }
    const parts = [left ?? up].filter((x): x is string => !!x).map(clean);
    p.label = parts.length ? `${parts[0]} (${p.a1})` : `Casilla ${p.a1}`;
  }
  return { widths, heights, rowIndex, cells: placed, controls };
}
