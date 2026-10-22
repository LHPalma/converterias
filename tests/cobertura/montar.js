// globalSetup: com COVERAGE=1, monta cobertura.html, o mesmo app do index.html mas com os scripts de src/
// carregados como arquivos (o V8 só mede cobertura por script). O script principal do template vai para
// cobertura-app.js com as linhas na mesma posição do src/template.html.
const fs = require('fs');
const path = require('path');
const { ROOT, on, options } = require('./config');

// mappings do source map: uma marca na coluna 0 de cada linha gerada -> [arquivo, linha] de origem (VLQ base64, campos relativos)
function vlqMap(map) {
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const vlq = n => { let v = n < 0 ? (-n << 1) | 1 : n << 1, s = ''; do { let d = v & 31; v >>>= 5; if (v) d |= 32; s += B[d]; } while (v); return s; };
  let ps = 0, pl = 0;
  return map.map(([src, line]) => { const seg = vlq(0) + vlq(src - ps) + vlq(line - pl) + vlq(0); ps = src; pl = line; return seg; }).join(';');
}

module.exports = async () => {
  if (!on) return;
  fs.rmSync(options.outputDir, { recursive: true, force: true });
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const lines = read('src/template.html').split('\n');
  const start = lines.findIndex(l => l === '<script>'), end = lines.lastIndexOf('</script>');
  if (start < 0 || end < start) throw new Error('não achei o script principal em src/template.html');
  // o script principal com as partes de src/app/ coladas (como no build.py) e um source map linha a linha, para o
  // relatório mostrar cada parte no próprio arquivo
  const out = [], map = [], sources = ['src/template.html.js'], content = [read('src/template.html')];
  for (let i = start + 1; i < end; i++) {
    const m = /^\s*\/\*@(app\/[a-z0-9-]+\.js)\*\/\s*$/.exec(lines[i]);
    if (!m) { out.push(lines[i]); map.push([0, i]); continue; }
    const f = 'src/' + m[1], k = sources.push(f) - 1, text = read(f); content.push(text);
    text.replace(/\n$/, '').split('\n').forEach((l, j) => { out.push(l); map.push([k, j]); });
  }
  fs.writeFileSync(path.join(ROOT, 'cobertura-app.js'), out.join('\n') + '\n//# sourceMappingURL=data:application/json;base64,' +
    Buffer.from(JSON.stringify({ version: 3, file: 'cobertura-app.js', sources, sourcesContent: content, names: [], mappings: vlqMap(map) })).toString('base64') + '\n');
  const src = { PDFLIB: 'vendor/pdf-lib.min.js', FONTKIT: 'vendor/fontkit.umd.min.js', JSZIP: 'vendor/jszip.min.js', PDFJS: 'vendor/pdf.min.js',
    AZW3: 'src/azw3.js', KFX: 'src/kfx.js', MANGA: 'src/manga.js', KINDLE: 'src/kindle.js', META: 'src/meta.js', TESSERACT: 'vendor/ocr/tesseract.min.js', SPELL: 'src/spell.js', OCR: 'src/ocr.js' };
  let html = lines.slice(0, start).join('\n');
  for (const [k, f] of Object.entries(src)) html = html.replace(`<script>/*${k}*/</script>`, `<script src="${f}"></script>`);
  html = html.replace('/*PDFJSWORKER*/', read('vendor/pdf.worker.min.js').replace(/<\/script/g, '<\\/script'));
  const fonts = {};
  for (const [k, n] of Object.entries({ r: 'latin-400-normal', i: 'latin-400-italic', b: 'latin-700-normal', bi: 'latin-700-italic', rx: 'latin-ext-400-normal', ix: 'latin-ext-400-italic', rg: 'greek-400-normal', ig: 'greek-400-italic' }))
    fonts[k] = fs.readFileSync(path.join(ROOT, 'vendor/fonts', n + '.woff')).toString('base64');
  html = html.replace('/*FONTS*/{}', JSON.stringify(fonts));
  if (/\/\*[A-Z]+\*\//.test(html.replace(/\/\*PDFJSWORKER\*\/|<script id="pdfWorker"[\s\S]*?<\/script>/, ''))) throw new Error('marcador sem substituto em cobertura.html');
  fs.writeFileSync(path.join(ROOT, 'cobertura.html'), html + '\n<script src="cobertura-app.js"></script>\n' + lines.slice(end + 1).join('\n'));
};
