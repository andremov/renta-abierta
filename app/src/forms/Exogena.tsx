// The person's exógena report next to their return: each reported line grouped by the box DIAN
// suggests, with the box's current value, so nothing reported by third parties is forgotten.
import { useRef, useState } from 'react';
import type { Session } from '../app/store';
import { readExogenaFile, type ExoRow } from '../app/exogena';
import { formatValue } from '../app/format';
import CASILLAS from './casillas.json';

const BOXES = new Map((CASILLAS as { n: number; concept: string; cell: string | null }[]).map((b) => [b.n, b]));
const money = (v: number) => formatValue(v, '"$"\\ #,##0');

export function ExogenaPage({ session }: { session: Session }) {
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const exo = session.exogena;

  const load = async (f: File | undefined) => {
    if (!f) return;
    try {
      session.setExogena(await readExogenaFile(f));
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'No se pudo leer el archivo.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const groups = new Map<number | null, { row: ExoRow; i: number }[]>();
  exo?.rows.forEach((row, i) => groups.set(row.casilla, [...(groups.get(row.casilla) ?? []), { row, i }]));
  const order = [...groups.keys()].sort((a, b) => (a ?? 999) - (b ?? 999));
  const reviewed = exo?.rows.filter((r) => r.estado).length ?? 0;

  return (
    <div className="exogena">
      <h1>Información reportada por terceros</h1>
      <p className="lede">
        Cargue el reporte de información exógena que descarga de los servicios en línea de la DIAN («Consulta de información
        reportada por terceros», en Excel o CSV). Verá cada valor junto a la casilla que la DIAN sugiere, para revisar que su
        declaración lo incluya. El archivo se lee en este navegador y no se envía a ningún lado.
      </p>
      <div className="results-actions">
        <button type="button" className="primary" onClick={() => fileRef.current?.click()}>
          {exo ? 'Cargar otro reporte' : 'Cargar reporte'}
        </button>
        {exo && (
          <button type="button" className="ghost" onClick={() => session.setExogena(null)}>
            Quitar reporte
          </button>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => load(e.target.files?.[0])} />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {exo && (
        <>
          <p className="muted">
            {exo.file}: {exo.rows.length} registros, {reviewed} revisados. Los valores no se copian solos a la declaración: regístrelos
            en la sección que corresponda y márquelos aquí como incluidos. La casilla sugerida es una orientación de la DIAN; un valor
            puede ir en otra casilla según su caso.
          </p>
          {order.map((n) => {
            const items = groups.get(n)!;
            const total = items.reduce((s, x) => s + x.row.valor, 0);
            const box = n !== null ? BOXES.get(n) : undefined;
            const current = box?.cell ? session.get('Formulario', box.cell) : null;
            return (
              <section key={n ?? 'none'} className="box-section">
                <h2>{n !== null ? `Casilla ${n}${box ? `: ${box.concept}` : ''}` : 'Sin casilla sugerida'}</h2>
                <p className="muted">
                  Reportado: <strong className="num">{money(total)}</strong>
                  {box?.cell && (
                    <>
                      {' '}
                      · En su declaración: <strong className="num">{typeof current === 'number' ? money(current) : '—'}</strong>
                    </>
                  )}
                </p>
                <table className="boxes">
                  <thead>
                    <tr>
                      <th scope="col">Reportó</th>
                      <th scope="col">Detalle</th>
                      <th scope="col" className="r">
                        Valor
                      </th>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(({ row, i }) => (
                      <tr key={i} className={row.estado === 'no-aplica' ? 'muted' : undefined}>
                        <td>
                          {row.nombre}
                          {row.nit && <small className="muted"> NIT {row.nit}</small>}
                        </td>
                        <td>{row.detalle}</td>
                        <td className="num r">{money(row.valor)}</td>
                        <td>
                          <div className="seg" role="radiogroup" aria-label={`Estado de ${row.nombre} ${row.detalle}`}>
                            {(
                              [
                                ['incluido', 'Incluido'],
                                ['no-aplica', 'No aplica'],
                              ] as const
                            ).map(([k, t]) => (
                              <button
                                key={k}
                                type="button"
                                role="radio"
                                aria-checked={row.estado === k}
                                className={row.estado === k ? 'on' : ''}
                                onClick={() => session.setExoStatus(i, row.estado === k ? null : k)}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
