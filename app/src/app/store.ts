// Session state: the person's inputs, the live workbook, persistence.
// Everything stays in this browser; nothing is sent anywhere.
import { useSyncExternalStore } from 'react';
import { Model, Workbook } from '../engine/workbook';
import { XErr, type Scalar } from '../engine/types';
import { CLEAR_ON_EDIT, inactiveKeys } from './rules';

const STORAGE_KEY = 'renta-ag2025:inputs:v1';
const PROFILE_KEY = 'renta-ag2025:profile:v1';

/** Questionnaire answers: question id -> yes/no. */
export type Profile = Record<string, boolean>;
export const FILE_KIND = 'ayuda-renta-ag2025';

export type Inputs = Record<string, Scalar>; // "Sheet!A1" -> value

export class Session {
  wb: Workbook;
  inputs: Inputs = {};
  version = 0;
  savedAt: Date | null = null;
  /** inputs that currently count as blank (hidden wizard rows, pop-up values whose trigger is off) */
  inactive = new Set<string>();
  profile: Profile = {};
  private listeners = new Set<() => void>();

  constructor(readonly model: Model) {
    this.wb = new Workbook(model);
    const saved = readStorage(STORAGE_KEY);
    if (saved) this.inputs = saved as Inputs;
    this.profile = (readStorage(PROFILE_KEY) as Profile) ?? {};
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

  /** What the person typed (or the file's default), before rules blank anything out. */
  raw = (sheet: string, a1: string): Scalar => {
    const k = `${sheet}!${a1}`;
    if (k in this.inputs) return this.inputs[k];
    const v = this.model.sheets.find((s) => s.name === sheet)?.cells[a1]?.v;
    return v === undefined || typeof v === 'object' ? null : v;
  };

  private applyAll() {
    const before = this.inactive;
    // Like DIAN's VBA, values whose question no longer applies are erased (not just ignored).
    // Repeat until stable: erasing one answer can make a dependent question inapplicable.
    const erased = new Set<string>();
    for (let guard = 0; guard < 5; guard++) {
      const off = inactiveKeys(this.inputs, this.raw);
      if (!off.size) break;
      for (const k of off) {
        delete this.inputs[k];
        erased.add(k);
      }
    }
    this.inactive = new Set();
    const keys = new Set([...Object.keys(this.inputs), ...before, ...erased]);
    for (const k of keys) {
      const [sheet, a1] = splitKey(k);
      try {
        this.wb.set(sheet, a1, this.inactive.has(k) ? null : (this.inputs[k] ?? null));
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
    const changed = this.inputs[k] !== v;
    if (v === null || v === '') delete this.inputs[k];
    else this.inputs[k] = v;
    this.wb.set(sheet, a1, v);
    if (changed)
      for (const target of CLEAR_ON_EDIT[k] ?? []) {
        if (!(target in this.inputs)) continue;
        delete this.inputs[target];
        const i = target.lastIndexOf('!');
        this.wb.set(target.slice(0, i), target.slice(i + 1), null);
      }
    this.applyAll();
    this.persist();
    this.emit();
  }

  setAnswer(id: string, yes: boolean | null) {
    if (yes === null) delete this.profile[id];
    else this.profile[id] = yes;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
    } catch {
      /* storage blocked: answers live in memory only */
    }
    this.emit();
  }

  /** Replace all inputs (import / reset). */
  replace(inputs: Inputs, profile: Profile = {}) {
    this.wb = new Workbook(this.model);
    this.inputs = { ...inputs };
    this.profile = { ...profile };
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
    } catch {
      /* ignore */
    }
    this.inactive = new Set();
    this.applyAll();
    this.persist();
    this.emit();
  }

  exportJSON(): string {
    return JSON.stringify(
      { kind: FILE_KIND, version: 1, exportedAt: new Date().toISOString(), profile: this.profile, inputs: this.inputs },
      null,
      1,
    );
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
    const profile: Profile = {};
    if (data.profile && typeof data.profile === 'object')
      for (const [k, v] of Object.entries(data.profile)) if (typeof v === 'boolean') profile[k] = v;
    this.replace(clean, profile);
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

function readStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useSession(s: Session): number {
  return useSyncExternalStore(s.subscribe, () => s.version);
}

export const isErrValue = (v: Scalar) => v instanceof XErr;
