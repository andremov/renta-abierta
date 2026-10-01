// Behavior the Excel file implemented in VBA, expressed declaratively:
//  - rows that only appear after certain answers (question "wizards"), and
//  - values the VBA asked for in pop-up InputBoxes and wrote into locked cells.
// Everything depends only on values the person typed, so it is applied before each
// recalculation: inactive rows / inputs count as blank, exactly as the VBA cleared them.
// Sources: build/vba-visibility.md and build/vba-behaviors.md.
import type { Scalar } from '../engine/types';

export type Get = (sheet: string, a1: string) => Scalar;
type Cond = (get: Get) => boolean;

const SAL = 'Salarios_Demas_Pagos_Laborales';

const nonEmpty = (sheet: string, a1: string): Cond => (g) => {
  const v = g(sheet, a1);
  return v !== null && v !== '';
};
const positive = (sheet: string, a1: string): Cond => (g) => {
  const v = g(sheet, a1);
  return typeof v === 'number' && v > 0;
};
const equals = (sheet: string, a1: string, want: string): Cond => (g) =>
  String(g(sheet, a1) ?? '').trim().toUpperCase() === want.toUpperCase();
const all = (...cs: Cond[]): Cond => (g) => cs.every((c) => c(g));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export interface RowGate {
  sheet: string;
  rows: number[]; // 1-based
  when: Cond;
}

export interface ExtraInput {
  sheet: string;
  cell: string;
  when: Cond;
  /** what the Excel pop-up asked, shown as the field's label */
  label: string;
  prompt: string;
  kind: 'money' | 'percent';
  /** upper bound (e.g. the amount the exemption belongs to) */
  max?: (get: Get) => number | null;
  /** non-blocking check shown under the field */
  warn?: (v: number, get: Get, calc: Get) => string | null;
}

// ---------------------------------------------------------------- row gates

const salaryBlocks: [string, number][] = [
  ['E9', 3],
  ['E22', 8],
  ['E35', 13],
];
const cesantias: [string, number][] = [
  ['E10', 3],
  ['E23', 5],
  ['E36', 7],
  ['E12', 15],
  ['E25', 17],
  ['E38', 19],
];
const gastosRep: [string, number][] = [
  ['E11', 3],
  ['E24', 5],
  ['E37', 7],
];

export const ROW_GATES: RowGate[] = [
  // Datos_Salarios: per employer, "¿fue oficial / suboficial / soldado…?" then follow-ups
  ...salaryBlocks.flatMap(([cell, q]): RowGate[] => {
    const asked = nonEmpty(SAL, cell);
    return [
      { sheet: 'Datos_Salarios', rows: [q], when: asked },
      { sheet: 'Datos_Salarios', rows: [q + 1], when: all(asked, equals('Datos_Salarios', `E${q}`, 'Si')) },
      { sheet: 'Datos_Salarios', rows: [q + 2], when: all(asked, equals('Datos_Salarios', `E${q}`, 'No')) },
      {
        sheet: 'Datos_Salarios',
        rows: [q + 3],
        when: all(asked, equals('Datos_Salarios', `E${q}`, 'No'), equals('Datos_Salarios', `E${q + 2}`, 'Si')),
      },
    ];
  }),
  // Datos_Cesantias: one question per positive cesantías amount; rows 9/11/13 are never used
  ...cesantias.map(([cell, row]): RowGate => ({ sheet: 'Datos_Cesantias', rows: [row], when: positive(SAL, cell) })),
  { sheet: 'Datos_Cesantias', rows: [9, 11, 13], when: () => false },
  // Datos_Gastos_Rep: one question per employer that reported gastos de representación
  ...gastosRep.map(([cell, row]): RowGate => ({ sheet: 'Datos_Gastos_Rep', rows: [row], when: nonEmpty(SAL, cell) })),
  // Datos_Otros_Ingresos: Excel showed one employer's block at a time (buttons "…"); show all three
  { sheet: 'Datos_Otros_Ingresos', rows: range(4, 59), when: () => true },
];

