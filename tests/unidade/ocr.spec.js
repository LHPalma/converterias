// Unitários de src/ocr.js: linhas do Tesseract → páginas → capítulos, notas, parágrafos e EPUB.
const { test, expect, inPage } = require('../apoio/app');
const A = require('../apoio/arquivos');
const JSZip = require('../../vendor/jszip.min.js');

// páginas sintéticas no formato do módulo: { W, H, rows: [{ x0, x1, y, t, w, c }], ink, img }
const row = (t, y, { x0 = 60, x1 = 535, c = 95 } = {}) => ({ x0, x1, y, t, w: t.split(' ').map(x => ({ t: x, c })), c });
const body = (n, { from = 80, prefix = 'linha' } = {}) => Array.from({ length: n }, (_, k) => row(`${prefix} ${k + 1} do texto corrido da página`, from + k * 16, { x0: k % 5 ? 60 : 75, x1: k % 5 === 4 ? 300 : 535 }));
const pg = (rows, o = {}) => ({ W: 595, H: 842, rows, ink: 0.05, img: null, ...o });

test('dice, norm e fixUrls', async ({ page }) => {
  const r = await page.evaluate(() => ({
    d: [Ocr._dice('capitulo', 'capitulo'), Ocr._dice('a', 'ab'), Ocr._dice('night', 'nacht'), Ocr._dice('abcd', 'wxyz')],
    n: Ocr._norm('  Notas e Referências! '),
    u: Ocr._fixUrls('veja hrtps://a.b, http://ok.c, htcp://x.y e htps://z.w'),
  }));
  expect(r.d[0]).toBe(1); expect(r.d[1]).toBe(0); expect(r.d[2]).toBeCloseTo(0.25); expect(r.d[3]).toBe(0);
  expect(r.n).toBe('notas e referencias');
  expect(r.u).toBe('veja https://a.b, http://ok.c, https://x.y e https://z.w');
});

test('rowsFromLines: sem palavras usa o texto da linha; descarta letra gigante e lixo de baixa confiança', async ({ page }) => {
  const rows = await page.evaluate(() => Ocr.rowsFromLines([
    { text: '  só   o texto da linha ', confidence: 90, bbox: { x0: 0, x1: 1190, y0: 100, y1: 130 } },
    { words: [{ text: 'enorme', confidence: 99 }], bbox: { x0: 0, x1: 500, y0: 200, y1: 300 } },
    { words: [{ text: '12', confidence: 70 }], bbox: { x0: 0, x1: 50, y0: 400, y1: 420 } },
    { words: [{ text: 'ab', confidence: 70 }], bbox: { x0: 0, x1: 50, y0: 500, y1: 520 } },
    { words: [{ text: '¦', confidence: 99 }, { text: '|Margem', confidence: 99 }], bbox: { x0: 0, x1: 300, y0: 600, y1: 620 } },
    { words: [{ text: '***', confidence: 99 }], bbox: { x0: 0, x1: 50, y0: 700, y1: 720 } },
    { words: [{ text: 'sem', confidence: null }, { text: 'confiança' }], bbox: { x0: 0, x1: 300, y0: 800, y1: 820 } },
  ], 1190).map(r => [r.t, Math.round(r.c)]));
  expect(rows).toEqual([['só o texto da linha', 90], ['12', 70], ['Margem', 99], ['sem confiança', 100]]);
});

test('Book: cabeçalho corrente, corpo sem número de página, tipo de página', async ({ page }) => {
  const pages = [
    pg([row('O COMEÇO', 30), ...body(20), row('12', 800)]),
    pg([row('O COMEÇO', 30), ...body(20), row('13', 800)]),
    pg([row('ÚNICO NESTA PÁGINA', 30), ...body(5)]),
    pg([row('Figura', 300, { x0: 200 })]),
  ];
  const r = await page.evaluate(p => {
    const b = new Ocr.Book(p);
    return { head: b.head, body0: b.bodyRows(0, false).length, opener: b.bodyRows(0, true).length, kinds: [0, 1, 2, 3].map(i => b.kind(b.bodyRows(i, false), false)), openerKind: b.kind(b.bodyRows(2, true).concat(b.bodyRows(2, true)), true) };
  }, pages);
  expect(r.head).toEqual(['O COMEÇO', 'O COMEÇO', null, null]);
  expect(r.body0).toBe(20);       // sem cabeçalho nem número de página
  expect(r.opener).toBe(21);      // na abertura do capítulo, o cabeçalho conta como texto
  expect(r.kinds).toEqual(['text', 'text', 'img', 'img']);
  expect(r.openerKind).toBe('text');
});

