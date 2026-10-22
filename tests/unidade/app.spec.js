// Unitários das funções internas de src/template.html (expostas em window.__converterias).
const { test, expect } = require('../apoio/app');
const A = require('../apoio/arquivos');

const call = (page, name, ...args) => page.evaluate(({ name, args }) => window.__converterias[name](...args), { name, args });

test('titleCase: artigos e preposições minúsculos, siglas, hífen, apóstrofo e CAIXA ALTA', async ({ page }) => {
  const cases = {
    'o nome do vento': 'O Nome do Vento',
    'THE LORD OF THE RINGS': 'The Lord of the Rings',
    'a guerra dos tronos e a fúria dos reis': 'A Guerra dos Tronos e a Fúria dos Reis',
    'história do brasil: volume II': 'História do Brasil: Volume II',
    'guia da NASA para iniciantes': 'Guia da NASA para Iniciantes',
    'olho d\'água': 'Olho d\'Água',
    'bem-vindo ao mundo pós-moderno': 'Bem-Vindo ao Mundo Pós-Moderno',
    '  espaços   demais  ': 'Espaços Demais',
    'de volta para o futuro': 'De Volta para o Futuro',
    '"citação" entre aspas': '"Citação" entre Aspas',
    'fim de': 'Fim De',   // a última palavra sempre maiúscula
  };
  for (const [i, o] of Object.entries(cases)) expect(await call(page, 'titleCase', i), i).toBe(o);
});

test('cleanAuthors: vários formatos de autor', async ({ page }) => {
  const cases = [
    ['Rothfuss, Patrick', ['Patrick Rothfuss']],
    ['Silva, Maria; João Souza', ['Maria Silva', 'João Souza']],
    ['Ana & Bia / Carla + Dora | Eva', ['Ana', 'Bia', 'Carla', 'Dora', 'Eva']],
    ['Neil Gaiman and Terry Pratchett', ['Neil Gaiman', 'Terry Pratchett']],
    ['Machado de Assis e José de Alencar', ['Machado de Assis', 'José de Alencar']],
    ['Ana, Bia, Carla', ['Ana', 'Bia', 'Carla']],
    ['Martin Luther King, Jr.', ['Martin Luther King, Jr.']],
    ['JOSÉ SARAMAGO', ['José Saramago']],
  ];
  for (const [i, o] of cases) expect(await call(page, 'cleanAuthors', i), i).toEqual(o);
});

test('makeName: título, subtítulo, autores, caracteres proibidos e limite de tamanho', async ({ page }) => {
  expect(await call(page, 'makeName', 'o hobbit: lá e de volta outra vez', ['Tolkien, J. R. R.'])).toBe('O Hobbit - Lá e de Volta Outra Vez (J. R. R. Tolkien)');
  expect(await call(page, 'makeName', 'Duna — Livro 1', [])).toBe('Duna - Livro 1');
  expect(await call(page, 'makeName', '', [])).toBe('Livro');
  expect(await call(page, 'makeName', 'a/b\\c:d*e?f"g<h>i|j', ['x'])).toBe('A B C D e F G H I J (X)');   // "e" é conjunção
  expect(await call(page, 'makeName', 'Antologia', ['A', 'B', 'C', 'D'])).toBe('Antologia (A et al.)');
  expect(await call(page, 'makeName', 'Antologia', ['A; B', 'C'])).toBe('Antologia (A, B, C)');
  const long = await call(page, 'makeName', 'palavra '.repeat(40), ['Autora Longa']);
  expect(long.length).toBeLessThanOrEqual(190);
  expect(long.endsWith(' (Autora Longa)')).toBe(true);
});

