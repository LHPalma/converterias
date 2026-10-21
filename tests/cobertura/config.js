// Cobertura de código (só com COVERAGE=1, via npm run coverage): o que os testes executaram de src/,
// medido no Chromium, com o relatório em coverage/.
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const on = !!process.env.COVERAGE;

// caminho do arquivo -> nome no relatório (o script principal sai de src/template.html, ver montar.js)
const sourcePath = p => {
  const f = p.replace(/^.*?(src\/|cobertura-app\.js)/, '$1');
  return f === 'cobertura-app.js' ? 'src/template.html.js' : f;
};

const options = {
  name: 'Cobertura do Converterias',
  outputDir: path.join(ROOT, 'coverage'),
  reports: [['v8'], ['console-details', { skipPercent: 0 }], ['json-summary'], ['lcovonly']],
  entryFilter: e => /\/(src\/[a-z0-9]+\.js|cobertura-app\.js)$/.test(e.url.split('?')[0]),
  sourceFilter: s => /^src\//.test(s),
  sourcePath,
  cleanCache: false,
};

module.exports = { ROOT, on, options };
