// TEXT() for the number formats the workbook uses. The workbook was authored in a
// Spanish (Colombia) locale, so in format strings "." groups thousands and "," is the
// decimal separator.
import type { Scalar } from './types';
import { numToStr } from './values';

export function formatText(v: Scalar, fmt: string): string {
  if (typeof v === 'string') return v;
  if (v === null) v = 0;
  if (typeof v === 'boolean') return v ? 'VERDADERO' : 'FALSO';
  if (typeof v !== 'number') return String(v);

  const first = fmt.search(/[#0]/);
  if (first < 0) return fmt;
  let last = first;
  for (let i = first; i < fmt.length; i++) if (/[#0.,]/.test(fmt[i])) last = i;
  const lastDigit = Math.max(fmt.lastIndexOf('#'), fmt.lastIndexOf('0'));
  last = Math.min(last, lastDigit);
  const prefix = fmt.slice(0, first);
  const pattern = fmt.slice(first, last + 1);
  const suffix = fmt.slice(last + 1);

  const [intPat, decPat = ''] = pattern.split(',');
  const decimals = decPat.replace(/[^#0]/g, '').length;
  const grouped = intPat.includes('.');
  const minInt = (intPat.match(/0/g) ?? []).length;

  const abs = Math.abs(v);
  const fixed = abs.toFixed(decimals);
  let [ip, dp = ''] = fixed.split('.');
  if (ip === '0' && minInt === 0) ip = '';
  ip = ip.padStart(minInt, '0');
  if (grouped) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const minDec = (decPat.match(/0/g) ?? []).length;
  dp = dp.replace(/0+$/, '').padEnd(minDec, '0');
  const body = ip + (dp ? ',' + dp : '');
  return (v < 0 && body ? '-' : '') + prefix + body + suffix;
}

export { numToStr };
