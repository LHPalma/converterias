#!/usr/bin/env python3
"""Gera o index.html (arquivo único, offline) a partir de src/template.html + vendor/.

Com --check, não grava nada: só confere se o index.html do repositório está igual ao que seria gerado."""
import base64, json, pathlib, re, sys

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
def esm_global(src, name):
    """O pdf.js 4+ só vem como módulo ES: o export final vira globalThis.<name> e o resto fica dentro de uma função,
    para rodar como script comum (como o app faz com todas as bibliotecas) sem espalhar nomes no escopo global."""
    m = re.search(r"export\{([^}]*)\};?\s*$", src)
    if not m:
        sys.exit(f"{name}: não achei o export final do módulo")
    pairs = [p.strip().split(" as ") for p in m[1].split(",")]
    body = src[:m.start()].replace("import.meta.url", "location.href")   # só nos caminhos de Node, que o navegador não usa
    if "import.meta" in body:
        sys.exit(f"{name}: o módulo usa import.meta de um jeito que o build não sabe converter")
    return '(() => {"use strict";\n' + body + "\nglobalThis." + name + " = {" + ",".join(f"{b}:{a}" for a, b in pairs) + "};\n})();"


for marker, f in (("/*PDFLIB*/", "pdf-lib.min.js"), ("/*FONTKIT*/", "fontkit.umd.min.js"), ("/*JSZIP*/", "jszip.min.js")):
    html = html.replace(marker, esc((v / f).read_text(encoding="utf-8")))
html = html.replace("/*PDFJS*/", esc(esm_global((v / "pdf.min.mjs").read_text(encoding="utf-8"), "pdfjsLib")))
# o worker continua módulo: o pdf.js 4 o abre com new Worker(..., { type: "module" })
html = html.replace("/*PDFJSWORKER*/", esc((v / "pdf.worker.min.mjs").read_text(encoding="utf-8")))
html = html.replace("/*TESSERACT*/", esc((v / "ocr" / "tesseract.min.js").read_text(encoding="utf-8")))
html = html.replace("/*SPELL*/", esc((root / "src" / "spell.js").read_text(encoding="utf-8")))
html = html.replace("/*OCR*/", esc((root / "src" / "ocr.js").read_text(encoding="utf-8")))
html = html.replace("/*AZW3*/", esc((root / "src" / "azw3.js").read_text(encoding="utf-8")))
html = html.replace("/*KFX*/", esc((root / "src" / "kfx.js").read_text(encoding="utf-8")))
html = html.replace("/*MANGA*/", esc((root / "src" / "manga.js").read_text(encoding="utf-8")))
html = html.replace("/*KINDLE*/", esc((root / "src" / "kindle.js").read_text(encoding="utf-8")))
html = html.replace("/*META*/", esc((root / "src" / "meta.js").read_text(encoding="utf-8")))
# partes do script principal (src/app/*.js): coladas no lugar de cada /*@app/x.js*/, dentro do mesmo escopo
html = re.sub(r"/\*@(app/[a-z0-9-]+\.js)\*/", lambda m: esc((root / "src" / m[1]).read_text(encoding="utf-8")).rstrip("\n").lstrip(" "), html)
html = html.replace("/*FONTS*/{}", json.dumps(fonts))

out = root / "index.html"
if "--check" in sys.argv:
    if out.read_text(encoding="utf-8") != html:
        sys.exit("index.html está desatualizado: rode python3 build.py e faça commit do resultado.")
    print("index.html em dia com src/ e vendor/.")
    sys.exit(0)
out.write_text(html, encoding="utf-8")
print(f"{out} ({out.stat().st_size / 1024:.0f} KB)")
