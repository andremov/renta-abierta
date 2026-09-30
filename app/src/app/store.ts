// Session state: the person's inputs, the live workbook, persistence.
// Everything stays in this browser; nothing is sent anywhere.
import { useSyncExternalStore } from 'react';
import { Model, Workbook } from '../engine/workbook';
import { XErr, type Scalar } from '../engine/types';

const STORAGE_KEY = 'renta-ag2025:inputs:v1';
export const FILE_KIND = 'ayuda-renta-ag2025';

export type Inputs = Record<string, Scalar>; // "Sheet!A1" -> value

export class Session {
  wb: Workbook;
  inputs: Inputs = {};
  version = 0;
  savedAt: Date | null = null;
  private listeners = new Set<() => void>();

  constructor(readonly model: Model) {
    this.wb = new Workbook(model);
    const saved = readStorage();
    if (saved) this.inputs = saved;
    this.applyAll();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private applyAll() {
    for (const [k, v] of Object.entries(this.inputs)) {
      const [sheet, a1] = splitKey(k);
      try {
        this.wb.set(sheet, a1, v);
      } catch {
        delete this.inputs[k]; // sheet no longer exists
      }
    }
    this.wb.recalc();
  }

  get(sheet: string, a1: string): Scalar {
    return this.wb.value(sheet, a1);
  }

  set(sheet: string, a1: string, v: Scalar) {
    const k = `${sheet}!${a1}`;
    if (v === null || v === '') delete this.inputs[k];
    else this.inputs[k] = v;
    this.wb.set(sheet, a1, v);
    this.wb.recalc();
    this.persist();
    this.emit();
  }

  /** Replace all inputs (import / reset). */
  replace(inputs: Inputs) {
    this.wb = new Workbook(this.model);
    this.inputs = { ...inputs };
    this.applyAll();
    this.persist();
    this.emit();
  }

  exportJSON(): string {
    return JSON.stringify({ kind: FILE_KIND, version: 1, exportedAt: new Date().toISOString(), inputs: this.inputs }, null, 1);
  }

  importJSON(text: string) {
    const data = JSON.parse(text);
    if (data?.kind !== FILE_KIND || typeof data.inputs !== 'object')
      throw new Error('El archivo no es un respaldo de esta herramienta.');
    const clean: Inputs = {};
    for (const [k, v] of Object.entries(data.inputs)) {
      if (typeof k === 'string' && k.includes('!') && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'))
        clean[k] = v;
    }
    this.replace(clean);
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.inputs));
      this.savedAt = new Date();
    } catch {
      this.savedAt = null; // storage blocked (private mode); data lives only in memory
    }
  }
}

export function splitKey(k: string): [string, string] {
  const i = k.lastIndexOf('!');
  return [k.slice(0, i), k.slice(i + 1)];
}

function readStorage(): Inputs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useSession(s: Session): number {
  return useSyncExternalStore(s.subscribe, () => s.version);
}

export const isErrValue = (v: Scalar) => v instanceof XErr;
