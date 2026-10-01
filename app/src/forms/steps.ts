// Wizard steps: each page is split into focused steps (one section, one repeated item, or
// a summary of computed totals). Steps depend on the current answers: sections whose
// questions do not apply are skipped, and repeated items appear as they are added.
import type { Session } from '../app/store';
import { gatedHiddenRows } from '../app/rules';
import { sheetByName } from '../app/nav';
import { buildSpec, sectionHasData, type Block, type Field, type FormSpec, type Section } from './spec';
import type { PageDef } from './pages';
import type { Model } from '../engine/workbook';

export interface Step {
  /** stable id within the page, used in the URL */
  id: string;
  pageId: string;
  sheet: string;
  title: string;
  kind: 'section' | 'item' | 'summary';
  section: Section;
  /** explanation of the annex, shown on its first step */
  intro?: string;
  /** shown above the title when a page spans several annexes */
  sheetTitle?: string;
  /** repeated items: "+ add another" on the last visible one */
  repeat?: { key: string; noun: string; index: number; visible: number; max: number };
}

const specCache = new Map<string, FormSpec>();
export function specFor(model: Model, sheet: string): FormSpec {
  let s = specCache.get(sheet);
  if (!s) specCache.set(sheet, (s = buildSpec(model, sheetByName(model, sheet)!, sheet)));
  return s;
}

function fieldVisible(f: Field, hidden: Set<number>, session: Session) {
  if (f.gatedRow && hidden.has(f.gatedRow)) return false;
  if (f.extra && !f.extra.when(session.raw)) return false;
  return true;
}

const hasNumber = (v: unknown) => v !== null && v !== '' && v !== 0 && typeof v !== 'object';

/** Does the section ask for anything right now? */
function asks(s: Section, hidden: Set<number>, session: Session): boolean {
  return s.blocks.some((b) => b.t === 'table' || (b.t === 'fields' && b.fields.some((f) => f.kind === 'input' && fieldVisible(f, hidden, session))));
}

