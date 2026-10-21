// Simulador de Kindle (src/kindle.js + a tela no app): abre o AZW3/KFX gerado e mostra como o aparelho exibe.
// Além de conferir o comportamento, salva capturas em simulador/ (o CI publica como artefato "simulador").
const fs = require('fs');
const path = require('path');
const { test, expect, run } = require('../apoio/app');
const A = require('../apoio/arquivos');

const OUT = path.join(__dirname, '..', '..', 'simulador');
const shot = async (page, name) => { fs.mkdirSync(OUT, { recursive: true }); await page.locator('#sim').screenshot({ path: path.join(OUT, name + '.png'), animations: 'disabled' }); };
const MANGA = [[0.6, 0.4], [1], [0.35, 0.65]];
const TEXTO = '<h1 id="dois">Capítulo Dois</h1>' + '<p>Texto corrido de exemplo, que se repete para encher a tela do aparelho e mostrar como o livro é paginado no Kindle.</p>'.repeat(60);

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 620, height: 1150 }); });

async function openManga(page, setup) {
  const comic = await A.comicPage(page, { layout: MANGA }), dbl = await A.comicPage(page, { w: 1600, h: 1100, double: true });
  await run(page, 'manga', [A.file('volume 1.pdf', await A.makeImagePdf([comic, dbl, A.ICON_BIG], { size: e => [e.width / 2, e.height / 2] }))], { setup });
  await page.click('#list .sim');
  await expect(page.locator('#sim')).toBeVisible();
  await expect(page.locator('#simScreen > img')).toHaveJSProperty('complete', true);
}

test('mangá: páginas, áreas de toque na ordem de leitura e quadro ampliado com máscara', async ({ page }) => {
  await openManga(page);
  await expect(page.locator('#simTitle')).toHaveText('volume 1 (AZW3)')   // sem título no PDF: o nome do arquivo;
  await expect(page.locator('#simCount')).toHaveText('1 / 4');   // a página dupla virou duas
  await expect(page.locator('#simDev')).toBeHidden();             // o tamanho da tela vem do arquivo
  await expect(page.locator('.khit')).toHaveCount(5);
  expect(await page.locator('#simScreen').evaluate(e => getComputedStyle(e).aspectRatio)).toBe('1072 / 1448');
  expect(await page.locator('#simScreen').evaluate(e => getComputedStyle(e).filter)).toMatch(/grayscale\(1\) url\("?#simEink"?\)/);   // tela de 16 tons
  // ordem: a fileira de cima da direita para a esquerda
  const boxes = await page.locator('.khit').evaluateAll(b => b.map(x => x.getBoundingClientRect()).map(r => [Math.round(r.x), Math.round(r.y)]));
  expect(boxes[0][0]).toBeGreaterThan(boxes[1][0]);
  expect(boxes[2][1]).toBeGreaterThan(boxes[0][1]);
  await shot(page, 'manga-pagina');
  await page.click('#simAreas');
  await shot(page, 'manga-areas');
  await page.locator('.khit').nth(0).click();
  await expect(page.locator('#simCount')).toHaveText('quadro 1 / 5');
  await expect(page.locator('#simExit')).toBeVisible();
  await shot(page, 'manga-quadro-1');
  await page.click('#simNext');
  await expect(page.locator('#simCount')).toHaveText('quadro 2 / 5');
  await expect(page.locator('.kmask').first()).toBeVisible();   // quadro mais baixo que a tela: o resto é tampado
  await shot(page, 'manga-quadro-2');
  for (let k = 3; k <= 5; k++) { await page.click('#simNext'); await expect(page.locator('#simCount')).toHaveText(`quadro ${k} / 5`); }
  await page.click('#simNext');                                     // depois do último quadro: próxima página
  await expect(page.locator('#simCount')).toHaveText('2 / 4');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#simCount')).toHaveText('3 / 4');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#simHint')).toHaveText('Página sem painéis.');   // ilustração inteira
  await expect(page.locator('#simNext')).toBeDisabled();
  await page.click('#simClose');
  await expect(page.locator('#sim')).toBeHidden();
});

