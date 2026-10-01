"""Export Excel's own Formulario 210 to PDF for a test scenario (macros force-disabled).

Usage: python tools/excel_pdf.py <case.json> <out.pdf>
"""
import json
import sys
from pathlib import Path

import pythoncom
import pywintypes
import win32com.client

SRC = Path("extracted/AyudaRenta 2025 V1.1 .xlsm").resolve()
SHEET_PASSWORD = "d2102004"


def main(case_path, out_pdf):
    case = json.loads(Path(case_path).read_text(encoding="utf-8"))
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("Excel.Application")
    try:
        app.Visible = False
        app.DisplayAlerts = False
        app.AutomationSecurity = 3  # macros force-disabled
        wb = app.Workbooks.Open(str(SRC), UpdateLinks=0, ReadOnly=True, AddToMru=False, Notify=False)
        try:
            for sheet, a1, v in case["inputs"]:
                ws = wb.Worksheets(sheet)
                try:
                    ws.Range(a1).Value2 = v
                except pywintypes.com_error:
                    ws.Unprotect(SHEET_PASSWORD)
                    ws.Range(a1).Value2 = v
            app.Iteration = True
            app.MaxIterations = 100
            app.MaxChange = 0.001
            app.CalculateFull()
            ws = wb.Worksheets("Formulario")
            ws.Visible = -1  # the sheet is veryHidden; export needs it visible
            ws.ExportAsFixedFormat(0, str(Path(out_pdf).resolve()), IgnorePrintAreas=False)
        finally:
            wb.Close(SaveChanges=False)
    finally:
        app.Quit()
    print("wrote", out_pdf)


if __name__ == "__main__":
    main(*sys.argv[1:3])
