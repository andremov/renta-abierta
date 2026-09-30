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


def split_a1(a1):
    m = re.match(r"([A-Z]+)(\d+)$", a1)
    n = 0
    for ch in m.group(1):
        n = n * 26 + ord(ch) - 64
    return n, int(m.group(2))


def col_name(c):
    s = ""
    while c:
        c, r = divmod(c - 1, 26)
        s = chr(65 + r) + s
    return s


XDR = "{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}"
FONT_NAMES = {"Arial", "Tahoma", "Calibri", "Verdana", "MS Sans Serif", "Times New Roman", "Segoe UI"}
CONTROL_KIND = {"{D7053240-CE69-11CD-A777-00DD01143C57}": "button",
                "{978C9E23-D4B0-11CE-BF2D-00AA003F40D0}": "label",
                "{8BD21D10-EC42-11CE-9E0D-00AA006002F3}": "textbox"}


# MS-OFORMS DataBlock layouts: (PropMask bit, field size); "cap" is an fmString count.
FORMS_FIELDS = {
    "button": [(0, 4), (1, 4), (2, 4), (3, "cap"), (4, 4), (6, 1), (7, 2), (8, 2), (10, 2)],
    "label": [(0, 4), (1, 4), (2, 4), (3, "cap"), (4, 4), (6, 1), (7, 4), (8, 2), (9, 2), (10, 2), (11, 2), (12, 2)],
}


def forms_caption(blob, kind):
    """Caption of a CommandButton/Label per MS-OFORMS (blob = CLSID + control stream)."""
    import struct
    mask = struct.unpack_from("<I", blob, 20)[0]
    pos = start = 24
    cap = None
    for bit, size in FORMS_FIELDS[kind]:
        if not mask >> bit & 1:
            continue
        n = 4 if size == "cap" else size
        pos += (-(pos - start)) % n  # fields are aligned to their size
        if size == "cap":
            cap = struct.unpack_from("<I", blob, pos)[0]
        pos += n
    if cap is None:
        return ""
    pos += (-(pos - start)) % 4
    length, compressed = cap & 0x7FFFFFFF, cap >> 31
    raw = blob[pos:pos + length]
    return raw.decode("cp1252" if compressed else "utf-16-le").strip()


def control_text(blob, kind=None):
    """Text of an MS Forms control: exact caption for buttons/labels, best effort otherwise."""
    if kind in FORMS_FIELDS:
        try:
            return forms_caption(blob, kind)
        except Exception:
            pass
    runs = []
    for raw in re.findall(rb"[\x20-\x7e\xa0-\xff\r\n\t]{3,}", blob):
        s = raw.decode("cp1252").strip()
        s = re.sub(r"[^\w).:;%\"'¿?¡!]+$", "", s)
        s = re.sub(r"\d{3}$", "", s) if re.sub(r"\d{3}$", "", s) in FONT_NAMES else s
        if len(s) < 3 or s in FONT_NAMES or sum(ch.isalpha() for ch in s) < len(s) * 0.5:
            continue
        runs.append(s)
    return "\n".join(runs)


def vba_navigation(path):
    """{codeName: {controlName: targetSheet}} from `<control>_Click` handlers calling CHoja."""
    from oletools.olevba import VBA_Parser
    nav = {}
    for _, _, vba_name, code in VBA_Parser(str(path)).extract_macros():
        mod = vba_name.rsplit(".", 1)[0]
        for sub in re.finditer(r"Private Sub (\w+)_Click\(\)(.*?)End Sub", code, re.S):
            body = "\n".join(l for l in sub.group(2).splitlines() if not l.strip().startswith("'"))
            t = re.search(r'CHoja\s*\(?\s*[^,\n]+,\s*"([^"]+)"', body)
            if t:
                nav.setdefault(mod, {})[sub.group(1)] = t.group(1)
    return nav