test('mangá: Esc e toque fora saem do quadro; 4 painéis por página', async ({ page }) => {
  await openManga(page, p => p.selectOption('#mPanels', '4'));
  await expect(page.locator('.khit')).toHaveCount(4);
  await page.locator('.khit').nth(1).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#simCount')).toHaveText('1 / 4');
  await expect(page.locator('#sim')).toBeVisible();                 // o Esc saiu do quadro, não do simulador
  await page.locator('.khit').nth(0).click();
  await page.locator('#simScreen').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#simCount')).toHaveText('1 / 4');
  await page.keyboard.press('ArrowLeft');                           // já na primeira: nada muda
  await expect(page.locator('#simCount')).toHaveText('1 / 4');
});

for (const dev of ['kpw34', 'kpw5', 'ks', 'k57']) {
  test(`mangá no aparelho ${dev}: a tela tem a resolução dele`, async ({ page }) => {
    await openManga(page, p => p.selectOption('#mDev', dev));
    const want = { kpw34: '1072 / 1448', kpw5: '1236 / 1648', ks: '1860 / 2480', k57: '600 / 800' }[dev];
    expect(await page.locator('#simScreen').evaluate(e => getComputedStyle(e).aspectRatio)).toBe(want);
    await shot(page, `manga-${dev}`);
  });
}

test('livro de texto (AZW3): paginado na tela do aparelho, sumário, troca de aparelho e tamanho da letra', async ({ page }) => {
  const epub = await A.makeEpub({ chapters: [A.RICH_CHAPTER, TEXTO, '<h1>Três</h1><p>fim</p>'], css: 'h1 { letter-spacing: .05em }', images: { 'img/a.png': A.ICON } });
  await run(page, 'kindle', [A.file('livro.epub', epub)]);
  await page.click('#list .sim');
  await expect(page.locator('#simTitle')).toHaveText('o nome do vento · Patrick Rothfuss (AZW3)');
  const frame = page.frameLocator('#simScreen iframe');
  await expect(frame.locator('h1').first()).toHaveText('Capítulo Rico');
  await expect(frame.locator('h1').first()).toHaveCSS('letter-spacing', /px/);   // o CSS do livro (fluxo do AZW3) vale
  await expect(page.locator('#simToc option')).toHaveText([/Capítulo 1/, /Seção 1\.1/, /Capítulo 2/, /Capítulo 3/]);
  await shot(page, 'texto-capitulo-1');
  await page.selectOption('#simToc', { label: 'Capítulo 3' });
  await expect(page.locator('#simCount')).toHaveText(/^3\.1 \/ 3$/);
  await page.selectOption('#simToc', { label: 'Capítulo 2' });
  await expect(page.locator('#simHint')).toHaveText(/^Arquivo 2 de 3, tela 1 de (\d+)\./);
  const telas = async () => +(/tela \d+ de (\d+)/.exec(await page.locator('#simHint').innerText())[1]);
  const base = await telas();
  expect(base).toBeGreaterThan(1);
  await shot(page, 'texto-capitulo-2');
  await page.click('#simNext');
  await expect(page.locator('#simCount')).toHaveText('2.2 / 3');
  await page.click('#simPrev');
  await page.click('#simPrev');                                    // volta para a última tela do capítulo anterior
  await expect(page.locator('#simCount')).toHaveText(/^1\.\d+ \/ 3$/);
  await page.selectOption('#simToc', { label: 'Capítulo 2' });
  await page.click('#simBigger'); await page.click('#simBigger');
  await expect.poll(telas).toBeGreaterThan(base);                  // letra maior, mais telas
  await page.click('#simSmaller'); await page.click('#simSmaller');
  await page.selectOption('#simDev', 'ks');                        // tela maior, menos telas
  await expect.poll(telas).toBeLessThan(base + 1);
  await shot(page, 'texto-scribe');
  // tocar na borda direita da tela avança
  await page.selectOption('#simDev', 'kpw34');
  await page.locator('.kturn').nth(1).click();
  await expect(page.locator('#simCount')).toHaveText('2.2 / 3');
});

