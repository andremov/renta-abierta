// Excel data validation, evaluated with the engine: dropdown lists, limits, custom rules.
import type { ModelSheet } from '../engine/workbook';
import type { Workbook } from '../engine/workbook';
import { Arr, parseA1, Range, XErr, type Scalar } from '../engine/types';
import { cellsOf, compare } from '../engine/values';
import { formatValue } from './format';

export interface Validation {
  type?: string;
  op?: string;
  f1?: string;
  f2?: string;
  prompt?: string;
  promptTitle?: string;
  error?: string;
  errorTitle?: string;
  /** offset of the target cell from the top-left of the validation range */
  dr: number;
  dc: number;
}

function inRef(ref: string, r: number, c: number): [number, number] | null {
  const [a, b = a] = ref.split(':');
  const [r1, c1] = parseA1(a);
  const [r2, c2] = parseA1(b);
  return r >= r1 && r <= r2 && c >= c1 && c <= c2 ? [r1, c1] : null;
}

export function validationAt(sh: ModelSheet, a1: string): Validation | null {
  const [r, c] = parseA1(a1);
  for (const dv of sh.validations) {
    const refs = (dv.sqref ?? '').split(/\s+/).filter(Boolean);
    let origin: [number, number] | null = null;
    // relative references are anchored at the top-left cell of the whole sqref
    let top: [number, number] | null = null;
    for (const ref of refs) {
      const [a] = ref.split(':');
      const p = parseA1(a);
      if (!top || p[0] < top[0] || (p[0] === top[0] && p[1] < top[1])) top = p;
      origin ??= inRef(ref, r, c);
    }
    if (origin && top) return { ...dv, dr: r - top[0], dc: c - top[1] } as Validation;
  }
  return null;
}

/** Shift the relative (non-$) references of a formula, like Excel does for validations. */
export function shiftFormula(f: string, dr: number, dc: number): string {
  if (!dr && !dc) return f;
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const name = (i: number) => {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  };
  return f
    .split(/("(?:[^"]|"")*")/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/(^|[^A-Za-z0-9_'!.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (_m, pre, dcol, c, drow, r) => {
            const cc = dcol ? c : name(col(c) + dc);
            const rr = drow ? r : String(parseInt(r, 10) + dr);
            return `${pre}${dcol}${cc}${drow}${rr}`;
          }),
    )
    .join('');
}

export function listOptions(wb: Workbook, sheet: number, a1: string, dv: Validation): string[] | null {
  if (dv.type !== 'list' || !dv.f1) return null;
  if (dv.f1.startsWith('"')) return dv.f1.slice(1, -1).split(',').map((s) => s.trim());
  const [r, c] = parseA1(a1);
  try {
    const v = wb.evalAt(sheet, r, c, shiftFormula(dv.f1, dv.dr, dv.dc));
    if (!(v instanceof Range) && !(v instanceof Arr)) return null;
    const out: string[] = [];
    for (const x of cellsOf(v, wb)) {
      if (x === null || x === '' || x instanceof XErr) continue;
      const s = typeof x === 'number' ? formatValue(x) : String(x);
      if (!out.includes(s)) out.push(s);
    }
    return out;
  } catch {
    return null;
  }
}

/** DIAN's list cells are fixed-width ("2   Impuestos de Barranquilla  "): compare without the padding. */
export const tidyOption = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The list option the person meant: the same text ignoring case and spacing, or just its code ("2", "02", "10" for "0010"). */
export function pickOption(options: string[], raw: string): string | undefined {
  const want = tidyOption(raw).toUpperCase();
  const exact = options.find((o) => tidyOption(o).toUpperCase() === want);
  if (exact || !/^\d+$/.test(want)) return exact;
  const byCode = options.filter((o) => Number(/^\s*(\d+)/.exec(o)?.[1] ?? NaN) === Number(want));
  return byCode.length === 1 ? byCode[0] : undefined;
}

