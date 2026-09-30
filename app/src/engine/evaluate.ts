// Formula evaluation: AST walker plus the Excel functions the workbook uses.
import type { Node } from './parser';
import { Arr, ERR, Range, Scalar, Value, XErr } from './types';
import {
  addSub,
  CellReader,
  cellsOf,
  clamp,
  cmpOp,
  compare,
  criterion,
  isErr,
  numToStr,
  parseNumber,
  roundTo,
  toArr,
  toBool,
  toNum,
  toStr,
  wildcard,
} from './values';
import { formatText } from './text';

export interface Ctx {
  rd: CellReader;
  sheet: number;
  row: number;
  col: number;
  /** true while evaluating an array (CSE) formula */
  array: boolean;
  /** Excel serial number for TODAY() */
  today: number;
}

export function evaluate(n: Node, ctx: Ctx): Value {
  switch (n.k) {
    case 'num':
    case 'str':
    case 'bool':
    case 'err':
      return n.v;
    case 'missing':
      return null;
    case 'ref':
      return new Range(n.sheet, n.r1, n.c1, n.r2, n.c2);
    case 'array':
      return new Arr(
        n.rows.length,
        n.rows[0].length,
        n.rows.flat().map((x) => scalar(evaluate(x, ctx), ctx)),
      );
    case 'neg':
      return lift1(evaluate(n.a, ctx), ctx, (v) => {
        const x = toNum(v);
        return isErr(x) ? x : -x;
      });
    case 'pct':
      return lift1(evaluate(n.a, ctx), ctx, (v) => {
        const x = toNum(v);
        return isErr(x) ? x : x / 100;
      });
    case 'bin':
      return lift2(evaluate(n.a, ctx), evaluate(n.b, ctx), ctx, (a, b) => binop(n.op, a, b));
    case 'fn': {
      const f = FUNCS[n.name];
      if (!f) return ERR.NAME;
      return f(n.args, ctx);
    }
  }
}

function binop(op: string, a: Scalar, b: Scalar): Scalar {
  if (op === '&') {
    const x = toStr(a);
    if (isErr(x)) return x;
    const y = toStr(b);
    if (isErr(y)) return y;
    return x + y;
  }
  if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    return cmpOp(op, compare(a, b));
  }
  const x = toNum(a);
  if (isErr(x)) return x;
  const y = toNum(b);
  if (isErr(y)) return y;
  switch (op) {
    case '+':
      return addSub(x, y, false);
    case '-':
      return addSub(x, y, true);
    case '*':
      return x * y;
    case '/':
      return y === 0 ? ERR.DIV0 : x / y;
    case '^': {
      const r = Math.pow(x, y);
      return Number.isFinite(r) ? r : ERR.NUM;
    }
  }
  throw new Error(`bad operator ${op}`);
}

/** Collapse a value to a scalar, applying Excel's implicit intersection to ranges. */
export function scalar(v: Value, ctx: Ctx): Scalar {
  if (v instanceof Range) {
    if (v.isCell) return ctx.rd.get(v.sheet, v.r1, v.c1);
    if (v.c1 === v.c2 && ctx.row >= v.r1 && ctx.row <= v.r2) return ctx.rd.get(v.sheet, ctx.row, v.c1);
    if (v.r1 === v.r2 && ctx.col >= v.c1 && ctx.col <= v.c2) return ctx.rd.get(v.sheet, v.r1, ctx.col);
    return ERR.VALUE;
  }
  if (v instanceof Arr) return v.data[0];
  return v;
}

const isMulti = (v: Value, ctx: Ctx) => v instanceof Arr || (ctx.array && v instanceof Range && !v.isCell);

function lift1(v: Value, ctx: Ctx, f: (a: Scalar) => Scalar): Value {
  if (!isMulti(v, ctx)) return f(scalar(v, ctx));
  const a = toArr(v, ctx.rd);
  return new Arr(a.rows, a.cols, a.data.map(f));
}

