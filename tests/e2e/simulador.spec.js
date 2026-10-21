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
