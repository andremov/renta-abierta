// Values from outside the form: loose list matching, hand-made backups, the exógena report.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Model } from '../engine/workbook';
import { pickOption } from './validation';
import { normalizeInput } from './api';
import { Session } from './store';
import { parseExogena } from './exogena';
import { readCsvRows } from './xlsx';

const model: Model = JSON.parse(readFileSync(new URL('../../public/model.json', import.meta.url), 'utf8'));
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });

describe('list options', () => {
  const seccional = ['1   Impuestos y Aduanas de Armenia  ', '2   Impuestos de Barranquilla  ', '20   Otra  '];
  it('ignores the fixed-width padding of DIAN list cells', () => {
    expect(pickOption(seccional, '2 Impuestos de Barranquilla')).toBe(seccional[1]);
    expect(pickOption(seccional, '2   Impuestos de Barranquilla  ')).toBe(seccional[1]);
    expect(pickOption(seccional, '2   impuestos de barranquilla')).toBe(seccional[1]);
  });
  it('accepts the code alone', () => {
    expect(pickOption(seccional, '2')).toBe(seccional[1]);
    expect(pickOption(seccional, '02')).toBe(seccional[1]);
    expect(pickOption(['0010', '0020', '0081'], '10')).toBe('0010');
    expect(pickOption(seccional, 'Barranquilla')).toBeUndefined();
  });
});

describe('normalizeInput', () => {
  const s = new Session(model);
  const n = (key: string, v: unknown, strict = true) => normalizeInput(model, s.wb, key, v, strict);
  it('keeps activity codes as text, as the cell is formatted', () => {
    expect(n('DatosGenerales!E9', '0010')).toEqual({ ok: true, value: '0010' });
    expect(n('DatosGenerales!E9', 10)).toEqual({ ok: true, value: '0010' });
  });
  it('resolves the seccional by code to the exact option text', () => {
    expect(n('DatosGenerales!C9', '2')).toEqual({ ok: true, value: '2   Impuestos de Barranquilla  ' });
  });
  it('parses Colombian amounts and rejects non-inputs', () => {
    expect(n('DatosGenerales!C10', '150.000.000')).toEqual({ ok: true, value: 150000000 });
    expect(n('Formulario!AK43', 1).ok).toBe(false);
    expect(n('DatosGenerales!E9', '9999').ok).toBe(false);
  });
});

describe('backup import', () => {
  it('accepts a hand-made file and reports unknown keys', () => {
    const s = new Session(model);
    const report = s.importJSON(
      JSON.stringify({ inputs: { 'DatosGenerales!E8': 'FELIPE', 'DatosGenerales!C9': '2', 'DatosGenerales!E9': '0010', 'Nope!A1': 1 }, pending: { 'DatosGenerales!E8': 'confirmar' } }),
    );
    expect(report.skipped).toEqual(['Nope!A1']);
    expect(s.raw('DatosGenerales', 'E8')).toBe('FELIPE');
    expect(s.raw('DatosGenerales', 'C9')).toBe('2   Impuestos de Barranquilla  ');
    expect(s.raw('DatosGenerales', 'E9')).toBe('0010');
    expect(s.pending).toEqual({ 'DatosGenerales!E8': 'confirmar' });
    expect(JSON.parse(s.exportJSON()).pending).toEqual({ 'DatosGenerales!E8': 'confirmar' });
  });
  it('rejects files of other kinds', () => {
    const s = new Session(model);
    expect(() => s.importJSON('{"kind":"other","inputs":{}}')).toThrow();
    expect(() => s.importJSON('not json')).toThrow();
  });
});

describe('exógena report', () => {
  it('finds the header row and the suggested box', () => {
    const csv = [
      'Consulta de información reportada por terceros;;;;',
      'NIT;Nombre o razón social;Detalle;Valor;Uso declaración sugerida',
      '860034313;BANCO DAVIVIENDA;Saldo a 31 de diciembre;1.234.567;R29',
      '900123456;EMPLEADOR SAS;Pagos por salarios;45.000.000,50;R32',
      ';;Total;46.234.567;',
    ].join('\n');
    const x = parseExogena(readCsvRows(csv), 'exogena.csv');
    expect(x.rows.map((r) => [r.nombre, r.valor, r.casilla])).toEqual([
      ['BANCO DAVIVIENDA', 1234567, 29],
      ['EMPLEADOR SAS', 45000000.5, 32],
    ]);
  });
  it('explains a file without the expected columns', () => {
    expect(() => parseExogena([['a', 'b']], 'x.csv')).toThrow(/Valor/);
  });
});
