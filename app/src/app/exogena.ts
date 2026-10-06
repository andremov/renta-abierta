// DIAN's "Consulta de información reportada por terceros" (exógena): what employers, banks and
// others reported about the person, with the Form 210 box DIAN suggests for each line.
import { readCsvRows, readXlsxRows } from './xlsx';

export type ExoStatus = 'incluido' | 'no-aplica';

export interface ExoRow {
  nit: string;
  nombre: string;
  detalle: string;
  valor: number;
  /** DIAN's "Uso declaración sugerida" text, e.g. "R32" */
  uso: string;
  /** box number taken from `uso` */
  casilla: number | null;
  estado?: ExoStatus;
}

export interface Exogena {
  file: string;
  rows: ExoRow[];
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

function parseAmount(s: string): number | null {
  const t = s.replace(/[$\s]/g, '');
  if (!t) return null;
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t)) return Number(t); // spreadsheet number
  if (/^-?[\d.]*(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.')); // 1.234.567,89
  if (/^-?[\d,]*(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, '')); // 1,234,567.89
  return null;
}

export function parseExogena(rows: string[][], file: string): Exogena {
  // the header row has a value column and the suggested-use column; titles above it are skipped
  const h = rows.findIndex((r) => r.some((c) => /^valor/.test(norm(c))) && r.some((c) => /uso/.test(norm(c))));
  if (h < 0) throw new Error('No se encontraron las columnas «Valor» y «Uso declaración sugerida». ¿Es el reporte de información exógena de la DIAN?');
  const head = rows[h].map(norm);
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const cNit = col(/^nit|identificaci/);
  const cNombre = col(/nombre|razon social/);
  const cDetalle = col(/detalle|concepto/);
  const cValor = col(/^valor/);
  const cUso = col(/uso/);
  const out: ExoRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const valor = parseAmount(r[cValor] ?? '');
    if (valor === null) continue;
    // totals rows have no reporting party ("Total" in some column, no NIT)
    if (!(cNit >= 0 && r[cNit]?.trim()) && r.some((c, j) => j !== cValor && /^total/i.test(c.trim()))) continue;
    const uso = (r[cUso] ?? '').trim();
    const m = /R\s*(\d{1,3})\b/i.exec(uso) ?? /^(\d{1,3})$/.exec(uso);
    out.push({
      nit: cNit >= 0 ? (r[cNit] ?? '').trim() : '',
      nombre: cNombre >= 0 ? (r[cNombre] ?? '').trim() : '',
      detalle: cDetalle >= 0 ? (r[cDetalle] ?? '').trim() : '',
      valor,
      uso,
      casilla: m ? Number(m[1]) : null,
    });
  }
  if (!out.length) throw new Error('El archivo no tiene filas con valores.');
  return { file, rows: out };
}

export async function readExogenaFile(f: File): Promise<Exogena> {
  const rows = /\.(csv|txt|tsv)$/i.test(f.name) ? readCsvRows(await f.text()) : await readXlsxRows(await f.arrayBuffer());
  return parseExogena(rows, f.name);
}
