// App chrome: header, step navigation, routing between questionnaire, form pages and results.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Session } from './store';
import { useSession } from './store';
import { sheetByName } from './nav';
import { buildLayout } from './layout';
import { marginBoxCss, parseHeaderFooter } from './headerFooter';
import type { ModelSheet } from '../engine/workbook';
import { GROUPS, ALL_PAGES, type PageDef } from '../forms/pages';
import { StepView } from '../forms/FormPage';
import { pageSteps, stepHasData, type Step } from '../forms/steps';
import { ProfilePage } from '../forms/Profile';
import { ResultsPage } from '../forms/Results';
import { SheetGrid } from './SheetGrid';
import { Pending } from './Checks';

type Route =
  | { kind: 'home' }
  | { kind: 'profile' }
  | { kind: 'page'; id: string; step?: string }
  | { kind: 'results' }
  | { kind: 'form' };

function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === 'perfil') return { kind: 'profile' };
  if (h === 'resultado') return { kind: 'results' };
  if (h === 'formulario') return { kind: 'form' };
  if (h.startsWith('p/')) {
    const [id, step] = h.slice(2).split('/');
    return { kind: 'page', id: decodeURIComponent(id), step: step ? decodeURIComponent(step) : undefined };
  }
  return { kind: 'home' };
}

function href(r: Route): string {
  switch (r.kind) {
    case 'home':
      return '#/';
    case 'profile':
      return '#/perfil';
    case 'results':
      return '#/resultado';
    case 'form':
      return '#/formulario';
    case 'page':
      return `#/p/${encodeURIComponent(r.id)}${r.step ? `/${encodeURIComponent(r.step)}` : ''}`;
  }
}
const stepRoute = (x: Step): Route => ({ kind: 'page', id: x.pageId, step: x.id });

/** A page applies when it is unconditional, a question enabling it was answered yes, or it already holds data. */
export function isActive(session: Session, p: PageDef): boolean {
  if (!p.when) return true;
  if (p.when.some((q) => session.profile[q])) return true;
  const keys = Object.keys(session.inputs);
  return p.sheets.some(({ sheet }) => keys.some((k) => k.startsWith(`${sheet}!`)));
}