test('autoChapters: capítulos pelos cabeçalhos, abertura e ilustração antes; notas viram capítulo; rótulos do sumário', async ({ page }) => {
  const toc = pg([row('SUMÁRIO', 100), row('Capítulo 1 O começo de tudo', 140), row('Capítulo 2', 160), row('O fim', 176), row('Capítulo III .... 9', 192)]);
  const ilus = pg([row('x', 400)], { ink: 0.3 });
  const opener = pg(body(16, { prefix: 'abertura' }));
  const pages = [toc, ilus, opener, pg([row('O COMEÇO DE TUDO', 30), ...body(20)]), pg([row('O COMEÇO DE TUDO', 30), ...body(20)]),
    pg([row('O FIM', 30), ...body(20)]), pg([row('O FIM', 30), ...body(20)]), pg([row('O FIM', 30), row('Notas e Referências', 80), ...body(18, { from: 100 })])];
  const r = await page.evaluate(p => new Ocr.Book(p).autoChapters(1, p.length, 'Livro'), pages);
  expect(r).toEqual([
    { title: 'O começo de tudo', hdr: 3, start: 2, end: 5, opener: 3, label: 'Capítulo 1' },
    { title: 'O fim', hdr: 5, start: 6, end: 7, opener: null, label: 'Capítulo 2' },
    { title: 'Notas e Referências', start: 8, end: 8, opener: 8 },
  ]);
  expect(await page.evaluate(p => new Ocr.Book(p).autoChapters(1, 1, 'Sem Cabeçalho'), [pg(body(20))])).toEqual([{ title: 'Sem Cabeçalho', start: 1, end: 1, opener: null }]);
});

test('paragraphs: recuo e linha curta abrem parágrafo; hífen de fim de linha junta', async ({ page }) => {
  const rows = [
    row('Primeiro parágrafo começa aqui com recuo', 100, { x0: 80 }), row('e continua na linha de baixo até o fim', 116), row('termina curto.', 132, { x1: 200 }),
    row('Segundo parágrafo com hifeni-', 148, { x0: 80 }), row('zação no fim da linha e segue normalmente', 164), row('até o ponto final.', 180, { x1: 300 }),
    ...Array.from({ length: 10 }, (_, k) => row('linha de enchimento para a página ter texto', 196 + k * 16, { x0: k ? 60 : 80 })),
  ];
  const r = await page.evaluate(rs => new Ocr.Book([{ W: 595, H: 842, rows: rs }]).paragraphs([[0, rs]], new Set(), false), rows);
  expect(r.map(b => b.text)).toEqual([
    'Primeiro parágrafo começa aqui com recuo e continua na linha de baixo até o fim termina curto.',
    'Segundo parágrafo com hifenização no fim da linha e segue normalmente até o ponto final.',
    expect.stringMatching(/^linha de enchimento para a página ter texto linha de enchimento/),
  ]);
  // página que começa continuando o parágrafo da anterior (sem recuo) junta; depois de linha curta, abre outro
  const two = await page.evaluate(rs => { const b = new Ocr.Book([{ W: 595, H: 842, rows: rs }, { W: 595, H: 842, rows: rs }]); return b.paragraphs([[0, rs], [1, rs]], new Set(), false).length; }, rows);
  expect(two).toBe(6);
});

test('paragraphs: endereço quebrado no fim da linha cola só a parte dele; o resto da frase segue com espaços', async ({ page }) => {
  const rows = [
    row('Veja o endereço https://exemplo.com/um/', 100, { x0: 80 }), row('caminho/longo e depois continua', 116), row('a frase normalmente.', 132, { x1: 300 }),
    ...Array.from({ length: 10 }, (_, k) => row('linha de enchimento para a página ter texto', 148 + k * 16, { x0: k ? 60 : 80 })),
  ];
  const r = await page.evaluate(rs => new Ocr.Book([{ W: 595, H: 842, rows: rs }]).paragraphs([[0, rs]], new Set(), false), rows);
  expect(r[0].text).toBe('Veja o endereço https://exemplo.com/um/caminho/longo e depois continua a frase normalmente.');
});

test('paragraphs: endereço que termina no fim da linha não engole a palavra seguinte', async ({ page }) => {
  const rows = [
    row('O site é https://exemplo.com', 100, { x0: 80 }), row('e lá tem tudo; ver também www.a.org/x/', 116), row('y/z.html para o resto.', 132, { x1: 300 }),
    ...Array.from({ length: 10 }, (_, k) => row('linha de enchimento para a página ter texto', 148 + k * 16, { x0: k ? 60 : 80 })),
  ];
  const r = await page.evaluate(rs => new Ocr.Book([{ W: 595, H: 842, rows: rs }]).paragraphs([[0, rs]], new Set(), false), rows);
  expect(r[0].text).toBe('O site é https://exemplo.com e lá tem tudo; ver também www.a.org/x/y/z.html para o resto.');
});

test('paragraphs em notas: cada número abre uma nota; endereços sem espaços', async ({ page }) => {
  const rows = [
    row('1 Primeira nota com texto que continua', 100), row('na linha seguinte.', 116),
    row('2 Ver http://exemplo.com/pagina-', 132), row('-com-hifen.html', 148), row('Depois do endereço.', 164),
    row('3 Outra em https://a.b/c d', 180), row('ef/g.pdf', 196), row('SOBRENOME, Nome. Obra.', 212), row('4 Hifeni-', 228), row('zada.', 244),
    ...Array.from({ length: 6 }, (_, k) => row('5' + k + ' nota extra de enchimento', 260 + k * 16)),
  ];
  const r = await page.evaluate(rs => new Ocr.Book([{ W: 595, H: 842, rows: rs }]).paragraphs([[0, rs]], new Set(), true), rows);
  expect(r.slice(0, 6).map(b => b.text)).toEqual([
    '1 Primeira nota com texto que continua na linha seguinte.',
    '2 Ver http://exemplo.com/pagina-com-hifen.html',   // "-" no fim e no começo da seguinte: é do endereço
    'Depois do endereço.',
    '3 Outra em https://a.b/c def/g.pdf',
    'SOBRENOME, Nome. Obra.',
    '4 Hifenizada.',
  ]);
});

