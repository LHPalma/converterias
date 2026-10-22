// Juntar: vários PDFs em um PDF (com marcadores) ou vários EPUBs em um EPUB (com sumário por livro).
const { test, expect, open, run } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readPdf, readEpub } = require('../apoio/leitores');
const JSZip = require('../../vendor/jszip.min.js');

test('PDFs: soma as páginas na ordem, um marcador por arquivo com os marcadores originais dentro', async ({ page }) => {
  const a = await A.makeNumberedPdf(2, { outline: [{ title: 'Introdução', page: 0, items: [{ title: 'Detalhe', page: 1, items: [] }] }] });
  const b = await A.makeNumberedPdf(3, { outline: [{ title: 'Nomeado', page: 2, named: 'destino-3', items: [] }] });
  const [out] = await run(page, 'merge', [A.file('Relatório parte 1.pdf', a), A.file('Relatório parte 2.pdf', b)]);
  expect(out.name).toBe('Relatório Parte.pdf');   // título: o começo comum dos nomes
  const pdf = await readPdf(out.buf);
  expect(pdf.pages).toBe(5);
  expect(pdf.title).toBe('Relatório Parte');   // no padrão do nome do arquivo
  expect(pdf.outline).toEqual([
    { title: 'Relatório parte 1', page: 0, items: [{ title: 'Introdução', page: 0, items: [{ title: 'Detalhe', page: 1, items: [] }] }] },
    { title: 'Relatório parte 2', page: 2, items: [{ title: 'Nomeado', page: 4, items: [] }] },
  ]);
  await expect(page.locator('#status')).toHaveText('Pronto: 2 PDFs juntados em um só (0.0 MB, 5 páginas). Toque em baixar.');
  await expect(page.locator('#list .s.ok').first()).toHaveText('✓ 2 páginas');
});

test('ordem da lista: escolher em várias vezes, subir, descer e remover', async ({ page }) => {
  await open(page, 'merge');
  await expect(page.locator('#go')).toHaveText('Juntar');
  await expect(page.locator('#go')).toBeDisabled();
  await page.setInputFiles('#file', [A.file('c.pdf', await A.makeNumberedPdf(3))]);
  await expect(page.locator('#go')).toBeDisabled();   // precisa de pelo menos dois
  await page.setInputFiles('#file', [A.file('a.pdf', await A.makeNumberedPdf(1)), A.file('b.pdf', await A.makeNumberedPdf(2))]);
  await expect(page.locator('#list li .n')).toHaveText(['c.pdf', 'a.pdf', 'b.pdf']);   // acumula, na ordem das escolhas
  await expect(page.locator('#list li .s').first()).toHaveText(/^1º · /);
  await page.locator('#list li').nth(0).locator('[data-d="1"]').click();    // c desce
  await expect(page.locator('#list li .n')).toHaveText(['a.pdf', 'c.pdf', 'b.pdf']);
  await page.locator('#list li').nth(2).locator('[data-d="-1"]').click();   // b sobe
  await expect(page.locator('#list li .n')).toHaveText(['a.pdf', 'b.pdf', 'c.pdf']);
  await expect(page.locator('#list li').nth(0).locator('[data-d="-1"]')).toBeDisabled();
  await expect(page.locator('#list li').nth(2).locator('[data-d="1"]')).toBeDisabled();
  await page.locator('#list li').nth(1).locator('[data-d="0"]').click();    // remove b
  await expect(page.locator('#list li .n')).toHaveText(['a.pdf', 'c.pdf']);
  await page.fill('#mTitle', 'Coletânea');
  await page.click('#go');
  await expect(page.locator('#status')).toHaveText(/^Pronto/);
  const pdf = await readPdf((await require('../apoio/app').download(page, '#sepBtn'))[0].buf);
  expect(pdf.pages).toBe(4);
  expect(pdf.title).toBe('Coletânea');
  expect(pdf.outline.map(o => [o.title, o.page])).toEqual([['a', 0], ['c', 1]]);
});

test('erros: misturar PDF com EPUB, arquivo estranho e PDF protegido', async ({ page }) => {
  await run(page, 'merge', [A.file('a.pdf', await A.makeNumberedPdf(1)), A.file('b.epub', await A.makeEpub())], { expectError: 'Erro: b.epub: misturar PDF e EPUB não dá. Escolha só PDFs.' });
  await page.reload();
  await run(page, 'merge', [A.file('x.txt', Buffer.from('olá')), A.file('y.txt', Buffer.from('mundo'))], { expectError: 'Erro: x.txt: não é PDF nem EPUB.' });
  await page.reload();
  await run(page, 'merge', [A.file('a.pdf', await A.makeNumberedPdf(1)), A.file('senha.pdf', await A.makeEncryptedPdf())], { expectError: 'Erro: senha.pdf: PDF protegido por senha.' });
  await expect(page.locator('#go')).toBeEnabled();
});

