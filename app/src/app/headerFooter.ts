// Excel page header/footer codes → CSS page-margin boxes (@page @bottom-right { content: … }).
// Codes: &L &C &R sections; &D date, &T time, &P page, &N pages, &A sheet, &F file;
// &"font,style", &<size>, &K<color>, &B &I &U &S &X &Y toggles; &&  literal ampersand.
// "&1#" is the placeholder Office puts before a sensitivity-label marking; _x000D_ is an escaped
// carriage return (Excel prints it as a line break).

export interface MarginBox {
  /** text with literal newlines; date/time already substituted */
  lines: string[];
  sizePt?: number;
  font?: string;
  color?: string;
}

export type Sections = Partial<Record<'left' | 'center' | 'right', MarginBox>>;

const pad = (n: number) => String(n).padStart(2, '0');

export function parseHeaderFooter(code: string, now: Date, sheetName: string): Sections {
  const out: Sections = {};
  let section: 'left' | 'center' | 'right' = 'center';
  let box: MarginBox = { lines: [''] };
  const flush = () => {
    const lines = box.lines.map((l) => l.trim());
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    while (lines.length && !lines[0]) lines.shift();
    if (lines.length) out[section] = { ...box, lines };
  };
  const text = (t: string) => (box.lines[box.lines.length - 1] += t);
  const src = code.replace(/_x000D_/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') {
      box.lines.push('');
      continue;
    }
    if (ch !== '&') {
      text(ch);
      continue;
    }
    const n = src[++i];
    if (n === undefined) break;
    if (n === '&') text('&');
    else if (n === 'L' || n === 'C' || n === 'R') {
      flush();
      section = n === 'L' ? 'left' : n === 'C' ? 'center' : 'right';
      box = { lines: [''] };
    } else if (n === 'D') text(`${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`);
    else if (n === 'T') text(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
    else if (n === 'P') text('\u0000P'); // page number: filled in by CSS counter
    else if (n === 'N') text('\u0000N');
    else if (n === 'A') text(sheetName);
    else if (n === 'F') text('AyudaRenta 2025');
    else if (n === '"') {
      const end = src.indexOf('"', i + 1);
      box.font = src.slice(i + 1, end).split(',')[0];
      i = end;
    } else if (n === 'K') {
      box.color = `#${src.slice(i + 1, i + 7)}`;
      i += 6;
    } else if (/\d/.test(n)) {
      let num = n;
      while (/\d/.test(src[i + 1] ?? '')) num += src[++i];
      if (src[i + 1] === '#') i++; // "&1#": sensitivity-label placeholder, not a size
      else box.sizePt = parseInt(num, 10);
    }
    // &B &I &U &S &X &Y &G &O &H: styling toggles / picture; ignored
  }
  flush();
  return out;
}

const cssString = (s: string) =>
  '"' +
  s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\u0000P/g, '" counter(page) "')
    .replace(/\u0000N/g, '" counter(pages) "') +
  '"';

/** CSS margin boxes for the bottom (footer) or top (header) of printed pages. Excel scales
 *  headers/footers with the page ("scale with document"), so sizes are multiplied by `scale`. */
export function marginBoxCss(sections: Sections, edge: 'top' | 'bottom', scale = 1): string {
  return (['left', 'center', 'right'] as const)
    .map((k) => {
      const b = sections[k];
      if (!b) return '';
      const props = [
        `content: ${cssString(b.lines.join('\n'))}`,
        'white-space: pre',
        `font-family: ${b.font ? `"${b.font}", ` : ''}Arial, sans-serif`,
        // the first line usually uses the default 11 pt font; Excel shrinks it with the page
        `font-size: ${((b.lines.length > 1 ? 11 : b.sizePt ?? 11) * scale).toFixed(2)}pt`,
        `color: ${b.color ?? '#000'}`,
        `text-align: ${k}`,
        `vertical-align: ${edge === 'bottom' ? 'bottom' : 'top'}`,
      ];
      return `@${edge}-${k} { ${props.join('; ')}; }`;
    })
    .join('\n');
}