test('buildEpub: capa, ilustração e corretor; título decorado da abertura sai', async ({ page }) => {
  const img = await A.drawImage(page, { w: 600, h: 840, type: 'image/jpeg' });
  const r = await inPage(page, async (jpg, aff, dic) => {
    const blob = new Blob([jpg], { type: 'image/jpeg' });
    const row = (t, y, o = {}) => ({ x0: o.x0 ?? 60, x1: o.x1 ?? 535, y, t, w: t.split(' ').map(x => ({ t: x, c: o.c ?? 95 })), c: 95 });
    const text = n => Array.from({ length: n }, (_, k) => row(`linha ${k + 1} do texto com a palavra paralelepipedo aqui`, 100 + k * 16, { x0: k % 6 ? 60 : 75, c: k === 0 ? 40 : 95 }));
    const pages = [
      { W: 595, H: 842, rows: [], ink: 0.6, img: blob },                                                         // capa (escura: não passa por ilustração da abertura)
      { W: 595, H: 842, rows: [row('O Começo', 70, { x0: 250 }), ...text(16)], ink: 0.05, img: blob },          // abertura (sem cabeçalho), com o título decorado
      { W: 595, H: 842, rows: [row('O COMEÇO', 30), row('figura', 300, { x0: 250 })], ink: 0.2, img: blob },     // ilustração
      { W: 595, H: 842, rows: [row('O COMEÇO', 30), ...text(16)], ink: 0.05, img: blob },
    ];
    const spell = new Spell.Dict(await (await fetch(aff)).text(), await (await fetch(dic)).text());
    const out = await Ocr.buildEpub(JSZip, pages, { title: 'Livro OCR', author: 'Alguém', lang: 'pt-BR', cover: 1, spell }, async () => {});
    const z = await JSZip.loadAsync(out.bytes);
    return { chapters: out.chapters, fixed: out.fixed, fixes: out.fixes.slice(0, 1), files: Object.keys(z.files).filter(n => !n.endsWith('/')).sort(),
      c01: await z.file('OEBPS/c01.xhtml').async('string'), opf: await z.file('OEBPS/content.opf').async('string'), low: Ocr.countLow(pages) };
  }, img, 'vendor/ocr/pt.aff', 'vendor/ocr/pt.dic');
  expect(r.chapters).toBe(1);
  expect(r.files).toEqual(['META-INF/container.xml', 'OEBPS/c01.xhtml', 'OEBPS/content.opf', 'OEBPS/img/capa.jpg', 'OEBPS/img/p003.jpg', 'OEBPS/nav.xhtml', 'mimetype']);
  expect(r.c01).toContain('<h1>O começo</h1>');
  expect(r.c01.match(/O Começo/g)).toBeNull();           // título decorado lido na abertura sai
  expect(r.c01).toContain('<p class="fig"><img src="img/p003.jpg" alt=""/></p>');
  expect(r.fixed).toBeGreaterThan(0);
  expect(r.fixes[0]).toEqual({ de: 'paralelepipedo', para: 'paralelepípedo' });
  expect(r.opf).toContain('<dc:creator>Alguém</dc:creator>');
  expect(r.opf).toContain('properties="cover-image"');
  expect(r.low).toBe(14);                                // 7 palavras (de 2+ letras) da 1ª linha de cada página de texto, com pouca confiança
});

test('_crop: apara bordas e número de página do scan', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const cv = document.createElement('canvas'); cv.width = 1000; cv.height = 1400;
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 1000, 1400); c.fillStyle = '#000'; c.fillRect(300, 300, 400, 600);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const out = await Ocr._crop(blob, { maxW: 200 }), bm = await createImageBitmap(new Blob([out]));
    const white = document.createElement('canvas'); white.width = white.height = 50; white.getContext('2d').fillStyle = '#fff'; white.getContext('2d').fillRect(0, 0, 50, 50);
    const wb = await new Promise(r => white.toBlob(r, 'image/png')), wo = await createImageBitmap(new Blob([await Ocr._crop(wb, { dropNo: false })]));
    return { w: bm.width, h: bm.height, jpeg: out[0] === 0xff, white: [wo.width, wo.height] };
  });
  expect(r.jpeg).toBe(true);
  expect(r.w).toBe(200);                    // reduzido para maxW
  expect(r.h).toBeGreaterThan(270); expect(r.h).toBeLessThan(300);   // 400×600 → 200×300, menos 4,5% de baixo
  expect(r.white).toEqual([44, 48]);         // página em branco: só as bordas fixas saem
});