export function Shell({ session }: { session: Session }) {
  useSession(session);
  const [route, setRoute] = useState(readRoute);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = () => {
      setRoute(readRoute());
      mainRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
      mainRef.current?.scrollTo({ top: 0 });
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const go = (r: Route) => (location.hash = href(r));
  const goSheet = (sheet: string) => {
    const p = ALL_PAGES.find((x) => x.sheets.some((s) => s.sheet === sheet));
    if (p) go({ kind: 'page', id: p.id });
  };

  // the whole wizard as one list: profile, every step of every applicable page, results.
  // Movement is free in both directions; nothing is required to continue.
  const active = ALL_PAGES.filter((p) => isActive(session, p));
  const byPage = new Map(active.map((p) => [p.id, pageSteps(session, p)]));
  const page = route.kind === 'page' ? ALL_PAGES.find((p) => p.id === route.id) : undefined;
  if (page && !byPage.has(page.id)) byPage.set(page.id, pageSteps(session, page)); // opened directly
  const flat: Route[] = [{ kind: 'profile' }, ...[...byPage.values()].flatMap((ss) => ss.map(stepRoute)), { kind: 'results' }];
  const pageStepsNow = page ? byPage.get(page.id) ?? [] : [];
  const wanted = route.kind === 'page' ? route.step : undefined;
  const step = page ? pageStepsNow.find((x) => x.id === wanted) ?? pageStepsNow[0] : undefined;
  const here = step ? href(stepRoute(step)) : href(route);
  const idx = flat.findIndex((x) => href(x) === here);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [here]);

  if (route.kind === 'form') return <PrintableForm session={session} onBack={() => go({ kind: 'results' })} />;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">
            210
          </span>
          <span>
            <strong>Renta abierta</strong>
            <small>Año gravable 2025 · personas naturales residentes</small>
          </span>
        </a>
        <Backups session={session} />
      </header>

      <div className="body">
        <nav className={`sidebar${navOpen ? ' open' : ''}`} aria-label="Pasos de la declaración">
          <button type="button" className="nav-toggle" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>
            <span>{idx >= 0 ? `Paso ${idx + 1} de ${flat.length}: ${step?.title ?? stepTitle(route)}` : 'Secciones'}</span>
            <span aria-hidden="true">{navOpen ? '▲' : '▼'}</span>
          </button>
          <div className="steps-wrap">
            <Steps session={session} route={route} go={go} byPage={byPage} current={step} />
          </div>
        </nav>

        <main className="main" ref={mainRef} tabIndex={-1}>
          {route.kind === 'home' && <Home session={session} go={go} />}
          {route.kind === 'profile' && <ProfilePage session={session} onDone={() => next && go(next)} />}
          {route.kind === 'results' && <ResultsPage session={session} go={goSheet} openForm={() => go({ kind: 'form' })} />}
          {route.kind === 'page' &&
            (page && step ? (
              <>
                <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={flat.length} aria-valuenow={idx + 1} aria-label="Progreso de la declaración">
                  <div className="progress-bar" style={{ width: `${Math.round(((idx + 1) / flat.length) * 100)}%` }} />
                </div>
                <p className="eyebrow">
                  {page.group.title} · {page.title}
                  {pageStepsNow.length > 1 && ` · Paso ${pageStepsNow.indexOf(step) + 1} de ${pageStepsNow.length}`}
                </p>
                {step.sheetTitle && step.sheetTitle !== step.title && <p className="sheet-kicker">{step.sheetTitle}</p>}
                <h1>{step.title}</h1>
                <StepView key={step.id} session={session} step={step} />
              </>
            ) : page ? (
              <p className="muted">Con sus respuestas actuales esta sección no tiene preguntas.</p>
            ) : (
              <p>Esta sección no existe.</p>
            ))}
          {route.kind !== 'home' && (
            <nav className="pager" aria-label="Anterior y siguiente">
              {prev ? (
                <button type="button" className="ghost" onClick={() => go(prev)}>
                  ← Atrás
                </button>
              ) : (
                <span />
              )}
              {next && (
                <button type="button" className="primary" onClick={() => go(next)}>
                  {next.kind === 'results' ? 'Ver resultado' : 'Continuar'} →
                </button>
              )}
            </nav>
          )}
        </main>
      </div>
    </div>
  );
}

function stepTitle(r: Route): string {
  if (r.kind === 'profile') return 'Perfil';
  if (r.kind === 'results') return 'Resultado';
  if (r.kind === 'page') return ALL_PAGES.find((p) => p.id === r.id)?.title ?? '';
  return 'Inicio';
}

