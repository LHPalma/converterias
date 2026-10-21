// Imagens → PDF e PDF → Imagens.
const { test, expect, open, run, download } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readPdf } = require('../apoio/leitores');
const JSZip = require('../../vendor/jszip.min.js');

const png = (name, buf = A.ICON) => A.file(name, buf, 'image/png');
const pngSize = b => [b.readUInt32BE(16), b.readUInt32BE(20)];
const jpegSize = b => { for (let i = 2; i < b.length;) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; } };

test('Imagens → PDF: uma por página, em A4, na ordem da lista, com título', async ({ page }) => {
  const [out] = await run(page, 'i2p', [png('b.png'), png('a.png'), png('c.png')], { setup: p => p.fill('#iTitle', 'Fotos da Viagem') });
  expect(out.name).toBe('Fotos da Viagem.pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.pages).toBe(3);
  expect(pdf.title).toBe('Fotos da Viagem');
  expect(pdf.sizes[0].width).toBeCloseTo(595.28, 0);
  expect(pdf.images).toEqual([1, 1, 1]);
  await expect(page.locator('#go')).toHaveText('Criar PDF');
  await expect(page.locator('#list .th')).toHaveCount(3);   // miniaturas
  await expect(page.locator('#list .s.ok').first()).toHaveText('✓ 192×192');
  await expect(page.locator('#status')).toHaveText(/^Pronto: 3 imagens em um PDF/);
});

test('Imagens → PDF: tamanhos (Carta, do tamanho da imagem), margens e orientação acompanhando a imagem', async ({ page }) => {
  const wide = await A.drawImage(page, { w: 400, h: 200, type: 'image/png' });
  let pdf = await readPdf((await run(page, 'i2p', [png('largo.png', wide)], { setup: p => p.selectOption('#iSize', 'letter') }))[0].buf);
  expect(pdf.sizes[0].width).toBeCloseTo(792, 0);   // paisagem: a página gira junto
  expect(pdf.sizes[0].height).toBeCloseTo(612, 0);
  pdf = await readPdf((await run(page, 'i2p', [png('largo.png', wide)], { setup: async p => { await p.selectOption('#iSize', 'fit'); await p.selectOption('#iMargin', '10'); } }))[0].buf);
  expect(pdf.sizes[0].width).toBeCloseTo(400 * 0.75 + 2 * 10 * 72 / 25.4, 1);
  expect(pdf.sizes[0].height).toBeCloseTo(200 * 0.75 + 2 * 10 * 72 / 25.4, 1);
});

test('Imagens → PDF: JPEG com EXIF girado, PNG transparente, WebP, GIF e BMP', async ({ page }) => {
  const jpg = await A.drawImage(page, { w: 300, h: 100, type: 'image/jpeg' });
  const files = [
    A.file('1 exif.jpg', A.withExif(jpg, 6), 'image/jpeg'),           // girada 90°: vira retrato
    A.file('2 exif-le.jpg', A.withExif(jpg, 8, true), 'image/jpeg'),
    A.file('3 normal.jpg', A.withExif(jpg, 1), 'image/jpeg'),
    png('4 alpha.png', await A.drawImage(page, { w: 120, h: 120, alpha: true, draw: 'circle' })),
    A.file('5 foto.webp', await A.drawImage(page, { type: 'image/webp' }), 'image/webp'),
    A.file('6 anim.gif', A.GIF_1x1, 'image/gif'),
    A.file('7 bitmap.bmp', A.bmp(40, 30), 'image/bmp'),
  ];
  const [out] = await run(page, 'i2p', files, { setup: p => p.selectOption('#iSize', 'fit') });
  const pdf = await readPdf(out.buf);
  expect(pdf.pages).toBe(7);
  const wh = pdf.sizes.map(s => [Math.round(s.width / 0.75), Math.round(s.height / 0.75)]);
  expect(wh).toEqual([[100, 300], [100, 300], [300, 100], [120, 120], [200, 120], [1, 1], [40, 30]]);
  expect(out.name).toBe('1 Exif (+6).pdf');   // sem título e sem começo comum nos nomes: o primeiro (+n)
});

test('Imagens → PDF: arquivo que não é imagem dá erro', async ({ page }) => {
  await run(page, 'i2p', [png('ok.png'), A.file('texto.png', Buffer.from('não sou imagem'), 'image/png')], { expectError: 'Erro: texto.png: formato de imagem que o navegador não abre.' });
});

test('PDF → Imagens: PNG por página, só as páginas pedidas, na resolução pedida', async ({ page }) => {
  const outs = await run(page, 'p2i', [A.file('doc.pdf', await A.makeNumberedPdf(12))], {
    setup: async p => { await p.selectOption('#xDpi', '72'); await p.fill('#xPages', '2-3, 11-'); },
  });
  expect(outs.map(o => o.name)).toEqual(['doc - 02.png', 'doc - 03.png', 'doc - 11.png', 'doc - 12.png']);   // zeros à esquerda conforme o total
  for (const o of outs) expect(pngSize(o.buf)).toEqual([300, 400]);   // 300×400 pt a 72 dpi
  await expect(page.locator('#status')).toHaveText('Pronto: 4 imagens. Toque em baixar.');
  const [zip] = await download(page, '#zipBtn');
  expect(zip.name).toBe('Imagens (4).zip');
  expect(Object.keys((await JSZip.loadAsync(zip.buf)).files)).toEqual(outs.map(o => o.name));
});

test('PDF → Imagens: JPEG a 150 dpi, vários PDFs com o mesmo nome', async ({ page }) => {
  const outs = await run(page, 'p2i', [A.file('x.pdf', await A.makeNumberedPdf(1)), A.file('x.pdf', await A.makeNumberedPdf(1))], { setup: p => p.selectOption('#xFmt', 'jpg') });
  expect(outs.map(o => o.name)).toEqual(['x - 1.jpg', 'x (2) - 1.jpg']);
  expect(jpegSize(outs[0].buf)).toEqual([625, 834]);   // 300×400 pt a 150 dpi (arredondado para cima)
});

test('PDF → Imagens: páginas inválidas ou fora do PDF dão erro; PDF ilegível também', async ({ page }) => {
  const doc = A.file('doc.pdf', await A.makeNumberedPdf(3));
  await run(page, 'p2i', [doc], { setup: p => p.fill('#xPages', 'abc'), expectError: 'Erro: Páginas inválidas: "abc". Use algo como 1-5, 8, 10-12.' });
  await run(page, 'p2i', [doc], { setup: p => p.fill('#xPages', '7-9'), expectError: 'Erro: Esse PDF tem 3 página(s); nenhuma cai em "7-9".' });
  await run(page, 'p2i', [A.file('ruim.pdf', Buffer.from('%PDF quebrado'))], { setup: p => p.fill('#xPages', ''), expectError: 'Erro: ruim.pdf: não consegui ler este PDF.' });
  await run(page, 'p2i', [A.file('senha.pdf', await A.makeEncryptedPdf())], { expectError: 'Erro: senha.pdf: PDF protegido por senha.' });
  // um bom e um ruim: as imagens já prontas continuam disponíveis
  await run(page, 'p2i', [doc, A.file('z.pdf', Buffer.from('%PDF quebrado'))], { expectError: /^Erro: z\.pdf: não consegui ler este PDF\.\. 3 imagem\(ns\) já pronta\(s\)/ });
  await expect(page.locator('#outBtns')).toBeVisible();
});
