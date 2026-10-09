import { useEffect, useState } from 'react';
import { AndremovProvider, Notice, PageShell, Text } from '@andremov/brand';
import type { Model } from './engine/workbook';
import { Session } from './app/store';
import { Shell } from './app/Shell';
import { Backups } from './app/Backups';
import { installBrowserApi } from './app/browserApi';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}model.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Model>;
      })
      .then((m) => {
        const s = new Session(m);
        if (import.meta.env.DEV) Object.assign(window, { __session: s });
        installBrowserApi(s);
        setSession(s);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  // backup messages ("Respaldo cargado.") stay a few seconds, longer when they list skipped values
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.includes(':') ? 10000 : 4000);
    return () => clearTimeout(t);
  }, [message]);

  return (
    <AndremovProvider locale="es">
      <PageShell
        header={{ title: 'Renta abierta 2025', href: '#/', children: session && <Backups session={session} onMessage={setMessage} /> }}
        contained={false}
      >
        {error ? (
          <div className="mx-auto max-w-2xl px-4 py-12">
            <Notice tone="danger" title="No se pudo cargar el programa">
              {error}. Recargue la página.
            </Notice>
          </div>
        ) : !session ? (
          <div className="grid place-items-center px-4 py-24" role="status">
            <Text variant="muted">Cargando el programa y las tablas de la DIAN…</Text>
          </div>
        ) : (
          <Shell session={session} message={message} />
        )}
      </PageShell>
    </AndremovProvider>
  );
}