/**
 * Answers the VBA erases when another cell is edited (beyond rows becoming hidden):
 * editing an employer's salary resets that employer's salary questions, as
 * Salarios_Demas_Pagos_Laborales Worksheet_Change → Datos_Salarios does.
 */
export const CLEAR_ON_EDIT: Record<string, string[]> = {
  [`${SAL}!E9`]: ['Datos_Salarios!E3', 'Datos_Salarios!E4', 'Datos_Salarios!E5', 'Datos_Salarios!E6'],
  [`${SAL}!E22`]: ['Datos_Salarios!E8', 'Datos_Salarios!E9', 'Datos_Salarios!E10', 'Datos_Salarios!E11'],
  [`${SAL}!E35`]: ['Datos_Salarios!E13', 'Datos_Salarios!E14', 'Datos_Salarios!E15', 'Datos_Salarios!E16'],
};

/** Question sheets that belong to another sheet (the VBA jumped to them automatically). */
export const HELPER_OF: Record<string, string> = {
  Datos_Salarios: SAL,
  Datos_Cesantias: SAL,
  Datos_Gastos_Rep: SAL,
  Datos_Otros_Ingresos: SAL,
};

// ---------------------------------------------------------- pop-up inputs

const OTRO_VALOR =
  'Si no acepta ningún valor patrimonial sugerido, digite el valor que usted considere procedente, bajo su propia responsabilidad.';

const otrosIngresos: [string, string, 'exento' | 'incr' | 'exterior'][] = [
  ['E6', 'E7', 'exento'],
  ['E10', 'E11', 'exento'],
  ['E12', 'E13', 'exento'],
  ['E14', 'E15', 'incr'],
  ['E19', 'E20', 'exterior'],
  ['E25', 'E26', 'exento'],
  ['E29', 'E30', 'exento'],
  ['E31', 'E32', 'exento'],
  ['E33', 'E34', 'incr'],
  ['E38', 'E39', 'exterior'],
  ['E44', 'E45', 'exento'],
  ['E48', 'E49', 'exento'],
  ['E50', 'E51', 'exento'],
  ['E52', 'E53', 'incr'],
  ['E57', 'E58', 'exterior'],
];
const OTROS_TEXT = {
  exento: ['Valor exento', 'Según certificación emitida por su pagador, indique el valor exento de este ingreso.'],
  incr: [
    'Monto no constitutivo de renta',
    'Según certificación emitida por su pagador, indique el monto a tratarse como ingreso no constitutivo de renta ni ganancia ocasional.',
  ],
  exterior: [
    'Impuesto pagado en el exterior',
    'Según certificación, indique el valor en moneda colombiana del impuesto pagado en el exterior.',
  ],
} as const;

const num = (v: Scalar) => (typeof v === 'number' ? v : null);

