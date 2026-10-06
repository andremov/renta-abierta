// Values that arrive from outside the form (a hand-made backup, the browser API) go through
// the same conversions a person's typing does: list options matched loosely, Colombian number
// format parsed, text codes kept as text.
import type { Scalar } from '../engine/types';
import type { Model, Workbook } from '../engine/workbook';
import { EXTRA_BY_KEY } from './rules';
import { parseInput } from './format';
import { checkValidation, listOptions, pickOption, validationAt } from './validation';
import { fieldType } from '../forms/catalog';

export type Normalized = { ok: true; value: Scalar } | { ok: false; error: string };

/**
 * `strict` also applies the cell's data validation against the current answers (the browser API);
 * imports skip it, because list options can depend on answers that are restored later in the file.
 */
export function normalizeInput(model: Model, wb: Workbook, key: string, v: unknown, strict: boolean): Normalized {
  const i = key.lastIndexOf('!');
  const sheet = key.slice(0, i);
  const a1 = key.slice(i + 1);
  const sh = model.sheets.find((s) => s.name === sheet);
  const cell = sh?.cells[a1];
  if (!sh || !(cell?.in || EXTRA_BY_KEY.has(key))) return { ok: false, error: `${key} no es una casilla para diligenciar.` };
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'number' && typeof v !== 'string') return { ok: false, error: `${key}: use un número o un texto.` };
  const si = wb.sheetIndex(sheet);
  const nf = cell?.nf;
  const dv = validationAt(sh, a1);
  let value: Scalar = v;
  const options = dv?.type === 'list' ? listOptions(wb, si, a1, dv) : null;
  if (options?.length) {
    const match = pickOption(options, String(v));
    if (match !== undefined) value = nf !== '@' && /^-?(0|[1-9]\d*)$/.test(match) ? Number(match) : match;
    else if (strict) return { ok: false, error: `${key}: «${v}» no está en la lista de opciones.` };
  } else if (typeof v === 'string') {
    // same reading as the form field: text columns stay text whatever their number format
    const type = fieldType(model, key);
    const parsed = parseInput(v, type === 'text' ? '@' : type === 'id' ? '0' : nf);
    if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) return { ok: false, error: `${key}: ${parsed.error}` };
    value = parsed as Scalar;
  } else if (nf === '@') value = String(v);
  if (strict && dv && dv.type !== 'list') {
    const err = checkValidation(wb, si, a1, dv, value);
    if (err) return { ok: false, error: `${key}: ${err}` };
  }
  return { ok: true, value };
}
