// Workbook: holds cell values, orders formulas by dependency and recalculates.
import { collectRefs, Node, parseFormula } from './parser';
import { evaluate, scalar, Ctx } from './evaluate';
import { Arr, ERR, errFromCode, parseA1, Range, Scalar, Value } from './types';
import type { CellReader } from './values';

export type ModelScalar = number | string | boolean | { err: string };

export interface ModelCell {
  v?: ModelScalar;
  f?: string;
  cv?: ModelScalar;
  in?: 1;
  nf?: string;
  arr?: string;
  /** index into Model.styles */
  s?: number;
  /** rich-text runs (mixed font sizes/colours inside one cell) */
  rt?: { t: string; sz?: number; b?: 1; i?: 1; color?: string }[];
}

export interface ModelControl {
  name: string;
  kind: 'button' | 'label' | 'textbox' | string;
  text: string;
  from: [number, number] | null;
  to: [number, number] | null;
  /** sheet a navigation button opens; null if it points to a sheet that no longer exists */
  target?: string | null;
}

export interface CellStyle {
  b?: 1;
  i?: 1;
  u?: 1;
  sz?: number;
  color?: string;
  bg?: string;
  bd?: (string | null)[];
  ha?: string;
  va?: string;
  wrap?: 1;
  indent?: number;
  rot?: number;
}

export interface ModelSheet {
  name: string;
  state: string;
  merges: string[];
  validations: Record<string, string>[];
  cols: [number, number, number][];
  hiddenCols: [number, number][];
  hiddenRows: number[];
  heights?: Record<string, number>;
  gridLines?: boolean;
  codeName?: string | null;
  controls?: ModelControl[];
  print?: { scale?: number; orientation?: string; margins?: Record<string, number>; center?: 1; rowBreaks?: number[]; oddHeader?: string; oddFooter?: string };
  cells: Record<string, ModelCell>;
}

export interface Model {
  sheets: ModelSheet[];
  names?: Record<string, string>;
  styles?: CellStyle[];
  /** Excel's calculation order ([sheet, A1]); used to order iterative (circular) groups */
  calcChain?: [string, string][];
}

interface Rec {
  v: Scalar;
}

interface Formula {
  /** value saved in the file: the starting point of every iterative calculation */
  init: Scalar;
  sheet: number;
  r: number;
  c: number;
  src: string;
  node: Node;
  array: boolean;
  rec: Rec;
}

const COLS = 16384;
const key = (r: number, c: number) => r * COLS + c;

export function fromModel(v: ModelScalar | undefined): Scalar {
  if (v === undefined) return null;
  if (typeof v === 'object') return errFromCode(v.err);
  return v;
}

