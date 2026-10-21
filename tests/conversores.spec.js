// Ponta a ponta: cada aba do app recebe arquivos gerados na hora e a saída é aberta e conferida.
const { test, expect } = require('@playwright/test');
const { ICON, LOREM, makeEpub, makeTextPdf, makeNumberedPdf, makeImagePdf, readPdf, readEpub, readPalm } = require('./helpers');

const errors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const list = [];
  errors.set(page, list);
  page.on('pageerror', e => list.push(e.message));
  // o app baixa criando um <a download> e clicando nele: guarda nome e endereço de cada um
  await page.addInitScript(() => {
    window.__saved = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith('blob:')) { window.__saved.push({ name: this.download, href: this.href }); return; }
      return click.call(this);
    };
  });
  await page.goto('index.html');
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), 'erros de JavaScript na página').toEqual([]);
});

async function open(page, mode) {
  if (mode !== 'e2p') await page.click(`.tabs button[data-mode="${mode}"]`);
  await expect(page.locator(`.tabs button[data-mode="${mode}"]`)).toHaveClass(/on/);
}

/* escolhe os arquivos, toca em Converter e devolve as saídas baixadas: [{ name, buf }] */
async function run(page, mode, files, { setup, timeout } = {}) {
  await open(page, mode);
  if (setup) await setup(page);
  await page.setInputFiles('#file', files);
  await page.click('#go');
  await expect(page.locator('#status')).toHaveText(/^Pronto/, { timeout });
  await expect(page.locator('#status')).not.toHaveClass(/err/);
  return download(page, '#sepBtn');
}

async function download(page, button) {
  await page.evaluate(() => { window.__saved = []; });
  await page.click(button);
  await expect(page.locator(button)).toBeEnabled();   // "Baixar todos" baixa um por vez e só depois se libera
  const saved = await page.evaluate(() => Promise.all(window.__saved.map(async s => {
    const b = new Uint8Array(await (await fetch(s.href)).arrayBuffer());
    let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return { name: s.name, b64: btoa(bin) };
  })));
  return saved.map(s => ({ name: s.name, buf: Buffer.from(s.b64, 'base64') }));
}
const file = (name, buffer, mimeType) => ({ name, buffer, mimeType });