function evalBound(wb: Workbook, sheet: number, r: number, c: number, f: string | undefined, dv: Validation): Scalar {
  if (f === undefined) return null;
  const n = Number(f);
  if (f.trim() !== '' && Number.isFinite(n)) return n;
  try {
    const v = wb.evalAt(sheet, r, c, shiftFormula(f, dv.dr, dv.dc));
    return v instanceof Range ? wb.get(v.sheet, v.r1, v.c1) : v instanceof Arr ? v.data[0] : v;
  } catch {
    return null;
  }
}

/** Check a candidate value; returns an error message or null if valid. */
export function checkValidation(wb: Workbook, sheet: number, a1: string, dv: Validation, v: Scalar): string | null {
  if (v === null) return null;
  const [r, c] = parseA1(a1);
  const fail = () => dv.error?.trim() || defaultMessage(dv, wb, sheet, r, c);
  switch (dv.type) {
    case 'list': {
      const opts = listOptions(wb, sheet, a1, dv);
      if (!opts) return null;
      const s = typeof v === 'number' ? formatValue(v) : String(v);
      if (opts.some((o) => tidyOption(o).toUpperCase() === tidyOption(s).toUpperCase())) return null;
      if (/TRM_diaria/i.test(dv.f1 ?? ''))
        return 'Esa fecha no tiene tasa representativa del mercado (TRM) en la tabla de la DIAN. Elija un día con TRM publicada.';
      return dv.error?.trim() || 'Elija una opción de la lista.';
    }
    case 'whole':
    case 'decimal':
    case 'date':
    case 'textLength': {
      let x: Scalar = v;
      if (dv.type === 'textLength') x = String(v).length;
      if (typeof x !== 'number') return fail();
      if (dv.type === 'whole' && !Number.isInteger(x)) return 'Escriba un número entero, sin decimales.';
      const a = evalBound(wb, sheet, r, c, dv.f1, dv);
      const b = evalBound(wb, sheet, r, c, dv.f2, dv);
      return cmp(dv.op ?? 'between', x, a, b) ? null : fail();
    }
    case 'custom': {
      // custom rules refer to the new value through the cell itself; evaluated after entry
      return null;
    }
  }
  return null;
}

function cmp(op: string, x: number, a: Scalar, b: Scalar): boolean {
  const A = typeof a === 'number' ? a : null;
  const B = typeof b === 'number' ? b : null;
  if (A === null) return true; // bound could not be evaluated
  switch (op) {
    case 'between':
      return B === null ? x >= A : x >= A && x <= B;
    case 'notBetween':
      return B === null ? x < A : x < A || x > B;
    case 'equal':
      return compare(x, A) === 0;
    case 'notEqual':
      return compare(x, A) !== 0;
    case 'greaterThan':
      return x > A;
    case 'lessThan':
      return x < A;
    case 'greaterThanOrEqual':
      return x >= A;
    case 'lessThanOrEqual':
      return x <= A;
  }
  return true;
}

function defaultMessage(dv: Validation, wb: Workbook, sheet: number, r: number, c: number): string {
  const a = evalBound(wb, sheet, r, c, dv.f1, dv);
  const b = evalBound(wb, sheet, r, c, dv.f2, dv);
  const f = (x: Scalar) => (typeof x === 'number' ? formatValue(x, dv.type === 'date' ? 'dd/mm/yyyy' : '#,##0') : String(x));
  switch (dv.op ?? 'between') {
    case 'between':
      return `El valor debe estar entre ${f(a)} y ${f(b)}.`;
    case 'greaterThan':
      return `El valor debe ser mayor que ${f(a)}.`;
    case 'greaterThanOrEqual':
      return `El valor debe ser mayor o igual a ${f(a)}.`;
    case 'lessThan':
      return `El valor debe ser menor que ${f(a)}.`;
    case 'lessThanOrEqual':
      return `El valor no puede superar ${f(a)}.`;
    case 'notEqual':
      return `El valor no puede ser igual a ${f(a)}.`;
    case 'equal':
      return `El valor debe ser ${f(a)}.`;
  }
  return 'El valor no es válido para esta casilla.';
}
