// App chrome: header, section navigation, sheet view, help panel, backups.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from './store';
import { useSession } from './store';
import { buildNav, FORM_SHEET, helpTable, sectionIntro, sheetByName, sheetNorms, sheetTitles, type NavNode } from './nav';
import { SheetGrid } from './SheetGrid';
import { validationAt } from './validation';
import { formatValue } from './format';
import { ExtrasPanel, HelperLinks } from './Extras';
import { Pending } from './Checks';
import { HELPER_OF, gatedHiddenRows, gatedRows } from './rules';

const readHash = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));

export function Shell({ session }: { session: Session }) {
  useSession(session);
  const model = session.model;
  const nav = useMemo(() => buildNav(model), [model]);
  const titles = useMemo(() => sheetTitles(model, nav), [model, nav]);
  const [current, setCurrent] = useState(readHash);
  const [focused, setFocused] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const on = () => {
      setCurrent(readHash());
      setFocused(null);
      mainRef.current?.scrollTo({ top: 0 });
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  const go = (sheet: string) => {
    const sh = sheetByName(model, sheet);
    if (sh) location.hash = `/${encodeURIComponent(sh.name)}`;
  };

  const sheet = current ? sheetByName(model, current) : undefined;
  // rows hidden in the saved file, except the ones the question rules control
  const gated = useMemo(() => (sheet ? gatedRows(sheet.name) : new Set<number>()), [sheet]);
  const closed = sheet ? gatedHiddenRows(sheet.name, session.raw) : new Set<number>();
  const closedKey = [...closed].join(',');
  const hiddenRows = useMemo(
    () => new Set([...(sheet?.hiddenRows ?? []).filter((r) => !gated.has(r)), ...closed]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, gated, closedKey],
  );
  const owner = sheet ? HELPER_OF[sheet.name] : undefined;
  const parent = nav.find((n) => n.sheet === sheet?.name || n.children.some((c) => c.sheet === sheet?.name));

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark" aria-hidden="true">210</span>
          <span>
            <strong>Renta abierta</strong>
            <small>Año gravable 2025 · personas naturales residentes</small>
          </span>
        </a>
        <Backups session={session} />
      </header>

      <div className="body">
        <nav className="sidebar" aria-label="Secciones">
          <SectionList nav={nav} current={sheet?.name} go={go} session={session} />
        </nav>

        <main className="main" ref={mainRef}>
          {!sheet ? (
            <Home nav={nav} go={go} session={session} />
          ) : (
            <>
              <div className="crumbs">
                {owner && (
                  <button type="button" className="link" onClick={() => go(owner)}>
                    ← {titles.get(owner) ?? owner}
                  </button>
                )}
                {!owner && parent && parent.sheet !== sheet.name && (
                  <button type="button" className="link" onClick={() => go(parent.sheet)}>
                    ← {parent.label}
                  </button>
                )}
                {sheet.name !== FORM_SHEET && (
                  <button type="button" className="link" onClick={() => go(FORM_SHEET)}>
                    Ver formulario 210
                  </button>
                )}
              </div>
              <h1>{titles.get(sheet.name) ?? sheet.name}</h1>
              <SectionIntro text={sectionIntro(model, sheet.name)} />
              <HelperLinks session={session} sheet={sheet.name} go={go} titles={titles} />
              {sheet.name === FORM_SHEET && <Pending session={session} go={go} />}
              <SheetGrid
                key={sheet.name}
                session={session}
                sheet={sheet}
                hiddenRows={hiddenRows}
                onFocusCell={setFocused}
                onNavigate={go}
                titles={titles}
              />
              <ExtrasPanel session={session} sheet={sheet.name} />
            </>
          )}
        </main>

        {sheet && <HelpPanel session={session} sheetName={sheet.name} focused={focused} />}
      </div>
    </div>
  );
}

function filledCount(session: Session, sheet: string): number {
  const prefix = `${sheet}!`;
  return Object.keys(session.inputs).filter((k) => k.startsWith(prefix)).length;
}

function SectionList({ nav, current, go, session }: { nav: NavNode[]; current?: string; go: (s: string) => void; session: Session }) {
  const item = (n: NavNode, depth: number) => {
    const count = filledCount(session, n.sheet);
    return (
      <li key={n.sheet}>
        <button
          type="button"
          className={`nav-item depth-${depth}${n.sheet === current ? ' is-current' : ''}`}
          aria-current={n.sheet === current ? 'page' : undefined}
          onClick={() => go(n.sheet)}
        >
          <span>{n.label}</span>
          {count > 0 && <span className="pill" title={`${count} casillas diligenciadas`}>{count}</span>}
        </button>
        {n.children.length > 0 && depth === 0 && (n.sheet === current || n.children.some((c) => c.sheet === current)) && (
          <ul>{n.children.map((c) => item(c, depth + 1))}</ul>
        )}
      </li>
    );
  };
  return (
    <>
      <ul className="nav-list">{nav.map((n) => item(n, 0))}</ul>
      <button type="button" className={`nav-form${current === FORM_SHEET ? ' is-current' : ''}`} onClick={() => go(FORM_SHEET)}>
        Formulario 210
      </button>
    </>
  );
}

