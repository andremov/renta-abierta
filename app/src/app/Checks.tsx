// Completeness checks the Excel file enforced in VBA (Validar) before leaving Datos generales,
// plus rules DIAN wrote but that never fire in Excel. Shown as a to-do list, not a blocker.
import { ArrowRight } from 'lucide-react';
import { Notice } from '@andremov/brand';
import { Button } from '@andremov/brand/ui/button';
import type { Session } from './store';
import { catalogFor } from '../forms/catalog';

interface Check {
  sheet: string;
  cell: string;
  message: string;
  failed: (s: Session) => boolean;
}

const blank = (s: Session, sheet: string, a1: string) => {
  const v = s.raw(sheet, a1);
  return v === null || v === '';
};
const required = (cell: string, message: string): Check => ({
  sheet: 'DatosGenerales',
  cell,
  message,
  failed: (s) => blank(s, 'DatosGenerales', cell),
});

const CHECKS: Check[] = [
  required('C6', 'Falta el NIT del declarante.'),
  required('B8', 'Falta el primer apellido.'),
  required('D8', 'Falta el primer nombre.'),
  required('C9', 'Falta el código de la dirección seccional.'),
  required('E9', 'Falta la actividad económica.'),
  required('C11', 'Falta el número de años que ha declarado.'),
  required('C60', 'Falta la fecha de presentación.'),
  required('C10', 'Falta el patrimonio bruto a 31 de diciembre de 2024.'),
  required('E10', 'Falta el patrimonio líquido a 31 de diciembre de 2024.'),
  {
    sheet: 'DatosGenerales',
    cell: 'E10',
    message: 'El patrimonio líquido de 2024 no puede ser mayor que el patrimonio bruto de 2024.',
    failed: (s) => {
      const b = s.raw('DatosGenerales', 'C10');
      const l = s.raw('DatosGenerales', 'E10');
      return typeof b === 'number' && typeof l === 'number' && l > b;
    },
  },
];

export function Pending({ session, go }: { session: Session; go: (sheet: string) => void }) {
  const failing = CHECKS.filter((c) => c.failed(session));
  // fields the person marked "pendiente por confirmar"
  const marked = Object.entries(session.pending);
  const byKey = new Map(marked.length ? catalogFor(session.model).map((e) => [e.key, e]) : []);
  if (!failing.length && !marked.length) return null;
  return (
    <Notice tone="warning" title="Pendientes antes de presentar" className="pending">
      <ul className="grid list-disc gap-0.5 pl-5">
        {failing.map((c) => (
          <li key={c.message}>
            {/* ghost, not link: the link colour fails AA on the warning surface; ghost keeps the notice's ink */}
            <Button variant="ghost" className="-mx-1 h-auto px-1 py-0.5 whitespace-normal text-left" onClick={() => go(c.sheet)}>
              {c.message}
              <ArrowRight aria-hidden />
            </Button>
          </li>
        ))}
        {marked.map(([key, note]) => {
          const e = byKey.get(key);
          const sheet = key.slice(0, key.lastIndexOf('!'));
          return (
            <li key={key}>
              <Button variant="ghost" className="-mx-1 h-auto px-1 py-0.5 whitespace-normal text-left" onClick={() => go(sheet)}>
                Por confirmar: {e ? `${e.pageTitle} › ${e.label}` : key}
                <ArrowRight aria-hidden />
              </Button>
              {note && <span> — {note}</span>}
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}
