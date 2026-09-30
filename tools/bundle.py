"""Write the model the web app loads (minified) to app/public/model.json."""
import json
from pathlib import Path

m = json.loads(Path("build/model.json").read_text(encoding="utf-8"))
m.pop("names", None)  # all dead 2003-era external references
out = Path("app/public/model.json")
out.write_text(json.dumps(m, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