test('EPUBs: um livro com os arquivos de todos, sumário por livro e capa do primeiro', async ({ page }) => {
  const a = await A.makeEpub({ title: 'Volume Um', authors: ['Ana'], chapters: 2 });
  const b = await A.makeEpub({ title: 'Volume Dois', authors: ['Ana', 'Bia'], version: 2, chapters: 2, cover: false, lang: 'en' });
  const [out] = await run(page, 'merge', [A.file('v1.epub', a), A.file('v2.epub', b)], { setup: p => p.fill('#mTitle', 'Coleção Completa') });
  expect(out.name).toBe('Coleção Completa (Ana, Bia).epub');
  const ep = await readEpub(out.buf);
  expect(ep.mimetypeFirst).toBe(true);
  expect(ep.missing).toEqual([]);
  expect(ep.title).toBe('Coleção Completa');
  expect(ep.creators).toEqual(['Ana', 'Bia']);
  expect(ep.lang).toBe('pt');   // idioma do primeiro
  expect(ep.spine).toEqual(['b1_c1', 'b1_c2', 'b2_c1', 'b2_c2']);
  expect(ep.navTitles).toEqual(['Volume Um', 'Capítulo 1', 'Seção 1.1', 'Capítulo 2', 'Volume Dois', 'Capítulo 1', 'Capítulo 2']);
  expect(ep.opf).toContain('<meta name="cover" content="b1_capa"/>');
  expect(ep.opf).toMatch(/id="b1_capa"[^>]*properties="cover-image"/);
  // EPUB 2: o DOCTYPE do XHTML 1.1 vira o do EPUB 3
  const v2 = ep.spineHtml[2];
  expect(v2).toContain('<!DOCTYPE html>');
  expect(v2).not.toContain('XHTML 1.1');
  expect(ep.text).toContain('Era uma vez um conversor');
  await expect(page.locator('#list .s.ok').first()).toHaveText('✓ 2 seções');
});

for (const prefix of [true, false]) {
  test(`EPUBs: fonte ofuscada (IDPF) é desofuscada — encryption.xml ${prefix ? 'com prefixo enc:' : 'com namespace padrão'}`, async ({ page }) => {
    const uid = 'urn:uuid:aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
    const a = await A.makeEpub({ uid, fonts: { 'fontes/f.ttf': A.idpfObfuscate(A.FAKE_TTF, uid) }, encryption: A.encryptionXml('OEBPS/fontes/f.ttf', undefined, prefix) });
    const [out] = await run(page, 'merge', [A.file('a.epub', a), A.file('b.epub', await A.makeEpub({ title: 'B' }))]);
    const ep = await readEpub(out.buf);
    expect((await ep.file('b1/OEBPS/fontes/f.ttf')).equals(A.FAKE_TTF)).toBe(true);
    expect(ep.names).not.toContain('META-INF/encryption.xml');
  });

  test(`EPUBs: DRM de verdade dá erro — encryption.xml ${prefix ? 'com prefixo enc:' : 'com namespace padrão'}`, async ({ page }) => {
    const drm = await A.makeEpub({ encryption: A.encryptionXml('OEBPS/texto/c1.xhtml', 'http://www.w3.org/2001/04/xmlenc#aes128-cbc', prefix) });
    await run(page, 'merge', [A.file('drm.epub', drm), A.file('b.epub', await A.makeEpub())], { expectError: 'Erro: drm.epub: EPUB com proteção (DRM): não dá para juntar.' });
  });
}

test('EPUBs: svg, mathml e script ganham as properties do EPUB 3', async ({ page }) => {
  const a = await A.makeEpub({ chapters: ['<h1>SVG</h1><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg><p>texto</p>', '<h1>Mat</h1><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math><script>1</script>'] });
  const ep = await readEpub((await run(page, 'merge', [A.file('a.epub', a), A.file('b.epub', await A.makeEpub({ title: 'B' }))]))[0].buf);
  expect(ep.opf).toMatch(/id="b1_c1"[^>]*properties="svg"/);
  expect(ep.opf).toMatch(/id="b1_c2"[^>]*properties="mathml scripted"/);
});

test('EPUBs quebrados dão erro', async ({ page }) => {
  const noOpf = new JSZip(); noOpf.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="nada.opf"/></rootfiles></container>');
  const bufNoOpf = Buffer.concat([Buffer.from('PK'), Buffer.from(await noOpf.generateAsync({ type: 'uint8array' })).subarray(2)]);
  await run(page, 'merge', [A.file('a.epub', await A.makeEpub()), A.file('sem opf.epub', bufNoOpf)], { expectError: 'Erro: sem opf.epub: EPUB sem arquivo de pacote (.opf).' });
  await page.reload();
  await run(page, 'merge', [A.file('a.epub', await A.makeEpub()), A.file('vazio.epub', await A.makeEpub({ chapters: [] }))], { expectError: 'Erro: vazio.epub: EPUB sem conteúdo no spine.' });
  await page.reload();
  await run(page, 'merge', [A.file('a.epub', await A.makeEpub()), A.file('pk.epub', Buffer.from('PK nada'))], { expectError: 'Erro: pk.epub: não consegui abrir este EPUB.' });
});

test('título sem nada em comum nos nomes: o primeiro nome + quantos mais', async ({ page }) => {
  const [out] = await run(page, 'merge', [A.file('abc.pdf', await A.makeNumberedPdf(1)), A.file('xyz.pdf', await A.makeNumberedPdf(1))]);
  expect(out.name).toBe('Abc (+1).pdf');
});
