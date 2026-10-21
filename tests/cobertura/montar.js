// globalSetup: com COVERAGE=1, monta cobertura.html, o mesmo app do index.html mas com os scripts de src/
// carregados como arquivos (o V8 só mede cobertura por script). O script principal do template vai para
// cobertura-app.js com as linhas na mesma posição do src/template.html.
const fs = require('fs');
const path = require('path');
const { ROOT, on, options } = require('./config');

module.exports = async () => {
  if (!on) return;
  fs.rmSync(options.outputDir, { recursive: true, force: true });
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const lines = read('src/template.html').split('\n');
  const start = lines.findIndex(l => l === '<script>'), end = lines.lastIndexOf('</script>');
  if (start < 0 || end < start) throw new Error('não achei o script principal em src/template.html');
  fs.writeFileSync(path.join(ROOT, 'cobertura-app.js'), '\n'.repeat(start + 1) + lines.slice(start + 1, end).join('\n') + '\n');
  const src = { PDFLIB: 'vendor/pdf-lib.min.js', FONTKIT: 'vendor/fontkit.umd.min.js', JSZIP: 'vendor/jszip.min.js', PDFJS: 'vendor/pdf.min.js',
    AZW3: 'src/azw3.js', KFX: 'src/kfx.js', MANGA: 'src/manga.js', KINDLE: 'src/kindle.js', TESSERACT: 'vendor/ocr/tesseract.min.js', SPELL: 'src/spell.js', OCR: 'src/ocr.js' };
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
