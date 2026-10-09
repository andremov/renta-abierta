// andremov-brand-check-unique: the wizard's field (label row with Ayuda and Pendiente, figures right-aligned in monospace like the printed form, computed rows) is this tool's own UI
// One form field bound to a workbook cell.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Scalar } from '../engine/types';
import { XErr } from '../engine/types';
import type { Session } from '../app/store';
import { dateToSerial, editText, formatValue, parseInput, serialToDate } from '../app/format';
import { checkValidation, listOptions, pickOption, tidyOption, type Validation } from '../app/validation';
import type { CellHelp } from '../app/nav';
import type { FieldType } from './spec';
import { Check } from 'lucide-react';
import { Notice, SegmentedControl, SelectField, Text } from '@andremov/brand';
import { Button } from '@andremov/brand/ui/button';
import { Input } from '@andremov/brand/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@andremov/brand/ui/input-group';
import { Toggle } from '@andremov/brand/ui/toggle';

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
      const selected = opts.find((o) => o.toUpperCase() === v) ?? null;
      control = (
        <SegmentedControl
          aria-label={label}
          options={opts.map((o) => ({ value: o, label: o === 'Si' || o === 'SI' ? 'Sí' : o }))}
          value={selected}
          // choosing the selected answer again clears it
          onChange={(o) => commit(o === selected ? null : o)}
        />
      );
      break;
    }
    case 'check':
      control = (
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            {...common}
            type="checkbox"
            className="size-4 accent-primary"
            checked={String(value ?? '').trim().toUpperCase() === 'X'}
            onChange={(e) => commit(e.target.checked ? 'X' : null)}
          />
          <Text as="span">Sí</Text>
        </label>
      );
      break;
    case 'select': {
      const current = value === null ? '' : typeof value === 'number' ? formatValue(value) : String(value);
      if (options.length > 40) {
        control = (
          <>
            <Input
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
          <SelectField
            {...common}
            value={current}
            onChange={(v) => commitPick(v)}
            options={[
              { value: '', label: 'Seleccione…' },
              ...(current && !options.includes(current) ? [{ value: current, label: current }] : []),
              ...options.map((o) => ({ value: o, label: o })),
            ]}
          />
        );
      }
      break;
    }
    case 'date':
      control = (
        <Input
          {...common}
          type="date"
          value={typeof value === 'number' ? isoDate(value) : ''}
          onChange={(e) => commit(e.target.value ? dateToSerial(e.target.value.split('-').reverse().join('/')) : null)}
        />
      );
      break;
    default: {
      const shownNf = type === 'money' ? MONEY_NF : type === 'id' ? '0' : nf;
      const numeric = type === 'money' || type === 'number' || type === 'percent';
      control = (
        <InputGroup>
          {type === 'money' && (
            <InputGroupAddon aria-hidden="true">
              <Text variant="mono">$</Text>
            </InputGroupAddon>
          )}
          <InputGroupInput
            {...common}
            type="text"
            // figures in the brand's monospace with tabular digits, right-aligned like the printed form
            className={numeric ? 'font-mono tabular-nums text-right' : type === 'id' ? 'font-mono tabular-nums' : undefined}
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
          {type === 'percent' && (
            <InputGroupAddon align="inline-end" aria-hidden="true">
              <Text variant="mono">%</Text>
            </InputGroupAddon>
          )}
        </InputGroup>
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
    <div className="field flex min-w-0 flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <Text as="label" variant="heading" id={`${id}-label`} htmlFor={type === 'yesno' ? undefined : id} className="pt-1">
          {label}
        </Text>
        <span className="inline-flex shrink-0 items-center gap-1">
          {help?.text && (
            <Button variant="link" size="xs" aria-expanded={showHelp} aria-controls={`${id}-help`} onClick={() => setShowHelp(!showHelp)}>
              {showHelp ? 'Ocultar ayuda' : 'Ayuda'}
            </Button>
          )}
          <Toggle
            size="sm"
            className="h-6 px-2 text-xs"
            pressed={pendingNote !== undefined}
            title="Marque el dato como pendiente para revisarlo antes de presentar"
            onPressedChange={(on: boolean) => session.setPending(key, on ? '' : null)}
          >
            {pendingNote !== undefined && <Check aria-hidden />}
            Pendiente
          </Toggle>
        </span>
      </div>
      {dv?.prompt && !compact && (
        <Text variant="hint" as="p" id={`${id}-hint`} className="hint">
          {dv.prompt}
        </Text>
      )}
      {control}
      {error && (
        <Text as="p" id={`${id}-err`} className="text-danger-text" role="alert">
          {error}
        </Text>
      )}
      {!error && warning && (
        <Notice tone="warning" className="p-3">
          {warning}
        </Notice>
      )}
      {pendingNote !== undefined && (
        <Input
          aria-label={`Nota sobre lo pendiente: ${label}`}
          placeholder="¿Qué falta confirmar? (opcional)"
          value={pendingNote}
          onChange={(e) => session.setPending(key, e.target.value)}
        />
      )}
      {help && showHelp && (
        <Notice tone="info" id={`${id}-help`} title={help.title || undefined}>
          <div className="grid gap-1.5 whitespace-pre-line">
            {help.text.split(/\n+/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {help.norms && (
              <Text variant="hint" as="p">
                {help.norms.replace(/\n+/g, ' ')}
              </Text>
            )}
          </div>
        </Notice>
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
      <output className="font-mono tabular-nums">{text || '—'}</output>
    </div>
  );
}
