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
- **UI**: each sheet is rendered as a CSS grid mirroring the Excel layout;
  help text comes from the workbook's `AY_*` sheets.

See `QUIRKS.md` for bugs found in the official workbook and deliberate differences.

## Verification

```
cd app
npm test                 # engine + app tests
```

- `cached.test.ts`: recalculating the untouched workbook reproduces all 8,923
  values Excel cached in the file.
- `oracle.test.ts`: 30 randomized scenarios (100–480 inputs each across up to
  21 annexes) compared cell-by-cell with results computed by real Excel
  (`tools/gen_cases.py`, `tools/excel_oracle.py`; Windows + Excel, macros
  force-disabled). Skipped when `build/oracle` is absent.

## Development

```
cd app
npm install
npm run model            # re-extract from extracted/*.xlsm (Python 3 + oletools, openpyxl)
npm run dev
npm run build            # static site in app/dist
```

Visual/perf checks use the installed Chrome headlessly: `node scripts/shots.mjs`,
`node scripts/smoke.mjs`, `node scripts/loadtime.mjs`.
