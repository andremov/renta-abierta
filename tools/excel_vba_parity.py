"""Run DIAN's own VBA (macros ON) on scripted scenarios, to compare with the web rules.

Safety:
- Works on a throwaway copy of the workbook in build/sandbox; nothing is ever saved.
- Uses a separate, hidden Excel instance. Macros are enabled only for files that this
  automation session opens (Application.AutomationSecurity is an in-memory property of
  this instance; the user's Trust Center settings are not touched).
- DIAN's VBA was reviewed beforehand (build/vba-behaviors.md): no shell, network or file
  access in the code paths exercised here.

A watcher thread answers the InputBox / MsgBox dialogs the VBA opens, from the
scenario's script, and logs every prompt.

Usage: python tools/excel_vba_parity.py [scenario-name ...]
Output: build/vba-parity/excel/<scenario>.json
"""
import json
import shutil
import sys
import threading
import time
from pathlib import Path

import pythoncom
import win32com.client
import win32con
import win32gui
import win32process

SRC = Path("extracted/AyudaRenta 2025 V1.1 .xlsm").resolve()
SANDBOX = Path("build/sandbox/AyudaRenta-sandbox.xlsm").resolve()
OUT = Path("build/vba-parity/excel")
SCENARIOS = json.loads(Path("tools/vba_scenarios.json").read_text(encoding="utf-8"))
HELPER_SHEETS = ["Datos_Salarios", "Datos_Cesantias", "Datos_Gastos_Rep", "Datos_Otros_Ingresos"]
ERRORS = {-2146826281: "#DIV/0!", -2146826246: "#N/A", -2146826259: "#NAME?", -2146826288: "#NULL!",
          -2146826252: "#NUM!", -2146826265: "#REF!", -2146826273: "#VALUE!"}

model = json.loads(Path("build/model.json").read_text(encoding="utf-8"))
SHEETS = {s["name"]: s for s in model["sheets"]}


def split(a1):
    i = next(i for i, ch in enumerate(a1) if ch.isdigit())
    c = 0
    for ch in a1[:i]:
        c = c * 26 + ord(ch) - 64
    return int(a1[i:]), c


def conv(v):
    if isinstance(v, int) and v in ERRORS:
        return {"err": ERRORS[v]}
    if isinstance(v, float) and v.is_integer() and abs(v) < 2**53:
        return int(v)
    return v


