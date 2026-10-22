// EPUB → PDF: diagramação própria do app (fontes embutidas, margens, capa, imagens, listas, títulos).
const { test, expect, open, run, download, pdfText } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readPdf } = require('../apoio/leitores');
const JSZip = require('../../vendor/jszip.min.js');

const MM = 72 / 25.4;
const epub = (o, name = 'livro.epub') => A.makeEpub(o).then(b => A.file(name, b, 'application/epub+zip'));

test('diagrama o livro, preenche metadados e nomeia em Title Case', async ({ page }) => {
  const [out] = await run(page, 'e2p', [await epub({ title: 'o nome do vento', authors: ['Patrick Rothfuss'] })]);
  expect(out.name).toBe('O Nome do Vento (Patrick Rothfuss).pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.title).toBe('O Nome do Vento');   // metadado no mesmo padrão do nome do arquivo
  expect(pdf.author).toBe('Patrick Rothfuss');
  expect(pdf.producer).toBe('epub2pdf (local)');
  expect(pdf.pages).toBe(4);                   // capa + 3 capítulos, cada um começando numa página
  expect(pdf.sizes[0].width).toBeCloseTo(612, 0);
  expect(pdf.sizes[0].height).toBeCloseTo(612, 0);   // capa quadrada: a proporção da imagem, na largura da página
  for (const s of pdf.sizes.slice(1)) { expect(s.width).toBeCloseTo(612, 0); expect(s.height).toBeCloseTo(792, 0); }
  expect(pdf.fonts.some(f => /IBMPlexSerif/.test(f))).toBe(true);   // fonte embutida (subconjunto)
  const text = await pdfText(page, out.buf);
  expect(text[1]).toContain('Capítulo 1');
  expect(text[1]).toContain('Era uma vez um conversor que rodava inteiro no navegador');
  expect(text[3]).toContain('Capítulo 3');
  await expect(page.locator('#list .s.ok')).toHaveText(/✓ 4 páginas · 0\.\d MB/);
  await expect(page.locator('#status')).toHaveText('Pronto: 1 convertido(s). Toque em baixar.');
  await expect(page.locator('#sepBtn')).toHaveText('Baixar o PDF');
  await expect(page.locator('#zipBtn')).toBeHidden();
});

test('tamanho de página, margens, fonte, justificação e capa desligada', async ({ page }) => {
  const book = await epub({ chapters: [A.LOREM.join(' ').repeat(12)] });
  const sizes = {};
  for (const [size, wh] of [['A4', [595.28, 841.89]], ['A5', [419.53, 595.28]]]) {
    const [out] = await run(page, 'e2p', [book], { setup: async p => { await p.selectOption('#size', size); await p.uncheck('#cover'); } });
    const pdf = await readPdf(out.buf);
    for (const s of pdf.sizes) { expect(s.width).toBeCloseTo(wh[0], 0); expect(s.height).toBeCloseTo(wh[1], 0); }
    sizes[size] = pdf.pages;
  }
  expect(sizes.A5).toBeGreaterThan(sizes.A4);   // página menor, mais páginas
  const pagesFor = async setup => readPdf((await run(page, 'e2p', [book], { setup }))[0].buf).then(p => p.pages);
  const base = await pagesFor(async p => { await p.selectOption('#size', 'A5'); await p.fill('#font', '10'); });
  const big = await pagesFor(p => p.fill('#font', '20'));
  expect(big).toBeGreaterThan(base);
  const wide = await pagesFor(async p => { await p.fill('#font', '10'); await p.fill('#ms', '50'); await p.fill('#mt', '50'); await p.fill('#mb', '50'); await p.uncheck('#just'); });
  expect(wide).toBeGreaterThan(base);
  // fonte fora da faixa é limitada (6 a 30) e valor inválido volta ao padrão
  const huge = await pagesFor(async p => { await p.fill('#font', '99'); await p.fill('#ms', ''); await p.fill('#mt', ''); await p.fill('#mb', ''); });
  const max = await pagesFor(p => p.fill('#font', '30'));
  expect(huge).toBe(max);
  // margem maior que a página: erro claro, na lista
  await open(page, 'e2p');
  await page.fill('#ms', '60'); await page.selectOption('#size', 'A5'); await page.fill('#ms', '60');
  await page.evaluate(() => { document.getElementById('ms').value = '200'; });
  await page.setInputFiles('#file', [book]);
  await page.click('#go');
  await expect(page.locator('#list .s.err')).toHaveText('Erro: Margens grandes demais para esse tamanho de página.');
});

for (const [kind, o] of [
  ['properties="cover-image"', { cover: 'cover-image' }],
  ['<meta name="cover">', { cover: 'meta' }],
  ['<meta name="cover"> apontando para id que não existe (acha pelo nome)', { cover: 'meta-nome' }],
  ['<guide> com página de capa (img)', { cover: 'guide' }],
  ['<guide> com página de capa em SVG', { cover: 'guide', svgCover: true }],
  ['só pelo nome do arquivo (img/capa.png)', { cover: 'nome' }],
]) {
  test(`capa achada por ${kind}`, async ({ page }) => {
    const [out] = await run(page, 'e2p', [await epub(o)]);
    const pdf = await readPdf(out.buf);
    expect(pdf.sizes[0].height).toBeCloseTo(612, 0);   // 1ª página é a capa quadrada
    expect(pdf.images[0]).toBe(1);
    if (o.cover === 'guide') expect(pdf.images.slice(1).every(n => n === 0)).toBe(true);   // a capa não se repete no texto
  });
}

test('capítulo rico: títulos, estilos, listas, citação, código, tabela, quebras e texto escondido', async ({ page }) => {
  const [out] = await run(page, 'e2p', [await epub({ chapters: [A.RICH_CHAPTER], cover: false })]);
  const text = (await pdfText(page, out.buf)).join(' ');
  for (const t of ['Capítulo Rico', 'Uma seção', 'Nível 6', 'itálico', 'negrito', 'os dois', 'Linha centralizada', 'Linha à direita',
    'primeiro item', 'segundo item', '1.', '2.', 'Uma citação recuada', 'codigo', 'segunda linha', 'Antes da quebra', 'depois da quebra',
    'λόγος', 'exemplo.com.br']) expect(text, t).toContain(t);
  expect(text).toMatch(/D\s?Ž/);   // Ǆ (sem glifo na fonte) vira D + Ž pela normalização NFKC
  expect(text).toContain('•');
  expect(text).not.toContain('texto escondido');
  expect(text).not.toContain('var nao');
  expect(text).toMatch(/Ligadura fi/);   // ligadura ﬁ vira "fi" (a fonte não tem o glifo)
});

test('imagens do livro: PNG, JPEG, GIF, WebP e SVG entram no PDF; imagem quebrada é ignorada', async ({ page }) => {
  const jpg = await A.drawImage(page, { type: 'image/jpeg' }), webp = await A.drawImage(page, { type: 'image/webp' });
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#2f6fed"/></svg>');
  const imgs = { 'img/a.png': A.ICON, 'img/b.jpg': jpg, 'img/c.gif': A.GIF_1x1, 'img/d.webp': webp, 'img/e.svg': svg, 'img/f.png': Buffer.from('quebrada') };
  const body = '<h1>Figuras</h1><p>Texto.</p>' + Object.keys(imgs).map(n => `<p><img src="../${n}" alt=""/></p>`).join('');
  const [out] = await run(page, 'e2p', [await epub({ chapters: [body], images: imgs, cover: false })]);
  const pdf = await readPdf(out.buf);
  expect(pdf.images.reduce((a, b) => a + b, 0)).toBe(5);
  await expect(page.locator('#list .s.ok')).toBeVisible();
});

test('EPUB 2 com NCX, DOCTYPE, OPF na raiz, linear="no" e autor por papel (opf:role)', async ({ page }) => {
  const book = await A.makeEpub({ version: 2, opfDir: '', linearNo: [2], chapters: 3, cover: false });
  // um editor (opf:role="edt") não entra como autor
  const zip = await JSZip.loadAsync(book);
  const opf = (await zip.file('content.opf').async('string')).replace('</metadata>', '<dc:creator opf:role="edt">Editor Fulano</dc:creator><dc:creator opf:role="aut">Autora Beltrana</dc:creator></metadata>');
  zip.file('content.opf', opf);
  const buf = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
  const [out] = await run(page, 'e2p', [A.file('dois.epub', buf)]);
  expect(out.name).toBe('O Nome do Vento (Patrick Rothfuss, Autora Beltrana).pdf');
  const text = (await pdfText(page, out.buf)).join(' ');
  expect(text).toContain('Capítulo 1');
  expect(text).not.toContain('cap. 2,');   // capítulo fora da leitura linear
  expect(text).toContain('Capítulo 3');
});

test('sem título nos metadados: usa o nome do arquivo', async ({ page }) => {
  const book = await A.makeEpub({ title: '', authors: [] });
  const [out] = await run(page, 'e2p', [A.file('meu livro favorito.epub', book)]);
  expect(out.name).toBe('Meu Livro Favorito.pdf');
});

test('lote: vários livros, nomes repetidos ganham (2), ZIP com todos', async ({ page }) => {
  const a = await A.makeEpub({ title: 'Mesmo Livro', authors: ['A'] });
  const outs = await run(page, 'e2p', [A.file('b.epub', a), A.file('a.epub', a), A.file('c.epub', await A.makeEpub({ title: 'Outro' }))]);
  expect(outs.map(o => o.name).sort()).toEqual(['Mesmo Livro (A) (2).pdf', 'Mesmo Livro (A).pdf', 'Outro (Patrick Rothfuss).pdf']);
  await expect(page.locator('#sepBtn')).toHaveText('Baixar todos os PDFs (sem ZIP)');
  await expect(page.locator('#fname')).toHaveText('3 arquivos selecionados');
  const [zip] = await download(page, '#zipBtn');
  expect(zip.name).toBe('PDFs (3 livros).zip');
  const z = await JSZip.loadAsync(zip.buf);
  expect(Object.keys(z.files).sort()).toEqual(outs.map(o => o.name).sort());
  // a ordem da fila é a dos nomes (numérica)
  await expect(page.locator('#list li .n').first()).toHaveText('Mesmo Livro (A).pdf');
});

test('erros: arquivo que não é EPUB, sem container.xml, spine vazio e sem texto', async ({ page }) => {
  const noContainer = new JSZip(); noContainer.file('mimetype', 'application/epub+zip'); noContainer.file('x.txt', 'oi');
  const empty = await A.makeEpub({ chapters: [] });
  const noText = await A.makeEpub({ chapters: ['<p><img src="../img/capa.png"/></p>'], cover: false, images: { 'img/capa.png': A.ICON } });
  const files = [
    A.file('1 quebrado.epub', Buffer.from('isto não é um zip')),
    A.file('2 sem container.epub', Buffer.from(await noContainer.generateAsync({ type: 'uint8array' }))),
    A.file('3 vazio.epub', empty),
    A.file('4 sem texto.epub', noText),
    await epub({}, '5 bom.epub'),
  ];
  await open(page, 'e2p');
  await page.setInputFiles('#file', files);
  await page.click('#go');
  await expect(page.locator('#status')).toHaveText('Pronto: 1 convertido(s), 4 com erro. Toque em baixar.');
  const st = page.locator('#list .s');
  await expect(st.nth(0)).toHaveText(/^Erro:/);
  await expect(st.nth(1)).toHaveText('Erro: Não parece um EPUB válido (sem container.xml).');
  await expect(st.nth(2)).toHaveText('Erro: EPUB sem conteúdo no spine.');
  await expect(st.nth(3)).toHaveText('Erro: Não consegui extrair texto do EPUB.');
  await expect(st.nth(4)).toHaveClass(/ok/);
  await expect(page.locator('#go')).toBeEnabled();
});

test('margens e posição do texto seguem as opções (em mm)', async ({ page }) => {
  const [out] = await run(page, 'e2p', [await epub({ chapters: 1, cover: false })], {
    setup: async p => { await p.fill('#ms', '40'); await p.fill('#mt', '30'); },
  });
  const left = await page.evaluate(async b64 => {
    window.__converterias.initPdfjs();
    const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    return Math.min(...tc.items.filter(i => i.str.trim()).map(i => i.transform[4]));
  }, out.buf.toString('base64'));
  expect(left).toBeGreaterThanOrEqual(40 * MM - 0.5);
  expect(left).toBeLessThan(40 * MM + 60);   // o título é centralizado; o texto começa na margem
});

test('marcadores do PDF a partir do sumário do livro (nav), cada um na página do capítulo; números de página no rodapé', async ({ page }) => {
  const longo = '<h1>Capítulo Longo</h1>' + '<p>Texto corrido para encher mais de uma página do PDF, com frases que se repetem.</p>'.repeat(60);
  const [out] = await run(page, 'e2p', [await epub({ chapters: [A.RICH_CHAPTER, longo, '<h1>Três</h1><p>fim</p>'] })]);
  const pdf = await readPdf(out.buf);
  expect(pdf.outline.map(o => o.title)).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  expect(pdf.outline[0].items.map(o => o.title)).toEqual(['Seção 1.1']);
  const [c1, c2, c3] = pdf.outline.map(o => o.page);
  expect(c1).toBe(1);                                                // depois da capa
  expect(c2).toBeGreaterThan(c1);
  expect(c3).toBeGreaterThan(c2 + 1);                                // o capítulo 2 ocupa mais de uma página
  expect(c3).toBe(pdf.pages - 1);
  expect(pdf.outline[0].items[0].page).toBeGreaterThanOrEqual(c1);
  const text = await pdfText(page, out.buf);
  expect(text[0]).not.toMatch(/\d\s*$/);                             // a capa não tem número
  expect(text[1]).toMatch(/\s1$/);
  expect(text[c3]).toMatch(new RegExp(`\\s${c3}$`));
});

test('marcadores pelo toc.ncx (EPUB 2) e, sem sumário nenhum, pelos títulos; números de página desligáveis', async ({ page }) => {
  const [a] = await run(page, 'e2p', [await epub({ version: 2, nav: false, ncx: true, chapters: 2, cover: false })]);
  const pa = await readPdf(a.buf);
  expect(pa.outline.map(o => [o.title, o.page])).toEqual([['Capítulo 1', 0], ['Capítulo 2', 1]]);
  const [b] = await run(page, 'e2p', [await epub({ nav: false, cover: false, chapters: ['<h1>Primeiro</h1><h2>Parte A</h2><p>texto</p>', '<h1>Segundo</h1><p>texto</p>'] })],
    { setup: p => p.uncheck('#pnum') });
  const pb = await readPdf(b.buf);
  expect(pb.outline.map(o => [o.title, o.page, o.items.map(i => i.title)])).toEqual([['Primeiro', 0, ['Parte A']], ['Segundo', 1, []]]);
  const text = await pdfText(page, b.buf);
  expect(text[0]).not.toMatch(/\s1$/);
});

test('marcadores para âncoras dentro do mesmo arquivo (EPUB gerado pelo PDF → EPUB, capítulos num arquivo só)', async ({ page }) => {
  const [ep] = await run(page, 'p2e', [A.file('livro.pdf', await A.makeTextPdf({ chapters: 3, paras: [A.LOREM.join(' ').repeat(4), A.LOREM.join(' ').repeat(4)] }))]);
  const [out] = await run(page, 'e2p', [A.file(ep.name, ep.buf, 'application/epub+zip')]);
  const pdf = await readPdf(out.buf);
  expect(pdf.outline.map(o => o.title)).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  const pg = pdf.outline.map(o => o.page);
  expect(pg[1]).toBeGreaterThan(pg[0]);
  expect(pg[2]).toBeGreaterThan(pg[1]);
  const text = await pdfText(page, out.buf);
  for (const [k, p] of pg.entries()) expect(text[p]).toContain(`Capítulo ${k + 1}`);
  expect(pdf.title).toBe('Livro de Teste');
});