def load_controls(z, sheet_path, root, nav, sheet_names):
    rels = load_rels(z, sheet_path)
    out, seen = [], set()
    for ctl in root.iter(M + "control"):
        name = ctl.get("name")
        pr = ctl.find(M + "controlPr")
        if name in seen or pr is None:
            continue
        seen.add(name)
        axml_path = rels[ctl.get("{%s}id" % NS["r"])]
        cls = ET.fromstring(z.read(axml_path)).get("{%s}classid" % "http://schemas.microsoft.com/office/2006/activeX")
        brels = load_rels(z, axml_path)
        blob = z.read(next(iter(brels.values()))) if brels else b""
        frm = pr.find(f"{M}anchor/{M}from")
        to = pr.find(f"{M}anchor/{M}to")
        pos = lambda el: [int(el.find(XDR + "row").text), int(el.find(XDR + "col").text)] if el is not None else None
        kind = CONTROL_KIND.get(cls, cls)
        d = {"name": name, "kind": kind, "text": control_text(blob, kind),
             "from": pos(frm), "to": pos(to)}
        target = nav.get(name)
        if target:
            d["target"] = target if target.upper() in sheet_names else None
        out.append(d)
    return out


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


INDEXED = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"] * 2 + [
    "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366", "FFFFCC",
    "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF", "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000",
    "008080", "0000FF", "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99", "3366FF",
    "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696", "003366", "339966", "003300", "333300",
    "993300", "993366", "333399", "333333"]
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def load_theme(z):
    root = ET.fromstring(z.read("xl/theme/theme1.xml"))
    scheme = root.find(f"{A}themeElements/{A}clrScheme")
    colors = []
    for el in scheme:
        c = el[0]
        colors.append(c.get("lastClr") or c.get("val") or "000000")
    # Excel's theme index swaps the dark/light pairs: lt1, dk1, lt2, dk2, accents...
    colors[0], colors[1], colors[2], colors[3] = colors[1], colors[0], colors[3], colors[2]
    return colors


