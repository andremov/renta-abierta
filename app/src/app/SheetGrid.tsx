// Renders one worksheet as a CSS grid that mirrors the Excel layout.
import { memo, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CellStyle, ModelSheet } from '../engine/workbook';
import { XErr, type Scalar } from '../engine/types';
import type { Session } from './store';
import { buildLayout, type Placed } from './layout';
import { editText, formatValue, parseInput } from './format';
import { checkValidation, listOptions, validationAt } from './validation';

interface Props {
  session: Session;
  sheet: ModelSheet;
  hiddenRows: Set<number>;
  onFocusCell: (a1: string | null) => void;
  onNavigate: (sheet: string) => void;
  titles: Map<string, string>;
}

const BORDER: Record<string, string> = {
  thin: '1px solid',
  hair: '1px solid',
  dotted: '1px dotted',
  dashed: '1px dashed',
  medium: '2px solid',
  mediumDashed: '2px dashed',
  thick: '3px solid',
  double: '3px double',
};

function border(spec: string | null | undefined): string | undefined {
  if (!spec) return undefined;
  const [kind, color] = spec.split(' ');
  return `${BORDER[kind] ?? '1px solid'} ${color}`;
}

function cellCss(st: CellStyle | undefined, numeric: boolean): CSSProperties {
  const css: CSSProperties = {};
  if (!st) return numeric ? { justifyContent: 'flex-end', textAlign: 'right' } : css;
  if (st.bg) css.background = st.bg;
  if (st.color) css.color = st.color;
  if (st.b) css.fontWeight = 700;
  if (st.i) css.fontStyle = 'italic';
  if (st.u) css.textDecoration = 'underline';
  if (st.sz) css.fontSize = `${Math.max(9, Math.min(st.sz, 18)) * 1.2}px`;
  const ha = st.ha ?? (numeric ? 'right' : 'left');
  css.justifyContent = ha === 'center' || ha === 'centerContinuous' ? 'center' : ha === 'right' ? 'flex-end' : 'flex-start';
  css.textAlign = ha === 'center' || ha === 'centerContinuous' ? 'center' : ha === 'right' ? 'right' : ha === 'justify' ? 'justify' : 'left';
  css.alignItems = st.va === 'top' ? 'flex-start' : st.va === 'center' ? 'center' : 'flex-end';
  if (st.wrap) css.whiteSpace = 'pre-wrap';
  if (st.indent) css.paddingLeft = `${st.indent * 9 + 3}px`;
  if (st.bd) {
    css.borderTop = border(st.bd[0]);
    css.borderRight = border(st.bd[1]);
    css.borderBottom = border(st.bd[2]);
    css.borderLeft = border(st.bd[3]);
  }
  return css;
}

export function SheetGrid({ session, sheet, hiddenRows, onFocusCell, onNavigate, titles }: Props) {
  const layout = useMemo(() => buildLayout(sheet, hiddenRows), [sheet, hiddenRows]);
  const styles = session.model.styles ?? [];
  const si = session.wb.sheetIndex(sheet.name);
  return (
    <div className="sheet-scroll">
      <div
        className="sheet-grid"
        role="grid"
        aria-label={titles.get(sheet.name) ?? sheet.name}
        style={{
          gridTemplateColumns: layout.widths.map((w) => `${w}px`).join(' '),
          // fixed tracks like Excel rows; auto-sized tracks with spanning merges make layout very slow
          gridTemplateRows: layout.heights.map((h) => `${h}px`).join(' '),
        }}
      >
        {layout.cells.map((p) => (
          <GridCell
            key={p.a1 + p.row}
            p={p}
            style={p.cell?.s !== undefined ? styles[p.cell.s] : undefined}
            session={session}
            sheet={sheet}
            si={si}
            value={session.wb.get(si, p.r, p.c)}
            version={session.version}
            onFocusCell={onFocusCell}
          />
        ))}
        {layout.controls.map((ctl) => {
          const label = ctl.text || titles.get(ctl.target) || ctl.target;
          return (
            <button
              key={ctl.name}
              type="button"
              className={ctl.text ? 'nav-btn' : 'nav-btn nav-btn--overlay'}
              style={{ gridRow: `${ctl.row} / ${ctl.rowEnd + 1}`, gridColumn: `${ctl.col} / ${ctl.colEnd + 1}` }}
              onClick={() => onNavigate(ctl.target)}
              title={`Ir a: ${titles.get(ctl.target) ?? ctl.target}`}
              aria-label={label}
            >
              {ctl.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CellProps {
  p: Placed;
  style?: CellStyle;
  session: Session;
  sheet: ModelSheet;
  si: number;
  value: Scalar;
  version: number;
  onFocusCell: (a1: string | null) => void;
}

const GridCell = memo(function GridCell({ p, style, session, sheet, si, value, onFocusCell }: CellProps) {
  const isInput = !!p.cell?.in;
  const numeric = typeof value === 'number';
  const css: CSSProperties = {
    ...cellCss(style, numeric),
    gridRow: `${p.row} / span ${p.rowSpan}`,
    gridColumn: `${p.col} / span ${p.colSpan}`,
  };
  if (isInput) {
    return (
      <div className="cell cell--input" style={css}>
        <CellInput a1={p.a1} label={p.label ?? p.a1} nf={p.cell?.nf} value={value} session={session} sheet={sheet} si={si} onFocusCell={onFocusCell} />
      </div>
    );
  }
  const text = value instanceof XErr ? '' : formatValue(value, p.cell?.nf);
  return (
    <div className={p.cell?.f !== undefined ? 'cell cell--calc' : 'cell'} style={css} data-a1={p.a1}>
      {text}
    </div>
  );
});

interface InputProps {
  a1: string;
  label: string;
  nf?: string;
  value: Scalar;
  session: Session;
  sheet: ModelSheet;
  si: number;
  onFocusCell: (a1: string | null) => void;
}

function CellInput({ a1, label, nf, value, session, sheet, si, onFocusCell }: InputProps) {
  const dv = useMemo(() => validationAt(sheet, a1), [sheet, a1]);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `in-${sheet.codeName ?? si}-${a1}`;
  const options = dv?.type === 'list' ? listOptions(session.wb, si, a1, dv) : null;

  const commit = (raw: string) => {
    const parsed = parseInput(raw, nf);
    if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
      setError(parsed.error);
      return;
    }
    const err = dv ? checkValidation(session.wb, si, a1, dv, parsed) : null;
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setDraft(null);
    if (parsed !== value) session.set(sheet.name, a1, parsed);
  };

  const common = {
    id,
    'aria-label': label,
    title: label,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-err` : undefined,
    onFocus: () => onFocusCell(a1),
  };

  if (options) {
    const current = value === null ? '' : typeof value === 'number' ? formatValue(value) : String(value);
    const known = options.some((o) => o === current);
    return (
      <>
        <select {...common} value={current} onChange={(e) => commit(e.target.value)}>
          <option value="">—</option>
          {!known && current && <option value={current}>{current}</option>}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {error && <span id={`${id}-err`} className="cell-error" role="alert">{error}</span>}
      </>
    );
  }

  const shown = draft ?? editText(value, nf);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit(e.currentTarget.value);
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(null);
      setError(null);
      e.currentTarget.blur();
    }
  };
  return (
    <>
      <input
        {...common}
        type="text"
        inputMode={nf === '@' ? 'text' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={onKey}
      />
      {error && <span id={`${id}-err`} className="cell-error" role="alert">{error}</span>}
    </>
  );
}
