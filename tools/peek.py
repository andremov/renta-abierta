"""Print a compact row-by-row map of a sheet: L=label text, I=input, F=formula (shown value)."""
import json, re, sys
m = json.load(open('build/model.json', encoding='utf8'))
S = {s['name']: s for s in m['sheets']}
def rc(a1):
    mm = re.match(r'([A-Z]+)(\d+)', a1); c = 0
    for ch in mm.group(1): c = c*26 + ord(ch) - 64
    return int(mm.group(2)), c
for name in sys.argv[1:]:
    s = S[name]; rows = {}
    hidden = set(s['hiddenRows'])
    for a1, c in s['cells'].items():
        r, col = rc(a1)
        if col >= 26: continue
        if 'in' in c: k = 'I'
        elif 'f' in c: k = 'F'
        elif isinstance(c.get('v'), str) and c['v'].strip(): k = 'L'
        else: continue
        txt = (str(c.get('v', '')) if k == 'L' else (c.get('nf') or ''))[:38].replace('\n', ' ')
        rows.setdefault(r, []).append((col, k, a1, txt))
    print(f"===== {name}  ({len(rows)} rows, hidden={len(hidden)})")
    for r in sorted(rows):
        cells = sorted(rows[r])
        print(f"{r:4}{'h' if r in hidden else ' '} " + ' | '.join(f"{k}{a1}:{t}" if k == 'L' else f"{k}{a1}" for col, k, a1, t in cells)[:230])
