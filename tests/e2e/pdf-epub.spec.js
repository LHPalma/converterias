// PDF → EPUB: o PDF só guarda letras posicionadas; o app reconstrói parágrafos, títulos, notas, figuras e o sumário.
const { test, expect, open, run } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readEpub } = require('../apoio/leitores');
const { PDFDocument, StandardFonts } = require('../../vendor/pdf-lib.min.js');

const T = 'Este parágrafo tem frases suficientes para ocupar várias linhas da página, como num livro de verdade, e assim o conversor consegue medir a margem, o recuo e o espaçamento das linhas.';
const pdfFile = (buf, name = 'livro.pdf') => A.file(name, buf, 'application/pdf');
const convert = async (page, buf, o = {}) => readEpub((await run(page, 'p2e', [pdfFile(buf, o.name)], o))[0].buf);

test('texto simples: parágrafos remontados, títulos e metadados', async ({ page }) => {
  const ep = await convert(page, await A.makeTextPdf({ title: 'Livro de Teste', author: 'Fulana de Tal', chapters: 2 }));
  expect(ep.mimetypeFirst).toBe(true);
  expect(ep.missing).toEqual([]);
  expect(ep.title).toBe('Livro de Teste');
  expect(ep.creators).toEqual(['Fulana de Tal']);   // autores passam pelo Title Case dos nomes (preposição minúscula)
  expect(ep.html).toMatch(/<h1[^>]*>Capítulo 1<\/h1>/);
  expect(ep.text).toContain(A.LOREM[0]);              // linhas quebradas voltam a ser um parágrafo só
  expect(ep.navTitles).toEqual(['Capítulo 1', 'Capítulo 2']);
  expect(ep.lang).toBe('pt');
  expect(ep.opf).toContain('properties="cover-image"');   // 1ª página como capa (padrão)
  await expect(page.locator('#list .s.ok')).toHaveText(/✓ \d+ capítulos? · /);
});

