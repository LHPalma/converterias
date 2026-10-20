#!/usr/bin/env python3
"""Gera o index.html (arquivo único, offline) a partir de src/template.html + vendor/."""
import base64, json, pathlib

root = pathlib.Path(__file__).parent
v = root / "vendor"
esc = lambda s: s.replace("</script", "<\\/script")

FONTS = {
    "r": "latin-400-normal", "i": "latin-400-italic", "b": "latin-700-normal", "bi": "latin-700-italic",
    "rx": "latin-ext-400-normal", "ix": "latin-ext-400-italic",
    "rg": "greek-400-normal", "ig": "greek-400-italic",   # grego: Noto Serif (a IBM Plex Serif não tem)
}
fonts = {k: base64.b64encode((v / "fonts" / f"{n}.woff").read_bytes()).decode() for k, n in FONTS.items()}

html = (root / "src" / "template.html").read_text(encoding="utf-8")
for marker, f in (("/*PDFLIB*/", "pdf-lib.min.js"), ("/*FONTKIT*/", "fontkit.umd.min.js"), ("/*JSZIP*/", "jszip.min.js"),
                  ("/*PDFJS*/", "pdf.min.js"), ("/*PDFJSWORKER*/", "pdf.worker.min.js")):
    html = html.replace(marker, esc((v / f).read_text(encoding="utf-8")))
html = html.replace("/*AZW3*/", esc((root / "src" / "azw3.js").read_text(encoding="utf-8")))
html = html.replace("/*KFX*/", esc((root / "src" / "kfx.js").read_text(encoding="utf-8")))
html = html.replace("/*MANGA*/", esc((root / "src" / "manga.js").read_text(encoding="utf-8")))
html = html.replace("/*FONTS*/{}", json.dumps(fonts))

out = root / "index.html"
out.write_text(html, encoding="utf-8")
print(f"{out} ({out.stat().st_size / 1024:.0f} KB)")
