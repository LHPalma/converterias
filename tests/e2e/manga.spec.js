// Mangá: PDF de páginas escaneadas → AZW3 de layout fixo (páginas em cinza no tamanho da tela, quadros ampliáveis).
const { test, expect, open, run } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readAzw3 } = require('../apoio/leitores');

const imgSize = b => b[0] === 0x89 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : (() => { for (let i = 2; i < b.length;) { const m = b[i + 1], len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + len; } })();
const manga = async (page, buf, setup, name = 'volume 1.pdf') => {
  const [out] = await run(page, 'manga', [A.file(name, buf, 'application/pdf')], { setup: async p => { await p.click('.tabs button[data-mode="manga"]'); if (setup) await setup(p); } });
  return { ...out, book: readAzw3(out.buf) };
};
const pages = (k) => k.resources.filter(r => r[0] === 0x89 || r[0] === 0xff).slice(0, -1);   // a última é a miniatura da capa

test('layout fixo: uma página de imagem por página do PDF, no tamanho da tela, da direita para a esquerda', async ({ page }) => {
  const comic = await A.comicPage(page);
  const { name, book: k } = await manga(page, await A.makeImagePdf([comic, comic, comic], { size: [400, 600] }), p => p.selectOption('#mPanels', '0'));
  expect(name).toBe('Volume 1.azw3');
  expect(k.exth).toMatchObject({ 122: 'true', 123: 'comic', 124: 'portrait', 126: '1072x1448', 127: 'true', 128: 'true', 132: 'false', 527: 'rtl', 525: 'horizontal-rl' });
  expect(k.files).toHaveLength(3);
  for (const f of k.files) {
    expect(f).toContain('<meta name="viewport" content="width=1072, height=1448"/>');
    expect(f).toMatch(/<img src="kindle:embed:[0-9A-V]{4}\?mime=image\/jpeg" alt="" class="pg" style="top:\d+px; left:\d+px; width:\d+px; height:\d+px"\/>/);
  }
  for (const r of pages(k)) { const [w, h] = imgSize(r); expect(w <= 1072 && h <= 1448 && (w === 1072 || h === 1448)).toBe(true); }
  await expect(page.locator('#list .s.ok')).toHaveText(/✓ 3 páginas · /);
});

test('aparelho, sentido de leitura, PNG e contraste', async ({ page }) => {
  const comic = await A.comicPage(page);
  const { book: k } = await manga(page, await A.makeImagePdf([comic], { size: [400, 600], title: 'Título Interno', author: 'Mangaká' }), async p => {
    await p.selectOption('#mDev', 'ks'); await p.selectOption('#mDir', 'ltr'); await p.check('#mPng'); await p.check('#mLevel');
  }, 'arquivo.pdf');
  expect(k.title).toBe('Título Interno');   // o título de dentro do PDF vale mais que o nome do arquivo
  expect(k.exth[100]).toBe('Mangaká');
  expect(k.exth[126]).toBe('1860x2480');
  expect(k.exth[527]).toBe('ltr');
  const [img] = pages(k);
  expect(img[0]).toBe(0x89);
  const [w, h] = imgSize(img);
  expect(w === 1860 || h === 2480).toBe(true);
});

test('página dupla é partida em duas, na ordem de leitura; sem partir, fica inteira', async ({ page }) => {
  const dbl = await A.comicPage(page, { w: 1600, h: 1100, double: true });
  const pdf = await A.makeImagePdf([dbl], { size: [800, 550] });
  const split = (await manga(page, pdf)).book;
  expect(split.files).toHaveLength(2);
  const whole = (await manga(page, pdf, p => p.uncheck('#mSplit'))).book;
  expect(whole.files).toHaveLength(1);
  const [w, h] = imgSize(pages(whole)[0]);
  expect(w).toBe(1072); expect(h).toBeLessThan(1448);   // paisagem dentro da tela em pé
});

test('aparar margens: com moldura branca, a página aparada fica maior na tela', async ({ page }) => {
  const small = await page.evaluate(() => {   // quadrinho pequeno no meio de muito branco
    const cv = document.createElement('canvas'); cv.width = 800; cv.height = 1200;
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 800, 1200);
    c.fillStyle = '#000'; c.fillRect(300, 300, 300, 500); return cv.toDataURL('image/png').split(',')[1];
  });
  const pdf = await A.makeImagePdf([Buffer.from(small, 'base64')], { size: [400, 600] });
  const area = k => { const [w, h] = imgSize(pages(k)[0]); return [w, h]; };
  const crop = area((await manga(page, pdf)).book), nocrop = area((await manga(page, pdf, p => p.uncheck('#mCrop'))).book);
  expect(nocrop).toEqual([965, 1448]);   // a página inteira, na proporção 2:3
  expect(crop[1]).toBe(1448);
  expect(crop[0]).toBeLessThan(nocrop[0]);   // só o conteúdo (mais estreito que a página)
});

