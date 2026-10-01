// Prints every page's wizard steps for a scenario (titles and kinds).
import { readFileSync } from 'node:fs';
import type { Model } from '../src/engine/workbook';
import { Session } from '../src/app/store';
import { ALL_PAGES } from '../src/forms/pages';
import { pageSteps } from '../src/forms/steps';
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem() {} } });
const model: Model = JSON.parse(readFileSync(new URL('../public/model.json', import.meta.url), 'utf8'));
const s = new Session(model);
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
s.replace(Object.fromEntries(input.inputs.map(([a, b, v]: [string, string, unknown]) => [`${a}!${b}`, v])));
for (const p of ALL_PAGES.filter((x) => !process.argv[3] || x.id === process.argv[3]))
  console.log(`${p.id}: ` + pageSteps(s, p).map((x) => `${x.title}${x.kind !== 'section' ? ` (${x.kind})` : ''}`).join(' | '));