def apply_tint(hexrgb, tint):
    import colorsys
    r, g, b = (int(hexrgb[i:i + 2], 16) / 255 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = l * (1 + tint) if tint < 0 else l * (1 - tint) + tint
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


def color_of(el, theme):
    if el is None:
        return None
    if el.get("rgb"):
        rgb = el.get("rgb")[-6:]
    elif el.get("theme") is not None:
        rgb = theme[int(el.get("theme"))]
    elif el.get("indexed") is not None:
        i = int(el.get("indexed"))
        if i >= len(INDEXED):
            return None  # 64 = system foreground, 65 = system background
        rgb = INDEXED[i]
    else:
        return None
    if el.get("tint"):
        rgb = apply_tint(rgb, float(el.get("tint")))
    return "#" + rgb.upper()


def load_styles(z):
    """Returns ([(locked, numFmt, styleIndex)] per xf, [style dicts])."""
    root = ET.fromstring(z.read("xl/styles.xml"))
    theme = load_theme(z)
    fmts = dict(BUILTIN_FMTS)
    for nf in root.findall("m:numFmts/m:numFmt", NS):
        fmts[int(nf.get("numFmtId"))] = nf.get("formatCode")

    fonts = []
    for f in root.findall("m:fonts/m:font", NS):
        d = {}
        if f.find("m:b", NS) is not None and f.find("m:b", NS).get("val") not in ("0", "false"):
            d["b"] = 1
        if f.find("m:i", NS) is not None and f.find("m:i", NS).get("val") not in ("0", "false"):
            d["i"] = 1
        if f.find("m:u", NS) is not None:
            d["u"] = 1
        sz = f.find("m:sz", NS)
        if sz is not None:
            d["sz"] = float(sz.get("val"))
        col = color_of(f.find("m:color", NS), theme)
        if col and col != "#000000":
            d["color"] = col
        fonts.append(d)

    fills = []
    for f in root.findall("m:fills/m:fill", NS):
        p = f.find("m:patternFill", NS)
        bg = None
        if p is not None and p.get("patternType") not in (None, "none"):
            bg = color_of(p.find("m:fgColor", NS), theme) or "#FFFFFF"
        fills.append(bg)

    borders = []
    for b in root.findall("m:borders/m:border", NS):
        sides = []
        for side in ("top", "right", "bottom", "left"):
            el = b.find(f"m:{side}", NS)
            st = el.get("style") if el is not None else None
            sides.append(f"{st} {color_of(el.find('m:color', NS), theme) or '#000000'}" if st else None)
        borders.append(sides if any(sides) else None)

    styles, index, xfs = [], {}, []
    for xf in root.findall("m:cellXfs/m:xf", NS):
        prot = xf.find("m:protection", NS)
        locked = not (prot is not None and prot.get("locked") in ("0", "false"))
        d = dict(fonts[int(xf.get("fontId", 0))])
        bg = fills[int(xf.get("fillId", 0))]
        if bg:
            d["bg"] = bg
        bd = borders[int(xf.get("borderId", 0))]
        if bd:
            d["bd"] = bd
        al = xf.find("m:alignment", NS)
        if al is not None:
            if al.get("horizontal"):
                d["ha"] = al.get("horizontal")
            if al.get("vertical"):
                d["va"] = al.get("vertical")
            if al.get("wrapText") in ("1", "true"):
                d["wrap"] = 1
            if al.get("indent"):
                d["indent"] = int(al.get("indent"))
            if al.get("textRotation"):
                d["rot"] = int(al.get("textRotation"))
        k = json.dumps(d, sort_keys=True)
        if k not in index:
            index[k] = len(styles)
            styles.append(d)
        xfs.append((locked, fmts.get(int(xf.get("numFmtId", 0)), "General"), index[k]))
    return xfs, styles


def main():
    z = zipfile.ZipFile(SRC)
    sst = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        sst = [text_of(si) for si in root.findall("m:si", NS)]
    xfs, styles = load_styles(z)

    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = load_rels(z, "xl/workbook.xml")
    model = {"sheets": [], "names": {}, "styles": styles}
    for dn in wb.findall("m:definedNames/m:definedName", NS):
        key = dn.get("name")
        if dn.get("localSheetId") is not None:
            key = f"{dn.get('localSheetId')}!{key}"
        model["names"][key] = dn.text

    nav = vba_navigation(SRC)
    sheet_names = {sh.get("name").upper() for sh in wb.findall("m:sheets/m:sheet", NS)}
    for sh in wb.findall("m:sheets/m:sheet", NS):
        name = sh.get("name")
        path = rels[sh.get("{%s}id" % NS["r"])]
        root = ET.fromstring(z.read(path))
        pr = root.find("m:sheetPr", NS)
        code_name = pr.get("codeName") if pr is not None else None
        controls = load_controls(z, path, root, nav.get(code_name, {}), sheet_names)
        cells, shared = {}, {}
        hidden_rows, heights = [], {}
        for row in root.iter(M + "row"):
            if row.get("hidden") in ("1", "true"):
                hidden_rows.append(int(row.get("r")))
            if row.get("customHeight") in ("1", "true") and row.get("ht"):
                heights[int(row.get("r"))] = float(row.get("ht"))
            for c in row.findall(M + "c"):
                ref = c.get("r")
                locked, nf, style = xfs[int(c.get("s", 0))]
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
                if style:
                    d["s"] = style
                vis = styles[style]
                if "f" in d or "v" in d or "in" in d or "bg" in vis or "bd" in vis:
                    cells[ref] = d

        merges = [m.get("ref") for m in root.findall("m:mergeCells/m:mergeCell", NS)]
        # Only the top-left cell of a merged area can hold a value.
        for ref in merges:
            (c1, r1), (c2, r2) = (split_a1(x) for x in ref.split(":"))
            for r in range(r1, r2 + 1):
                for c in range(c1, c2 + 1):
                    a1 = f"{col_name(c)}{r}"
                    if (r, c) != (r1, c1) and a1 in cells:
                        cells[a1].pop("in", None)
                        cells[a1].pop("nf", None)
                        if not ({"f", "v", "s"} & cells[a1].keys()):
                            del cells[a1]
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
            "codeName": code_name,
            "controls": controls,
            "merges": merges, "validations": dvs,
            "cols": cols, "hiddenCols": hidden_cols, "hiddenRows": hidden_rows, "heights": heights,
            "gridLines": (root.find("m:sheetViews/m:sheetView", NS) is None
                          or root.find("m:sheetViews/m:sheetView", NS).get("showGridLines") not in ("0", "false")),
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
