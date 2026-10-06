// Results: headline figures, every Form 210 box for transcription, and the printable form.
import { useState } from 'react';
import type { Session } from '../app/store';
import { formatValue } from '../app/format';
import { XErr, type Scalar } from '../engine/types';
import { Pending } from '../app/Checks';
import CASILLAS from './casillas.json';

export interface Casilla {
  n: number;
  concept: string;
  section: string;
  group?: string;
  cell: string | null;
  kind: 'money' | 'text' | 'date' | 'number';
}
const BOXES = CASILLAS as Casilla[];

const FORM = 'Formulario';
const money = (v: Scalar) => (typeof v === 'number' ? formatValue(v, '"$"\\ #,##0') : '—');

function boxValue(session: Session, b: Casilla): Scalar {
  if (!b.cell) return null;
  const v = session.get(FORM, b.cell);
  return v instanceof XErr ? null : v;
}

function display(b: Casilla, v: Scalar): string {
  if (v === null || v === '') return '';
  if (b.kind === 'money' && typeof v === 'number') return formatValue(v, '#,##0');
  if (b.kind === 'date' && typeof v === 'number') return formatValue(v, 'dd/mm/yyyy');
  return String(v);
}

export function ResultsPage({ session, go, openForm }: { session: Session; go: (sheet: string) => void; openForm: () => void }) {
  const byN = new Map(BOXES.map((b) => [b.n, b]));
  const val = (n: number) => {
    const b = byN.get(n);
    return b ? boxValue(session, b) : null;
  };
  const pagar = val(136);
  const favor = val(137);
  const [showZero, setShowZero] = useState(false);
  const sections = [...new Set(BOXES.map((b) => b.section))];

  return (
    <div className="results">
      <h1>Resultado de su declaración</h1>
      <div className="headline">
        {typeof favor === 'number' && favor > 0 ? (
          <div className="figure good">
            <span>Saldo a favor (casilla 137)</span>
            <strong className="num">{money(favor)}</strong>
          </div>
        ) : (
          <div className="figure">
            <span>Saldo a pagar (casilla 136)</span>
            <strong className="num">{money(pagar)}</strong>
          </div>
        )}
        <div className="figure">
          <span>Impuesto neto de renta (casilla 126)</span>
          <strong className="num">{money(val(126))}</strong>
        </div>
        <div className="figure">
          <span>Total patrimonio líquido (casilla 31)</span>
          <strong className="num">{money(val(31))}</strong>
        </div>
        <div className="figure">
          <span>Fecha límite para presentar</span>
          <strong className="num">{formatValue(session.get('DatosGenerales', 'E13'), 'dd/mm/yyyy') || '—'}</strong>
        </div>
      </div>
      <Pending session={session} go={go} />

      <div className="results-actions">
        <button type="button" className="primary" onClick={openForm}>
          Ver formulario 210
        </button>
        <label className="check">
          <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
          <span>Mostrar casillas en cero</span>
        </label>
      </div>
      <p className="muted">
        Copie cada valor en la casilla del mismo número en el formulario 210 de los servicios en línea de la DIAN.
      </p>

      {sections.map((sec) => {
        const rows = BOXES.filter((b) => b.section === sec).map((b) => ({ b, v: boxValue(session, b) }));
        const shown = rows.filter(({ v }) => showZero || (v !== null && v !== '' && v !== 0));
        if (!shown.length) return null;
        return (
          <section key={sec} className="box-section">
            <h2>{sec}</h2>
            <table className="boxes">
              <thead>
                <tr>
                  <th scope="col">Casilla</th>
                  <th scope="col">Concepto</th>
                  <th scope="col" className="r">
                    Valor
                  </th>
                  <th scope="col">
                    <span className="sr-only">Copiar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ b, v }) => (
                  <tr key={b.n} data-casilla={b.n}>
                    <td className="num n">{b.n}</td>
                    <td>{b.concept}</td>
                    <td className="num r">{display(b, v) || '0'}</td>
                    <td>
                      <CopyButton text={display(b, v).replace(/\./g, '') || '0'} label={`Copiar casilla ${b.n}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label={label}
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => undefined,
        )
      }
    >
      {done ? 'Copiado' : 'Copiar'}
    </button>
  );
}
