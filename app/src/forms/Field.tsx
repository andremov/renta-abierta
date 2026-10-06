// One form field bound to a workbook cell.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Scalar } from '../engine/types';
import { XErr } from '../engine/types';
import type { Session } from '../app/store';
import { dateToSerial, editText, formatValue, parseInput, serialToDate } from '../app/format';
import { checkValidation, listOptions, pickOption, tidyOption, type Validation } from '../app/validation';
import type { CellHelp } from '../app/nav';
import type { FieldType } from './spec';

interface InputProps {
  session: Session;
  sheet: string;
  a1: string;
  label: string;
  type: FieldType;
  nf?: string;
  dv?: Validation | null;
  help?: CellHelp;
  /** extra validation (e.g. pop-up values that cannot exceed their source) */
  check?: (v: Scalar) => string | null;
  warning?: string | null;
  compact?: boolean;
}

const MONEY_NF = '#,##0';

export function FieldInput({ session, sheet, a1, label, type, nf, dv, help, check, warning, compact }: InputProps) {
  const id = useId();
  const si = session.wb.sheetIndex(sheet);
  const value = session.raw(sheet, a1);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const key = `${sheet}!${a1}`;
  const pendingNote = session.pending[key];
  const options = useMemo(
    () => (type === 'select' && dv ? listOptions(session.wb, si, a1, dv) ?? [] : []),
    // options can depend on other answers (e.g. year lists), so refresh on every recalculation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, dv, si, a1, session.version],
  );

  /** `live`: saving while the person is still typing; keeps their text as typed and stays quiet on errors. */
  const commit = (v: Scalar, live = false) => {
    const err = (dv ? checkValidation(session.wb, si, a1, dv, v) : null) ?? check?.(v) ?? null;
    if (err) {
      if (!live) setError(err);
      return;
    }
    setError(null);
    if (!live) setDraft(null);
    if (v !== session.raw(sheet, a1)) session.set(sheet, a1, v);
  };
  const commitText = (raw: string, live = false) => {
    const effNf = type === 'money' ? nf ?? MONEY_NF : type === 'id' ? '0' : type === 'text' ? '@' : nf;
    const parsed = parseInput(raw, effNf);
    if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) return live || setError(parsed.error);
    if (type === 'text' && typeof parsed === 'string' && /^\d+$/.test(parsed) && /^0|#/.test(nf ?? '')) return commit(Number(parsed), live);
    commit(parsed as Scalar, live);
  };
  const commitDraft = (raw: string, live = false) => (type === 'select' ? commitPick(raw, live) : commitText(raw, live));

  // Typed text is saved shortly after the last keystroke, not only on blur, and whatever is still
  // pending is saved when the field goes away (Continuar, jumping to another step, closing the tab).
  const pending = useRef<string | null>(null);
  pending.current = draft;
  const flush = useRef(() => {});
  flush.current = () => {
    if (pending.current !== null) commitDraft(pending.current, true);
  };
  useEffect(() => {
    if (draft === null) return;
    const t = setTimeout(() => flush.current(), 400);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    const onHide = () => flush.current();
    addEventListener('pagehide', onHide);
    const unregister = session.onFlush(onHide);
    return () => {
      removeEventListener('pagehide', onHide);
      unregister();
      flush.current();
    };
  }, [session]);

  const describedBy = [error && `${id}-err`, help && showHelp && `${id}-help`, dv?.prompt && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  // `name`/`data-cell` are stable handles for testers and assistive tools ("Sheet!A1", as in backups)
  const common = { id, name: `${sheet}!${a1}`, 'data-cell': `${sheet}!${a1}`, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy };

  let control;
  switch (type) {
    case 'yesno': {
      const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
      const opts = dv?.f1?.slice(1, -1).split(',').map((s) => s.trim()) ?? ['Si', 'No'];
      control = (
        <div className="seg" role="radiogroup" aria-labelledby={`${id}-label`}>
          {opts.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={v === o.toUpperCase()}
              className={v === o.toUpperCase() ? 'on' : ''}
              onClick={() => commit(v === o.toUpperCase() ? null : o)}
            >
              {o === 'Si' || o === 'SI' ? 'Sí' : o}
            </button>
          ))}
        </div>
      );
      break;
    }
    case 'check':
      control = (
        <label className="check">
          <input {...common} type="checkbox" checked={String(value ?? '').trim().toUpperCase() === 'X'} onChange={(e) => commit(e.target.checked ? 'X' : null)} />
          <span>Sí</span>
        </label>
      );
      break;
    case 'select': {
      const current = value === null ? '' : typeof value === 'number' ? formatValue(value) : String(value);
      if (options.length > 40) {
        control = (
          <>
            <input
              {...common}
              list={`${id}-list`}
              value={draft ?? tidyOption(current)}
              placeholder="Escriba para buscar…"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => draft !== null && commitPick(e.target.value)}
            />
            <datalist id={`${id}-list`}>
              {options.map((o) => (
                <option key={o} value={tidyOption(o)} />
              ))}
            </datalist>
          </>
        );
      } else {
        control = (
          <select {...common} value={current} onChange={(e) => commitPick(e.target.value)}>
            <option value="">Seleccione…</option>
            {current && !options.includes(current) && <option value={current}>{current}</option>}
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      }
      break;
    }
    case 'date':
      control = (
        <input
          {...common}
          type="date"
          value={typeof value === 'number' ? isoDate(value) : ''}
          onChange={(e) => commit(e.target.value ? dateToSerial(e.target.value.split('-').reverse().join('/')) : null)}
        />
      );
      break;
    default: {
      const shownNf = type === 'money' ? MONEY_NF : type === 'id' ? '0' : nf;
      control = (
        <div className={`text-input ${type}`}>
          {type === 'money' && <span className="affix" aria-hidden="true">$</span>}
          <input
            {...common}
            type="text"
            inputMode={type === 'text' ? 'text' : type === 'id' ? 'numeric' : 'decimal'}
            autoComplete="off"
            spellCheck={type === 'text'}
            value={draft ?? (type === 'id' && typeof value === 'number' ? String(value) : editText(value, shownNf))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => draft !== null && commitText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDraft(null);
                setError(null);
              }
            }}
          />
          {type === 'percent' && <span className="affix" aria-hidden="true">%</span>}
        </div>
      );
    }
  }

  function commitPick(raw: string, live = false) {
    if (!raw.trim()) return commit(null, live);
    const match = pickOption(options, raw);
    if (!match) return live || setError('Elija una opción de la lista.');
    // codes like "0010" are text in the workbook; only plain numbers become numbers
    const n = nf !== '@' && /^-?(0|[1-9]\d*)$/.test(match) ? Number(match) : null;
    commit(n ?? match, live);
  }

  return (
    <div className={`field${compact ? ' compact' : ''}${error ? ' has-error' : ''}`}>
      <div className="field-head">
        <label id={`${id}-label`} htmlFor={type === 'yesno' ? undefined : id}>
          {label}
        </label>
        <span className="field-tools">
        {help?.text && (
          <button type="button" className="help-toggle" aria-expanded={showHelp} aria-controls={`${id}-help`} onClick={() => setShowHelp(!showHelp)}>
            {showHelp ? 'Ocultar ayuda' : 'Ayuda'}
          </button>
        )}
        <button
          type="button"
          className={`pending-toggle${pendingNote !== undefined ? ' on' : ''}`}
          aria-pressed={pendingNote !== undefined}
          title="Marque el dato como pendiente para revisarlo antes de presentar"
          onClick={() => session.setPending(key, pendingNote !== undefined ? null : '')}
        >
          {pendingNote !== undefined ? 'Pendiente ✓' : 'Pendiente'}
        </button>
        </span>
      </div>
      {dv?.prompt && !compact && (
        <p id={`${id}-hint`} className="hint">
          {dv.prompt}
        </p>
      )}
      {control}
      {error && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      )}
      {!error && warning && <p className="field-warn">{warning}</p>}
      {pendingNote !== undefined && (
        <input
          className="pending-note"
          aria-label={`Nota sobre lo pendiente: ${label}`}
          placeholder="¿Qué falta confirmar? (opcional)"
          value={pendingNote}
          onChange={(e) => session.setPending(key, e.target.value)}
        />
      )}
      {help && showHelp && (
        <div id={`${id}-help`} className="help-box">
          {help.title && <strong>{help.title}</strong>}
          {help.text.split(/\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {help.norms && <p className="norms">{help.norms.replace(/\n+/g, ' ')}</p>}
        </div>
      )}
    </div>
  );
}

function isoDate(serial: number): string {
  const [d, m, y] = serialToDate(serial).split('/');
  return `${y}-${m}-${d}`;
}

/** Read-only computed value. */
export function CalcRow({ label, value, nf, strong }: { label: string; value: Scalar; nf?: string; strong?: boolean }) {
  const text = value instanceof XErr ? '' : formatValue(value, nf && /[#0$]/.test(nf) ? nf : typeof value === 'number' ? '"$"\\ #,##0' : nf);
  return (
    <div className={`calc${strong ? ' strong' : ''}`}>
      <span>{label}</span>
      <output className="num">{text || '—'}</output>
    </div>
  );
}
