// Wizard steps: each page is split into focused steps (one section, one repeated item, or
// a summary of computed totals). Steps depend on the current answers: sections whose
// questions do not apply are skipped, and repeated items appear as they are added.
import type { Session } from '../app/store';
import { gatedHiddenRows } from '../app/rules';
import { sheetByName } from '../app/nav';
import { buildSpec, sectionHasData, type Field, type FormSpec, type Section } from './spec';
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

/** Section headings that are really column headers; the annex name says more. */
const GENERIC = /^(concepto|valor|totales?|descripci[oó]n|datos?|nombre|identificaci[oó]n|tipo)\b/i;

export function pageSteps(session: Session, page: PageDef): Step[] {
  const steps: Step[] = [];
  const summaries: Step[] = [];
  page.sheets.forEach(({ sheet, title }, si) => {
    const spec = specFor(session.model, sheet);
    const hidden = gatedHiddenRows(sheet, session.raw);
    // annex name above the step title, only when it is not already the page's name
    const sheetTitle = si > 0 && title && title !== page.title ? title : undefined;
    const fallback = (si === 0 ? page.title : title) ?? page.title;
    const summary: Section[] = [];
    const first = steps.length;

    spec.parts.forEach((part, pi) => {
      if ('t' in part) {
        const key = `${sheet}#${pi}`;
        const lastFilled = part.items.reduce((n, s, i) => (sectionHasData(s, session.raw) ? i + 1 : n), 0);
        const visible = Math.min(part.items.length, Math.max(1, lastFilled, session.ui[key] ?? 0));
        for (let i = 0; i < visible; i++) {
          if (!asks(part.items[i], hidden, session)) continue;
          steps.push({
            id: `${sheet}#${pi}.${i}`,
            pageId: page.id,
            sheet,
            sheetTitle,
            // short, specific section titles ("Dependiente económico 3") beat a generic counter
            title: part.items[i].title && part.items[i].title.length <= 40 ? part.items[i].title : `${capitalize(part.noun)} ${i + 1}`,
            kind: 'item',
            section: part.items[i],
            repeat: { key, noun: part.noun, index: i, visible, max: part.items.length },
          });
        }
        return;
      }
      if (asks(part, hidden, session)) {
        const t = part.title && !GENERIC.test(part.title) ? part.title : fallback;
        steps.push({ id: `${sheet}#${pi}`, pageId: page.id, sheet, sheetTitle: t === fallback ? undefined : sheetTitle, title: t, kind: 'section', section: part });
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
