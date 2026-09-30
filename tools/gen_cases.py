"""Generate random input scenarios for differential testing against Excel.

Each case fills a random subset of input (unlocked) cells on a random subset of
annex sheets, with values shaped by the cell's data validation / number format.
Output: build/cases/case_NNN.json = {"seed": n, "inputs": [[sheet, a1, value], ...]}
"""
import json
import random
import re
import sys
from pathlib import Path

N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
model = json.loads(Path("build/model.json").read_text(encoding="utf-8"))
sheets = {s["name"]: s for s in model["sheets"]}
OUT = Path("build/cases")
OUT.mkdir(parents=True, exist_ok=True)

# Sheets that hold reference data or help text, not taxpayer inputs
SKIP = re.compile(r"^(AY_|ENTRADA|Navegacion|TRM_diaria|msg|calidad|plazos|monedas|TOPES|go$|go casa|tarifa|"
                  r"renta exenta|Retenciones|cesantias|descuentos|ajustes|Ganancia ocasional exenta|Sanciones|"
                  r"costos y deduc|mod_once|Formulario)")


def col_idx(s):
    n = 0
    for ch in s.upper():
        n = n * 26 + ord(ch) - 64
    return n - 1


def col_name(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def expand(sqref):
    for part in sqref.split():
        m = re.match(r"\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$", part)
        if not m:
            continue
        c1, r1 = col_idx(m.group(1)), int(m.group(2))
        c2, r2 = (col_idx(m.group(3)), int(m.group(4))) if m.group(3) else (c1, r1)
        if (r2 - r1 + 1) * (c2 - c1 + 1) > 5000:
            continue
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                yield f"{col_name(c)}{r}"


def list_values(sheet, f1):
    if f1 is None:
        return None
    if f1.startswith('"'):
        return [x.strip() for x in f1.strip('"').split(",")]
    m = re.match(r"(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$", f1)
    if not m:
        return None
    src = sheets.get(m.group(1) or sheet)
    if not src:
        return None
    vals = []
    for a1 in expand(f"{m.group(2)}{m.group(3)}:{m.group(4)}{m.group(5)}"):
        c = src["cells"].get(a1, {})
        v = c.get("v", c.get("cv"))
        if v not in (None, "") and not isinstance(v, dict):
            vals.append(v)
    return vals or None


def validation_map(sh):
    m = {}
    for dv in sh["validations"]:
        for a1 in expand(dv.get("sqref", "")):
            m[a1] = dv
    return m


def value_for(rng, sheet, a1, cell, dv):
    nf = cell.get("nf", "")
    if dv and dv.get("type") == "list":
        vals = list_values(sheet, dv.get("f1"))
        if vals:
            return rng.choice(vals)
    if dv and dv.get("type") == "decimal":
        try:
            hi = float(dv.get("f2", "1"))
        except ValueError:
            hi = 1
        return round(rng.uniform(0, hi), 4)
    if "yy" in nf:
        return rng.randint(44927, 46387)  # 2023-01-01 .. 2026-12-31
    if "%" in nf:
        return round(rng.uniform(0, 1), 4)
    if nf == "@":
        return rng.choice([str(rng.randint(1, 999999999)), "Texto prueba", "X", str(rng.randint(1, 60))])
    if dv and dv.get("type") == "whole" and dv.get("op") is None:
        try:
            lo, hi = int(float(dv["f1"])), int(float(dv["f2"]))
            return rng.randint(lo, min(hi, lo + 500_000_000))
        except (KeyError, ValueError):
            pass
    r = rng.random()
    if r < 0.1:
        return 0
    if r < 0.4:
        return rng.randint(1, 5_000_000)
    if r < 0.85:
        return rng.randint(5_000_000, 300_000_000)
    return rng.randint(300_000_000, 5_000_000_000)


candidates = [s for s in model["sheets"] if not SKIP.match(s["name"])]
for n in range(N):
    rng = random.Random(1000 + n)
    inputs = []
    # always touch general data; then a random mix of annexes
    picked = [sheets["DatosGenerales"]] + rng.sample(candidates, rng.randint(3, 20))
    for sh in picked:
        vm = validation_map(sh)
        ins = [a1 for a1, c in sh["cells"].items() if c.get("in")]
        density = rng.choice([0.1, 0.3, 0.6, 1.0])
        for a1 in ins:
            if rng.random() > density:
                continue
            inputs.append([sh["name"], a1, value_for(rng, sh["name"], a1, sh["cells"][a1], vm.get(a1))])
    (OUT / f"case_{n:03d}.json").write_text(json.dumps({"seed": 1000 + n, "inputs": inputs}, ensure_ascii=False),
                                             encoding="utf-8")
    print(f"case_{n:03d}: {len(inputs)} inputs on {len(picked)} sheets")
