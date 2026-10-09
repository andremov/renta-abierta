// The person's exógena report next to their return: each reported line grouped by the box DIAN
// suggests, with the box's current value, so nothing reported by third parties is forgotten.
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Notice, Section, SegmentedControl, Text } from '@andremov/brand';
import { Button } from '@andremov/brand/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@andremov/brand/ui/table';
import type { Session } from '../app/store';
import { readExogenaFile, type ExoRow } from '../app/exogena';
import { formatValue } from '../app/format';
import CASILLAS from './casillas.json';

const BOXES = new Map((CASILLAS as { n: number; concept: string; cell: string | null }[]).map((b) => [b.n, b]));
const money = (v: number) => formatValue(v, '"$"\\ #,##0');
const ESTADOS = [
  { value: 'incluido' as const, label: 'Incluido' },
  { value: 'no-aplica' as const, label: 'No aplica' },
];

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
    <div className="exogena grid gap-5">
      <Text variant="title">Información reportada por terceros</Text>
      <Text>
        Cargue el reporte de información exógena que descarga de los servicios en línea de la DIAN («Consulta de información
        reportada por terceros», en Excel o CSV). Verá cada valor junto a la casilla que la DIAN sugiere, para revisar que su
        declaración lo incluya. El archivo se lee en este navegador y no se envía a ningún lado.
      </Text>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden />
          {exo ? 'Cargar otro reporte' : 'Cargar reporte'}
        </Button>
        {exo && (
          <Button variant="outline" onClick={() => session.setExogena(null)}>
            Quitar reporte
          </Button>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => load(e.target.files?.[0])} />
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {exo && (
        <>
          <Text variant="muted">
            {exo.file}: {exo.rows.length} registros, {reviewed} revisados. Los valores no se copian solos a la declaración: regístrelos
            en la sección que corresponda y márquelos aquí como incluidos. La casilla sugerida es una orientación de la DIAN; un valor
            puede ir en otra casilla según su caso.
          </Text>
          {order.map((n) => {
            const items = groups.get(n)!;
            const total = items.reduce((s, x) => s + x.row.valor, 0);
            const box = n !== null ? BOXES.get(n) : undefined;
            const current = box?.cell ? session.get('Formulario', box.cell) : null;
            return (
              <Section
                key={n ?? 'none'}
                className="box-section"
                title={n !== null ? `Casilla ${n}${box ? `: ${box.concept}` : ''}` : 'Sin casilla sugerida'}
                description={`Reportado: ${money(total)}${box?.cell ? ` · En su declaración: ${typeof current === 'number' ? money(current) : '—'}` : ''}`}
              >
                <Table className="exo-rows">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Reportó</TableHead>
                      <TableHead scope="col">Detalle</TableHead>
                      <TableHead scope="col" className="text-right">
                        Valor
                      </TableHead>
                      <TableHead scope="col">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(({ row, i }) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-normal">
                          <Text as="span" variant={row.estado === 'no-aplica' ? 'muted' : 'body'}>
                            {row.nombre}
                          </Text>
                          {row.nit && <Text variant="hint"> NIT {row.nit}</Text>}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <Text as="span" variant={row.estado === 'no-aplica' ? 'muted' : 'body'}>
                            {row.detalle}
                          </Text>
                        </TableCell>
                        <TableCell className="text-right">
                          <Text variant="mono">{money(row.valor)}</Text>
                        </TableCell>
                        <TableCell>
                          <SegmentedControl
                            size="sm"
                            aria-label={`Estado de ${row.nombre} ${row.detalle}`}
                            options={ESTADOS}
                            value={row.estado ?? null}
                            // choosing the selected state again clears it
                            onChange={(k) => session.setExoStatus(i, row.estado === k ? null : k)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            );
          })}
        </>
      )}
    </div>
  );
}