test('resolve: caminhos relativos dentro do zip', async ({ page }) => {
  const cases = [
    [['OEBPS/content.opf', 'texto/c1.xhtml'], 'OEBPS/texto/c1.xhtml'],
    [['OEBPS/texto/c1.xhtml', '../img/a.png'], 'OEBPS/img/a.png'],
    [['OEBPS/texto/c1.xhtml', './c2.xhtml#ancora'], 'OEBPS/texto/c2.xhtml'],
    [['OEBPS/texto/c1.xhtml', '/raiz.css'], 'raiz.css'],
    [['c1.xhtml', 'img%20com%20espa%C3%A7o.png?v=1'], 'img com espaço.png'],
    [['a/b/c.xhtml', '../../../../x.png'], 'x.png'],
    [['a/b.xhtml', 'bad%E0%A4%A.png'], 'a/bad%E0%A4%A.png'],
  ];
  for (const [[b, r], o] of cases) expect(await call(page, 'resolve', b, r), r).toBe(o);
});

test('pageRange: intervalos, abertos, repetidos e erros', async ({ page }) => {
  expect(await call(page, 'pageRange', '', 3)).toEqual([0, 1, 2]);
  expect(await call(page, 'pageRange', '1-3, 7, 10-', 12)).toEqual([0, 1, 2, 6, 9, 10, 11]);
  expect(await call(page, 'pageRange', '-2; 2 3', 5)).toEqual([0, 1, 2]);
  expect(await call(page, 'pageRange', '5-3', 9)).toEqual([2, 3, 4]);   // invertido
  expect(await call(page, 'pageRange', '8-20', 10)).toEqual([7, 8, 9]);
  expect(await call(page, 'pageRange', '10-', 10)).toEqual([9]);
  expect(await call(page, 'pageRange', '3, 11-', 10)).toEqual([2]);   // aberto além do fim: nada, sem puxar a última
  for (const [t, err] of [['x', /Páginas inválidas: "x"/], ['-', /Páginas inválidas/], ['1-2-3', /Páginas inválidas/], ['20-30', /nenhuma cai em "20-30"/], ['11-', /nenhuma cai em "11-"/]])
    await expect(page.evaluate(t => window.__converterias.pageRange(t, 10), t)).rejects.toThrow(err);
});

test('guessTitle e stem: nome comum de uma lista de arquivos', async ({ page }) => {
  const g = names => page.evaluate(n => window.__converterias.guessTitle(n.map(x => ({ name: x }))), names);
  expect(await g(['Revista 01.pdf', 'Revista 02.pdf', 'Revista 03.pdf'])).toBe('Revista');
  expect(await g(['Volume - Parte 1.epub', 'Volume - Parte 2.epub'])).toBe('Volume - Parte');
  expect(await g(['ab.pdf', 'ac.pdf'])).toBe('ab (+1)');
  expect(await g(['único.pdf'])).toBe('único');
  expect(await page.evaluate(() => window.__converterias.stem({ name: 'Foto.JPEG' }))).toBe('Foto');
});

test('guessLang: pelas palavras comuns e pela escrita', async ({ page }) => {
  const rep = (s, n = 10) => Array(n).fill(s).join(' ');
  const cases = {
    pt: rep('o livro é de uma das pessoas que não tem mais para ver'),
    en: rep('the book is one of the things that would have been there'),
    es: rep('el libro es una de las cosas que no hay para ver con los'),
    fr: rep('le livre est une des choses que nous avons pour la vie dans les'),
    de: rep('der Mann und die Frau sind nicht in den Haus mit dem Hund'),
    it: rep('il libro è una delle cose che non sono per la vita del mondo'),
    ru: rep('это русский текст для проверки языка'),
    ja: rep('これは日本語のテキストです'),
    zh: rep('这是一个用于测试的中文文本'),
    ko: rep('이것은 한국어 텍스트입니다'),
    he: rep('זהו טקסט בעברית לבדיקה'),
    ar: rep('هذا نص باللغة العربية للاختبار'),
    el: rep('αυτό είναι ένα ελληνικό κείμενο'),
    th: rep('นี่คือข้อความภาษาไทย'),
    hi: rep('यह हिंदी में एक पाठ है'),
  };
  for (const [l, t] of Object.entries(cases)) expect(await call(page, 'guessLang', t), l).toBe(l);
  expect(await call(page, 'guessLang', 'xyz abc')).toBe('pt');   // pouco texto: padrão
});

