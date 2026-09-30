// Fields for the values the Excel file asked for in pop-up windows, and links to
// the question sheets the VBA used to jump to automatically.
import { useState } from 'react';
import type { Session } from './store';
import { EXTRA_INPUTS, HELPER_OF, gatedHiddenRows, gatedRows, type ExtraInput } from './rules';
import { editText, formatValue, parseInput } from './format';

export function ExtrasPanel({ session, sheet }: { session: Session; sheet: string }) {
  const active = EXTRA_INPUTS.filter((x) => x.sheet === sheet && x.when(session.raw));
  if (!active.length) return null;
  return (
    <section className="extras" aria-labelledby="extras-h">
      <h2 id="extras-h">Datos adicionales</h2>
      <p className="muted">
        El programa de Excel pedía estos valores en ventanas emergentes según sus respuestas anteriores.
      </p>
      <div className="extras-list">
        {active.map((x) => (
          <ExtraField key={x.cell} x={x} session={session} />
        ))}
      </div>
    </section>
  );
}

function ExtraField({ x, session }: { x: ExtraInput; session: Session }) {
  const id = `extra-${x.sheet}-${x.cell}`;
  const value = session.raw(x.sheet, x.cell);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nf = x.kind === 'money' ? '#,##0' : '0.##';

  const commit = (raw: string) => {
    const parsed = parseInput(raw, nf);
    if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) return setError(parsed.error);
    if (parsed !== null && (typeof parsed !== 'number' || parsed < 0)) return setError('Escriba un valor mayor o igual a cero.');
    const max = x.max?.(session.raw);
    if (typeof parsed === 'number' && max != null && parsed > max)
      return setError(`El valor no puede superar ${formatValue(max, x.kind === 'money' ? '"$"\\ #,##0' : '0')}.`);
    setError(null);
    setDraft(null);
    session.set(x.sheet, x.cell, parsed);
  };
  const warning = typeof value === 'number' && x.warn ? x.warn(value, session.raw, (s, a) => session.get(s, a)) : null;

  return (
    <div className="extra">
      <label htmlFor={id}>{x.label}</label>
      <p className="muted small">{x.prompt}</p>
      <div className="extra-input">
        {x.kind === 'money' && <span aria-hidden="true">$</span>}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft ?? editText(value, nf)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => draft !== null && commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {x.kind === 'percent' && <span aria-hidden="true">%</span>}
      </div>
      {error && <p id={`${id}-err`} className="field-error" role="alert">{error}</p>}
      {!error && warning && <p className="field-warn">{warning}</p>}
    </div>
  );
}

/** Question sheets with open questions for this sheet (e.g. salary follow-ups). */
export function HelperLinks({ session, sheet, go, titles }: { session: Session; sheet: string; go: (s: string) => void; titles: Map<string, string> }) {
  const helpers = Object.entries(HELPER_OF)
    .filter(([h, owner]) => owner === sheet && h !== 'Datos_Otros_Ingresos')
    .filter(([h]) => {
      const hidden = gatedHiddenRows(h, session.raw);
      return [...gatedRows(h)].some((r) => !hidden.has(r));
    })
    .map(([h]) => h);
  if (!helpers.length) return null;
  return (
    <div className="helpers" role="note">
      <strong>Preguntas adicionales según lo que diligenció:</strong>
      <div className="helpers-list">
        {helpers.map((h) => (
          <button key={h} type="button" className="nav-chip" onClick={() => go(h)}>
            {titles.get(h) ?? h.replace(/_/g, ' ')} →
          </button>
        ))}
      </div>
    </div>
  );
}