export const EXTRA_INPUTS: ExtraInput[] = [
  {
    sheet: 'DatosGenerales',
    cell: 'H11',
    when: (g) => (num(g('DatosGenerales', 'C11')) ?? 0) > 1,
    label: 'Impuesto neto de renta del año 2024',
    prompt:
      'Diligencie el impuesto neto de renta del año 2024; tome este valor de la casilla 126 del formulario 210 de la declaración de renta del año 2024.',
    kind: 'money',
  },
  {
    sheet: 'Liquidacion_Privada',
    cell: 'H26',
    when: equals('DatosGenerales', 'C12', 'X'),
    label: 'Impuesto neto de renta para el beneficio de auditoría',
    prompt:
      'Si para acogerse al beneficio de auditoría requiere modificar la casilla 126 (impuesto neto de renta), ingrese aquí el valor una vez termine de diligenciar la declaración.',
    kind: 'money',
    warn: (v, _g, calc) => {
      const neto = (num(calc('Formulario', 'AK40')) ?? 0) - (num(calc('Formulario', 'AN42')) ?? 0);
      return v < neto ? 'El valor es menor al impuesto neto de renta calculado. Verifique que sea el valor que desea usar.' : null;
    },
  },
  // Inversiones: "Otro valor" chosen as the patrimonial value of row r.
  // (The Excel file writes row 14's value into Q11 by mistake; fixed here, see QUIRKS.md.)
  ...Array.from({ length: 23 }, (_, i): ExtraInput => ({
    sheet: 'Inversiones',
    cell: `Q${i + 7}`,
    when: equals('Inversiones', `I${i + 7}`, 'Otro valor'),
    label: `Otro valor patrimonial (fila ${i + 7})`,
    prompt: OTRO_VALOR,
    kind: 'money',
  })),
  ...Array.from({ length: 20 }, (_, i): ExtraInput => ({
    sheet: 'Activos_Fijos',
    cell: `AT${i + 7}`,
    when: equals('Activos_Fijos', `J${i + 7}`, 'Otro valor'),
    label: `Otro valor patrimonial (fila ${i + 7})`,
    prompt: OTRO_VALOR,
    kind: 'money',
  })),
  ...otrosIngresos.map(([src, cell, k]): ExtraInput => ({
    sheet: 'Datos_Otros_Ingresos',
    cell,
    when: nonEmpty('Datos_Otros_Ingresos', src),
    label: OTROS_TEXT[k][0],
    prompt: OTROS_TEXT[k][1],
    kind: 'money',
    max: (g) => num(g('Datos_Otros_Ingresos', src)),
  })),
  {
    sheet: 'Venta_Inm_Dif_Casa_Hab',
    cell: 'N21',
    when: equals('Venta_Inm_Dif_Casa_Hab', 'J7', 'SI'),
    label: 'Porcentaje de participación en la propiedad',
    prompt: 'Indique el porcentaje de participación en la propiedad de la casa o apartamento de habitación (por ejemplo 50).',
    kind: 'percent',
    max: () => 100,
  },
];

const key = (sheet: string, a1: string) => `${sheet}!${a1}`;
export const EXTRA_BY_KEY = new Map(EXTRA_INPUTS.map((x) => [key(x.sheet, x.cell), x]));

/** Visible-row overrides for a sheet: rows forced hidden given current answers. */
export function gatedHiddenRows(sheet: string, get: Get): Set<number> {
  const hidden = new Set<number>();
  const shown = new Set<number>();
  for (const g of ROW_GATES) {
    if (g.sheet !== sheet) continue;
    for (const r of g.rows) (g.when(get) ? shown : hidden).add(r);
  }
  for (const r of shown) hidden.delete(r);
  return hidden;
}

/** Rows a gate controls, to un-hide them when the gate opens (they start hidden in the file). */
export function gatedRows(sheet: string): Set<number> {
  return new Set(ROW_GATES.filter((g) => g.sheet === sheet).flatMap((g) => g.rows));
}

/**
 * Inputs that are inactive given the current answers (hidden wizard rows, pop-up inputs whose
 * trigger is off). Their stored values are kept but count as blank in the calculation.
 */
export function inactiveKeys(inputs: Record<string, Scalar>, get: Get): Set<string> {
  const out = new Set<string>();
  const gatedBySheet = new Map<string, Set<number>>();
  for (const k of Object.keys(inputs)) {
    const x = EXTRA_BY_KEY.get(k);
    if (x) {
      if (!x.when(get)) out.add(k);
      continue;
    }
    const i = k.lastIndexOf('!');
    const sheet = k.slice(0, i);
    if (!ROW_GATES.some((g) => g.sheet === sheet)) continue;
    let hidden = gatedBySheet.get(sheet);
    if (!hidden) gatedBySheet.set(sheet, (hidden = gatedHiddenRows(sheet, get)));
    const row = parseInt(k.slice(i + 1).replace(/^[A-Z]+/, ''), 10);
    if (hidden.has(row)) out.add(k);
  }
  return out;
}