test('livro de texto (KFX): blocos, listas e sumário do próprio KFX', async ({ page }) => {
  await run(page, 'kindle', [A.file('livro.epub', await A.makeEpub({ chapters: [A.RICH_CHAPTER, TEXTO] }))], { setup: p => p.selectOption('#kFmt', 'kfx') });
  await page.click('#list .sim');
  await expect(page.locator('#simTitle')).toHaveText('o nome do vento · Patrick Rothfuss (KFX)');
  const frame = page.frameLocator('#simScreen iframe');
  await expect(frame.locator('h1').first()).toHaveText('Capítulo Rico');
  await expect(frame.locator('ul li')).toHaveText(['primeiro item', 'segundo item']);
  await expect(frame.locator('ol li')).toHaveText(['um', 'dois']);
  await expect(frame.locator('pre')).toContainText('codigo  com   espacos');
  await expect(page.locator('#simToc option')).toHaveText([/Capítulo 1/, /Seção 1\.1/, /Capítulo 2/]);
  await shot(page, 'kfx-capitulo-1');
});

test('arquivo que não abre no simulador dá aviso, sem travar', async ({ page }) => {
  await page.evaluate(() => window.__converterias.simOpen(new Uint8Array([1, 2, 3]), 'x.azw3'));
  await expect(page.locator('#status')).toHaveText('Não consegui abrir no simulador: não é um AZW3 (falta o cabeçalho BOOKMOBI).');
  await expect(page.locator('#sim')).toBeHidden();
});

test('EPUB (Enviar para Kindle): capítulos com o CSS e as imagens do livro, sumário do nav, fonte, margens e espaçamento', async ({ page }) => {
  const epub = await A.makeEpub({ chapters: [A.RICH_CHAPTER + '<p><img src="../img/a.png" alt=""/></p>', TEXTO, '<h1>Três</h1><p>fim</p>'], css: 'h1 { letter-spacing: .05em }', images: { 'img/a.png': A.ICON_BIG } });
  await page.evaluate(b => window.__converterias.simOpen(Uint8Array.from(atob(b), c => c.charCodeAt(0)), 'livro.epub'), epub.toString('base64'));
  await expect(page.locator('#simTitle')).toHaveText('o nome do vento · Patrick Rothfuss (EPUB)');
  const frame = page.frameLocator('#simScreen iframe');
  await expect(frame.locator('h1').first()).toHaveText('Capítulo Rico');
  await expect(frame.locator('h1').first()).toHaveCSS('letter-spacing', /px/);   // o CSS do livro, achado pelo caminho relativo
  await expect.poll(() => frame.locator('img[alt=""]').last().evaluate(i => i.complete && i.naturalWidth)).toBe(512);   // a imagem do livro, pelo caminho relativo
  await expect(page.locator('#simToc option')).toHaveText([/Capítulo 1/, /Seção 1\.1/, /Capítulo 2/, /Capítulo 3/]);
  // sem fontes embutidas, o Kindle começa na serifada dele
  await expect(page.locator('#simFont')).toHaveValue('serif');
  await expect(frame.locator('p').first()).toHaveCSS('font-family', /Kindle Serif/);
  await expect(page.locator('#simScreen .kfoot')).toHaveText(/Capítulo 1\s*\d+%$/);
  await page.selectOption('#simToc', { label: 'Capítulo 2' });
  const telas = async () => +(/tela \d+ de (\d+)/.exec(await page.locator('#simHint').innerText())[1]);
  const pct = async () => +(/(\d+)%$/.exec(await page.locator('#simScreen .kfoot').innerText())[1]);
  const base = await telas(), p1 = await pct();
  await page.click('#simNext');
  expect(await pct()).toBeGreaterThan(p1);                          // a porcentagem lida anda com as telas
  await page.selectOption('#simMargin', '2');
  await expect.poll(telas).toBeGreaterThan(base);                  // margens largas: menos texto por tela
  await page.selectOption('#simMargin', '1'); await expect.poll(telas).toBe(base);
  await page.selectOption('#simSpace', '2');
  await expect.poll(telas).toBeGreaterThan(base);                  // mais espaço entre linhas, idem
  await page.selectOption('#simSpace', '1');
  await page.selectOption('#simFont', 'sans');
  await expect(frame.locator('p').first()).toHaveCSS('font-family', /Amazon Ember/);
  await page.selectOption('#simFont', 'editor');
  await expect(frame.locator('p').first()).not.toHaveCSS('font-family', /!important/);
  await shot(page, 'epub-capitulo-2');
  await page.selectOption('#simToc', { label: 'Capítulo 3' });
  await expect(page.locator('#simScreen .kfoot')).toHaveText(/100%$/);
});