test('composeAcc: acentos soltos do TeX', async ({ page }) => {
  expect(await call(page, 'composeAcc', 'ent˜ao cora¸c˜ao p˜ao', false)).toEqual(['então coração pão', 4]);
  expect(await call(page, 'composeAcc', 'caf´e', false)).toEqual(['caf´e', 0]);          // ´ só vale em documento TeX
  expect(await call(page, 'composeAcc', 'caf´e ´agua `a', true)).toEqual(['café água à', 3]);
  expect(await call(page, 'composeAcc', '¸a ı^', true)).toEqual(['¸a ı^', 0]);          // cedilha só em c/s/t
  expect(await call(page, 'composeAcc', '¨ı ˆı', false)).toEqual(['ï î', 2]);            // i sem pingo
});

test('modeOf: moda ponderada', async ({ page }) => {
  expect(await call(page, 'modeOf', [[10, 1], [10.2, 5], [12, 3], [10.1, 2]], 0.5)).toBeCloseTo(10.15, 1);
  expect(await call(page, 'modeOf', [], 1)).toBe(0);
});

test('clusterLines, buildRuns e finalizeLines: itens de texto viram linhas com estilos e sobrescrito', async ({ page }) => {
  const st = (o = {}) => ({ b: false, i: false, m: false, x: false, ...o });
  const items = [
    { x: 50, y: 100, w: 40, size: 10, str: 'Uma', st: st() }, { x: 93, y: 100, w: 40, size: 10, str: 'frase', st: st({ i: true }) },
    { x: 133, y: 96, w: 4, size: 6, str: '1', st: st() }, { x: 140, y: 100, w: 30, size: 10, str: ', fim.', st: st() },
    { x: 50, y: 114, w: 60, size: 10, str: 'segunda', st: st({ b: true }) }, { x: 50, y: 128, w: 60, size: 10, str: 'x = 1', st: st({ m: true }), mono: true },
  ];
  const lines = await page.evaluate(items => { const C = window.__converterias; return C.finalizeLines(C.clusterLines(items), 1, 0, false); }, items);
  expect(lines).toHaveLength(3);
  expect(lines[0].text).toBe('Uma frase1, fim.');
  expect(lines[0].runs.map(r => [r.t, r.i, r.sup])).toEqual([['Uma ', false, 0], ['frase', true, 0], ['1', false, 1], [', fim.', false, 0]]);
  expect(lines[1].bold).toBe(true);
  expect(lines[2].mono).toBe(true);
  expect(lines[2].code).toBe('x = 1');
  // da direita para a esquerda (coordenadas já espelhadas): trechos latinos voltam à ordem da esquerda para a direita
  const rtl = await page.evaluate(() => { const C = window.__converterias, s = { b: false, i: false, m: false, x: false };
    return C.finalizeLines(C.clusterLines([{ x: 10, y: 50, w: 20, size: 10, str: 'שלום', st: s }, { x: 40, y: 50, w: 10, size: 10, str: 'B2', st: s }, { x: 52, y: 50, w: 10, size: 10, str: 'A1', st: s }]), 1, 0, true)[0]; });
  expect(rtl.rtl).toBe(true);
  expect(rtl.text).toBe('שלום A1B2');
});