function SectionIntro({ text }: { text: string }) {
  if (!text) return null;
  const [first, ...rest] = text.split(/\n\s*\n/);
  return (
    <details className="intro">
      <summary>{first.length > 140 ? 'Instrucciones de la sección' : first}</summary>
      <div className="prose">{(first.length > 140 ? [first, ...rest] : rest).map((p, i) => <p key={i}>{p}</p>)}</div>
    </details>
  );
}

function HelpPanel({ session, sheetName, focused }: { session: Session; sheetName: string; focused: string | null }) {
  const sheet = sheetByName(session.model, sheetName)!;
  const table = useMemo(() => helpTable(session.model, sheet), [session.model, sheet]);
  const help = focused ? table.get(focused) : undefined;
  const dv = focused ? validationAt(sheet, focused) : null;
  const norms = help?.norms || sheetNorms(sheet);
  return (
    <aside className="help" aria-live="polite">
      <h2>Ayuda</h2>
      {help ? (
        <>
          {help.title && <h3>{help.title}</h3>}
          <div className="prose">{help.text.split(/\n+/).map((p, i) => <p key={i}>{p}</p>)}</div>
        </>
      ) : (
        <p className="muted">Seleccione una casilla para ver la explicación de la DIAN.</p>
      )}
      {dv?.prompt && (
        <div className="note">
          {dv.promptTitle && <strong>{dv.promptTitle}</strong>}
          <p>{dv.prompt}</p>
        </div>
      )}
      {norms && (
        <>
          <h2>Normas relacionadas</h2>
          <div className="prose small">{norms.split(/\n+/).map((p, i) => <p key={i}>{p}</p>)}</div>
        </>
      )}
    </aside>
  );
}

function Home({ nav, go, session }: { nav: NavNode[]; go: (s: string) => void; session: Session }) {
  const form = (a1: string) => formatValue(session.get(FORM_SHEET, a1), '"$"\\ #,##0');
  const filled = Object.keys(session.inputs).length;
  return (
    <div className="home">
      <h1>Declaración de renta 2025, sin macros</h1>
      <p className="lede">
        Una versión web del Programa Ayuda Renta 2025 (formulario 210) de la DIAN. Hace los mismos cálculos que el archivo de
        Excel, pero funciona en cualquier sistema operativo y navegador, sin habilitar macros ni ActiveX.
      </p>
      <ul className="facts">
        <li>
          <strong>Sus datos no salen de este equipo.</strong> Los cálculos se hacen en su navegador y no se envían a ningún
          servidor. Guarde un respaldo para continuar en otro equipo.
        </li>
        <li>
          <strong>No es un servicio de la DIAN.</strong> Úsela como ayuda para preparar la declaración y preséntela en los
          servicios en línea de la DIAN.
        </li>
      </ul>
      <div className="start">
        <button type="button" className="primary" onClick={() => go(nav[0].sheet)}>
          {filled ? 'Continuar con la declaración' : 'Empezar con los datos generales'}
        </button>
        {filled > 0 && <span className="muted">{filled} casillas diligenciadas</span>}
      </div>
      <h2>Secciones</h2>
      <ol className="sections">
        {nav.map((n) => (
          <li key={n.sheet}>
            <button type="button" className="link" onClick={() => go(n.sheet)}>
              {n.label}
            </button>
            {n.children.length > 0 && <span className="muted"> · {n.children.length} anexos</span>}
          </li>
        ))}
      </ol>
      {filled > 0 && <Pending session={session} go={go} />}
      {filled > 0 && (
        <p className="muted">
          Patrimonio líquido calculado: <strong className="num">{form('AK14')}</strong>
        </p>
      )}
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
      <button type="button" onClick={save}>Guardar respaldo</button>
      <button type="button" onClick={() => fileRef.current?.click()}>Abrir respaldo</button>
      <input ref={fileRef} id="backup-file" type="file" accept="application/json,.json" hidden onChange={(e) => open(e.target.files?.[0])} />
      {confirming ? (
        <span className="confirm">
          ¿Borrar todos los datos de este navegador?
          <button type="button" className="danger" onClick={() => { session.replace({}); setConfirming(false); setMsg('Datos borrados.'); }}>
            Borrar
          </button>
          <button type="button" onClick={() => setConfirming(false)}>Cancelar</button>
        </span>
      ) : (
        <button type="button" className="quiet" onClick={() => setConfirming(true)}>Borrar todo</button>
      )}
      {msg && <span className="toast" role="status" onAnimationEnd={() => setMsg(null)}>{msg}</span>}
    </div>
  );
}
