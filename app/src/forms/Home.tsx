// Landing: what the tool is, the privacy promise, start or continue.
import { Notice, Text } from '@andremov/brand';
import { Button } from '@andremov/brand/ui/button';
import type { Session } from '../app/store';
import { Pending } from '../app/Checks';

export function HomePage({ session, start, results, fix }: { session: Session; start: () => void; results: () => void; fix: () => void }) {
  const started = Object.keys(session.inputs).length > 0 || Object.keys(session.profile).length > 0;
  return (
    <div className="home flex flex-col gap-5 py-3">
      <div className="grid gap-2">
        <Text variant="hint">Año gravable 2025 · personas naturales residentes</Text>
        <Text variant="title">Su declaración de renta 2025, sin Excel ni macros</Text>
      </div>
      <Text>
        Prepare el formulario 210 respondiendo preguntas sencillas. Los cálculos son los mismos del Programa Ayuda Renta 2025 de
        la DIAN, y el resultado es el formulario 210 con los valores para copiar en los servicios en línea de la DIAN.
      </Text>
      <div className="grid gap-3">
        <Notice tone="success" title="Sus datos no salen de este equipo.">
          Todo se calcula en su navegador y no se envía a ningún servidor. Guarde un respaldo para continuar en otro equipo.
        </Notice>
        <Notice tone="info" title="No es un servicio de la DIAN.">
          Es una herramienta independiente para preparar la declaración; la presentación se hace en los servicios en línea de la
          DIAN.
        </Notice>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={start}>
          {started ? 'Continuar' : 'Empezar'}
        </Button>
        {started && (
          <Button variant="outline" size="lg" onClick={results}>
            Ver resultado
          </Button>
        )}
      </div>
      {started && <Pending session={session} go={fix} />}
    </div>
  );
}