class DialogWatcher(threading.Thread):
    """Answers modal dialogs of one Excel process."""

    def __init__(self, pid):
        super().__init__(daemon=True)
        self.pid = pid
        self.answers = []
        self.confirm = "yes"
        self.log = []
        self.stop = False
        self.cancels = 0

    def run(self):
        while not self.stop:
            try:
                win32gui.EnumWindows(self._visit, None)
            except Exception:
                pass
            time.sleep(0.15)

    def _visit(self, hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        if win32process.GetWindowThreadProcessId(hwnd)[1] != self.pid:
            return True
        cls = win32gui.GetClassName(hwnd)
        if cls == "ThunderDFrame":  # VBA UserForm (e.g. the welcome form)
            self.log.append({"kind": "userform", "title": win32gui.GetWindowText(hwnd)})
            win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
        elif cls == "#32770":
            self._answer(hwnd)
        return True

    def _answer(self, hwnd):
        kids = []
        win32gui.EnumChildWindows(hwnd, lambda h, acc: acc.append(h), kids)
        texts, edit, buttons = [], None, {}
        for h in kids:
            c = win32gui.GetClassName(h)
            t = win32gui.GetWindowText(h)
            if c == "Static" and t.strip():
                texts.append(t.strip())
            elif c == "Edit":
                edit = h
            elif c == "Button":
                buttons[t.replace("&", "").strip().lower()] = h
        prompt = " ".join(texts)
        if edit:
            if self.answers:
                value = str(self.answers.pop(0))
            else:
                self.cancels += 1
                value = "0" if self.cancels > 2 else None
            entry = {"kind": "inputbox", "title": win32gui.GetWindowText(hwnd), "prompt": prompt, "answer": value}
            self.log.append(entry)
            if value is None:
                btn = buttons.get("cancel") or buttons.get("cancelar")
            else:
                win32gui.SendMessage(edit, win32con.WM_SETTEXT, 0, value)
                btn = buttons.get("ok") or buttons.get("aceptar")
        else:
            want = ["yes", "sí", "si"] if self.confirm == "yes" else ["no"]
            btn = next((buttons[w] for w in want if w in buttons), None) or buttons.get("ok") or buttons.get("aceptar")
            self.log.append({"kind": "msgbox", "title": win32gui.GetWindowText(hwnd), "prompt": prompt,
                             "answer": next((k for k, v in buttons.items() if v == btn), None)})
        if btn:
            win32gui.PostMessage(btn, win32con.BM_CLICK, 0, 0)
        time.sleep(0.3)


def snapshot(wb, touched):
    out = {"formulario": {}, "inputs": {}, "hiddenRows": {}}
    fcells = [a for a, c in SHEETS["Formulario"]["cells"].items() if "f" in c]
    ws = wb.Worksheets("Formulario")
    rows = [split(a) for a in fcells]
    block = ws.Range(ws.Cells(1, 1), ws.Cells(max(r for r, _ in rows), max(c for _, c in rows))).Value2
    out["formulario"] = {a: conv(block[r - 1][c - 1]) for a, (r, c) in zip(fcells, rows)}
    for sheet, extra_cells in touched.items():
        ws = wb.Worksheets(sheet)
        cells = [a for a, c in SHEETS[sheet]["cells"].items() if c.get("in")] + sorted(extra_cells)
        for a in cells:
            v = conv(ws.Range(a).Value2)
            if v not in (None, ""):
                out["inputs"][f"{sheet}!{a}"] = v
    for sheet in HELPER_SHEETS:
        ws = wb.Worksheets(sheet)
        out["hiddenRows"][sheet] = [r for r in range(1, 61) if ws.Rows(r).Hidden]
    return out


def run(app, watcher, sc):
    shutil.copyfile(SRC, SANDBOX)
    wb = app.Workbooks.Open(str(SANDBOX), UpdateLinks=0, ReadOnly=False, AddToMru=False, Notify=False)
    result = {"checkpoints": {}, "dialogs": []}
    touched = {s: set() for s in HELPER_SHEETS}
    try:
        app.Calculation = -4105  # automatic, as a person would have it
        app.Iteration = True
        app.MaxIterations = 100
        app.MaxChange = 0.001
        watcher.log = []
        for step in sc["steps"]:
            if "checkpoint" in step:
                app.CalculateFull()
                result["checkpoints"][step["checkpoint"]] = snapshot(wb, touched)
                continue
            sheet, a1, v = step["set"]
            touched.setdefault(sheet, set())
            for ans in step.get("answers", []):
                s, cell = ans["cell"].split("!")
                touched.setdefault(s, set()).add(cell)
            watcher.answers = [a["value"] for a in step.get("answers", [])]
            watcher.confirm = step.get("confirm", "yes")
            watcher.cancels = 0
            rng = wb.Worksheets(sheet).Range(a1)
            if v is None:
                rng.ClearContents()
            else:
                rng.Value2 = v
            if watcher.answers:
                result.setdefault("unusedAnswers", []).append({"step": step["set"], "left": watcher.answers})
        app.CalculateFull()
        result["checkpoints"]["final"] = snapshot(wb, touched)
        result["dialogs"] = list(watcher.log)
    finally:
        wb.Close(SaveChanges=False)
    return result


def main():
    names = sys.argv[1:]
    OUT.mkdir(parents=True, exist_ok=True)
    SANDBOX.parent.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    app = win32com.client.DispatchEx("Excel.Application")
    pid = win32process.GetWindowThreadProcessId(app.Hwnd)[1]
    watcher = DialogWatcher(pid)
    watcher.start()
    try:
        app.Visible = False
        app.DisplayAlerts = False
        app.AutomationSecurity = 1  # msoAutomationSecurityLow: macros on, this instance only
        for sc in SCENARIOS:
            if names and sc["name"] not in names:
                continue
            t = time.time()
            res = run(app, watcher, sc)
            (OUT / f"{sc['name']}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"{sc['name']}: {time.time() - t:.1f}s, {len(res['dialogs'])} dialogs", flush=True)
    finally:
        watcher.stop = True
        app.Quit()


if __name__ == "__main__":
    main()
