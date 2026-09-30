"""Compute ground-truth results for test cases with the real Excel.

Safety: runs a separate, invisible Excel instance with macros FORCE-DISABLED
(AutomationSecurity=3), never updates external links, opens read-only and never
saves. Only formula cells' values are dumped.

Usage: python tools/excel_oracle.py [case files...]   (default: build/cases/*.json)
Output: build/oracle/<case>.json = {sheet: {a1: value}}
"""
import json
import sys
import time
from pathlib import Path

import pythoncom
import win32com.client

SRC = Path("extracted/AyudaRenta 2025 V1.1 .xlsm").resolve()
OUT = Path("build/oracle")
ERRORS = {-2146826281: "#DIV/0!", -2146826246: "#N/A", -2146826259: "#NAME?", -2146826288: "#NULL!",
          -2146826252: "#NUM!", -2146826265: "#REF!", -2146826273: "#VALUE!"}

model = json.loads(Path("build/model.json").read_text(encoding="utf-8"))
formula_cells = {s["name"]: [a1 for a1, c in s["cells"].items() if "f" in c] for s in model["sheets"]}


def col_idx(s):
    n = 0
    for ch in s:
        n = n * 26 + ord(ch) - 64
    return n


def split(a1):
    i = next(i for i, ch in enumerate(a1) if ch.isdigit())
    return int(a1[i:]), col_idx(a1[:i])


def conv(v):
    if isinstance(v, int) and v in ERRORS:
        return {"err": ERRORS[v]}
    if isinstance(v, float) and v.is_integer() and abs(v) < 2**53:
        return int(v)
    return v


def run(app, case_path):
    case = json.loads(case_path.read_text(encoding="utf-8"))
    wb = app.Workbooks.Open(str(SRC), UpdateLinks=0, ReadOnly=True, AddToMru=False, Notify=False)
    try:
        app.Calculation = -4135  # manual while we write
        for sheet, a1, v in case["inputs"]:
            wb.Worksheets(sheet).Range(a1).Value2 = v
        app.Iteration = True
        app.MaxIterations = 100
        app.MaxChange = 0.001
        app.CalculateFull()
        out = {}
        for sheet, cells in formula_cells.items():
            if not cells:
                continue
            ws = wb.Worksheets(sheet)
            rows = [split(a) for a in cells]
            r2 = max(r for r, _ in rows)
            c2 = max(c for _, c in rows)
            block = ws.Range(ws.Cells(1, 1), ws.Cells(r2, c2)).Value2
            out[sheet] = {a1: conv(block[r - 1][c - 1]) for a1, (r, c) in zip(cells, rows)}
        return out
    finally:
        wb.Close(SaveChanges=False)


def main():
    files = [Path(p) for p in sys.argv[1:]] or sorted(Path("build/cases").glob("*.json"))
    OUT.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("Excel.Application")
    try:
        app.Visible = False
        app.DisplayAlerts = False
        app.ScreenUpdating = False
        app.EnableEvents = False
        app.AutomationSecurity = 3  # msoAutomationSecurityForceDisable
        for f in files:
            t = time.time()
            res = run(app, f)
            (OUT / f.name).write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
            print(f"{f.name}: {time.time() - t:.1f}s", flush=True)
    finally:
        app.Quit()


if __name__ == "__main__":
    main()
