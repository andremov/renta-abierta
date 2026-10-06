// Minimal .xlsx reader (first worksheet → rows of cell text) using only browser built-ins:
// the zip is read by hand and inflated with DecompressionStream, the XML with DOMParser.

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** name → bytes of every file in the zip, from its central directory. */
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('El archivo no es un libro de Excel (.xlsx).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflate(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const xml = (name: string) => {
    const f = files.get(name);
    return f ? new DOMParser().parseFromString(dec.decode(f), 'application/xml') : null;
  };
  const strings = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? [])].map((si) =>
    [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''),
  );
  // first sheet in workbook order
  const rels = xml('xl/_rels/workbook.xml.rels');
  const first = xml('xl/workbook.xml')?.getElementsByTagName('sheet')[0];
  const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = [...(rels?.getElementsByTagName('Relationship') ?? [])].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  const sheet = xml(path) ?? xml('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('No se encontró ninguna hoja en el archivo.');
  const rows: string[][] = [];
  for (const row of sheet.getElementsByTagName('row')) {
    const cells: string[] = [];
    for (const c of row.getElementsByTagName('c')) {
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const text =
        t === 's' ? (strings[Number(v)] ?? '') : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent ?? '').join('') : v;
      cells[colIndex(c.getAttribute('r') ?? '')] = text;
    }
    rows.push(Array.from(cells, (x) => x ?? ''));
  }
  return rows;
}

/** CSV/TSV as exported by spreadsheets (separator guessed from the first line). */
export function readCsvRows(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}
