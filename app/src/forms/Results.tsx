// Results: headline figures, every Form 210 box for transcription, and the printable form.
import { useState } from 'react';
import { FileText } from 'lucide-react';
import { CheckboxField, CopyButton, Section, StatGroup, StatTile, Text } from '@andremov/brand';
import { Button } from '@andremov/brand/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@andremov/brand/ui/table';
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

/** Notes under a box when its value depends on something still missing. */
const NOTES: Record<number, (s: Session) => string | null> = {
  133: (s) =>
    s.raw('DatosGenerales', 'C11') === null
      ? 'El anticipo depende del número de años que ha declarado (Datos generales). Mientras no lo diligencie queda en 0 y el saldo a pagar puede verse más bajo.'
      : null,
};
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
    <div className="results grid gap-5">
      <Text variant="title">Resultado de su declaración</Text>
      <StatGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {typeof favor === 'number' && favor > 0 ? (
          <StatTile size="sm" tone="brand" label="Saldo a favor (casilla 137)" value={money(favor)} />
        ) : (
          <StatTile size="sm" tone="brand" label="Saldo a pagar (casilla 136)" value={money(pagar)} />
        )}
        <StatTile size="sm" label="Impuesto neto de renta (casilla 126)" value={money(val(126))} />
        <StatTile size="sm" label="Total patrimonio líquido (casilla 31)" value={money(val(31))} />
        <StatTile size="sm" label="Fecha límite para presentar" value={formatValue(session.get('DatosGenerales', 'E13'), 'dd/mm/yyyy') || '—'} />
      </StatGroup>
      <Pending session={session} go={go} />

      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={openForm}>
          <FileText aria-hidden />
          Ver formulario 210
        </Button>
        <CheckboxField label="Mostrar casillas en cero" checked={showZero} onChange={setShowZero} />
      </div>
      <Text variant="muted">
        Copie cada valor en la casilla del mismo número en el formulario 210 de los servicios en línea de la DIAN.
      </Text>

      {sections.map((sec) => {
        const rows = BOXES.filter((b) => b.section === sec).map((b) => ({ b, v: boxValue(session, b) }));
        const shown = rows.filter(({ b, v }) => showZero || (v !== null && v !== '' && v !== 0) || NOTES[b.n]?.(session));
        if (!shown.length) return null;
        return (
          <Section key={sec} title={sec}>
            <Table className="boxes">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Casilla</TableHead>
                  <TableHead scope="col">Concepto</TableHead>
                  <TableHead scope="col" className="text-right">
                    Valor
                  </TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Copiar</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(({ b, v }) => (
                  <TableRow key={b.n} data-casilla={b.n}>
                    <TableCell className="n">
                      <Text variant="mono">{b.n}</Text>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Text as="span">{b.concept}</Text>
                      {NOTES[b.n]?.(session) && (
                        <Text variant="hint" className="block">
                          {NOTES[b.n](session)}
                        </Text>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Text variant="mono">{display(b, v) || '0'}</Text>
                    </TableCell>
                    <TableCell className="text-right">
                      <CopyButton value={display(b, v).replace(/\./g, '') || '0'} aria-label={`Copiar casilla ${b.n}`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        );
      })}
    </div>
  );
}