function Steps({
  session,
  route,
  go,
  byPage,
  current,
}: {
  session: Session;
  route: Route;
  go: (r: Route) => void;
  byPage: Map<string, Step[]>;
  current?: Step;
}) {
  const cur = href(route);
  const link = (r: Route, label: string, on: boolean, extra?: ReactNode) => (
    <li key={href(r)}>
      <a href={href(r)} className={`step${on ? ' is-current' : ''}`} aria-current={on ? 'step' : undefined}>
        <span>{label}</span>
        {extra}
      </a>
    </li>
  );
  return (
    <>
      <ul className="steps">{link({ kind: 'profile' }, 'Perfil', cur === '#/perfil')}</ul>
      {GROUPS.map((g) => {
        const pages = g.pages.filter((p) => byPage.has(p.id));
        if (!pages.length) return null;
        return (
          <div key={g.id} className="step-group">
            <h2>{g.title}</h2>
            <ul className="steps">
              {pages.map((p) => {
                const ss = byPage.get(p.id) ?? [];
                const open = current?.pageId === p.id;
                const done = ss.filter((x) => stepHasData(session, x)).length;
                return (
                  <li key={p.id}>
                    <a href={href({ kind: 'page', id: p.id, step: ss[0]?.id })} className={`step${open ? ' is-open' : ''}`}>
                      <span>{p.title}</span>
                      {ss.length > 0 && (
                        <span className="pill" title={`${done} de ${ss.length} pasos con datos`}>
                          {done}/{ss.length}
                        </span>
                      )}
                    </a>
                    {open && ss.length > 1 && (
                      <ol className="substeps">
                        {ss.map((x) =>
                          link(
                            stepRoute(x),
                            x.title,
                            x.id === current?.id,
                            stepHasData(session, x) ? (
                              <span className="tick" aria-label="con datos">
                                ✓
                              </span>
                            ) : undefined,
                          ),
                        )}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <ul className="steps">{link({ kind: 'results' }, 'Resultado', cur === '#/resultado')}</ul>
      <button type="button" className="link small" onClick={() => go({ kind: 'profile' })}>
        ¿Falta una sección? Revise su perfil
      </button>
    </>
  );
}

function Home({ session, go }: { session: Session; go: (r: Route) => void }) {
  const started = Object.keys(session.inputs).length > 0 || Object.keys(session.profile).length > 0;
  return (
    <div className="home">
      <h1>Su declaración de renta 2025, sin Excel ni macros</h1>
      <p className="lede">
        Prepare el formulario 210 respondiendo preguntas sencillas. Los cálculos son los mismos del Programa Ayuda Renta 2025 de
        la DIAN, y el resultado es el formulario 210 con los valores para copiar en los servicios en línea de la DIAN.
      </p>
      <ul className="facts">
        <li>
          <strong>Sus datos no salen de este equipo.</strong> Todo se calcula en su navegador y no se envía a ningún servidor.
          Guarde un respaldo para continuar en otro equipo.
        </li>
        <li>
          <strong>No es un servicio de la DIAN.</strong> Es una herramienta independiente para preparar la declaración; la
          presentación se hace en los servicios en línea de la DIAN.
        </li>
      </ul>
      <div className="start">
        <button type="button" className="primary" onClick={() => go({ kind: 'profile' })}>
          {started ? 'Continuar' : 'Empezar'}
        </button>
        {started && (
          <button type="button" className="ghost" onClick={() => go({ kind: 'results' })}>
            Ver resultado
          </button>
        )}
      </div>
      {started && <Pending session={session} go={() => go({ kind: 'page', id: 'datos-generales' })} />}
    </div>
  );
}

/** Pages of the printable form, split the way Excel paginates: the sheet's own print scale and
 *  margins on a Letter page, breaking when the accumulated row heights fill a page. */
function printPages(sheet: ModelSheet, hidden: Set<number>): { pages: [number, number][]; scale: number; margins: Record<string, number> } {
  const ps = sheet.print ?? {};
  // Excel's printed rows come out ~3% shorter than their nominal height (device-pixel rounding),
  // so its effective scale is slightly below the nominal one; this reproduces its page breaks.
  const scale = (ps.scale ?? 100) / 100 / 1.03;
  const margins = { top: 0.75, bottom: 0.75, left: 0.7, right: 0.7, ...(ps.margins ?? {}) };
  const pageHeight = ((11 - margins.top - margins.bottom) * 96) / scale;
  const full = buildLayout(sheet, hidden);
  const breaks = new Set((ps.rowBreaks ?? []).map((r) => r)); // Excel stores the last row of a page (1-based)
  const pages: [number, number][] = [];
  let start = full.rowIndex[0];
  let used = 0;
  full.rowIndex.forEach((r, i) => {
    const h = full.heights[i];
    if (used + h > pageHeight && used > 0) {
      pages.push([start, full.rowIndex[i - 1]]);
      start = r;
      used = 0;
    }
    used += h;
    if (breaks.has(r + 1)) {
      pages.push([start, r]);
      start = full.rowIndex[i + 1];
      used = 0;
    }
  });
  if (start !== undefined && (!pages.length || pages[pages.length - 1][1] < full.rowIndex[full.rowIndex.length - 1]))
    pages.push([start, full.rowIndex[full.rowIndex.length - 1]]);
  // a trailing sliver of empty rows is not a page
  const height = ([a, b]: [number, number]) => full.rowIndex.reduce((h, r, i) => (r >= a && r <= b ? h + full.heights[i] : h), 0);
  return { pages: pages.filter((pg) => height(pg) > 40), scale, margins };
}

function PrintableForm({ session, onBack }: { session: Session; onBack: () => void }) {
  const sheet = sheetByName(session.model, 'Formulario')!;
  const hidden = useMemo(() => new Set(sheet.hiddenRows), [sheet]);
  const { pages, scale, margins } = useMemo(() => printPages(sheet, hidden), [sheet, hidden]);
  // Excel fills &D/&T with the moment of printing
  const [printedAt, setPrintedAt] = useState(() => new Date());
  useEffect(() => {
    const on = () => setPrintedAt(new Date());
    addEventListener('beforeprint', on);
    return () => removeEventListener('beforeprint', on);
  }, []);
  const ps = sheet.print ?? {};
  const header = ps.oddHeader ? marginBoxCss(parseHeaderFooter(ps.oddHeader, printedAt, sheet.name), 'top', scale) : '';
  const footer = ps.oddFooter ? marginBoxCss(parseHeaderFooter(ps.oddFooter, printedAt, sheet.name), 'bottom', scale) : '';
  const pageCss = `@page { size: letter; margin: ${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in;
${header}
${footer}
}`;
  return (
    <div className="print-page" style={{ '--print-zoom': scale } as CSSProperties}>
      <style>{pageCss}</style>
      <div className="print-bar">
        <button type="button" className="ghost" onClick={onBack}>
          ← Volver al resultado
        </button>
        <button type="button" className="primary" onClick={() => window.print()}>
          Imprimir o guardar PDF
        </button>
      </div>
      <p className="print-note muted">
        Formulario 210 tal como lo genera el Programa Ayuda Renta 2025. Úselo como guía para diligenciar el formulario oficial.
      </p>
      {pages.map((range) => (
        <div key={range[0]} className="print-sheet">
          <SheetGrid session={session} sheet={sheet} hiddenRows={hidden} rowRange={range} onFocusCell={() => undefined} onNavigate={() => undefined} titles={new Map()} />
        </div>
      ))}
    </div>
  );
}

function Backups({ session }: { session: Session }) {
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const blob = new Blob([session.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `renta-2025-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg('Respaldo descargado.');
  };
  const open = async (f: File | undefined) => {
    if (!f) return;
    try {
      session.importJSON(await f.text());
      setMsg('Respaldo cargado.');
    } catch (e) {
      setMsg((e as Error).message || 'No se pudo leer el archivo.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="backups">
      <button type="button" onClick={save}>
        Guardar respaldo
      </button>
      <button type="button" onClick={() => fileRef.current?.click()}>
        Abrir respaldo
      </button>
      <input ref={fileRef} id="backup-file" type="file" accept="application/json,.json" hidden onChange={(e) => open(e.target.files?.[0])} />
      {confirming ? (
        <span className="confirm">
          ¿Borrar todos los datos de este navegador?
          <button
            type="button"
            className="danger"
            onClick={() => {
              session.replace({});
              setConfirming(false);
              setMsg('Datos borrados.');
            }}
          >
            Borrar
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </span>
      ) : (
        <button type="button" className="quiet" onClick={() => setConfirming(true)}>
          Borrar todo
        </button>
      )}
      {msg && (
        <span className="toast" role="status" onAnimationEnd={() => setMsg(null)}>
          {msg}
        </span>
      )}
    </div>
  );
}