function lift2(a: Value, b: Value, ctx: Ctx, f: (a: Scalar, b: Scalar) => Scalar): Value {
  if (!isMulti(a, ctx) && !isMulti(b, ctx)) return f(scalar(a, ctx), scalar(b, ctx));
  const x = isMulti(a, ctx) ? toArr(a, ctx.rd) : new Arr(1, 1, [scalar(a, ctx)]);
  const y = isMulti(b, ctx) ? toArr(b, ctx.rd) : new Arr(1, 1, [scalar(b, ctx)]);
  const rows = Math.max(x.rows, y.rows);
  const cols = Math.max(x.cols, y.cols);
  const pick = (m: Arr, r: number, c: number): Scalar => {
    const rr = m.rows === 1 ? 0 : r;
    const cc = m.cols === 1 ? 0 : c;
    return rr < m.rows && cc < m.cols ? m.get(rr, cc) : ERR.NA;
  };
  const data: Scalar[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data.push(f(pick(x, r, c), pick(y, r, c)));
  return new Arr(rows, cols, data);
}

// ---------------------------------------------------------------------------
// helpers for function implementations

type Fn = (args: Node[], ctx: Ctx) => Value;

const ev = (n: Node | undefined, ctx: Ctx): Value => (n ? evaluate(n, ctx) : null);
const sc = (n: Node | undefined, ctx: Ctx): Scalar => scalar(ev(n, ctx), ctx);

function num(n: Node | undefined, ctx: Ctx, dflt?: number): number | XErr {
  if ((n === undefined || n.k === 'missing') && dflt !== undefined) return dflt;
  return toNum(sc(n, ctx));
}

function str(n: Node | undefined, ctx: Ctx): string | XErr {
  return toStr(sc(n, ctx));
}

/** Numbers to aggregate: ranges/arrays contribute only numbers, direct args are coerced. */
function numbers(args: Node[], ctx: Ctx): number[] | XErr {
  const out: number[] = [];
  for (const a of args) {
    if (a.k === 'missing') {
      out.push(0);
      continue;
    }
    const v = evaluate(a, ctx);
    if (v instanceof Range || v instanceof Arr) {
      for (const x of cellsOf(v, ctx.rd)) {
        if (isErr(x)) return x;
        if (typeof x === 'number') out.push(x);
      }
    } else {
      const x = toNum(v);
      if (isErr(x)) return x;
      out.push(x);
    }
  }
  return out;
}

function logicals(args: Node[], ctx: Ctx): boolean[] | XErr {
  const out: boolean[] = [];
  for (const a of args) {
    const v = evaluate(a, ctx);
    if (v instanceof Range || v instanceof Arr) {
      for (const x of cellsOf(v, ctx.rd)) {
        if (isErr(x)) return x;
        if (typeof x === 'number' || typeof x === 'boolean') out.push(toBool(x) as boolean);
      }
    } else {
      const b = toBool(v);
      if (isErr(b)) return b;
      out.push(b);
    }
  }
  return out.length ? out : ERR.VALUE;
}

/** Positional access into a 1-D or 2-D lookup source. */
interface Grid {
  rows: number;
  cols: number;
  at(r: number, c: number): Scalar;
  ref?: Range;
}

function grid(v: Value, ctx: Ctx): Grid | XErr {
  if (isErr(v)) return v;
  if (v instanceof Range) {
    const c = clamp(v, ctx.rd);
    return { rows: c.rows, cols: c.cols, at: (r, k) => ctx.rd.get(c.sheet, c.r1 + r, c.c1 + k), ref: v };
  }
  const a = v instanceof Arr ? v : new Arr(1, 1, [v]);
  return { rows: a.rows, cols: a.cols, at: (r, k) => a.get(r, k) };
}

const sameKind = (a: Scalar, b: Scalar) =>
  (typeof a === 'number' && typeof b === 'number') ||
  (typeof a === 'string' && typeof b === 'string') ||
  (typeof a === 'boolean' && typeof b === 'boolean');

/**
 * Find a position in a vector.
 * mode 0: exact (wildcards for text); 1: largest <= lv (ascending); -1: smallest >= lv (descending).
 */
function findIn(lv: Scalar, n: number, at: (i: number) => Scalar, mode: number): number {
  if (mode === 0) {
    const re = typeof lv === 'string' && /[*?~]/.test(lv) ? wildcard(lv) : null;
    for (let i = 0; i < n; i++) {
      const v = at(i);
      if (re) {
        if (typeof v === 'string' && re.test(v)) return i;
      } else if (v !== null && sameKind(v, lv) && compare(v, lv) === 0) return i;
    }
    return -1;
  }
  // Approximate match: Excel binary-searches; on sorted data that equals this scan.
  let found = -1;
  for (let i = 0; i < n; i++) {
    const v = at(i);
    if (v === null || !sameKind(v, lv)) continue;
    const c = compare(v, lv);
    if (mode === 1) {
      if (c <= 0) found = i;
      else break;
    } else {
      if (c >= 0) found = i;
      else break;
    }
  }
  return found;
}

function days360(s: number, e: number, european: boolean): number {
  const d = (serial: number) => {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  };
  const lastOfFeb = (x: { y: number; m: number; d: number }) =>
    x.m === 2 && new Date(Date.UTC(x.y, 2, 0)).getUTCDate() === x.d;
  const a = d(s);
  const b = d(e);
  if (european) {
    if (a.d === 31) a.d = 30;
    if (b.d === 31) b.d = 30;
  } else {
    if (lastOfFeb(a) && lastOfFeb(b)) b.d = 30;
    if (lastOfFeb(a)) a.d = 30;
    if (b.d === 31 && a.d >= 30) b.d = 30;
    if (a.d === 31) a.d = 30;
  }
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (b.d - a.d);
}

// ---------------------------------------------------------------------------

export const FUNCS: Record<string, Fn> = {
  IF(args, ctx) {
    const c = ev(args[0], ctx);
    const pick = (n: Node | undefined, isFalse: boolean): Value => {
      if (!n) return isFalse ? false : true;
      if (n.k === 'missing') return 0;
      return evaluate(n, ctx);
    };
    if (isMulti(c, ctx)) {
      const cond = toArr(c, ctx.rd);
      const t = pick(args[1], false);
      const f = pick(args[2], true);
      const tA = toArr(isMulti(t, ctx) ? t : scalar(t, ctx), ctx.rd);
      const fA = toArr(isMulti(f, ctx) ? f : scalar(f, ctx), ctx.rd);
      const at = (m: Arr, i: number, j: number) => m.get(m.rows === 1 ? 0 : i, m.cols === 1 ? 0 : j);
      const data: Scalar[] = [];
      for (let i = 0; i < cond.rows; i++)
        for (let j = 0; j < cond.cols; j++) {
          const b = toBool(cond.get(i, j));
          data.push(isErr(b) ? b : b ? at(tA, i, j) : at(fA, i, j));
        }
      return new Arr(cond.rows, cond.cols, data);
    }
    const b = toBool(scalar(c, ctx));
    if (isErr(b)) return b;
    return b ? pick(args[1], false) : pick(args[2], true);
  },
  IFERROR(args, ctx) {
    const v = ev(args[0], ctx);
    const s = v instanceof Range && !v.isCell ? v : scalar(v, ctx);
    return isErr(s) ? ev(args[1], ctx) ?? 0 : v;
  },
  IFNA(args, ctx) {
    const v = ev(args[0], ctx);
    const s = v instanceof Range && !v.isCell ? v : scalar(v, ctx);
    return isErr(s) && s.code === '#N/A' ? ev(args[1], ctx) ?? 0 : v;
  },
  AND(args, ctx) {
    const b = logicals(args, ctx);
    return isErr(b) ? b : b.every(Boolean);
  },
  OR(args, ctx) {
    const b = logicals(args, ctx);
    return isErr(b) ? b : b.some(Boolean);
  },
  SUM(args, ctx) {
    const xs = numbers(args, ctx);
    return isErr(xs) ? xs : xs.reduce((s, x) => addSub(s, x, false), 0);
  },
  MAX(args, ctx) {
    const xs = numbers(args, ctx);
    return isErr(xs) ? xs : xs.length ? Math.max(...xs) : 0;
  },
  MIN(args, ctx) {
    const xs = numbers(args, ctx);
    return isErr(xs) ? xs : xs.length ? Math.min(...xs) : 0;
  },
  COUNT(args, ctx) {
    let n = 0;
    for (const a of args) {
      const v = evaluate(a, ctx);
      if (v instanceof Range || v instanceof Arr) {
        for (const x of cellsOf(v, ctx.rd)) if (typeof x === 'number') n++;
      } else if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && parseNumber(v) !== null))
        n++;
    }
    return n;
  },
  ROUND(args, ctx) {
    const x = num(args[0], ctx);
    if (isErr(x)) return x;
    const d = num(args[1], ctx, 0);
    return isErr(d) ? d : roundTo(x, d);
  },
  ROUNDUP(args, ctx) {
    const x = num(args[0], ctx);
    if (isErr(x)) return x;
    const d = num(args[1], ctx, 0);
    return isErr(d) ? d : roundTo(x, d, 'up');
  },
  TRUNC(args, ctx) {
    const x = num(args[0], ctx);
    if (isErr(x)) return x;
    const d = num(args[1], ctx, 0);
    return isErr(d) ? d : roundTo(x, d, 'trunc');
  },
  ABS(args, ctx) {
    const x = num(args[0], ctx);
    return isErr(x) ? x : Math.abs(x);
  },
  MOD(args, ctx) {
    const x = num(args[0], ctx);
    if (isErr(x)) return x;
    const d = num(args[1], ctx);
    if (isErr(d)) return d;
    if (d === 0) return ERR.DIV0;
    const r = x - d * Math.floor(x / d);
    return Number(r.toPrecision(15));
  },
  VALUE(args, ctx) {
    const v = sc(args[0], ctx);
    if (typeof v === 'number') return v;
    if (v === null) return 0;
    if (typeof v !== 'string') return isErr(v) ? v : ERR.VALUE;
    const n = parseNumber(v);
    return n === null ? ERR.VALUE : n;
  },
  CONCATENATE(args, ctx) {
    let s = '';
    for (const a of args) {
      const x = str(a, ctx);
      if (isErr(x)) return x;
      s += x;
    }
    return s;
  },
  LEN(args, ctx) {
    const s = str(args[0], ctx);
    return isErr(s) ? s : s.length;
  },
  UPPER(args, ctx) {
    const s = str(args[0], ctx);
    return isErr(s) ? s : s.toUpperCase();
  },
  REPT(args, ctx) {
    const s = str(args[0], ctx);
    if (isErr(s)) return s;
    const n = num(args[1], ctx);
    if (isErr(n)) return n;
    return n < 0 ? ERR.VALUE : s.repeat(Math.trunc(n));
  },
  MID(args, ctx) {
    const s = str(args[0], ctx);
    if (isErr(s)) return s;
    const start = num(args[1], ctx);
    if (isErr(start)) return start;
    const len = num(args[2], ctx);
    if (isErr(len)) return len;
    if (start < 1 || len < 0) return ERR.VALUE;
    return s.substr(Math.trunc(start) - 1, Math.trunc(len));
  },
  RIGHT(args, ctx) {
    const s = str(args[0], ctx);
    if (isErr(s)) return s;
    const n = num(args[1], ctx, 1);
    if (isErr(n)) return n;
    if (n < 0) return ERR.VALUE;
    return Math.trunc(n) === 0 ? '' : s.slice(-Math.trunc(n));
  },
  TEXT(args, ctx) {
    const v = sc(args[0], ctx);
    if (isErr(v)) return v;
    const f = str(args[1], ctx);
    if (isErr(f)) return f;
    return formatText(v, f);
  },
  ISBLANK(args, ctx) {
    const v = ev(args[0], ctx);
    return v instanceof Range ? ctx.rd.get(v.sheet, v.r1, v.c1) === null : v === null;
  },
  TODAY(_args, ctx) {
    return ctx.today;
  },
  DAYS360(args, ctx) {
    const s = num(args[0], ctx);
    if (isErr(s)) return s;
    const e = num(args[1], ctx);
    if (isErr(e)) return e;
    const m = args[2] ? toBool(sc(args[2], ctx)) : false;
    if (isErr(m)) return m;
    return days360(s, e, m);
  },
  VLOOKUP(args, ctx) {
    const lv = sc(args[0], ctx);
    if (isErr(lv)) return lv;
    const g = grid(ev(args[1], ctx), ctx);
    if (isErr(g)) return g;
    const col = num(args[2], ctx);
    if (isErr(col)) return col;
    const approx = args[3] && args[3].k !== 'missing' ? toBool(sc(args[3], ctx)) : true;
    if (isErr(approx)) return approx;
    if (col < 1) return ERR.VALUE;
    if (lv === null) return ERR.NA;
    const i = findIn(lv, g.rows, (r) => g.at(r, 0), approx ? 1 : 0);
    if (i < 0) return ERR.NA;
    if (col > g.cols) return ERR.REF;
    const out = g.at(i, Math.trunc(col) - 1);
    return out;
  },
  MATCH(args, ctx) {
    const lv = sc(args[0], ctx);
    if (isErr(lv)) return lv;
    const g = grid(ev(args[1], ctx), ctx);
    if (isErr(g)) return g;
    const mode = num(args[2], ctx, 1);
    if (isErr(mode)) return mode;
    if (g.rows > 1 && g.cols > 1) return ERR.NA;
    if (lv === null) return ERR.NA;
    const n = Math.max(g.rows, g.cols);
    const at = g.rows > 1 ? (i: number) => g.at(i, 0) : (i: number) => g.at(0, i);
    const i = findIn(lv, n, at, Math.sign(mode));
    return i < 0 ? ERR.NA : i + 1;
  },
  LOOKUP(args, ctx) {
    const lv = sc(args[0], ctx);
    if (isErr(lv)) return lv;
    const g = grid(ev(args[1], ctx), ctx);
    if (isErr(g)) return g;
    const vertical = g.rows >= g.cols;
    const n = vertical ? g.rows : g.cols;
    const key = vertical ? (i: number) => g.at(i, 0) : (i: number) => g.at(0, i);
    const i = findIn(lv, n, key, 1);
    if (i < 0) return ERR.NA;
    if (args[2]) {
      const r = grid(ev(args[2], ctx), ctx);
      if (isErr(r)) return r;
      return r.rows >= r.cols ? r.at(i, 0) : r.at(0, i);
    }
    return vertical ? g.at(i, g.cols - 1) : g.at(g.rows - 1, i);
  },
  INDEX(args, ctx) {
    const src = ev(args[0], ctx);
    if (isErr(src)) return src;
    let r = num(args[1], ctx, 0);
    if (isErr(r)) return r;
    let c = num(args[2], ctx, 0);
    if (isErr(c)) return c;
    r = Math.trunc(r);
    c = Math.trunc(c);
    const rows = src instanceof Range ? src.rows : src instanceof Arr ? src.rows : 1;
    const cols = src instanceof Range ? src.cols : src instanceof Arr ? src.cols : 1;
    // a single row with one index argument indexes columns
    if (rows === 1 && args.length === 2) {
      c = r;
      r = 1;
    }
    if (r < 0 || c < 0 || r > rows || c > cols) return ERR.REF;
    if (src instanceof Range) {
      const r1 = r === 0 ? src.r1 : src.r1 + r - 1;
      const r2 = r === 0 ? src.r2 : r1;
      const c1 = c === 0 ? src.c1 : src.c1 + c - 1;
      const c2 = c === 0 ? src.c2 : c1;
      if (cols === 1 && c === 0) return new Range(src.sheet, r1, src.c1, r2, src.c1);
      return new Range(src.sheet, r1, c1, r2, c2);
    }
    const a = toArr(src, ctx.rd);
    return a.get(Math.max(r, 1) - 1, Math.max(c, 1) - 1);
  },
  SUMIF(args, ctx) {
    const rg = ev(args[0], ctx);
    const crit = criterion(sc(args[1], ctx));
    const sumSrc = args[2] && args[2].k !== 'missing' ? ev(args[2], ctx) : rg;
    const g = grid(rg, ctx);
    if (isErr(g)) return g;
    const s = sumSrc instanceof Range ? grid(new Range(sumSrc.sheet, sumSrc.r1, sumSrc.c1, sumSrc.r1 + g.rows - 1, sumSrc.c1 + g.cols - 1), ctx) : grid(sumSrc, ctx);
    if (isErr(s)) return s;
    let total = 0;
    for (let i = 0; i < g.rows; i++)
      for (let j = 0; j < g.cols; j++)
        if (crit(g.at(i, j))) {
          const v = i < s.rows && j < s.cols ? s.at(i, j) : null;
          if (isErr(v)) return v;
          if (typeof v === 'number') total = addSub(total, v, false);
        }
    return total;
  },
  SUMIFS(args, ctx) {
    const s = grid(ev(args[0], ctx), ctx);
    if (isErr(s)) return s;
    const conds: [Grid, (v: Scalar) => boolean][] = [];
    for (let k = 1; k + 1 < args.length; k += 2) {
      const raw = ev(args[k], ctx);
      const g = raw instanceof Range && s.ref ? grid(new Range(raw.sheet, raw.r1, raw.c1, raw.r1 + s.rows - 1, raw.c1 + s.cols - 1), ctx) : grid(raw, ctx);
      if (isErr(g)) return g;
      if (raw instanceof Range && (raw.rows !== (s.ref?.rows ?? s.rows) || raw.cols !== (s.ref?.cols ?? s.cols)))
        return ERR.VALUE;
      conds.push([g, criterion(sc(args[k + 1], ctx))]);
    }
    let total = 0;
    for (let i = 0; i < s.rows; i++)
      for (let j = 0; j < s.cols; j++) {
        if (!conds.every(([g, p]) => p(g.at(i, j)))) continue;
        const v = s.at(i, j);
        if (isErr(v)) return v;
        if (typeof v === 'number') total = addSub(total, v, false);
      }
    return total;
  },
  COUNTIF(args, ctx) {
    const g = grid(ev(args[0], ctx), ctx);
    if (isErr(g)) return g;
    const crit = criterion(sc(args[1], ctx));
    let n = 0;
    for (let i = 0; i < g.rows; i++) for (let j = 0; j < g.cols; j++) if (crit(g.at(i, j))) n++;
    return n;
  },
};

export { numToStr };
