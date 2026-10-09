// Backup actions in the header: save the draft to a file, load one, erase everything in this browser.
// Three buttons from sm up; one "Respaldo" menu on a phone, where the header has no room for three.
import { useRef, useState } from 'react';
import { ChevronDown, FolderOpen, Save, Trash2 } from 'lucide-react';
import { Button } from '@andremov/brand/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@andremov/brand/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@andremov/brand/ui/alert-dialog';
import type { Session } from './store';

export function Backups({ session, onMessage }: { session: Session; onMessage: (msg: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const blob = new Blob([session.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `renta-2025-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    onMessage('Respaldo descargado.');
  };
  const open = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { skipped } = session.importJSON(await f.text());
      onMessage(
        skipped.length
          ? `Respaldo cargado. ${skipped.length} ${skipped.length === 1 ? 'valor no se reconoció' : 'valores no se reconocieron'}: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`
          : 'Respaldo cargado.',
      );
    } catch (e) {
      onMessage((e as Error).message || 'No se pudo leer el archivo.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const pick = () => fileRef.current?.click();

  return (
    <>
      <div className="hidden items-center gap-2 sm:flex">
        <Button variant="outline" size="sm" onClick={save}>
          <Save aria-hidden />
          Guardar respaldo
        </Button>
        <Button variant="outline" size="sm" onClick={pick}>
          <FolderOpen aria-hidden />
          Abrir respaldo
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Borrar todo
        </Button>
      </div>
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Respaldo
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={save}>
              <Save aria-hidden />
              Guardar respaldo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={pick}>
              <FolderOpen aria-hidden />
              Abrir respaldo
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
              <Trash2 aria-hidden />
              Borrar todo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <input ref={fileRef} id="backup-file" type="file" accept="application/json,.json" hidden onChange={(e) => open(e.target.files?.[0])} />
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar todos los datos de este navegador?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran las respuestas, los valores y el reporte de exógena guardados aquí. Guarde antes un respaldo si los va a
              necesitar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              size="default"
              onClick={() => {
                session.replace({});
                session.setExogena(null);
                onMessage('Datos borrados.');
              }}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