test('EPUB gerado pelo app (PDF → EPUB) abre no simulador pelo botão do resultado', async ({ page }) => {
  await run(page, 'p2e', [A.file('livro.pdf', await A.makeTextPdf({ chapters: 3, paras: [A.LOREM.join(' ').repeat(3), A.LOREM.join(' ').repeat(3)] }))]);
  await page.click('#list .sim');
  await expect(page.locator('#simTitle')).toHaveText('Livro de Teste · Fulana de Tal (EPUB)');
  const frame = page.frameLocator('#simScreen iframe');
  await expect(frame.locator('.cover img')).toBeVisible();            // abre na capa, como o Kindle
  await expect(page.locator('#simToc option')).toHaveText(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  // os três capítulos estão no mesmo arquivo: o sumário leva à tela da âncora
  await page.selectOption('#simToc', { label: 'Capítulo 3' });
  const sub3 = +(/tela (\d+)/.exec(await page.locator('#simHint').innerText())[1]);
  expect(sub3).toBeGreaterThan(1);
  await expect(page.locator('#simToc')).toHaveValue('2');
  await expect(page.locator('#simScreen .kfoot')).toHaveText(/^Capítulo 3/);
  await page.selectOption('#simToc', { label: 'Capítulo 1' });
  await expect(page.locator('#simHint')).toHaveText(/tela 1 de/);
});

test('PDF: página inteira reduzida à tela do aparelho, sumário do PDF e troca de aparelho', async ({ page }) => {
  await run(page, 'e2p', [A.file('livro.epub', await A.makeEpub({ chapters: [A.RICH_CHAPTER, TEXTO, '<h1>Três</h1><p>fim</p>'] }))]);
  await page.click('#list .sim');
  await expect(page.locator('#simTitle')).toHaveText(/\(PDF\)$/);
  await expect(page.locator('#simDev')).toBeVisible();                // a tela é a do aparelho escolhido
  await expect(page.locator('#simFont')).toBeHidden();               // PDF não reflui: sem opções de letra
  await expect(page.locator('#simAreas')).toBeHidden();
  const img = page.locator('#simScreen > img');
  await expect(img).toHaveJSProperty('complete', true);
  const box = async () => img.evaluate(i => { const r = i.getBoundingClientRect(), s = i.parentElement.getBoundingClientRect(); return { w: r.width / s.width, h: r.height / s.height }; });
  const b = await box();
  expect(Math.max(b.w, b.h)).toBeGreaterThan(0.99);                  // cabe na tela, encostando num dos lados
  const total = +(/\/ (\d+)/.exec(await page.locator('#simCount').innerText())[1]);
  expect(total).toBeGreaterThan(2);
  await expect(page.locator('#simHint')).toHaveText(/página inteira reduzida/);
  await shot(page, 'pdf-pagina-1');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#simCount')).toHaveText(`2 / ${total}`);
  await page.locator('.kturn').nth(0).click();
  await expect(page.locator('#simCount')).toHaveText(`1 / ${total}`);
  await expect(page.locator('#simToc')).toBeHidden();                 // o EPUB → PDF não grava marcadores
  await page.selectOption('#simDev', 'k57');
  expect(await page.locator('#simScreen').evaluate(e => getComputedStyle(e).aspectRatio)).toBe('600 / 800');
  await expect(img).toHaveJSProperty('complete', true);
  await shot(page, 'pdf-k57');
});

test('PDF com marcadores (Juntar): o sumário do simulador leva à página do marcador', async ({ page }) => {
  await run(page, 'merge', [A.file('Parte 1.pdf', await A.makeNumberedPdf(3)), A.file('Parte 2.pdf', await A.makeNumberedPdf(2))]);
  await page.click('#simBtn');
  await expect(page.locator('#simCount')).toHaveText('1 / 5');
  await expect(page.locator('#simToc option')).toHaveCount(2);
  await page.selectOption('#simToc', '1');
  await expect(page.locator('#simCount')).toHaveText('4 / 5');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#simToc')).toHaveValue('0');            // voltou para a primeira parte
});

test('PDF ilegível no simulador dá aviso', async ({ page }) => {
  await page.evaluate(() => window.__converterias.simOpen(new TextEncoder().encode('%PDF-1.7 lixo'), 'x.pdf'));
  await expect(page.locator('#status')).toHaveText('Não consegui abrir no simulador: não consegui ler este PDF.');
});

test('Kindle.open com EPUB 2: sumário do toc.ncx, OPF fora de OEBPS/, capa e fontes embutidas', async ({ page }) => {
  const { inPage } = require('../apoio/app');
  const epub = await A.makeEpub({ version: 2, opfDir: '', chapters: 2, cover: 'meta', fonts: { 'f/x.ttf': Buffer.from('fonte') } });
  const r = await inPage(page, async b => {
    const k = await Kindle.open(b);
    const out = { kind: k.kind, toc: k.toc.map(t => [t.title, t.file]), n: k.chapters.length, cover: /^blob:/.test(k.cover) || k.cover === '', hasFonts: k.hasFonts, h1: k.chapters.map(c => /<h1[^>]*>([^<]+)/.exec(c.html)[1]) };
    k.close(); return out;
  }, epub);
  expect(r).toMatchObject({ kind: 'epub', n: 2, hasFonts: true, h1: ['Capítulo 1', 'Capítulo 2'], cover: true });
  expect(r.toc.map(t => t[1])).toEqual([0, 1]);
  const bad = await page.evaluate(async () => { try { await Kindle.open(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])); } catch (e) { return e.message; } });
  expect(bad).toBe('não é um EPUB (o ZIP não abre).');
});