test('Panel View: 2 ou 4 regiões ampliáveis por página', async ({ page }) => {
  const comic = await A.comicPage(page);
  const pdf = await A.makeImagePdf([comic], { size: [400, 600] });
  const four = (await manga(page, pdf, p => p.selectOption('#mPanels', '4'))).book;
  expect(four.exth[132]).toBe('true');
  expect(four.files[0]).toContain('class="app-amzn-magnify"');
  const f4 = four.files[0].replace(/&quot;/g, '"');
  for (const id of ['PV-TL', 'PV-TR', 'PV-BL', 'PV-BR']) expect(f4).toMatch(new RegExp(`<div class="PV-P" id="${id}-P" aid="[0-9A-V]+"><img style="position:absolute;`));
  expect(f4).toContain('"targetId":"PV-TR-P", "ordinal":1');   // mangá (direita→esquerda): o quadrante da direita vem primeiro
  expect(f4).toContain('"targetId":"PV-TL-P", "ordinal":2');
  expect(four.css[0]).toContain('#PV-TL {');
  const two = (await manga(page, pdf, p => p.selectOption('#mPanels', '2'))).book;
  expect(two.files[0]).toContain('id="PV-T-P"');
  expect(two.files[0]).toContain('id="PV-B-P"');
  const none = (await manga(page, pdf, p => p.selectOption('#mPanels', '0'))).book;
  expect(none.exth[132]).toBe('false');
  expect(none.files[0]).not.toContain('app-amzn-magnify');
});

const areas = f => [...f.matchAll(/<div id="(PV\d+)" style="position:absolute;left:([\d.]+)%;top:([\d.]+)%/g)].map(m => [+m[2], +m[3]]);

test('Panel View automático (padrão): quadros detectados, na ordem de leitura do mangá', async ({ page }) => {
  const comic = await A.comicPage(page, { layout: [[0.6, 0.4], [1], [0.35, 0.65]] });
  const { book: k } = await manga(page, await A.makeImagePdf([comic, comic], { size: [400, 600] }));
  expect(k.exth[132]).toBe('true');
  const a = areas(k.files[0]);
  expect(a).toHaveLength(5);
  // fileiras de cima para baixo; em cada fileira, da direita para a esquerda
  expect(a[0][0]).toBeGreaterThan(a[1][0]); expect(a[0][1]).toBeCloseTo(a[1][1], 0);
  expect(a[2][1]).toBeGreaterThan(a[0][1]);
  expect(a[3][0]).toBeGreaterThan(a[4][0]); expect(a[3][1]).toBeGreaterThan(a[2][1]);
  await expect(page.locator('#list .s.ok')).toHaveText(/quadrinhos detectados em 2/);
  // da esquerda para a direita, a ordem dentro da fileira inverte
  const ltr = areas((await manga(page, await A.makeImagePdf([comic], { size: [400, 600] }), p => p.selectOption('#mDir', 'ltr'))).book.files[0]);
  expect(ltr[0][0]).toBeLessThan(ltr[1][0]);
});

test('4-koma: tiras verticais de alto a baixo são lidas uma de cada vez', async ({ page }) => {
  const koma = await A.comicPage(page, { koma: true });
  const a = areas((await manga(page, await A.makeImagePdf([koma], { size: [400, 600] }))).book.files[0]);
  expect(a).toHaveLength(8);
  const right = a.slice(0, 4), left = a.slice(4);
  expect(right.every(([x]) => x > 50)).toBe(true);   // a tira da direita inteira primeiro
  expect(left.every(([x]) => x < 50)).toBe(true);
  for (let k = 1; k < 4; k++) expect(right[k][1]).toBeGreaterThan(right[k - 1][1]);
});

test('página sem quadros (ilustração inteira) fica sem Panel View', async ({ page }) => {
  const k = (await manga(page, await A.makeImagePdf([A.ICON_BIG], { size: [400, 600] }))).book;
  expect(k.exth[132]).toBe('false');
  await expect(page.locator('#list .s.ok')).toHaveText(/^✓ 1 páginas · 0\.\d MB/);
});

test('PDF de texto corrido no Mangá: aviso de que a aba Para Kindle é melhor', async ({ page }) => {
  const text = await A.makeTextPdf({ chapters: 6, paras: [A.LOREM.join(' ').repeat(2)] });
  await manga(page, text);
  await expect(page.locator('#list .s.ok')).toHaveText(/parece texto corrido, não quadrinho/);
});

test('erros: arquivo que não é PDF e PDF ilegível', async ({ page }) => {
  await open(page, 'manga');
  await page.setInputFiles('#file', [A.file('a.epub', await A.makeEpub()), A.file('b.pdf', Buffer.from('%PDF-1.7 lixo'))]);
  await page.click('#go');
  await expect(page.locator('#list .s.err').nth(0)).toHaveText('Erro: a aba Mangá recebe PDF.');
  await expect(page.locator('#list .s.err').nth(1)).toHaveText('Erro: não consegui ler este PDF.');
});
