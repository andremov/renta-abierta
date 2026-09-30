# Quirks found in DIAN's Ayuda Renta 2025 workbook

The port reproduces Excel's behavior exactly, including these. They are listed
here so they can be reported to DIAN or deliberately fixed later.

| Where | What | Effect |
|---|---|---|
| `tarifa imporenta!E105` | `TRUNC(Impuestos_Exteriordiv!E42*0.35, F105)` — the second argument is a peso amount (`ROUND(D105/1000,0)*1000`), not a digit count. | Excel treats the huge digit count as "no truncation", so the value is not rounded to thousands as the neighbouring cells are. |
| `Deudas_Inex!Z2` and other help lookups | `VLOOKUP(..., AY_*!A2:D26, 5, 0)` asks for column 5 of a 4-column table; others point to dead external workbooks (`[4]`, `[5]`). | Contextual help lookups always return `#N/A`. |
| Defined names | 80+ names (`AÑO_GRAVABLE_DE_2003`, `RG`, …) point to 2003-era files on `\\BCCNSIST005` and `A:\Documents and Settings\...`. | Dead; if "update links" is accepted, Windows may attempt SMB connections. Not used by any formula. |
| `DatosGenerales` `Worksheet_Change` | Several `Case "$E$10"` branches duplicated; the second never runs. `Case "$C$9"` compares a cell to itself. | Intended validations never fire. |
| `TEXT(x," $ ###.###.###")` labels | Format string assumes a Spanish (Colombia) Windows locale. | On an English-locale Excel the labels render as `$ ..`. The port always uses Colombian formatting. |