/** Does the section show a computed value right now? */
function shows(s: Section, sheet: string, session: Session): boolean {
  return s.blocks.some((b) => b.t === 'fields' && b.fields.some((f) => f.kind === 'calc' && hasNumber(session.get(sheet, f.a1))));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Most fields shown on one step; rows of the sheet are never split. */
const MAX_FIELDS = 6;

/**
 * Named step breaks for the busiest screens: a new step starts at this cell, with this title.
 * Other long sections are split generically and numbered.
 */
const STEP_BREAKS: Record<string, Record<string, string>> = {
  DatosGenerales: {
    C6: 'Identificación y nombre',
    C9: 'Dirección seccional y actividad económica',
    C10: 'Patrimonio a 31 de diciembre de 2024',
    C11: 'Declaraciones anteriores',
    C12: 'Beneficio de auditoría',
    ...Object.fromEntries(
      [21, 34, 40, 46, 52].flatMap((r) => [
        [`C${r}`, 'Documento'],
        [`B${r + 3}`, 'Nombre y parentesco'],
      ]),
    ),
    D26: 'Meses como dependiente y renuncia',
  },
  Salarios_Demas_Pagos_Laborales: Object.fromEntries(
    [0, 13, 26].flatMap((o) => [
      [`C${7 + o}`, 'Datos del empleador'],
      [`E${8 + o}`, 'Ingresos laborales'],
      [`E${10 + o}`, 'Cesantías y gastos de representación'],
      [`E${15 + o}`, 'Aportes a seguridad social y ahorro'],
      [`E${18 + o}`, 'Retención en la fuente'],
    ]),
  ),
};

/** Sections that only apply when a profile question says so (or they already hold data). */
const SECTION_WHEN: Record<string, { match: RegExp; when: string }[]> = {
  DatosGenerales: [
    { match: /^dependiente/i, when: 'dependientes' },
    { match: /^signatario/i, when: 'signatario' },
  ],
};

interface Chunk {
  title?: string;
  blocks: Block[];
  inputs: number;
  table: boolean;
}

/** Split a section into short steps: rows stay together, tables get their own step. */
function chunkSection(s: Section, sheet: string, hidden: Set<number>, session: Session): { title?: string; section: Section }[] {
  const breaks = STEP_BREAKS[sheet] ?? {};
  const chunks: Chunk[] = [];
  let cur: Chunk | null = null;
  let pendingText: Block[] = [];
  const open = (title?: string) => {
    cur = { title, blocks: [...pendingText], inputs: 0, table: false };
    pendingText = [];
    chunks.push(cur);
    return cur;
  };
  const addFields = (c: Chunk, fs: Field[]) => {
    const last = c.blocks[c.blocks.length - 1];
    if (last?.t === 'fields') last.fields.push(...fs);
    else c.blocks.push({ t: 'fields', fields: [...fs] });
  };

  for (const b of s.blocks) {
    if (b.t === 'text' || b.t === 'heading') {
      pendingText.push(b);
      continue;
    }
    if (b.t === 'table') {
      const c = open();
      c.blocks.push(b);
      c.table = true;
      cur = null; // whatever follows starts a new step
      continue;
    }
    // group the fields by sheet row
    const rows = new Map<number, Field[]>();
    for (const f of b.fields) {
      const list = rows.get(f.r) ?? [];
      list.push(f);
      rows.set(f.r, list);
    }
    for (const fs of rows.values()) {
      const inputs = fs.filter((f) => f.kind === 'input' && fieldVisible(f, hidden, session));
      const named = fs.map((f) => breaks[f.a1]).find(Boolean);
      let c = cur as Chunk | null;
      if (!inputs.length) {
        // computed values of this row join the current step
        if (c) addFields(c, fs);
        else addFields((c = open()), fs);
        continue;
      }
      if (!c || c.table || named || c.inputs + inputs.length > MAX_FIELDS) c = open(named);
      addFields(c, fs);
      c.inputs += inputs.length;
    }
  }
  if (pendingText.length && chunks.length) chunks[chunks.length - 1].blocks.push(...pendingText);
  const useful = chunks.filter((c) => c.table || c.inputs > 0);
  // computed-only chunks (e.g. a total right before a table) merge into the previous step
  for (const c of chunks) if (!c.table && !c.inputs) {
    const i = chunks.indexOf(c);
    const prev = [...chunks.slice(0, i)].reverse().find((x) => useful.includes(x));
    if (prev) prev.blocks.push(...c.blocks);
  }
  return useful.map((c) => ({ title: c.title, section: { title: s.title, blocks: c.blocks } }));
}

/** Expand one section into its steps, titled "Section (2/3)" unless a break names them. */
function sectionSteps(
  base: Omit<Step, 'section' | 'title'>,
  baseTitle: string,
  s: Section,
  hidden: Set<number>,
  session: Session,
  prefixNamed: boolean,
): Step[] {
  const parts = chunkSection(s, base.sheet, hidden, session);
  return parts.map((p, k) => ({
    ...base,
    id: parts.length > 1 ? `${base.id}.c${k}` : base.id,
    title: p.title ? (prefixNamed ? `${baseTitle} · ${p.title}` : p.title) : parts.length > 1 ? `${baseTitle} (${k + 1}/${parts.length})` : baseTitle,
    section: p.section,
  }));
}

/** Section headings that are really column headers; the annex name says more. */
const GENERIC = /^(concepto|valor|totales?|descripci[oó]n|datos?|nombre|identificaci[oó]n|tipo)\b/i;

export function pageSteps(session: Session, page: PageDef): Step[] {
  const steps: Step[] = [];
  const summaries: Step[] = [];
  page.sheets.forEach(({ sheet, title, when }, si) => {
    if (when && !when.some((q) => session.profile[q]) && !Object.keys(session.inputs).some((k) => k.startsWith(`${sheet}!`))) return;
    const spec = specFor(session.model, sheet);
    const hidden = gatedHiddenRows(sheet, session.raw);
    // annex name above the step title, only when it is not already the page's name
    const sheetTitle = si > 0 && title && title !== page.title ? title : undefined;
    const fallback = (si === 0 ? page.title : title) ?? page.title;
    const summary: Section[] = [];
    const first = steps.length;

    const conditional = SECTION_WHEN[sheet] ?? [];
    const skip = (title: string, sections: Section[]) => {
      const rule = conditional.find((c) => c.match.test(title));
      return !!rule && !session.profile[rule.when] && !sections.some((x) => sectionHasData(x, session.raw));
    };

    spec.parts.forEach((part, pi) => {
      if ('t' in part ? skip(part.items[0].title, part.items) : skip(part.title, [part])) return;
      if ('t' in part) {
        const key = `${sheet}#${pi}`;
        const lastFilled = part.items.reduce((n, s, i) => (sectionHasData(s, session.raw) ? i + 1 : n), 0);
        const visible = Math.min(part.items.length, Math.max(1, lastFilled, session.ui[key] ?? 0));
        for (let i = 0; i < visible; i++) {
          if (!asks(part.items[i], hidden, session)) continue;
          const itemTitle = part.items[i].title && part.items[i].title.length <= 40 ? part.items[i].title : `${capitalize(part.noun)} ${i + 1}`;
          steps.push(
            ...sectionSteps(
              {
                id: `${sheet}#${pi}.${i}`,
                pageId: page.id,
                sheet,
                sheetTitle,
                kind: 'item',
                repeat: { key, noun: part.noun, index: i, visible, max: part.items.length },
              },
              itemTitle,
              part.items[i],
              hidden,
              session,
              true,
            ),
          );
        }
        return;
      }
      if (asks(part, hidden, session)) {
        const t = part.title && !GENERIC.test(part.title) ? part.title : fallback;
        steps.push(
          ...sectionSteps(
            { id: `${sheet}#${pi}`, pageId: page.id, sheet, sheetTitle: t === fallback ? undefined : sheetTitle, kind: 'section' },
            t,
            part,
            hidden,
            session,
            t !== fallback,
          ),
        );
      } else if (shows(part, sheet, session)) summary.push(part);
    });

    if (summary.length)
      summaries.push({
        id: `${sheet}#resumen`,
        pageId: page.id,
        sheet,
        sheetTitle,
        title: `Resumen: ${fallback}`,
        kind: 'summary',
        section: { title: '', blocks: summary.flatMap((s) => s.blocks) },
      });
    if (steps.length > first && spec.intro) steps[first].intro = spec.intro;
  });
  // totals come after every question of the page; repeated titles get a number
  const all = [...steps, ...summaries];
  const seen = new Map<string, number>();
  for (const st of all) {
    const n = (seen.get(st.title) ?? 0) + 1;
    seen.set(st.title, n);
    if (n > 1) st.title = `${st.title} (${n})`;
  }
  return all;
}

/** A step counts as done when any of its inputs holds a value. */
export function stepHasData(session: Session, step: Step): boolean {
  return step.kind !== 'summary' && sectionHasData(step.section, session.raw);
}