/** Excel serial number for a JS date (local calendar day). */
export function excelSerial(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

export class Workbook implements CellReader {
  readonly sheetNames: string[];
  private readonly byName = new Map<string, number>();
  private readonly cells: Map<number, Rec>[] = [];
  private readonly ext: { rows: number; cols: number }[] = [];
  readonly formulas: Formula[] = [];
  /** Evaluation plan: a formula index, or a cycle (group of indices) to iterate. */
  private plan: (number | number[])[] = [];
  today = excelSerial(new Date());
  maxIterations = 100;
  maxChange = 0.001;

  constructor(readonly model: Model) {
    this.sheetNames = model.sheets.map((s) => s.name);
    this.sheetNames.forEach((n, i) => this.byName.set(n.toUpperCase(), i));
    const resolve = (name: string) => {
      const i = this.byName.get(name.toUpperCase());
      if (i === undefined) throw new Error(`unknown sheet ${name}`);
      return i;
    };

    model.sheets.forEach((sh, si) => {
      const map = new Map<number, Rec>();
      let rows = 0;
      let cols = 0;
      for (const [a1, cell] of Object.entries(sh.cells)) {
        const [r, c] = parseA1(a1);
        rows = Math.max(rows, r);
        cols = Math.max(cols, c);
        const rec: Rec = { v: fromModel(cell.f !== undefined ? cell.cv : cell.v) };
        map.set(key(r, c), rec);
        if (cell.f !== undefined) {
          let node: Node;
          try {
            node = parseFormula(cell.f, si, resolve);
          } catch (e) {
            throw new Error(`${sh.name}!${a1}: ${(e as Error).message}`);
          }
          this.formulas.push({ init: rec.v, sheet: si, r, c, src: cell.f, node, array: !!cell.arr, rec });
        }
      }
      this.cells.push(map);
      this.ext.push({ rows, cols });
    });
    this.buildPlan();
  }

  sheetIndex(name: string): number {
    const i = this.byName.get(name.toUpperCase());
    if (i === undefined) throw new Error(`unknown sheet ${name}`);
    return i;
  }

  get(sheet: number, r: number, c: number): Scalar {
    return this.cells[sheet].get(key(r, c))?.v ?? null;
  }

  extent(sheet: number) {
    return this.ext[sheet];
  }

  /** Read a cell by sheet name and A1 address. */
  value(sheet: string | number, a1: string): Scalar {
    const [r, c] = parseA1(a1);
    return this.get(typeof sheet === 'number' ? sheet : this.sheetIndex(sheet), r, c);
  }

  /** Set an input cell value (does not recalculate). */
  set(sheet: string | number, a1: string, v: Scalar) {
    const si = typeof sheet === 'number' ? sheet : this.sheetIndex(sheet);
    const [r, c] = parseA1(a1);
    const k = key(r, c);
    let rec = this.cells[si].get(k);
    if (!rec) {
      rec = { v: null };
      this.cells[si].set(k, rec);
      this.ext[si] = { rows: Math.max(this.ext[si].rows, r), cols: Math.max(this.ext[si].cols, c) };
    }
    rec.v = v === '' ? null : v;
  }

  private buildPlan() {
    // index formula cells per sheet+column for range lookups
    const idx = new Map<number, Map<number, [number, number][]>>();
    this.formulas.forEach((f, i) => {
      let cols = idx.get(f.sheet);
      if (!cols) idx.set(f.sheet, (cols = new Map()));
      let list = cols.get(f.c);
      if (!list) cols.set(f.c, (list = []));
      list.push([f.r, i]);
    });
    for (const cols of idx.values()) for (const list of cols.values()) list.sort((a, b) => a[0] - b[0]);

    const deps: number[][] = this.formulas.map((f) => {
      const out = new Set<number>();
      for (const ref of collectRefs(f.node)) {
        const cols = idx.get(ref.sheet);
        if (!cols) continue;
        for (const [c, list] of cols) {
          if (c < ref.c1 || c > ref.c2) continue;
          let lo = 0;
          let hi = list.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (list[mid][0] < ref.r1) lo = mid + 1;
            else hi = mid;
          }
          for (let j = lo; j < list.length && list[j][0] <= ref.r2; j++) out.add(list[j][1]);
        }
      }
      return [...out];
    });

    // Within a circular group Excel recalculates in its calc-chain order; when rounding makes a
    // group oscillate instead of converging, that order decides the final values.
    const chainRank = new Map<string, number>();
    (this.model.calcChain ?? []).forEach(([sh, a1], i) => chainRank.set(`${sh}!${a1}`, i));
    const rank = (i: number) => chainRank.get(this.addr(i)) ?? 1e9 + i;

    // Tarjan's SCC (iterative); SCCs come out in dependency order.
    const n = this.formulas.length;
    const index = new Int32Array(n).fill(-1);
    const low = new Int32Array(n);
    const onStack = new Uint8Array(n);
    const stack: number[] = [];
    let counter = 0;
    const plan: (number | number[])[] = [];
    for (let s = 0; s < n; s++) {
      if (index[s] !== -1) continue;
      const work: [number, number][] = [[s, 0]];
      while (work.length) {
        const top = work[work.length - 1];
        const [v, ei] = top;
        if (ei === 0 && index[v] === -1) {
          index[v] = low[v] = counter++;
          stack.push(v);
          onStack[v] = 1;
        }
        if (ei < deps[v].length) {
          top[1]++;
          const w = deps[v][ei];
          if (index[w] === -1) work.push([w, 0]);
          else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
          continue;
        }
        work.pop();
        if (work.length) {
          const u = work[work.length - 1][0];
          low[u] = Math.min(low[u], low[v]);
        }
        if (low[v] === index[v]) {
          const comp: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            comp.push(w);
          } while (w !== v);
          if (comp.length === 1 && !deps[v].includes(v)) plan.push(v);
          else plan.push(comp.sort((a, b) => rank(a) - rank(b)));
        }
      }
    }
    // With circular references Excel iterates its whole calculation chain, so cells downstream of a
    // cycle are recomputed on every pass too (and may end one pass behind if they come earlier in
    // the chain). Emulate that: everything reachable from a cycle forms one iteration region,
    // evaluated in calc-chain order after the rest of the workbook.
    const cyclic = plan.filter((p): p is number[] => Array.isArray(p)).flat();
    if (cyclic.length) {
      const dependents: number[][] = this.formulas.map(() => []);
      deps.forEach((ds, i) => ds.forEach((d) => dependents[d].push(i)));
      const region = new Set<number>(cyclic);
      const queue = [...cyclic];
      while (queue.length) for (const d of dependents[queue.pop()!]) if (!region.has(d)) region.add(d), queue.push(d);
      this.plan = [
        ...plan.filter((p) => typeof p === 'number' && !region.has(p)),
        [...region].sort((a, b) => rank(a) - rank(b)),
      ];
      this.regionSize = region.size;
      this.regionCells = new Set([...region].map((i) => this.addr(i)));
    } else this.plan = plan;
  }

  /** number of formulas evaluated iteratively (cycles and everything downstream of them) */
  regionSize = 0;
  /** "Sheet!A1" of every formula in the iteration region */
  regionCells = new Set<string>();

  /** Circular reference groups, as "Sheet!A1" lists. */
  cycles(): string[][] {
    return this.plan
      .filter((p): p is number[] => Array.isArray(p))
      .map((g) => g.map((i) => this.addr(i)));
  }

  addr(i: number): string {
    const f = this.formulas[i];
    return `${this.sheetNames[f.sheet]}!${colName(f.c)}${f.r + 1}`;
  }

  private adhoc = new Map<string, Node>();

  /** Evaluate an arbitrary formula as if it were in (sheet, r, c). Returns ranges unresolved. */
  evalAt(sheet: number, r: number, c: number, src: string): Value {
    const k = `${sheet}|${src}`;
    let node = this.adhoc.get(k);
    if (!node) {
      node = parseFormula(src.replace(/^=/, ''), sheet, (n) => this.sheetIndex(n));
      this.adhoc.set(k, node);
    }
    return evaluate(node, { rd: this, sheet, row: r, col: c, array: false, today: this.today });
  }

  private evalFormula(f: Formula): Scalar {
    const ctx: Ctx = { rd: this, sheet: f.sheet, row: f.r, col: f.c, array: f.array, today: this.today };
    const v = evaluate(f.node, ctx);
    let s: Scalar;
    if (v instanceof Arr) s = v.data[0];
    else if (v instanceof Range) s = f.array ? this.get(v.sheet, v.r1, v.c1) : scalar(v, ctx);
    else s = v;
    if (s === null) return 0;
    if (typeof s === 'number' && !Number.isFinite(s)) return ERR.NUM;
    return s;
  }

  recalc() {
    for (const step of this.plan) {
      if (typeof step === 'number') {
        const f = this.formulas[step];
        f.rec.v = this.evalFormula(f);
        continue;
      }
      // Canonical result = Excel's full recalculation of the file: start the region from the values
      // saved in the file, evaluate it once in the normal pass, then iterate up to MaxIterations
      // more times. When rounding makes a cycle oscillate forever, this pins the outcome instead
      // of letting it depend on how many recalculations happened before.
      for (const i of step) this.formulas[i].rec.v = this.formulas[i].init;
      for (let it = 0; it < this.maxIterations + 1; it++) {
        let delta = 0;
        for (const i of step) {
          const f = this.formulas[i];
          const nv = this.evalFormula(f);
          const ov = f.rec.v;
          if (typeof nv === 'number' && typeof ov === 'number') delta = Math.max(delta, Math.abs(nv - ov));
          else if (nv !== ov && !(nv instanceof Object && ov instanceof Object && String(nv) === String(ov)))
            delta = Infinity;
          f.rec.v = nv;
        }
        if (delta < this.maxChange) break;
      }
    }
  }
}

function colName(c: number): string {
  let s = '';
  for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}
