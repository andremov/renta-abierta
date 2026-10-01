# Renta abierta 2025

A web version of DIAN's **Programa Ayuda Renta 2025** (Form 210, personas naturales
residentes, año gravable 2025). It does the same calculations as the official
`.xlsm`, but runs in any browser on any OS, with no macros, no ActiveX and no
changes to security settings. Unofficial; not affiliated with DIAN.

## Privacy model

- Static site. All calculation happens in the browser; there is no backend.
- Data is stored only in the browser (`localStorage`) and in backup files the
  person downloads. The Content-Security-Policy (`vercel.json`) only allows
  requests to the site itself, so the page cannot send data anywhere else.
- No analytics, cookies, third-party fonts or scripts.

## How it works

```
extracted/*.xlsm ──tools/extract.py──▶ build/model.json ──tools/bundle.py──▶ app/public/model.json
                                          (cells, formulas, styles,            │
                                           validations, controls, nav)         ▼
                                                               app/src/engine  Excel-compatible formula engine
                                                               app/src/app     React UI (sheet grid, rules, help)
```

- **Engine** (`app/src/engine`): parser + evaluator for the 30 Excel functions the
  workbook uses, dependency ordering, and iterative calculation for its 23
  circular-reference groups (Excel's 100 iterations / 0.001).
- **Rules** (`app/src/app/rules.ts`): the VBA behaviour that affects values —
  question "wizards" and values the VBA asked for in pop-ups — as declarative
  rules. Inventories of the VBA: `build/vba-behaviors.md`, `build/vba-visibility.md`.
- **Forms** (`app/src/forms`): web forms are generated from each sheet's
  structure (labels, inputs, tables, totals, validations) by `spec.ts`. Every
  field reads and writes a real workbook cell, so the engine and its Excel
  verification are untouched. A questionnaire (`pages.ts`) decides which pages
  apply; help text comes from the workbook's `AY_*` sheets.
- **Output**: the results page lists every Form 210 box (`casillas.json`,
  mapped from the `Formulario` sheet) for transcription into DIAN's online
  form, plus the `Formulario` sheet rendered as-is for printing.

See `QUIRKS.md` for bugs found in the official workbook and deliberate differences.

## Verification

The output must be exactly the Excel file's output. Three layers guard that:


```
cd app
npm test                 # engine + app tests
```

- `cached.test.ts`: recalculating the untouched workbook reproduces all 8,923
  values Excel cached in the file.
- `oracle.test.ts`: 200 realistic taxpayer profiles (`scripts/gen-profiles.ts`) computed
  through the web session, plus 30 randomized scenarios (100–480 inputs each across up to
  21 annexes) compared cell-by-cell with results computed by real Excel
  (`tools/gen_cases.py`, `tools/excel_oracle.py`; Windows + Excel, macros
  force-disabled). Skipped when `build/oracle` is absent.
- `app/vba-parity.test.ts`: scripted scenarios run in Excel with DIAN's macros on (sandboxed
  copy, `tools/excel_vba_parity.py`) and through the web rules; values must match.
- `forms/coverage.test.ts`: every input cell a person can fill in Excel is
  reachable from the web forms (77 input sheets), so nothing that affects the
  Form 210 is left out. `forms/pages.test.ts`: every input sheet belongs to a page.

## Development

```
cd app
npm install
npm run model            # re-extract from extracted/*.xlsm (Python 3 + oletools, openpyxl)
npm run dev
npm run build            # static site in app/dist
```

## Deployment

Live at https://renta-abierta.vercel.app. The Vercel project (root directory
`app/`) is connected to this repository: every push to `main` deploys to
production, and other branches and pull requests get preview deployments.

Visual/perf checks use the installed Chrome headlessly: `node scripts/shots.mjs`,
`node scripts/smoke.mjs`, `node scripts/loadtime.mjs`.