test('findGutters e pageLines: duas colunas são lidas uma depois da outra', async ({ page }) => {
  const out = await page.evaluate(() => {
    const C = window.__converterias, s = { b: false, i: false, m: false, x: false }, raw = [];
    for (let k = 0; k < 20; k++) { raw.push({ x: 50, y: 100 + k * 14, w: 200, size: 10, str: 'esquerda ' + k, st: s }); raw.push({ x: 300, y: 100 + k * 14, w: 200, size: 10, str: 'direita ' + k, st: s }); }
    raw.push({ x: 50, y: 80, w: 450, size: 14, str: 'Título que cruza as duas colunas', st: s });
    return { g: C.findGutters(raw, 10), lines: C.pageLines(raw, 1, false).map(L => L.text) };
  });
  expect(out.g).toHaveLength(1);
  expect(out.g[0]).toBeGreaterThan(250); expect(out.g[0]).toBeLessThan(300);
  expect(out.lines[0]).toBe('Título que cruza as duas colunas');
  expect(out.lines.slice(1, 21).every(t => t.startsWith('esquerda'))).toBe(true);
  expect(out.lines.slice(21).every(t => t.startsWith('direita'))).toBe(true);
  expect(await page.evaluate(() => window.__converterias.findGutters([], 10))).toEqual([]);
});

test('figureRegions: agrupa imagem e desenhos; descarta ícone, linha solta e caixa de texto', async ({ page }) => {
  const r = await page.evaluate(() => {
    const C = window.__converterias, W = 600, H = 800, s = { b: false, i: false, m: false, x: false };
    const shapes = [
      { b: [100, 100, 300, 250], k: 'img' },                                     // figura
      { b: [305, 120, 340, 140], k: 'vec' }, { b: [305, 150, 340, 170], k: 'vec' }, { b: [305, 180, 340, 200], k: 'vec' },   // desenhos colados
      { b: [500, 20, 520, 35], k: 'img' },                                       // ícone
      { b: [50, 500, 550, 501], k: 'rule' },                                     // linha solta
      { b: [50, 600, 550, 700], k: 'vec' },                                      // caixa de texto
      { b: [10, 10, 11, 11], k: 'dot' },
    ];
    const raw = [{ x: 150, y: 270, w: 60, size: 8, str: 'Figura 1', st: s }];
    for (let k = 0; k < 6; k++) raw.push({ x: 60, y: 620 + k * 12, w: 480, size: 10, str: 'texto corrido dentro de uma caixa com bastante coisa escrita', st: s });
    return C.figureRegions(shapes, raw, W, H, 500);
  });
  expect(r).toHaveLength(1);
  expect(r[0].box[0]).toBeLessThanOrEqual(100); expect(r[0].box[2]).toBeGreaterThanOrEqual(340);
  expect(r[0].alt).toBe('Figura 1');   // rótulo curto colado na figura entra nela
});

test('drawnShapes: formas e imagens desenhadas viram caixas na página', async ({ page }) => {
  const pdf = await (async () => {
    const { PDFDocument, rgb } = require('../../vendor/pdf-lib.min.js');
    const d = await PDFDocument.create(), pg = d.addPage([400, 400]);
    pg.drawRectangle({ x: 50, y: 50, width: 100, height: 60, color: rgb(0, 0, 0) });
    pg.drawRectangle({ x: 300, y: 300, width: 2, height: 2, color: rgb(0, 0, 0) });   // ponto (marcador de lista)
    pg.drawLine({ start: { x: 10, y: 380 }, end: { x: 390, y: 380 }, thickness: 1 });
    pg.drawImage(await d.embedPng(A.ICON), { x: 200, y: 50, width: 100, height: 100 });
    return Buffer.from(await d.save());
  })();
  const r = await page.evaluate(async b64 => {
    const C = window.__converterias; C.initPdfjs();
    const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)), isEvalSupported: false }).promise, pg = await doc.getPage(1), vp = pg.getViewport({ scale: 1 });
    const { OPS, Util } = pdfjsLib, ol = await pg.getOperatorList();
    const res = C.drawnShapes(ol, vp, vp.width, vp.height, new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter(Boolean)), OPS, Util);
    return { kinds: res.shapes.map(s => s.k).sort(), hasImg: res.hasImg, bigImg: res.bigImg, img: res.shapes.find(s => s.k === 'img').b.map(Math.round) };
  }, pdf.toString('base64'));
  expect(r.kinds).toEqual(['dot', 'img', 'rule', 'vec']);
  expect(r.hasImg).toBe(true);
  expect(r.bigImg).toBe(false);
  expect(r.img).toEqual([200, 250, 300, 350]);   // em coordenadas da página (y para baixo)
});

