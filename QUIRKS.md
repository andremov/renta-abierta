# Quirks found in DIAN's Ayuda Renta 2025 workbook

The port reproduces Excel's behavior exactly, including these. They are listed
here so they can be reported to DIAN or deliberately fixed later.

| Where | What | Effect |
|---|---|---|
| `tarifa imporenta!E105` | `TRUNC(Impuestos_Exteriordiv!E42*0.35, F105)` — the second argument is a peso amount (`ROUND(D105/1000,0)*1000`), not a digit count. | Excel treats the huge digit count as "no truncation", so the value is not rounded to thousands as the neighbouring cells are. |
| `Deudas_Inex!Z2` and other help lookups | `VLOOKUP(..., AY_*!A2:D26, 5, 0)` asks for column 5 of a 4-column table; others point to dead external workbooks (`[4]`, `[5]`). | Contextual help lookups always return `#N/A`. |
| Defined names | 80+ names (`AÑO_GRAVABLE_DE_2003`, `RG`, …) point to 2003-era files on `\\BCCNSIST005` and `A:\Documents and Settings\...`. | Dead; if "update links" is accepted, Windows may attempt SMB connections. Not used by any formula. |
| `DatosGenerales` `Worksheet_Change` | Several `Case "$E$10"` branches duplicated; the second never runs. `Case "$C$9"` compares a cell to itself. | Intended validations never fire. |
| Foreign-tax discount loop (`Impuestos_Exteriortra!E18` ↔ `Impuestos_Exteriorcanola!E17`, boxes 122/125) | The two cells feed each other through `ROUND(…/1000)*1000`; for some amounts they flip by ±1.000 forever instead of converging, so Excel's iterative calculation stops wherever iteration 100 lands. | Excel's result then depends on how many recalculations happened before. The web pins it to Excel's *full recalculation* of the file (start from the saved values, calc-chain order, 1 + 100 passes), which reproduced Excel's Form 210 in all 200 test profiles. In 2 of them a per-row detail line in that annex (not on the form) still differs by 1.000, because Excel re-sorts its chain at run time. |
| `TEXT(x," $ ###.###.###")` labels | Format string assumes a Spanish (Colombia) Windows locale. | On an English-locale Excel the labels render as `$ ..`. The port always uses Colombian formatting. |

## Deliberate differences from the Excel file (UI/VBA behaviour only)

Tax formulas are reproduced exactly. These are the places where the web version behaves
differently from DIAN's VBA, on purpose:

| Excel behaviour | Web version | Why |
|---|---|---|
| Values requested in `InputBox` pop-ups and written into locked cells (e.g. `DatosGenerales!H11`, `Liquidacion_Privada!H26`, "Otro valor" amounts, exemptions in *Datos otros ingresos*). | Shown as labelled form fields when their trigger applies. | No modal dialogs; values stay editable. |
| `Inversiones` row 14 "Otro valor" writes to **Q11** (row 11's cell). | Writes to Q14. | Obvious bug: it overwrites another asset's value. |
| `Otros_costos` E17 opens a "¿Facturó la totalidad…? marque 1/0" prompt whose answer overwrites the cost amount in F17. | Not replicated. | Stale code that destroys user input. |
| Editing a salary clears that employer's answers in *Datos salarios* and jumps there. | Same: the answers are erased (the questions appear again on the salary page). | Output parity with Excel. |
| A value requested by a pop-up is erased when its trigger is turned off. | Same: the value is erased and must be entered again if the trigger comes back. | Output parity with Excel. |
| *Datos otros ingresos* shows one employer block at a time (buttons "…"). | All three blocks are shown. | Presentation only; values identical. |
| Helper sheets keep whatever rows were visible when DIAN saved the file. | Rows follow the current answers. | Presentation only; verified to give identical values (`vba-parity.test.ts`). |
| `Validar()` blocks leaving *Datos generales* until 9 fields are filled. | Non-blocking "Pendientes antes de presentar" list on the home page and Form 210. | People can fill the sections in any order. |
| "Patrimonio líquido 2024 must not exceed bruto" check never fires (duplicate `Case`). | Shown in "Pendientes". | It is the rule DIAN evidently intended. |
| Rows 9, 11, 13 of *Datos cesantías* can never be shown. | Never shown. | Same as Excel. |
| `TODAY()` in the form header. | Uses the browser's date. | Same as Excel. |

## Printed Formulario 210

The printable form renders the `Formulario` sheet with its own layout, rich text, fills,
borders, 55 % print scale and margins, paginated like Excel (2 pages). Remaining
differences: fonts are Arial from the browser (Excel's metrics differ slightly). The sheet's
own footer (print date/time, "BORRADOR", "Información Pública Clasificada") is reproduced
in the page margin, scaled like Excel's. Dates, times and thousands separators always
follow Colombian conventions (as in DIAN's own saved file), regardless of the computer's
regional settings.
