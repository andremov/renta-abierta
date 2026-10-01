// Display formatting and input parsing with Colombian conventions:
// "." groups thousands, "," is the decimal separator, dates are dd/mm/yyyy.
import { XErr, type Scalar } from '../engine/types';

const EPOCH = Date.UTC(1899, 11, 30);

export function serialToDate(n: number): string {
  const d = new Date(EPOCH + Math.round(n) * 86400000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export function dateToSerial(s: string): number | null {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s.trim());
  if (!m) return null;
  const t = Date.UTC(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(t);
  if (d.getUTCDate() !== +m[1] || d.getUTCMonth() !== +m[2] - 1) return null;
  return Math.round((t - EPOCH) / 86400000);
}

export const isDateFormat = (nf?: string) => !!nf && /(^|[^"\\])(d{1,4}|y{2,4})/i.test(nf.replace(/\[[^\]]*\]/g, '')) && !/#|0\.0/.test(nf);
export const isPercentFormat = (nf?: string) => !!nf && nf.includes('%');
export const isTextFormat = (nf?: string) => nf === '@';
export const isMoneyFormat = (nf?: string) => !!nf && nf.includes('$');

function group(n: number, decimals: number): string {
  const [ip, dp] = Math.abs(n).toFixed(decimals).split('.');
  const g = ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + g + (dp ? ',' + dp : '');
}

/** Render a cell value according to its Excel number format. */
export function formatValue(v: Scalar, nf?: string): string {
  if (v === null) return '';
  if (v instanceof XErr) return v.code;
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v === 'string') return v;
  if (!nf || nf === 'General') {
    if (Number.isInteger(v)) return Math.abs(v) >= 10000 ? group(v, 0) : String(v);
    return String(Number(v.toPrecision(10))).replace('.', ',');
  }
  if (/\[\$-F800\]/i.test(nf)) {
    const d = new Date(EPOCH + Math.round(v) * 86400000);
    return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
  }
  if (isDateFormat(nf)) return serialToDate(v);
  if (isPercentFormat(nf)) {
    const d = (nf.split('.')[1] ?? '').replace(/[^0]/g, '').length;
    return group(v * 100, d) + '%';
  }
  const section = nf.split(';')[v < 0 && nf.includes(';') ? 1 : 0];
  const decimals = (section.split('.')[1] ?? '').replace(/[^0#]/g, '').length;
  const body = group(v < 0 && nf.includes(';') ? Math.abs(v) : v, decimals);
  if (isMoneyFormat(section)) return (v < 0 && nf.includes(';') ? '-' : '') + '$ ' + body;
  return body;
}

/** Parse what a person typed into an input cell. */
export function parseInput(raw: string, nf?: string): Scalar | { error: string } {
  const s = raw.trim();
  if (s === '') return null;
  if (isTextFormat(nf)) return s;
  if (isDateFormat(nf)) {
    const d = dateToSerial(s);
    return d === null ? { error: 'Escriba la fecha como dd/mm/aaaa.' } : d;
  }
  const pct = s.endsWith('%');
  const cleaned = s.replace(/[$\s%]/g, '');
  if (/^-?[\d.]*(,\d+)?$/.test(cleaned) && /\d/.test(cleaned)) {
    const n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return { error: 'Escriba un número válido.' };
    if (pct) return n / 100;
    // in percentage cells "35" means 35 %, while "0,35" is already a fraction
    if (isPercentFormat(nf)) return n > 1 ? n / 100 : n;
    return n;
  }
  if (nf && /[#0]/.test(nf)) return { error: 'Escriba solo números, sin letras.' };
  return s;
}

/** Value shown inside an input box while editing. */
export function editText(v: Scalar, nf?: string): string {
  if (v === null || v instanceof XErr) return '';
  if (typeof v === 'number') {
    if (isDateFormat(nf)) return serialToDate(v);
    if (isPercentFormat(nf)) return String(Number((v * 100).toPrecision(12))).replace('.', ',') + '%';
    return formatValue(v, nf && /[#0]/.test(nf) ? nf.replace(/"\$"\\? ?|\[\$\$[^\]]*\]\\? ?/g, '') : undefined);
  }
  return String(v);
}