test('buildBlocks: XHTML vira blocos com estilos, listas, citações e imagens', async ({ page }) => {
  const blocks = await page.evaluate(() => {
    const d = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><body><h2>T</h2><p>a <em>b</em> <strong>c</strong><sup>1</sup></p><ol><li>x</li><li>y</li></ol><blockquote><p>q</p></blockquote><pre>l1\nl2</pre><img src="../i.png"/><hr/><p hidden="">h</p><div class="center">c</div><p style="text-align: right">r</p><table><tr><td>t1</td><td>t2</td></tr></table></body></html>', 'application/xhtml+xml');
    const out = []; window.__converterias.buildBlocks(d.body, 'OEBPS/t/c.xhtml', out);
    return out.map(b => b.t === 'p' ? { kind: b.kind, align: b.align, quote: b.quote, label: b.label, pre: b.pre, text: b.toks.map(t => t.sp ? ' ' : t.br ? '\n' : t.parts.map(p => p.w + (p.f ? `[${p.f}]` : '') + (p.sup ? '^' : '')).join('')).join('') } : b);
  });
  expect(blocks).toEqual([
    { kind: 'h2', align: 'center', quote: 0, label: null, pre: false, text: 'T[2]' },
    { kind: 'p', align: null, quote: 0, label: null, pre: false, text: 'a b[1] c[2]1^' },
    { kind: 'li', align: null, quote: 0, label: '1.', pre: false, text: 'x' },
    { kind: 'li', align: null, quote: 0, label: '2.', pre: false, text: 'y' },
    { kind: 'p', align: null, quote: 1, label: null, pre: false, text: 'q' },
    { kind: 'p', align: 'left', quote: 0, label: null, pre: true, text: 'l1\nl2' },
    { t: 'img', path: 'OEBPS/i.png' },
    { t: 'hr' },
    { kind: 'p', align: 'center', quote: 0, label: null, pre: false, text: 'c' },
    { kind: 'p', align: 'right', quote: 0, label: null, pre: false, text: 'r' },
    { kind: 'p', align: null, quote: 0, label: null, pre: false, text: 't1 t2' },
  ]);
});

test('jpegInfo: componentes e orientação EXIF (big e little endian)', async ({ page }) => {
  const jpg = await A.drawImage(page, { type: 'image/jpeg' });
  const info = b => page.evaluate(b64 => window.__converterias.jpegInfo(Uint8Array.from(atob(b64), c => c.charCodeAt(0))), b.toString('base64'));
  expect(await info(jpg)).toEqual({ comps: 3, orient: 1 });
  expect(await info(A.withExif(jpg, 6))).toEqual({ comps: 3, orient: 6 });
  expect(await info(A.withExif(jpg, 3, true))).toEqual({ comps: 3, orient: 3 });
  const cmyk = Buffer.from(jpg); for (let i = 2; i < cmyk.length; i++) if (cmyk[i] === 0xff && cmyk[i + 1] === 0xc0) { cmyk[i + 9] = 4; break; }
  expect((await info(cmyk)).comps).toBe(4);
});

test('kindOf: PDF, EPUB (zip) ou nada', async ({ page }) => {
  const k = (b) => page.evaluate(b64 => window.__converterias.kindOf(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))])), b.toString('base64'));
  expect(await k(Buffer.from('%PDF-1.7 ...'))).toBe('pdf');
  expect(await k(Buffer.concat([Buffer.from('lixo antes '), Buffer.from('%PDF-1.4')]))).toBe('pdf');
  expect(await k(Buffer.from('PK\x03\x04'))).toBe('epub');
  expect(await k(Buffer.from('nada'))).toBe(null);
});

