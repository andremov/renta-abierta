import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { editText, formatValue, parseInput } from './format';
import { shiftFormula } from './validation';
import { gatedHiddenRows, inactiveKeys } from './rules';
import { Session } from './store';
import type { Model } from '../engine/workbook';

describe('format', () => {
  it('parses Colombian number input', () => {
    expect(parseInput('1.234.567', '#,##0')).toBe(1234567);
    expect(parseInput('$ 2.500.000', '"$"\\ #,##0')).toBe(2500000);
    expect(parseInput('1234,5', '#,##0.00')).toBe(1234.5);
    expect(parseInput('35', '0.00%')).toBeCloseTo(0.35);
    expect(parseInput('0,35', '0.00%')).toBeCloseTo(0.35);
    expect(parseInput('12%', undefined)).toBeCloseTo(0.12);
    expect(parseInput('abc', '#,##0')).toEqual({ error: expect.any(String) });
    expect(parseInput('Juan', '@')).toBe('Juan');
    expect(parseInput('', '#,##0')).toBeNull();
  });
  it('parses dates as Excel serials', () => {
    expect(parseInput('31/12/2025', 'dd/mm/yyyy;@')).toBe(46022);
    expect(parseInput('31/02/2025', 'dd/mm/yyyy;@')).toEqual({ error: expect.any(String) });
  });
  it('formats like the workbook', () => {
    expect(formatValue(7892776000, '"$"\\ #,##0')).toBe('$ 7.892.776.000');
    expect(formatValue(-1500, '"$"\\ #,##0;\\-"$"\\ #,##0')).toBe('-$ 1.500');
    expect(formatValue(0.19, '0.00%')).toBe('19,00%');
    expect(formatValue(46022, 'dd/mm/yyyy;@')).toBe('31/12/2025');
    expect(editText(2500000, '"$"\\ #,##0')).toBe('2.500.000');
  });
});

describe('validation formulas', () => {
  it('shifts only relative references', () => {
    expect(shiftFormula('IF(E44<E40,E44,0)', 2, 0)).toBe('IF(E46<E42,E46,0)');
    expect(shiftFormula('$A$26:$A$28', 5, 1)).toBe('$A$26:$A$28');
    expect(shiftFormula("'ajustes art. 73'!$A$6:$A$131", 3, 0)).toBe("'ajustes art. 73'!$A$6:$A$131");
    expect(shiftFormula('AO7:AS7', 1, 0)).toBe('AO8:AS8');
    expect(shiftFormula('"Si,No"', 4, 0)).toBe('"Si,No"');
  });
});

describe('VBA rules', () => {
  const SAL = 'Salarios_Demas_Pagos_Laborales';
  it('reveals salary follow-up questions per employer', () => {
    const vals: Record<string, unknown> = {};
    const get = (s: string, a: string) => (vals[`${s}!${a}`] ?? null) as never;
    expect(gatedHiddenRows('Datos_Salarios', get).has(3)).toBe(true);
    vals[`${SAL}!E9`] = 1000000;
    let hidden = gatedHiddenRows('Datos_Salarios', get);
    expect(hidden.has(3)).toBe(false);
    expect(hidden.has(4)).toBe(true);
    vals['Datos_Salarios!E3'] = 'No';
    hidden = gatedHiddenRows('Datos_Salarios', get);
    expect(hidden.has(4)).toBe(true);
    expect(hidden.has(5)).toBe(false);
    expect(hidden.has(6)).toBe(true);
    vals['Datos_Salarios!E5'] = 'Si';
    expect(gatedHiddenRows('Datos_Salarios', get).has(6)).toBe(false);
    // employer 2 untouched
    expect(gatedHiddenRows('Datos_Salarios', get).has(8)).toBe(true);
  });

  it('blanks answers whose question is hidden and pop-up values whose trigger is off', () => {
    const inputs = { 'Datos_Salarios!E4': 5, 'Inversiones!Q14': 9, 'Inversiones!Q7': 3, 'Inversiones!I7': 'Otro valor' };
    const get = (s: string, a: string) => (inputs as Record<string, never>)[`${s}!${a}`] ?? null;
    const off = inactiveKeys(inputs, get);
    expect(off.has('Datos_Salarios!E4')).toBe(true);
    expect(off.has('Inversiones!Q14')).toBe(true);
    expect(off.has('Inversiones!Q7')).toBe(false);
  });
});

describe('session', () => {
  const model: Model = JSON.parse(readFileSync(new URL('../../public/model.json', import.meta.url), 'utf8'));
  beforeEach(() => {
    const mem = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) },
    });
  });

  it('flows an input through to the form and survives export/import', () => {
    const s = new Session(model);
    s.set('DatosGenerales', 'C6', 80123456);
    expect(s.get('DatosGenerales', 'E6')).toBe(4); // DV computed by the workbook
    const json = s.exportJSON();
    const t = new Session(model);
    t.replace({});
    expect(t.get('DatosGenerales', 'E6')).not.toBe(4);
    t.importJSON(json);
    expect(t.get('DatosGenerales', 'E6')).toBe(4);
  });

  it('erases a pop-up value when its trigger turns off, like the VBA', () => {
    const s = new Session(model);
    s.set('DatosGenerales', 'C11', 3);
    s.set('DatosGenerales', 'H11', 1000000);
    expect(s.get('DatosGenerales', 'H11')).toBe(1000000);
    s.set('DatosGenerales', 'C11', 1);
    expect(s.get('DatosGenerales', 'H11')).toBeNull();
    expect(s.inputs['DatosGenerales!H11']).toBeUndefined();
    s.set('DatosGenerales', 'C11', 3);
    expect(s.get('DatosGenerales', 'H11')).toBeNull(); // asked again, as Excel's prompt would
  });

  it('resets salary questions when the salary is edited, like the VBA', () => {
    const s = new Session(model);
    s.set('Salarios_Demas_Pagos_Laborales', 'E9', 80000000);
    s.set('Datos_Salarios', 'E3', 'No');
    s.set('Datos_Salarios', 'E5', 'Si');
    s.set('Datos_Salarios', 'E6', 5000000);
    s.set('Salarios_Demas_Pagos_Laborales', 'E9', 90000000);
    expect(s.inputs['Datos_Salarios!E3']).toBeUndefined();
    expect(s.get('Datos_Salarios', 'E6')).toBeNull();
  });
});

describe('page footer', () => {
  it('parses the Formulario footer like Excel prints it', async () => {
    const { parseHeaderFooter, marginBoxCss } = await import('./headerFooter');
    const code = '&L&9    \n\n&C&14\n\n&16\n&R&D&T \nBORRADOR_x000D_&1#&"Calibri"&10&K000000 Información Pública Clasificada ';
    const s = parseHeaderFooter(code, new Date(2026, 8, 30, 19, 46), 'Formulario');
    expect(s.left).toBeUndefined();
    expect(s.center).toBeUndefined();
    expect(s.right?.lines).toEqual(['30/09/202619:46', 'BORRADOR', 'Información Pública Clasificada']);
    expect(s.right?.font).toBe('Calibri');
    expect(s.right?.sizePt).toBe(10);
    expect(marginBoxCss(s, 'bottom')).toContain('@bottom-right');
  });
});
