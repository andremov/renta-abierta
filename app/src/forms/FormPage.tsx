// Renders one page of the questionnaire-driven form from generated sheet specs.
import { useState } from 'react';
import type { Model } from '../engine/workbook';
import { parseA1, toA1, type Scalar } from '../engine/types';
import type { Session } from '../app/store';
import { gatedHiddenRows, type ExtraInput } from '../app/rules';
import { helpTable, sheetByName, type CellHelp } from '../app/nav';
import { validationAt } from '../app/validation';
import { formatValue } from '../app/format';
import { buildSpec, filledRows, sectionHasData, type Block, type Field, type FormSpec, type RepeatGroup, type Section, type TableColumn } from './spec';
import { CalcRow, FieldInput } from './Field';
import type { PageDef } from './pages';

const specCache = new Map<string, FormSpec>();
export function specFor(model: Model, sheet: string, title: string): FormSpec {
  let s = specCache.get(sheet);
  if (!s) specCache.set(sheet, (s = buildSpec(model, sheetByName(model, sheet)!, title)));
  return s;
}
const helpCache = new Map<string, Map<string, CellHelp>>();
function helpFor(model: Model, sheet: string) {
  let h = helpCache.get(sheet);
  if (!h) helpCache.set(sheet, (h = helpTable(model, sheetByName(model, sheet)!)));
  return h;
}

interface Ctx {
  session: Session;
  sheet: string;
  hidden: Set<number>;
  help: Map<string, CellHelp>;
}

export function FormPage({ session, page }: { session: Session; page: PageDef }) {
  return (
    <div className="form-page">
      {page.sheets.map(({ sheet, title }, i) => (
        <SheetForm key={sheet} session={session} sheet={sheet} title={i > 0 && title !== page.title ? title : undefined} />
      ))}
    </div>
  );
}

function SheetForm({ session, sheet, title }: { session: Session; sheet: string; title?: string }) {
  const spec = specFor(session.model, sheet, title ?? sheet);
  const hidden = gatedHiddenRows(sheet, session.raw);
  const ctx: Ctx = { session, sheet, hidden, help: helpFor(session.model, sheet) };
  const visibleParts = spec.parts.filter((p) => ('t' in p ? true : sectionVisible(p, ctx)));
  if (!visibleParts.length) return null;
  return (
    <section className="sheet-form" aria-label={title}>
      {title && <h2 className="sheet-title">{title}</h2>}
      {spec.intro && <Intro text={spec.intro} />}
      {visibleParts.map((p, i) => ('t' in p ? <Repeat key={i} group={p} ctx={ctx} /> : <SectionView key={i} section={p} ctx={ctx} />))}
    </section>
  );
}