test('xesc e uuid', async ({ page }) => {
  expect(await call(page, 'xesc', 'a<b>&"c"\u0001\ud800x\udc00')).toBe('a&lt;b&gt;&amp;&quot;c&quot;x');
  const ids = await page.evaluate(() => Array.from({ length: 5 }, () => window.__converterias.uuid()));
  for (const u of ids) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(new Set(ids).size).toBe(5);
});

test('shapeVec e shapeCorr: a mesma forma correlaciona 1; formas diferentes, menos', async ({ page }) => {
  const r = await page.evaluate(() => {
    const C = window.__converterias, cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 32); c.fillStyle = '#000';
    c.fillRect(4, 4, 8, 24); c.fillRect(36, 4, 8, 24); c.beginPath(); c.arc(56, 16, 6, 0, 7); c.fill();
    const a = C.shapeVec(cv, 0, 0, 16, 32), b = C.shapeVec(cv, 32, 0, 16, 32), o = C.shapeVec(cv, 48, 0, 16, 32);
    return [C.shapeCorr(a, b), C.shapeCorr(a, o)];
  });
  expect(r[0]).toBeCloseTo(1, 3);
  expect(r[1]).toBeLessThan(0.9);
});

test('rotated: miniatura girada troca largura e altura', async ({ page }) => {
  const r = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 30; c.height = 10; return [0, 90, 180, 270, -90, 450].map(d => { const o = window.__converterias.rotated(c, d); return [o.width, o.height]; }); });
  expect(r).toEqual([[30, 10], [10, 30], [30, 10], [10, 30], [10, 30], [10, 30]]);
});

test('pdfOutline e writeOutline: marcadores lidos e gravados de volta', async ({ page }) => {
  const src = await A.makeNumberedPdf(4, { outline: [{ title: 'A', page: 0, items: [{ title: 'A.1', page: 1, items: [] }] }, { title: 'B', page: 3, named: 'nomeado', items: [] }, { title: 'Fora', page: 2, items: [] }] });
  const tree = await page.evaluate(b64 => window.__converterias.pdfOutline(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), 3), src.toString('base64'));
  expect(tree).toEqual([{ title: 'A', page: 0, items: [{ title: 'A.1', page: 1, items: [] }] }, { title: 'Fora', page: 2, items: [] }]);   // B (página 4) fica fora de 3 páginas
  expect(await page.evaluate(() => window.__converterias.pdfOutline(new Uint8Array([1, 2, 3]), 1))).toEqual([]);
});

test('pdf.js usa as fontes-padrão embutidas no app (não as do aparelho) quando o PDF não embute a fonte', async ({ page }) => {
  const pdf = await A.makeTextPdf({ chapters: 1 });   // Times-Roman e Times-Bold sem embutir
  const r = await page.evaluate(async b64 => {
    window.__converterias.initPdfjs();
    const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise, pg = await doc.getPage(1);
    const ol = await pg.getOperatorList(), names = [...new Set(ol.fnArray.flatMap((f, i) => f === pdfjsLib.OPS.setFont ? [ol.argsArray[i][0]] : []))];
    const fonts = names.map(n => pg.commonObjs.get(n));
    return { n: fonts.length, missing: fonts.map(f => f.missingFile), system: fonts.map(f => !!f.systemFontInfo), embedded: Object.keys(PDFJS_FONTS).length };
  }, pdf.toString('base64'));
  expect(r.n).toBe(2);
  expect(r.missing).toEqual([false, false]);   // desenhadas com a FoxitSerif do app
  expect(r.system).toEqual([false, false]);
  expect(r.embedded).toBe(14);
});
