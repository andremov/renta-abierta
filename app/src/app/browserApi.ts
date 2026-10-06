// `window.rentaAbierta`: the same operations as the form, for assistants and testers that drive
// the page (documented in docs/respaldo.md). Values go through the form's own conversions and
// validations; nothing here sends data anywhere.
import { XErr, type Scalar } from '../engine/types';
import type { Session } from './store';
import { normalizeInput } from './api';
import { listOptions, validationAt } from './validation';
import { catalogFor } from '../forms/catalog';
import { QUESTIONS } from '../forms/pages';
import CASILLAS from '../forms/casillas.json';

type Result = { ok: true; value: Scalar } | { ok: false; error: string };

const plain = (v: Scalar) => (v instanceof XErr ? null : v);

/** Boxes of last year's Form 210 the program asks for, and where. */
export const PRIOR_YEAR: Record<number, string> = {
  29: 'DatosGenerales!C10', // patrimonio bruto 2024
  31: 'DatosGenerales!E10', // patrimonio líquido 2024
  126: 'DatosGenerales!H11', // impuesto neto de renta 2024 (shown once "años declarados" is filled)
  133: 'Liquidacion_Privada!G30', // anticipo para 2025
  137: 'Liquidacion_Privada!G28', // saldo a favor 2024 sin devolución ni compensación
};

export function installBrowserApi(session: Session) {
  const split = (key: string): [string, string] => {
    const i = key.lastIndexOf('!');
    return [key.slice(0, i), key.slice(i + 1)];
  };
  const setInput = (key: string, value: unknown): Result => {
    session.flush();
    const n = normalizeInput(session.model, session.wb, key, value, true);
    if (!n.ok) return n;
    const [sheet, a1] = split(key);
    session.set(sheet, a1, n.value);
    return { ok: true, value: session.raw(sheet, a1) };
  };
  const api = {
    version: 1,
    /** every input: key ("Hoja!A1"), page, section, label, type */
    fields: () => catalogFor(session.model),
    /** current choices of a list field (they can depend on other answers) */
    options: (key: string): string[] => {
      const [sheet, a1] = split(key);
      const sh = session.model.sheets.find((s) => s.name === sheet);
      const dv = sh && validationAt(sh, a1);
      return (dv && listOptions(session.wb, session.wb.sheetIndex(sheet), a1, dv)) ?? [];
    },
    getInputs: () => ({ ...session.inputs }),
    getInput: (key: string) => session.raw(...split(key)),
    setInput,
    /** sets several values; ones that fail are retried once at the end (list options may depend on later values) */
    setInputs: (values: Record<string, unknown>) => {
      const errors: Record<string, string> = {};
      let retry: [string, unknown][] = [];
      for (const [k, v] of Object.entries(values)) {
        const r = setInput(k, v);
        if (!r.ok) retry.push([k, v]);
      }
      retry = retry.filter(([k, v]) => {
        const r = setInput(k, v);
        if (!r.ok) errors[k] = r.error;
        return !r.ok;
      });
      return { ok: retry.length === 0, errors };
    },
    /** value of any workbook cell after recalculation, e.g. "Formulario!AK43" */
    value: (key: string) => plain(session.get(...split(key))),
    /** Form 210 boxes with their current values */
    casillas: () =>
      (CASILLAS as { n: number; concept: string; cell: string | null }[]).map((b) => ({
        n: b.n,
        concepto: b.concept,
        valor: b.cell ? plain(session.get('Formulario', b.cell)) : null,
      })),
    questions: () => QUESTIONS.map((q) => ({ ...q, answer: session.profile[q.id] ?? null })),
    setAnswer: (id: string, yes: boolean | null) => {
      if (!QUESTIONS.some((q) => q.id === id)) return { ok: false, error: `No existe la pregunta ${id}.` };
      session.setAnswer(id, yes);
      return { ok: true };
    },
    /** values from last year's Form 210, by box number (29, 31, 126, 133, 137) */
    setPriorYear: (boxes: Record<string | number, unknown>) =>
      api.setInputs(Object.fromEntries(Object.entries(boxes).map(([n, v]) => [PRIOR_YEAR[Number(n)] ?? `casilla ${n}`, v]))),
    pending: () => ({ ...session.pending }),
    setPending: (key: string, note: string | null) => session.setPending(key, note),
    exportBackup: () => session.exportJSON(),
    importBackup: (data: string | object) => session.importJSON(typeof data === 'string' ? data : JSON.stringify(data)),
  };
  Object.assign(window, { rentaAbierta: api });
}