function Intro({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const short = text.length > 220 ? text.slice(0, text.lastIndexOf(' ', 200)) + '…' : text;
  return (
    <div className="intro-text">
      <p>{open ? text : short}</p>
      {text.length > 220 && (
        <button type="button" className="link" onClick={() => setOpen(!open)}>
          {open ? 'Ver menos' : 'Leer explicación completa'}
        </button>
      )}
    </div>
  );
}

const fieldVisible = (f: Field, ctx: Ctx) => {
  if (f.gatedRow && ctx.hidden.has(f.gatedRow)) return false;
  if (f.extra && !f.extra.when(ctx.session.raw)) return false;
  return true;
};

function sectionVisible(s: Section, ctx: Ctx) {
  return s.blocks.some((b) => (b.t === 'fields' ? b.fields.some((f) => fieldVisible(f, ctx) && (f.kind === 'input' || hasValue(ctx, f.a1))) : b.t === 'table'));
}

function hasValue(ctx: Ctx, a1: string) {
  const v = ctx.session.get(ctx.sheet, a1);
  return v !== null && v !== '' && v !== 0 && typeof v !== 'object';
}

function SectionView({ section, ctx, titleOverride }: { section: Section; ctx: Ctx; titleOverride?: string }) {
  return (
    <div className="form-section">
      {(titleOverride ?? section.title) && <h3>{titleOverride ?? section.title}</h3>}
      {section.blocks.map((b, i) => (
        <BlockView key={i} block={b} ctx={ctx} />
      ))}
    </div>
  );
}

function BlockView({ block, ctx }: { block: Block; ctx: Ctx }) {
  switch (block.t) {
    case 'heading':
      return <h4>{block.text}</h4>;
    case 'text':
      return <p className="note-text">{block.text}</p>;
    case 'fields': {
      const fs = block.fields.filter((f) => fieldVisible(f, ctx));
      const inputs = fs.filter((f) => f.kind === 'input');
      const calcs = fs.filter((f) => f.kind === 'calc' && hasValue(ctx, f.a1));
      return (
        <>
          {inputs.length > 0 && (
            <div className="fields">
              {inputs.map((f) => (
                <FieldView key={f.a1} f={f} ctx={ctx} />
              ))}
            </div>
          )}
          {calcs.length > 0 && (
            <div className="calcs">
              {calcs.map((f) => (
                <CalcRow key={f.a1} label={f.label} value={ctx.session.get(ctx.sheet, f.a1)} nf={f.nf} strong={/^total/i.test(f.label)} />
              ))}
            </div>
          )}
        </>
      );
    }
    case 'table':
      return <TableView block={block} ctx={ctx} />;
  }
}

function FieldView({ f, ctx }: { f: Field; ctx: Ctx }) {
  const x = f.extra;
  return (
    <FieldInput
      session={ctx.session}
      sheet={f.sheet}
      a1={f.a1}
      label={f.label}
      type={f.type}
      nf={f.nf}
      dv={f.dv}
      help={ctx.help.get(f.a1) ?? (x ? { title: '', text: x.prompt, norms: '' } : undefined)}
      check={x ? extraCheck(x, ctx) : undefined}
      warning={x?.warn && typeof ctx.session.raw(f.sheet, f.a1) === 'number' ? x.warn(ctx.session.raw(f.sheet, f.a1) as number, ctx.session.raw, (s, a) => ctx.session.get(s, a)) : null}
    />
  );
}

function extraCheck(x: ExtraInput, ctx: Ctx) {
  return (v: Scalar) => {
    if (v === null) return null;
    if (typeof v !== 'number' || v < 0) return 'Escriba un valor mayor o igual a cero.';
    const max = x.max?.(ctx.session.raw);
    if (max != null && v > max) return `El valor no puede superar ${formatValue(max, x.kind === 'money' ? '"$"\\ #,##0' : '0')}.`;
    return null;
  };
}

// ------------------------------------------------------------------ tables

function TableView({ block, ctx }: { block: Extract<Block, { t: 'table' }>; ctx: Ctx }) {
  const raw = (a1: string) => ctx.session.raw(ctx.sheet, a1);
  const filled = filledRows(block.rows, block.columns, block.extras, raw);
  const [extraShown, setExtraShown] = useState<number[]>([]);
  const shown = block.rows.filter((r) => filled.includes(r) || extraShown.includes(r));
  const next = block.rows.find((r) => !shown.includes(r));
  const sheet = sheetByName(ctx.session.model, ctx.sheet)!;
  const inputCols = block.columns.filter((c) => c.kind === 'input');
  const calcCols = block.columns.filter((c) => c.kind === 'calc');

  const remove = (r: number) => {
    for (const c of block.columns) {
      const a1 = toA1(r, c.c);
      if (sheet.cells[a1]?.in && raw(a1) != null) ctx.session.set(ctx.sheet, a1, null);
    }
    for (const x of block.extras) if (parseA1(x.cell)[0] === r && raw(x.cell) != null) ctx.session.set(ctx.sheet, x.cell, null);
    setExtraShown((s) => s.filter((x) => x !== r));
  };

  return (
    <div className="table-block">
      {shown.length === 0 && <p className="muted">Todavía no hay registros.</p>}
      <ol className="cards">
        {shown.map((r, i) => (
          <li key={r} className="card">
            <div className="card-head">
              <span className="card-n">Registro {i + 1}</span>
              <button type="button" className="quiet-btn" onClick={() => remove(r)}>
                Quitar
              </button>
            </div>
            <div className="fields">
              {inputCols.map((c) => (
                <TableCell key={c.c} col={c} r={r} firstRow={block.rows[0]} ctx={ctx} />
              ))}
              {block.extras
                .filter((x) => parseA1(x.cell)[0] === r && x.when(ctx.session.raw))
                .map((x) => (
                  <FieldInput
                    key={x.cell}
                    session={ctx.session}
                    sheet={ctx.sheet}
                    a1={x.cell}
                    label={x.label.replace(/\s*\(fila \d+\)/, '')}
                    type="money"
                    help={{ title: '', text: x.prompt, norms: '' }}
                    check={extraCheck(x, ctx)}
                  />
                ))}
            </div>
            {calcCols.some((c) => hasValue(ctx, toA1(r, c.c))) && (
              <div className="calcs">
                {calcCols
                  .filter((c) => hasValue(ctx, toA1(r, c.c)))
                  .map((c) => (
                    <CalcRow key={c.c} label={c.label} value={ctx.session.get(ctx.sheet, toA1(r, c.c))} nf={c.nf} />
                  ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      {next !== undefined ? (
        <button type="button" className="add-btn" onClick={() => setExtraShown((s) => [...s, next])}>
          + Agregar registro
        </button>
      ) : (
        <p className="muted small">Alcanzó el máximo de {block.rows.length} registros de esta tabla.</p>
      )}
    </div>
  );
}

function TableCell({ col, r, firstRow, ctx }: { col: TableColumn; r: number; firstRow: number; ctx: Ctx }) {
  const a1 = toA1(r, col.c);
  const sheet = sheetByName(ctx.session.model, ctx.sheet)!;
  const cell = sheet.cells[a1];
  if (!cell?.in) {
    // this row computes the column instead of asking for it
    return hasValue(ctx, a1) ? <CalcRow label={col.label} value={ctx.session.get(ctx.sheet, a1)} nf={col.nf} /> : null;
  }
  return (
    <FieldInput
      session={ctx.session}
      sheet={ctx.sheet}
      a1={a1}
      label={col.label}
      type={col.type}
      nf={cell.nf ?? col.nf}
      dv={validationAt(sheet, a1)}
      // DIAN's help tables point at the first row of each table
      help={ctx.help.get(a1) ?? ctx.help.get(toA1(firstRow, col.c))}
      compact
    />
  );
}

// ----------------------------------------------------------------- repeats

function Repeat({ group, ctx }: { group: RepeatGroup; ctx: Ctx }) {
  const filled = group.items.filter((s) => sectionHasData(s, ctx.session.raw));
  const [opened, setOpened] = useState(0);
  const count = Math.min(group.items.length, Math.max(1, group.items.indexOf(filled[filled.length - 1]) + 1, opened));
  const shown = group.items.slice(0, count);
  return (
    <div className="repeat">
      {shown.map((s, i) => (
        <SectionView key={i} section={s} ctx={ctx} titleOverride={`${capitalize(group.noun)} ${i + 1}`} />
      ))}
      {count < group.items.length && (
        <button type="button" className="add-btn" onClick={() => setOpened(count + 1)}>
          + Agregar otro {group.noun}
        </button>
      )}
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