test('EPUB → PDF: diagrama o livro, preenche metadados e nomeia em Title Case', async ({ page }) => {
  const epub = await makeEpub({ title: 'o nome do vento', authors: ['Patrick Rothfuss'] });
  const [out] = await run(page, 'e2p', [file('livro.epub', epub, 'application/epub+zip')]);
  expect(out.name).toBe('O Nome do Vento (Patrick Rothfuss).pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.title.toLowerCase()).toBe('o nome do vento');
  expect(pdf.author).toBe('Patrick Rothfuss');
  expect(pdf.pages).toBeGreaterThanOrEqual(4);   // capa + 3 capítulos
  // capa em página cheia: a primeira página tem a proporção da imagem (quadrada)
  expect(pdf.sizes[0].width).toBeCloseTo(pdf.sizes[0].height, 0);
  // demais páginas em Carta (padrão)
  expect(pdf.sizes[1].width).toBeCloseTo(612, 0);
  expect(pdf.sizes[1].height).toBeCloseTo(792, 0);
});

test('EPUB → PDF: tamanho de página escolhido e capa desligada', async ({ page }) => {
  const epub = await makeEpub();
  const [out] = await run(page, 'e2p', [file('livro.epub', epub)], {
    setup: async p => { await p.selectOption('#size', { index: 0 }); await p.uncheck('#cover'); },
  });
  const pdf = await readPdf(out.buf);
  const sizes = new Set(pdf.sizes.map(s => `${Math.round(s.width)}x${Math.round(s.height)}`));
  expect(sizes.size).toBe(1);   // sem a página quadrada da capa
});

test('EPUB → PDF em lote: nomes repetidos ganham (2)', async ({ page }) => {
  const a = await makeEpub({ title: 'Mesmo Livro', authors: ['A'] });
  const outs = await run(page, 'e2p', [file('a.epub', a), file('b.epub', a)]);
  expect(outs.map(o => o.name).sort()).toEqual(['Mesmo Livro (A) (2).pdf', 'Mesmo Livro (A).pdf']);
  await expect(page.locator('#zipBtn')).toBeVisible();
});

test('EPUB → PDF: arquivo inválido vira erro na lista, sem travar o app', async ({ page }) => {
  await open(page, 'e2p');
  await page.setInputFiles('#file', [file('quebrado.epub', Buffer.from('isto não é um zip'))]);
  await page.click('#go');
  await expect(page.locator('#status')).toHaveText(/Pronto: 0 convertido\(s\), 1 com erro/);
  await expect(page.locator('#list .s.err')).toHaveText(/^Erro:/);
  await expect(page.locator('#go')).toBeEnabled();
});

test('PDF → EPUB: remonta capítulos, parágrafos e metadados', async ({ page }) => {
  const pdf = await makeTextPdf({ title: 'Livro de Teste', author: 'Fulana de Tal', chapters: 2 });
  const [out] = await run(page, 'p2e', [file('livro.pdf', pdf, 'application/pdf')]);
  expect(out.name).toMatch(/\.epub$/);
  const ep = await readEpub(out.buf);
  expect(ep.mimetypeFirst).toBe(true);
  expect(ep.title).toBe('Livro de Teste');
  expect(ep.creators).toEqual(['Fulana de Tal']);
  expect(ep.text).toContain('Capítulo 1');
  expect(ep.text).toContain('Capítulo 2');
  // as linhas quebradas voltam a ser um parágrafo só
  expect(ep.text).toContain('Era uma vez um conversor que rodava inteiro no navegador, sem mandar nada para servidor algum.');
  expect(ep.html).toMatch(/<h[1-3][^>]*>\s*Capítulo 1/);
});

test('Juntar PDFs: soma as páginas, na ordem, com um marcador por arquivo', async ({ page }) => {
  const a = await makeNumberedPdf(2), b = await makeNumberedPdf(3);
  const [out] = await run(page, 'merge', [file('parte 1.pdf', a), file('parte 2.pdf', b)]);
  const pdf = await readPdf(out.buf);
  expect(pdf.pages).toBe(5);
  expect(pdf.hasOutline).toBe(true);
});

test('Juntar EPUBs: um livro só com os capítulos de todos', async ({ page }) => {
  const a = await makeEpub({ title: 'Volume Um', chapters: 2 }), b = await makeEpub({ title: 'Volume Dois', chapters: 2 });
  const [out] = await run(page, 'merge', [file('v1.epub', a), file('v2.epub', b)], {
    setup: p => p.fill('#mTitle', 'Coleção Completa'),
  });
  expect(out.name).toMatch(/^Coleção Completa.*\.epub$/);
  const ep = await readEpub(out.buf);
  expect(ep.title).toBe('Coleção Completa');
  expect(ep.spine.length).toBeGreaterThanOrEqual(4);
  expect(ep.text).toContain('Volume Um');
  expect(ep.text).toContain('Volume Dois');
});

test('Juntar: misturar PDF e EPUB dá erro claro', async ({ page }) => {
  await open(page, 'merge');
  await page.setInputFiles('#file', [file('a.pdf', await makeNumberedPdf(1)), file('b.epub', await makeEpub())]);
  await page.click('#go');
  await expect(page.locator('#status')).toHaveText(/misturar PDF e EPUB não dá/);
});

test('Imagens → PDF: uma imagem por página, em A4', async ({ page }) => {
  const [out] = await run(page, 'i2p', [file('a.png', ICON, 'image/png'), file('b.png', ICON, 'image/png')], {
    setup: p => p.fill('#iTitle', 'Fotos'),
  });
  expect(out.name).toBe('Fotos.pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.pages).toBe(2);
  expect(pdf.sizes[0].width).toBeCloseTo(595.28, 0);
});

test('PDF → Imagens: PNG por página, só as páginas pedidas', async ({ page }) => {
  const outs = await run(page, 'p2i', [file('doc.pdf', await makeNumberedPdf(4))], {
    setup: async p => { await p.selectOption('#xDpi', '72'); await p.fill('#xPages', '2-3'); },
  });
  expect(outs.map(o => o.name).sort()).toEqual(['doc - 2.png', 'doc - 3.png']);   // zeros à esquerda conforme o total de páginas
  for (const o of outs) {
    expect(o.buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(o.buf.readUInt32BE(16)).toBe(300);   // 300 pt a 72 dpi = 300 px de largura
  }
});

test('Organizar PDF: remove, gira e reordena páginas', async ({ page }) => {
  await open(page, 'org');
  await page.setInputFiles('#file', [file('doc.pdf', await makeNumberedPdf(3))]);
  await expect(page.locator('#orgGrid .oc')).toHaveCount(3);
  await page.locator('#orgGrid .oc').nth(0).click();
  await page.click('#orgAct [data-org="del"]');                  // tira a página 1
  await expect(page.locator('#orgGrid .oc')).toHaveCount(2);
  await page.locator('#orgGrid .oc').nth(1).click();
  await page.click('#orgAct [data-org="cw"]');                   // gira a (antiga) página 3
  await page.click('[data-org="rev"]');                          // inverte a ordem: 3, 2
  await page.click('#orgSave');
  await expect(page.locator('#status')).toHaveText(/^Pronto: 2 páginas/);
  const [out] = await download(page, '#sepBtn');
  const pdf = await readPdf(out.buf);
  expect(pdf.pages).toBe(2);
  expect(pdf.rotations).toEqual([90, 0]);
});

test('Para Kindle (AZW3): EPUB vira KF8 válido', async ({ page }) => {
  const [out] = await run(page, 'kindle', [file('livro.epub', await makeEpub({ title: 'o nome do vento' }))]);
  expect(out.name).toBe('O Nome do Vento (Patrick Rothfuss).azw3');
  const h = readPalm(out.buf);
  expect(h.type).toBe('BOOKMOBI');
  expect(h.mobi).toBe('MOBI');
  expect(h.version).toBe(8);
  expect(h.nrec).toBeGreaterThan(5);
});

test('Para Kindle (KFX): EPUB vira contêiner CONT', async ({ page }) => {
  const [out] = await run(page, 'kindle', [file('livro.epub', await makeEpub())], {
    setup: p => p.selectOption('#kFmt', 'kfx'),
  });
  expect(out.name).toMatch(/\.kfx$/);
  expect(out.buf.toString('latin1', 0, 4)).toBe('CONT');
});

test('Para Kindle: PDF passa por EPUB e vira AZW3', async ({ page }) => {
  const [out] = await run(page, 'kindle', [file('livro.pdf', await makeTextPdf())]);
  expect(out.name).toMatch(/\.azw3$/);
  expect(readPalm(out.buf).type).toBe('BOOKMOBI');
});

test('Mangá: PDF de imagens vira AZW3 de layout fixo', async ({ page }) => {
  const pdf = await makeImagePdf([ICON, ICON, ICON], { size: [400, 600] });
  const [out] = await run(page, 'manga', [file('volume 1.pdf', pdf)]);
  expect(out.name).toMatch(/\.azw3$/);
  const h = readPalm(out.buf);
  expect(h.type).toBe('BOOKMOBI');
  expect(h.exth[122]).toBe('true');            // fixed-layout
  expect(h.exth[123]).toBe('comic');           // book-type
  expect(h.exth[126]).toBe('1072x1448');       // resolução do aparelho padrão
  expect(h.exth[527]).toMatch(/^(rtl|ltr)$/);    // direção de leitura
});

test('Escaneado → PDF: OCR lê a página e gera o PDF', async ({ page, browser }) => {
  test.slow();
  // "escaneia" uma página de texto: screenshot de um HTML, embutido como imagem num PDF sem texto
  const scan = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  const pngs = [];
  for (let k = 0; k < 2; k++) {   // duas páginas cheias de texto, como num livro
    await scan.setContent(`<body style="margin:150px;font:30px/1.6 Georgia,serif;background:#fff;color:#000;text-align:justify">` +
      Array.from({ length: 6 }, () => `<p style="margin:0;text-indent:2em">${LOREM.join(' ')}</p>`).join('') + '</body>');
    pngs.push(await scan.screenshot());
  }
  await scan.close();
  const [out] = await run(page, 'ocr', [file('escaneado.pdf', await makeImagePdf(pngs, { size: [595, 842] }))], {
    setup: async p => { await p.fill('#oTitle', 'Teste de OCR'); await p.uncheck('#oCover'); },
    timeout: 240_000,
  });
  expect(out.name).toBe('Teste de OCR.pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.title).toBe('Teste de OCR');
  expect(pdf.pages).toBeGreaterThanOrEqual(1);
  // o texto reconhecido entra no PDF (fonte embutida): confere pelo pdf.js do próprio app
  const text = await page.evaluate(async b64 => {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    let s = '';
    for (let i = 1; i <= doc.numPages; i++) s += (await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join(' ') + ' ';
    return s.replace(/\s+/g, ' ');
  }, out.buf.toString('base64'));
  expect(text).toMatch(/conversor/i);
  expect(text).toMatch(/navegador/);
});
