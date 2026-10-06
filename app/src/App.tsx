import { useEffect, useState } from 'react';
import type { Model } from './engine/workbook';
import { Session } from './app/store';
import { Shell } from './app/Shell';
import { installBrowserApi } from './app/browserApi';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error)
    return (
      <div className="loading" role="alert">
        No se pudo cargar el programa ({error}). Recargue la página.
      </div>
    );
  if (!session)
    return (
      <div className="loading" role="status">
        Cargando el programa y las tablas de la DIAN…
      </div>
    );
  return <Shell session={session} />;
}
