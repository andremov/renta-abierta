// Value model mirroring Excel's cell value types.

export class XErr {
  constructor(public readonly code: string) {}
  toString() {
    return this.code;
  }
}

export const ERR = {
  NA: new XErr('#N/A'),
  VALUE: new XErr('#VALUE!'),
  REF: new XErr('#REF!'),
  DIV0: new XErr('#DIV/0!'),
  NUM: new XErr('#NUM!'),
  NAME: new XErr('#NAME?'),
};

export function errFromCode(code: string): XErr {
  return Object.values(ERR).find((e) => e.code === code) ?? new XErr(code);
}

/** A scalar cell value. null = blank cell. */
export type Scalar = number | string | boolean | null | XErr;

/** A rectangular block of values (array formula intermediates). */
export class Arr {
  constructor(
    public readonly rows: number,
    public readonly cols: number,
    public readonly data: Scalar[],
  ) {}
  get(r: number, c: number): Scalar {
    return this.data[r * this.cols + c];
  }
}

/** A reference to a rectangular range of cells (0-based, inclusive). */
export class Range {
  constructor(
    public readonly sheet: number,
    public readonly r1: number,
    public readonly c1: number,
    public readonly r2: number,
    public readonly c2: number,
  ) {}
  get rows() {
    return this.r2 - this.r1 + 1;
  }
  get cols() {
    return this.c2 - this.c1 + 1;
  }
  get isCell() {
    return this.r1 === this.r2 && this.c1 === this.c2;
  }
}

export type Value = Scalar | Arr | Range;

export const MAX_ROW = 1048575;
export const MAX_COL = 16383;

export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToCol(i: number): string {
  let s = '';
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** "B12" -> [row, col] (0-based) */
export function parseA1(a1: string): [number, number] {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a1);
  if (!m) throw new Error(`bad cell ref ${a1}`);
  return [parseInt(m[2], 10) - 1, colToIndex(m[1])];
}

export function toA1(r: number, c: number): string {
  return indexToCol(c) + (r + 1);
}