test('livro completo: marcadores, nota de rodapé, itálico, lista, citação, código, figura, tabela, colunas e página escaneada', async ({ page }) => {
  const ep = await convert(page, await A.makeBookPdf({ twoCols: true, scannedPage: true, rotatedPage: true }));
  expect(ep.title).toBe('Um Livro Completo');
  expect(ep.creators).toEqual(['Maria Silva', 'João Souza']);   // "Silva, Maria; João Souza"
  expect(ep.navTitles).toEqual(['Capítulo 1', 'Primeira Seção', 'Capítulo 2', 'Capítulo 3']);
  expect(ep.nav).toMatch(/<li><a href="[^"]+">Capítulo 1<\/a><ol><li><a href="[^"]+#p1">Primeira Seção<\/a><\/li><\/ol><\/li>/);
  const h = ep.html;
  expect(h).toMatch(/<h1 id="p0">Capítulo 1<\/h1>/);
  // nota: o número sobrescrito vira link para a nota, que vai para o fim do arquivo
  expect(h).toMatch(/fim da frase\.<a epub:type="noteref" class="noteref" id="r-nt1" href="#nt1"><sup>1<\/sup><\/a>/);
  expect(h).toContain('<aside epub:type="footnote" id="nt1"><p><a href="#r-nt1">1</a> Esta é a nota de rodapé, em letra menor.</p></aside>');
  expect(h).toContain('<i>Uma frase inteira em itálico, sozinha na linha.</i>');
  expect(h).toContain('<h2>Negrito Isolado</h2>');
  expect(h).toContain('Este texto tem uma palavra com hifenização no fim da linha');          // hífen de fim de linha desfeito
  expect(h).toContain('acentos soltos: então, coração, informações e não.');                 // acentos do TeX recompostos
  expect(h).toContain('<p class="l">• segundo item da lista</p>');
  expect(h).toContain('<p class="q">Uma citação recuada dos dois lados');
  expect(h).toContain('<pre><code>function soma(a, b) {\n  return a + b;\n}</code></pre>');
  expect(h).toMatch(/<div class="fig"><img src="img\/p\d+-1\.jpg"/);
  expect(h).toMatch(/<table>.*<td>Revista<\/td><td>5,50<\/td><td>10<\/td><\/tr>/s);
  expect(h).toMatch(/<div class="pg"><img src="img\/p\d+\.jpg"/);                             // página só de imagem
  expect(h).toContain('Texto girado noventa graus na linha a');                                  // página em paisagem endireitada
  // coluna esquerda inteira antes da direita
  expect(h.indexOf('Coluna esquerda')).toBeLessThan(h.indexOf('Coluna direita'));
  expect(h.lastIndexOf('Coluna esquerda')).toBeLessThan(h.indexOf('Coluna direita'));
  // cabeçalho corrente e números de página saem
  expect(ep.text).not.toContain('UM LIVRO COMPLETO');
  expect(ep.text).not.toMatch(/\b(Parágrafo número \d+\.) \d{1,2} /);
  for (let n = 1; n <= 12; n++) expect(ep.text).toContain(`Parágrafo número ${n}.`);
  expect(ep.missing).toEqual([]);
  for (const m of ep.manifest.filter(x => /^img\//.test(x.href))) expect((await ep.file(m.href)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  await expect(page.locator('#list .s.ok')).toBeVisible();
});

test('opções: sem capa, sem imagens e mantendo cabeçalhos e rodapés', async ({ page }) => {
  const ep = await convert(page, await A.makeBookPdf({ chapters: 2 }), {
    setup: async p => { await p.click('.tabs button[data-mode="p2e"]'); await p.uncheck('#pCover'); await p.uncheck('#pImgs'); await p.uncheck('#pHf'); },
  });
  expect(ep.opf).not.toContain('cover-image');
  expect(ep.spine).not.toContain('capa');
  expect(ep.html).not.toContain('<img');
  expect(ep.manifest.some(m => /^img\//.test(m.href))).toBe(false);
  expect(ep.text).toContain('UM LIVRO COMPLETO');
});

test('sem marcadores: o sumário sai do sumário impresso, que some do texto', async ({ page }) => {
  const ep = await convert(page, await A.makeBookPdf({ outline: false, printedToc: true, chapters: 4 }));
  expect(ep.navTitles).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3', 'Capítulo 4']);
  expect(ep.text).not.toContain('......');
  expect(ep.text).not.toContain('Sumário');
});

test('sem marcadores nem sumário impresso: o sumário sai dos títulos', async ({ page }) => {
  const ep = await convert(page, await A.makeBookPdf({ outline: false, chapters: 3 }));
  // títulos do 1º nível no topo do sumário; os do 2º nível ("Negrito Isolado"…) ficam dentro deles
  expect(ep.navTitles.filter(t => /^Capítulo/.test(t))).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  expect(ep.nav).toMatch(/<li><a href="[^"]+">Capítulo 1<\/a><ol><li><a href="[^"]+">Negrito Isolado<\/a><\/li><\/ol><\/li>/);
});

test('título sem metadados: maior fonte da 1ª página quando o nome do arquivo não diz nada; senão, o nome', async ({ page }) => {
  const book = await A.makeTextPdf({ title: null, author: null, chapters: 2, heading: c => c === 1 ? 'A Grande Jornada' : 'Capítulo 2' });
  expect((await convert(page, book, { name: 'scan_001.pdf' })).title).toBe('A Grande Jornada');
  // "Capítulo…" não serve de título do livro
  expect((await convert(page, await A.makeTextPdf({ title: null, author: null }), { name: 'scan_001.pdf' })).title).toBe('scan 001');
  expect((await convert(page, book, { name: 'A_Arte_da_Guerra.pdf' })).title).toBe('A Arte da Guerra');
  const word = await A.makeTextPdf({ title: 'Microsoft Word - rascunho.docx', author: null, chapters: 1 });
  expect((await convert(page, word, { name: 'Meu Ensaio.pdf' })).title).toBe('Meu Ensaio');
});

test('idioma detectado pelo texto: inglês ganha lang="en" e sumário "Contents"', async ({ page }) => {
  const en = 'The quick brown fox jumps over the lazy dog and then it was said that all of them would have been there with the others.';
  const ep = await convert(page, await A.makeTextPdf({ paras: [en, en, en, en], chapters: 2 }));
  expect(ep.lang).toBe('en');
  expect(ep.nav).toContain('<h1>Contents</h1>');
});

test('PDF escaneado (só imagens): cada página vira imagem no EPUB', async ({ page }) => {
  const jpg = await A.drawImage(page, { w: 600, h: 900, type: 'image/jpeg' });
  const ep = await convert(page, await A.makeImagePdf([jpg, jpg, jpg], { size: [420, 630], title: 'Digitalizado' }));
  expect(ep.title).toBe('Digitalizado');
  expect((ep.html.match(/<div class="pg">/g) || []).length).toBe(2);   // a 1ª é a capa
  expect(ep.spine[0]).toBe('capa');
});

test('erros: não é PDF, PDF protegido por senha e PDF sem nada', async ({ page }) => {
  const blank = await PDFDocument.create(); blank.addPage([200, 200]);
  await open(page, 'p2e');
  await page.uncheck('#pCover');
  await page.setInputFiles('#file', [pdfFile(Buffer.from('%PDF-1.4 lixo'), '1.pdf'), pdfFile(await A.makeEncryptedPdf(), '2.pdf'), pdfFile(Buffer.from(await blank.save()), '3.pdf')]);
  await page.click('#go');
  await expect(page.locator('#status')).toHaveText(/Pronto: 0 convertido\(s\), 3 com erro/);
  const st = page.locator('#list .s');
  await expect(st.nth(0)).toHaveText('Erro: Não parece um PDF válido.');
  await expect(st.nth(1)).toHaveText('Erro: PDF protegido por senha.');
  await expect(st.nth(2)).toHaveText('Erro: Não encontrei texto nem imagens neste PDF.');
});

test('cancelar no meio de um lote', async ({ page }) => {
  const big = await A.makeBookPdf({ chapters: 12 });
  await open(page, 'p2e');
  await page.setInputFiles('#file', [pdfFile(big, 'a.pdf'), pdfFile(big, 'b.pdf'), pdfFile(big, 'c.pdf')]);
  await page.click('#go');
  await expect(page.locator('#cancel')).toBeVisible();
  await page.click('#cancel');
  await expect(page.locator('#status')).toHaveText(/^(Cancelado\.|Conversão cancelada\.)/);
  await expect(page.locator('#list .s.err').last()).toHaveText('Cancelado');
  await expect(page.locator('#cancel')).toBeHidden();
  await expect(page.locator('#go')).toBeEnabled();
});

test('títulos numerados e "Parte" abrindo arquivo próprio', async ({ page }) => {
  const pdf = await PDFDocument.create();
  const r = await pdf.embedFont(StandardFonts.TimesRoman), b = await pdf.embedFont(StandardFonts.TimesRomanBold);
  pdf.setTitle('Partes');
  for (let k = 1; k <= 3; k++) {
    const pg = pdf.addPage([420, 620]);
    pg.drawText(`PARTE ${['I', 'II', 'III'][k - 1]}`, { x: 170, y: 540, size: 16, font: b });
    pg.drawText(`1.${k} Seção ${['Origens', 'Meios', 'Fins'][k - 1]}`, { x: 50, y: 500, size: 11, font: b });
    let y = 470;
    for (let i = 0; i < 20; i++) { pg.drawText(T.slice(0, 70), { x: 50, y, size: 11, font: r }); y -= 15; }
  }
  const ep = await convert(page, Buffer.from(await pdf.save()));
  expect(ep.html).toMatch(/<h\d[^>]*>PARTE I<\/h\d>/);
  expect(ep.html).toMatch(/<h\d[^>]*>1\.2 Seção Meios<\/h\d>/);   // "1.2 Título" em negrito é título
  expect(ep.spineHtml.filter(x => /<h\d[^>]*>PARTE/.test(x)).length).toBe(3);   // "Parte" sempre abre arquivo novo
});
