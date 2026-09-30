// Excel coercion, comparison and number semantics.
import { Arr, ERR, Range, Scalar, Value, XErr } from './types';

/** Reads cell values; implemented by the Workbook. */
export interface CellReader {
  get(sheet: number, r: number, c: number): Scalar;
  /** Last used row/col of a sheet (0-based), to clamp whole-column references. */
  extent(sheet: number): { rows: number; cols: number };
}

export const isErr = (v: unknown): v is XErr => v instanceof XErr;

const NUMERIC = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*(%?)\s*$/;

/** Parse text the way Excel's implicit text->number conversion does (invariant format). */
export function parseNumber(s: string): number | null {
  const m = NUMERIC.exec(s);
  if (!m) return null;
  const n = parseFloat(s);
  return m[3] ? n / 100 : n;
}

export function toNum(v: Scalar): number | XErr {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) return v;
  const n = parseNumber(v);
  return n === null ? ERR.VALUE : n;
}

export function toBool(v: Scalar): boolean | XErr {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  if (isErr(v)) return v;
  const u = v.toUpperCase();
  if (u === 'TRUE' || u === 'VERDADERO') return true;
  if (u === 'FALSE' || u === 'FALSO') return false;
  return ERR.VALUE;
}

/** Excel "General" rendering of a number as text: up to 15 significant digits. */
export function numToStr(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const p = Number(n.toPrecision(15));
  let s = String(p);
  if (s.includes('e')) {
    const [mant, exp] = s.split('e');
    const e = parseInt(exp, 10);
    s = `${mant}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  return s;
}

export function toStr(v: Scalar): string | XErr {
  if (typeof v === 'string') return v;
  if (v === null) return '';
  if (typeof v === 'number') return numToStr(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

/** Round away from zero after clearing binary noise, like Excel. */
export function roundTo(n: number, digits: number, mode: 'round' | 'trunc' | 'up' = 'round'): number {
  const d = Math.trunc(digits);
  const scale = 10 ** Math.abs(d);
  let x = d >= 0 ? n * scale : n / scale;
  x = Number(x.toPrecision(15));
  const a = Math.abs(x);
  const r = mode === 'round' ? Math.floor(a + 0.5) : mode === 'trunc' ? Math.floor(a) : Math.ceil(a);
  const out = Math.sign(x) * r;
  const res = d >= 0 ? out / scale : out * scale;
  return res === 0 ? 0 : Number(res.toPrecision(15));
}

/** Excel snaps tiny residues of addition/subtraction to zero. */
export function addSub(a: number, b: number, sub: boolean): number {
  const r = sub ? a - b : a + b;
  if (r !== 0 && Math.abs(r) < Math.max(Math.abs(a), Math.abs(b)) * 2 ** -48) return 0;
  return r;
}

const typeRank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);

/** Excel comparison: numbers < text < booleans; text is case-insensitive. */
export function compare(a: Scalar, b: Scalar): number {
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === 'string') {
    const x = a.toUpperCase();
    const y = (b as string).toUpperCase();
    return x === y ? 0 : x.localeCompare(y, 'es') < 0 ? -1 : 1;
  }
  if (typeof a === 'boolean') return a === b ? 0 : a ? 1 : -1;
  const x = a as number;
  const y = b as number;
  if (x === y) return 0;
  // equal to 15 significant digits counts as equal
  if (Number(x.toPrecision(15)) === Number(y.toPrecision(15))) return 0;
  return x < y ? -1 : 1;
}

/** Clamp a range to the sheet's used extent (cells outside it are blank). */
export function clamp(rg: Range, rd: CellReader): Range {
  const ext = rd.extent(rg.sheet);
  const r2 = Math.min(rg.r2, Math.max(rg.r1, ext.rows));
  const c2 = Math.min(rg.c2, Math.max(rg.c1, ext.cols));
  return r2 === rg.r2 && c2 === rg.c2 ? rg : new Range(rg.sheet, rg.r1, rg.c1, r2, c2);
}

export function rangeToArr(rg: Range, rd: CellReader): Arr {
  const c = clamp(rg, rd);
  const data: Scalar[] = [];
  for (let r = c.r1; r <= c.r2; r++) for (let k = c.c1; k <= c.c2; k++) data.push(rd.get(c.sheet, r, k));
  return new Arr(c.rows, c.cols, data);
}

export function toArr(v: Value, rd: CellReader): Arr {
  if (v instanceof Arr) return v;
  if (v instanceof Range) return rangeToArr(v, rd);
  return new Arr(1, 1, [v]);
}

/** Iterate over the values of an aggregate argument (range, array or scalar). */
export function* cellsOf(v: Value, rd: CellReader): Generator<Scalar> {
  if (v instanceof Range) {
    const c = clamp(v, rd);
    for (let r = c.r1; r <= c.r2; r++) for (let k = c.c1; k <= c.c2; k++) yield rd.get(c.sheet, r, k);
  } else if (v instanceof Arr) yield* v.data;
  else yield v;
}

/** Excel wildcard pattern (* ? ~) to an anchored case-insensitive RegExp. */
export function wildcard(p: string): RegExp {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '~' && i + 1 < p.length) re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '*') re += '[\\s\\S]*';
    else if (ch === '?') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** Build a SUMIF/COUNTIF criterion predicate. */
export function criterion(crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit === 'number' || typeof crit === 'boolean' || crit === null) {
    const target = crit ?? 0;
    return (v) => v !== null && typeof v === typeof target && compare(v, target) === 0;
  }
  if (isErr(crit)) return (v) => isErr(v) && v.code === crit.code;
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(crit)!;
  const op = m[1] ?? '=';
  const rest = m[2];
  const num = parseNumber(rest);
  if (rest === '') {
    if (op === '=') return (v) => v === null || v === '';
    if (op === '<>') return (v) => !(v === null || v === '');
    return () => false;
  }
  if (num !== null) {
    return (v) => {
      if (typeof v !== 'number') return op === '<>' ? true : false;
      const c = compare(v, num);
      return cmpOp(op, c);
    };
  }
  const bool = rest.toUpperCase() === 'TRUE' ? true : rest.toUpperCase() === 'FALSE' ? false : null;
  if (bool !== null) return (v) => (typeof v === 'boolean' ? cmpOp(op, compare(v, bool)) : op === '<>');
  if (op === '=' || op === '<>') {
    const re = wildcard(rest);
    return (v) => {
      const hit = typeof v === 'string' && re.test(v);
      return op === '=' ? hit : !hit;
    };
  }
  return (v) => typeof v === 'string' && cmpOp(op, compare(v, rest));
}

export function cmpOp(op: string, c: number): boolean {
  switch (op) {
    case '=':
      return c === 0;
    case '<>':
      return c !== 0;
    case '<':
      return c < 0;
    case '>':
      return c > 0;
    case '<=':
      return c <= 0;
    case '>=':
      return c >= 0;
  }
  throw new Error(`bad op ${op}`);
}
