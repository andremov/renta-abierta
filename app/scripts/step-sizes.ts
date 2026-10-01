// Largest wizard steps (by visible input fields) for a scenario with every question answered yes.
import { readFileSync } from 'node:fs';
import type { Model } from '../src/engine/workbook';
import { Session } from '../src/app/store';
import { ALL_PAGES, QUESTIONS } from '../src/forms/pages';
import { pageSteps } from '../src/forms/steps';
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem() {} } });
const model: Model = JSON.parse(readFileSync(new URL('../public/model.json', import.meta.url), 'utf8'));
const s = new Session(model);
QUESTIONS.forEach((q) => (s.profile[q.id] = true));
const sizes: [number, string][] = [];
let total = 0;
for (const p of ALL_PAGES)
  for (const st of pageSteps(s, p)) {
    total++;
    const n = st.section.blocks.reduce((k, b) => k + (b.t === 'fields' ? b.fields.filter((f) => f.kind === 'input').length : b.t === 'table' ? 100 : 0), 0);
    sizes.push([n, `${p.id} › ${st.title}`]);
  }
sizes.sort((a, b) => b[0] - a[0]);
console.log(`steps: ${total}`);
console.log(sizes.filter(([n]) => n < 100).slice(0, 12).map(([n, t]) => `${n}  ${t}`).join('\n'));
console.log(`table steps: ${sizes.filter(([n]) => n >= 100).length}`);