test('aba Simular no Kindle: escolher o arquivo já abre o simulador, de qualquer formato', async ({ page }) => {
  await page.goto('about:blank'); await page.goto((process.env.COVERAGE ? 'cobertura.html' : 'index.html') + '#simular');
  await expect(page.locator('.tabs button[data-mode="sim"]')).toHaveClass(/on/);
  expect(await page.locator('#file').getAttribute('accept')).toBe('.azw3,.kfx,.epub,.pdf,.mobi,.azw');
  await page.setInputFiles('#file', [A.file('livro.epub', await A.makeEpub({ chapters: [TEXTO] }))]);
  await expect(page.locator('#sim')).toBeVisible();
  await expect(page.locator('#simTitle')).toHaveText('o nome do vento · Patrick Rothfuss (EPUB)');
  await page.click('#simClose');
  await expect(page.locator('#go')).toHaveText('Abrir no simulador');
  await page.click('#go');                                            // reabre o mesmo arquivo
  await expect(page.locator('#sim')).toBeVisible();
  await page.click('#simClose');
  await page.setInputFiles('#file', [A.file('paginas.pdf', await A.makeNumberedPdf(3))]);
  await expect(page.locator('#simCount')).toHaveText('1 / 3');
  await expect(page.locator('#simTitle')).toHaveText('paginas (PDF)');   // sem título no PDF: o nome do arquivo
  await page.click('#simClose');
  await page.setInputFiles('#file', [A.file('x.azw3', Buffer.from('nada disso'))]);
  await expect(page.locator('#status')).toHaveText(/^Não consegui abrir no simulador: /);
  await expect(page.locator('#sim')).toBeHidden();
});

test('aba Simular no Kindle: abre o AZW3 de mangá baixado de outra conversão', async ({ page }) => {
  const comic = await A.comicPage(page, { layout: MANGA });
  const [out] = await run(page, 'manga', [A.file('volume 1.pdf', await A.makeImagePdf([comic], { size: [400, 600] }))]);
  await page.click('.tabs button[data-mode="sim"]');
  await page.setInputFiles('#file', [A.file(out.name, out.buf)]);
  await expect(page.locator('#simCount')).toHaveText('1 / 1');
  await expect(page.locator('.khit')).toHaveCount(5);
});
