"""Dump the Ayuda Renta workbook to build/model.json.

Parses the .xlsm package XML directly (openpyxl walks the full used range, which
is huge on some sheets). Keeps every cell that has a value, a formula, or is
unlocked (a user input cell), plus data validations, merged ranges, hidden
rows/cols and defined names. Formulas stay as Excel text; shared formulas are
expanded per cell. "cv" is the value Excel cached when the file was saved.
"""
import json
import re
import sys
import zipfile
import posixpath
from pathlib import Path
from xml.etree import ElementTree as ET

from openpyxl.formula.translate import Translator

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "extracted/AyudaRenta 2025 V1.1 .xlsm")
OUT = Path("build/model.json")

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    "x14": "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
    "xm": "http://schemas.microsoft.com/office/excel/2006/main",
}
M = "{%s}" % NS["m"]
BUILTIN_FMTS = {0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%",
                14: "d/m/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 22: "d/m/yyyy h:mm", 49: "@"}


def text_of(el):
    """Concatenate <t> runs of an <si> / <is> element."""
    return "".join(t.text or "" for t in el.iter(M + "t"))


def load_rels(z, path):
    d, f = posixpath.split(path)
    rp = posixpath.join(d, "_rels", f + ".rels")
    if rp not in z.namelist():
        return {}
    root = ET.fromstring(z.read(rp))
    return {r.get("Id"): posixpath.normpath(posixpath.join(d, r.get("Target")))
            for r in root.findall("pr:Relationship", NS)}


def load_styles(z):
    root = ET.fromstring(z.read("xl/styles.xml"))
    fmts = dict(BUILTIN_FMTS)
    for nf in root.findall("m:numFmts/m:numFmt", NS):
        fmts[int(nf.get("numFmtId"))] = nf.get("formatCode")
    xfs = []
    for xf in root.findall("m:cellXfs/m:xf", NS):
        prot = xf.find("m:protection", NS)
        locked = not (prot is not None and prot.get("locked") in ("0", "false"))
        xfs.append((locked, fmts.get(int(xf.get("numFmtId", 0)), "General")))
    return xfs


def main():
    z = zipfile.ZipFile(SRC)
    sst = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        sst = [text_of(si) for si in root.findall("m:si", NS)]
    xfs = load_styles(z)

    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = load_rels(z, "xl/workbook.xml")
    model = {"sheets": [], "names": {}}
    for dn in wb.findall("m:definedNames/m:definedName", NS):
        key = dn.get("name")
        if dn.get("localSheetId") is not None:
            key = f"{dn.get('localSheetId')}!{key}"
        model["names"][key] = dn.text

    for sh in wb.findall("m:sheets/m:sheet", NS):
        name = sh.get("name")
        path = rels[sh.get("{%s}id" % NS["r"])]
        root = ET.fromstring(z.read(path))
        cells, shared = {}, {}
        hidden_rows = []
        for row in root.iter(M + "row"):
            if row.get("hidden") in ("1", "true"):
                hidden_rows.append(int(row.get("r")))
            for c in row.findall(M + "c"):
                ref = c.get("r")
                locked, nf = xfs[int(c.get("s", 0))]
                t = c.get("t", "n")
                fel, vel = c.find(M + "f"), c.find(M + "v")
                d = {}
                if fel is not None:
                    ft = fel.get("t")
                    if ft == "shared":
                        si = fel.get("si")
                        if fel.text:
                            shared[si] = (fel.text, ref)
                            d["f"] = fel.text
                        else:
                            src, origin = shared[si]
                            d["f"] = Translator("=" + src, origin=origin).translate_formula(ref)[1:]
                    else:
                        d["f"] = fel.text or ""
                        if ft == "array":
                            d["arr"] = fel.get("ref")
                # value
                val = None
                if t == "s" and vel is not None:
                    val = sst[int(vel.text)]
                elif t == "inlineStr":
                    isel = c.find(M + "is")
                    val = text_of(isel) if isel is not None else ""
                elif t == "b" and vel is not None:
                    val = vel.text == "1"
                elif t == "e" and vel is not None:
                    val = {"err": vel.text}
                elif t == "str" and vel is not None:
                    val = vel.text or ""
                elif vel is not None and vel.text is not None:
                    num = float(vel.text)
                    val = int(num) if num.is_integer() and abs(num) < 2**53 else num
                if "f" in d:
                    if val is not None:
                        d["cv"] = val
                elif val is not None and val != "":
                    d["v"] = val
                if not locked:
                    d["in"] = 1
                if nf != "General":
                    d["nf"] = nf
                if "f" in d or "v" in d or "in" in d:
                    cells[ref] = d

        merges = [m.get("ref") for m in root.findall("m:mergeCells/m:mergeCell", NS)]
        dvs = []
        for dv in root.findall("m:dataValidations/m:dataValidation", NS):
            f1, f2 = dv.find("m:formula1", NS), dv.find("m:formula2", NS)
            dvs.append({k: v for k, v in {
                "sqref": dv.get("sqref"), "type": dv.get("type"), "op": dv.get("operator"),
                "f1": f1.text if f1 is not None else None, "f2": f2.text if f2 is not None else None,
                "prompt": dv.get("prompt"), "promptTitle": dv.get("promptTitle"),
                "error": dv.get("error"), "errorTitle": dv.get("errorTitle"),
            }.items() if v is not None})
        # Excel 2010+ validations that reference other sheets live in extLst
        for dv in root.iter("{%s}dataValidation" % NS["x14"]):
            f1 = dv.find("x14:formula1/xm:f", NS)
            f2 = dv.find("x14:formula2/xm:f", NS)
            sq = dv.find("xm:sqref", NS)
            dvs.append({k: v for k, v in {
                "sqref": sq.text if sq is not None else None, "type": dv.get("type"), "op": dv.get("operator"),
                "f1": f1.text if f1 is not None else None, "f2": f2.text if f2 is not None else None,
                "prompt": dv.get("prompt"), "promptTitle": dv.get("promptTitle"),
                "error": dv.get("error"), "errorTitle": dv.get("errorTitle"),
            }.items() if v is not None})
        cols, hidden_cols = [], []
        for col in root.findall("m:cols/m:col", NS):
            span = [int(col.get("min")), int(col.get("max"))]
            if col.get("hidden") in ("1", "true"):
                hidden_cols.append(span)
            if col.get("width"):
                cols.append(span + [float(col.get("width"))])

        model["sheets"].append({
            "name": name,
            "state": sh.get("state", "visible"),
            "merges": merges, "validations": dvs,
            "cols": cols, "hiddenCols": hidden_cols, "hiddenRows": hidden_rows,
            "cells": cells,
        })
        nf = sum(1 for c in cells.values() if "f" in c)
        ni = sum(1 for c in cells.values() if "in" in c)
        print(f"  {name}: {len(cells)} cells, {nf} formulas, {ni} inputs, {len(dvs)} validations", file=sys.stderr)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(model, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
