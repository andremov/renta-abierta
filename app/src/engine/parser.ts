// Recursive-descent parser for the subset of Excel formula syntax the workbook uses.
import { colToIndex, errFromCode, MAX_COL, MAX_ROW, XErr } from './types';

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: XErr }
  | { k: 'missing' }
  | { k: 'ref'; sheet: number; r1: number; c1: number; r2: number; c2: number }
  | { k: 'fn'; name: string; args: Node[] }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'neg'; a: Node }
  | { k: 'pct'; a: Node }
  | { k: 'array'; rows: Node[][] };

/** Resolves a sheet name to its index; external workbook refs resolve to -1. */
export type SheetResolver = (name: string) => number;

const ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];
const CMP_OPS = ['<=', '>=', '<>', '=', '<', '>'];

export function parseFormula(src: string, currentSheet: number, resolve: SheetResolver): Node {
  let i = 0;

  const fail = (msg: string): never => {
    throw new Error(`${msg} at ${i} in: ${src}`);
  };
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const peek = (s: string) => {
    ws();
    return src.startsWith(s, i);
  };
  const eat = (s: string) => {
    if (!peek(s)) fail(`expected '${s}'`);
    i += s.length;
  };

  function expr(): Node {
    let a = concat();
    for (;;) {
      ws();
      const op = CMP_OPS.find((o) => src.startsWith(o, i));
      if (!op) return a;
      i += op.length;
      a = { k: 'bin', op, a, b: concat() };
    }
  }
  function concat(): Node {
    let a = additive();
    while (peek('&')) {
      i++;
      a = { k: 'bin', op: '&', a, b: additive() };
    }
    return a;
  }
  function additive(): Node {
    let a = mult();
    for (;;) {
      if (peek('+') || peek('-')) {
        const op = src[i++];
        a = { k: 'bin', op, a, b: mult() };
      } else return a;
    }
  }
  function mult(): Node {
    let a = power();
    for (;;) {
      if (peek('*') || peek('/')) {
        const op = src[i++];
        a = { k: 'bin', op, a, b: power() };
      } else return a;
    }
  }
  function power(): Node {
    let a = unary();
    while (peek('^')) {
      i++;
      a = { k: 'bin', op: '^', a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    if (peek('-')) {
      i++;
      return { k: 'neg', a: unary() };
    }
    if (peek('+')) {
      i++;
      return unary();
    }
    let a = primary();
    while (peek('%')) {
      i++;
      a = { k: 'pct', a };
    }
    return a;
  }

  function primary(): Node {
    ws();
    const ch = src[i];
    if (ch === '(') {
      i++;
      const e = expr();
      eat(')');
      return e;
    }
    if (ch === '"') {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) fail('unterminated string');
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      return { k: 'str', v: s };
    }
    if (ch === '#') {
      const e = ERRORS.find((x) => src.startsWith(x, i));
      if (!e) fail('bad error literal');
      i += e!.length;
      // "#REF!" can appear as a sheet-qualified broken ref: Sheet!#REF!
      return { k: 'err', v: errFromCode(e!) };
    }
    if (ch === '{') {
      i++;
      const rows: Node[][] = [[]];
      for (;;) {
        rows[rows.length - 1].push(unary());
        ws();
        if (src[i] === ',') i++;
        else if (src[i] === ';') {
          i++;
          rows.push([]);
        } else if (src[i] === '}') {
          i++;
          break;
        } else fail('bad array literal');
      }
      return { k: 'array', rows };
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    // a leading number could also be a row range like 1:3 (not used by the workbook)
    if (num && !/^\d+:\d/.test(src.slice(i))) {
      i += num[0].length;
      return { k: 'num', v: parseFloat(num[0]) };
    }
    return refOrName();
  }

  function refOrName(): Node {
    ws();
    let sheet = currentSheet;
    let sheetQualified = false;
    const rest = src.slice(i);
    // External workbook reference: [4]Sheet!A1 -- the links are dead, resolve to #N/A
    let m = /^\[\d+\]('(?:[^']|'')+'|[^\s!(),]+)!/.exec(rest);
    if (m) {
      i += m[0].length;
      sheet = -1;
      sheetQualified = true;
    } else {
      m = /^'((?:[^']|'')+)'!/.exec(rest) ?? /^([\p{L}\p{N}_.]+)!/u.exec(rest);
      if (m) {
        i += m[0].length;
        sheet = resolve(m[1].replace(/''/g, "'"));
        sheetQualified = true;
      }
    }
    const after = src.slice(i);
    if (sheetQualified && after.startsWith('#REF!')) {
      i += 5;
      return { k: 'err', v: errFromCode('#REF!') };
    }
    // Cell or range: A1, $A$1, A1:B2, A:A
    const cell = /^\$?([A-Za-z]{1,3})\$?(\d+)(?![\w(])/.exec(after);
    const colOnly = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![\w(])/.exec(after);
    if (colOnly && !cell) {
      i += colOnly[0].length;
      const c1 = colToIndex(colOnly[1]);
      const c2 = colToIndex(colOnly[2]);
      return mkRef(sheet, 0, Math.min(c1, c2), MAX_ROW, Math.max(c1, c2));
    }
    if (cell) {
      i += cell[0].length;
      let r1 = parseInt(cell[2], 10) - 1;
      let c1 = colToIndex(cell[1]);
      let r2 = r1;
      let c2 = c1;
      const m2 = /^\s*:\s*\$?([A-Za-z]{1,3})\$?(\d+)(?![\w(])/.exec(src.slice(i));
      if (m2) {
        i += m2[0].length;
        r2 = parseInt(m2[2], 10) - 1;
        c2 = colToIndex(m2[1]);
      }
      [r1, r2] = [Math.min(r1, r2), Math.max(r1, r2)];
      [c1, c2] = [Math.min(c1, c2), Math.max(c1, c2)];
      if (c2 > MAX_COL) fail('column out of range');
      return mkRef(sheet, r1, c1, r2, c2);
    }
    if (sheetQualified) fail('expected reference after sheet name');
    // Function call or boolean literal
    const fm = /^(?:_xlfn\.|_xlws\.)?([A-Za-z][A-Za-z0-9._]*)/.exec(after);
    if (!fm) fail(`unexpected '${src[i]}'`);
    i += fm![0].length;
    const name = fm![1].toUpperCase();
    if (peek('(')) {
      i++;
      const args: Node[] = [];
      ws();
      if (src[i] === ')') {
        i++;
        return { k: 'fn', name, args };
      }
      for (;;) {
        ws();
        if (src[i] === ',' || src[i] === ')') args.push({ k: 'missing' });
        else args.push(expr());
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        eat(')');
        break;
      }
      return { k: 'fn', name, args };
    }
    if (name === 'TRUE' || name === 'FALSE') return { k: 'bool', v: name === 'TRUE' };
    return { k: 'err', v: errFromCode('#NAME?') };
  }

  function mkRef(sheet: number, r1: number, c1: number, r2: number, c2: number): Node {
    if (sheet < 0) return { k: 'err', v: errFromCode('#N/A') };
    return { k: 'ref', sheet, r1, c1, r2, c2 };
  }

  const node = expr();
  ws();
  if (i < src.length) fail('trailing input');
  return node;
}

/** Collect every reference node in a formula (for dependency analysis). */
export function collectRefs(n: Node, out: Extract<Node, { k: 'ref' }>[] = []) {
  switch (n.k) {
    case 'ref':
      out.push(n);
      break;
    case 'fn':
      n.args.forEach((a) => collectRefs(a, out));
      break;
    case 'bin':
      collectRefs(n.a, out);
      collectRefs(n.b, out);
      break;
    case 'neg':
    case 'pct':
      collectRefs(n.a, out);
      break;
    case 'array':
      n.rows.flat().forEach((a) => collectRefs(a, out));
      break;
  }
  return out;
}
