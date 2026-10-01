// App chrome: header, step navigation, routing between questionnaire, form pages and results.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from './store';
import { useSession } from './store';
import { sheetByName } from './nav';
import { GROUPS, ALL_PAGES, type PageDef } from '../forms/pages';
import { FormPage } from '../forms/FormPage';
import { ProfilePage } from '../forms/Profile';
import { ResultsPage } from '../forms/Results';
import { SheetGrid } from './SheetGrid';
import { Pending } from './Checks';

type Route = { kind: 'home' } | { kind: 'profile' } | { kind: 'page'; id: string } | { kind: 'results' } | { kind: 'form' };

function readRoute(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (h === 'perfil') return { kind: 'profile' };
  if (h === 'resultado') return { kind: 'results' };
  if (h === 'formulario') return { kind: 'form' };
  if (h.startsWith('p/')) return { kind: 'page', id: h.slice(2) };
  return { kind: 'home' };
}
const href = (r: Route) =>
  r.kind === 'home' ? '#/' : r.kind === 'profile' ? '#/perfil' : r.kind === 'results' ? '#/resultado' : r.kind === 'form' ? '#/formulario' : `#/p/${r.id}`;

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

  const active = ALL_PAGES.filter((p) => isActive(session, p));
  const steps: Route[] = [{ kind: 'profile' }, ...active.map((p) => ({ kind: 'page', id: p.id }) as Route), { kind: 'results' }];
  const idx = steps.findIndex((s) => href(s) === href(route));
  const prev = idx > 0 ? steps[idx - 1] : null;
  const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null;
  const page = route.kind === 'page' ? ALL_PAGES.find((p) => p.id === route.id) : undefined;
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [route]);

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
            <span>{idx >= 0 ? `Paso ${idx + 1} de ${steps.length}: ${stepTitle(route)}` : 'Secciones'}</span>
            <span aria-hidden="true">{navOpen ? '▲' : '▼'}</span>
          </button>
          <div className="steps-wrap">
            <Steps session={session} route={route} go={go} />
          </div>
        </nav>

        <main className="main" ref={mainRef} tabIndex={-1}>
          {route.kind === 'home' && <Home session={session} go={go} />}
          {route.kind === 'profile' && <ProfilePage session={session} onDone={() => next && go(next)} />}
          {route.kind === 'results' && <ResultsPage session={session} go={goSheet} openForm={() => go({ kind: 'form' })} />}
          {route.kind === 'page' &&
            (page ? (
              <>
                <p className="eyebrow">{page.group.title}</p>
                <h1>{page.title}</h1>
                <FormPage session={session} page={page} />
              </>
            ) : (
              <p>Esta sección no existe.</p>
            ))}
          {route.kind !== 'home' && (
            <nav className="pager" aria-label="Anterior y siguiente">
              {prev ? (
                <button type="button" className="ghost" onClick={() => go(prev)}>
                  ← {stepTitle(prev)}
                </button>
              ) : (
                <span />
              )}
              {next && (
                <button type="button" className="primary" onClick={() => go(next)}>
                  {stepTitle(next)} →
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

function filledCount(session: Session, p: PageDef): number {
  const keys = Object.keys(session.inputs);
  return p.sheets.reduce((n, { sheet }) => n + keys.filter((k) => k.startsWith(`${sheet}!`)).length, 0);
}

function Steps({ session, route, go }: { session: Session; route: Route; go: (r: Route) => void }) {
  const cur = href(route);
  const item = (r: Route, label: string, count?: number) => (
    <li key={href(r)}>
      <a href={href(r)} className={`step${cur === href(r) ? ' is-current' : ''}`} aria-current={cur === href(r) ? 'page' : undefined}>
        <span>{label}</span>
        {!!count && <span className="pill">{count}</span>}
      </a>
    </li>
  );
  return (
    <>
      <ul className="steps">{item({ kind: 'profile' }, 'Perfil')}</ul>
      {GROUPS.map((g) => {
        const pages = g.pages.filter((p) => isActive(session, p));
        if (!pages.length) return null;
        return (
          <div key={g.id} className="step-group">
            <h2>{g.title}</h2>
            <ul className="steps">{pages.map((p) => item({ kind: 'page', id: p.id }, p.title, filledCount(session, p)))}</ul>
          </div>
        );
      })}
      <ul className="steps">{item({ kind: 'results' }, 'Resultado')}</ul>
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

function PrintableForm({ session, onBack }: { session: Session; onBack: () => void }) {
  const sheet = sheetByName(session.model, 'Formulario')!;
  const hidden = useMemo(() => new Set(sheet.hiddenRows), [sheet]);
  return (
    <div className="print-page">
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
      <SheetGrid session={session} sheet={sheet} hiddenRows={hidden} onFocusCell={() => undefined} onNavigate={() => undefined} titles={new Map()} />
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
