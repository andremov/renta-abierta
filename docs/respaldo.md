# Backup format, field map and browser API

Renta abierta keeps everything in the browser. There are two ways to put a whole draft in from
outside without typing into the forms one field at a time: a backup file, and an API on the open
page. Both use the same keys and the same conversions as the forms.

## Keys

Each input is identified by `"Sheet!A1"`: the sheet and cell of DIAN's Ayuda Renta 2025 workbook
that the field writes to, for example `DatosGenerales!E8` (Otros nombres).

The full list is published with the site at **`/campos.json`**
(https://renta-abierta.vercel.app/campos.json):

- `fields`: every input with `key`, `page` (wizard page id), `pageTitle`, `section`, `label`, `type`
  (`money`, `number`, `id`, `percent`, `text`, `date`, `select`, `yesno`, `check`), `list: true`
  when the value must come from a list, and `when` (the questionnaire answers that open its page).
- `questions`: questionnaire ids and texts (`profile` in the backup).
- `casillas`: Form 210 boxes and the `Formulario` cell holding each result. These are calculated
  and are not inputs.

In the browser, the form fields carry `name="Sheet!A1"` and `data-cell="Sheet!A1"`.

## Backup file

"Guardar respaldo" downloads this; "Abrir respaldo" loads it, including files you write yourself.

```json
{
  "kind": "ayuda-renta-ag2025",
  "version": 1,
  "profile": { "salario": true, "independiente": true, "cuentas": true },
  "inputs": {
    "DatosGenerales!C6": 80123456,
    "DatosGenerales!B8": "PÉREZ",
    "DatosGenerales!D8": "ANA",
    "DatosGenerales!C9": "2",
    "DatosGenerales!E9": "0010",
    "DatosGenerales!C10": 150000000
  },
  "pending": { "Rentas_Trabajo_ Hon_Com!E7": "Preguntar al contador si es cuenta por cobrar" }
}
```

- Only `inputs` is required. `kind` may be omitted, but if present it must be `ayuda-renta-ag2025`.
- **Values:** use JSON numbers for amounts (`150000000`). A string is read the way typed text is
  read: `"150.000.000"` or `"$ 150.000.000"` works, because `.` is the thousands separator and
  `,` is the decimal separator. Percentages are fractions (`0.35`) or text (`"35%"`). Dates are
  text, `"dd/mm/aaaa"`. Check boxes take `"X"`, and yes/no fields take `"Si"` or `"No"`.
- **List fields** accept the option text with any spacing or case, or just its code: `"2"` and
  `"02"` both select "2 Impuestos de Barranquilla". Activity codes are text: `"0010"`.
- **`profile`** opens the wizard pages (ids in `campos.json`). A page that has data is shown even
  when its question is unanswered.
- **`pending`** lists fields marked "pendiente por confirmar", each with an optional note. They are
  listed under "Pendientes antes de presentar" on the results page.
- Keys that are not inputs are skipped, and the app shows which ones. As in DIAN's file, values
  whose question doesn't apply are erased. For example, the 2024 impuesto neto
  (`DatosGenerales!H11`) is kept only when the number of years declared
  (`DatosGenerales!C11`) is filled.
- The file can also hold `exogena`, the exógena report loaded on the "Información exógena" page.

### Last year's Form 210

| Box of the 2024 return            | Key                       |
| --------------------------------- | ------------------------- |
| 29 Patrimonio bruto               | `DatosGenerales!C10`      |
| 31 Patrimonio líquido             | `DatosGenerales!E10`      |
| 126 Impuesto neto de renta        | `DatosGenerales!H11`      |
| 133 Anticipo para el año siguiente | `Liquidacion_Privada!G30` |
| 137 Saldo a favor                 | `Liquidacion_Privada!G28` |

## Browser API

The page exposes `window.rentaAbierta`. Values go through the same conversions and data validations
as the form, against the current answers, so they are rejected when the form would reject them.

| Call                         | Returns                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `fields()`                   | the `fields` list of `campos.json`                                                     |
| `options(key)`               | current options of a list field                                                        |
| `getInputs()` / `getInput(key)` | entered values                                                                      |
| `setInput(key, value)`       | `{ ok: true, value }` or `{ ok: false, error }`                                        |
| `setInputs({ key: value })`  | `{ ok, errors }`; failures are retried once at the end, because lists can depend on later values |
| `setPriorYear({ 29: …, 31: …, 126: …, 133: …, 137: … })` | same as `setInputs`, keyed by box of the 2024 return |
| `value(key)`                 | calculated value of any cell, e.g. `value('Formulario!AK43')`                         |
| `casillas()`                 | `[{ n, concepto, valor }]` for every Form 210 box                                      |
| `questions()` / `setAnswer(id, true \| false \| null)` | questionnaire                                                |
| `pending()` / `setPending(key, note \| null)` | "pendiente por confirmar" marks                                       |
| `exportBackup()` / `importBackup(jsonOrObject)` | backup file as text / load one (returns `{ skipped }`)              |

Order matters for the same reason it does in the form: answer a question before the fields it
opens (`C11` before `H11`, an employer's name before that employer's follow-up questions).

Typing into the fields also works. Text is saved about 0.4 s after the last change, and on leaving
the field or the step. It does not have to lose focus.
