// Índice do PDF: marcadores gerados (sumário impresso ou títulos) e editados à mão, salvos no próprio PDF.
const { test, expect, open, download } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readPdf } = require('../apoio/leitores');

const rows = page => page.locator('#idxList li[data-i]');
const titles = page => rows(page).locator('.t').evaluateAll(l => l.map(i => i.value));
const pagesOf = page => rows(page).locator('.p').evaluateAll(l => l.map(i => +i.value));
const levels = page => page.evaluate(() => window.__converterias.idx.items.map(it => it.level));
async function load(page, buf, name = 'livro.pdf') {
  await open(page, 'idx');
  await page.setInputFiles('#file', [A.file(name, buf, 'application/pdf')]);
  await expect(page.locator('#idxInfo')).toContainText(name);
}
async function shot(page, name) { const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', '..', 'simulador'); fs.mkdirSync(dir, { recursive: true }); await page.locator('#optIdx').screenshot({ path: path.join(dir, name + '.png') }); }
async function save(page) {
  await page.click('#idxSave');
  await expect(page.locator('#status')).toHaveText(/^Pronto: PDF com \d+ marcador/);
  const [out] = await download(page, '#sepBtn');
  return out;
}

test('PDF sem índice: gera sozinho a partir do sumário impresso, com as páginas certas; entrada sem página no livro fica de fora', async ({ page }) => {
  await load(page, await A.makeBookPdf({ outline: false, printedToc: true }));
  await expect(page.locator('#status')).toHaveText(/^Pronto: 3 marcadores \(gerado do sumário impresso\)/);
  expect(await titles(page)).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);   // "Apêndice ... 99" não existe no livro
  const p = await pagesOf(page);
  expect(p[0]).toBe(2);                                                // a página 1 é o próprio sumário
  expect(p[1]).toBeGreaterThan(p[0]); expect(p[2]).toBeGreaterThan(p[1]);
  const out = await save(page);
  expect(out.name).toBe('livro.pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.outline.map(o => [o.title, o.page + 1])).toEqual([['Capítulo 1', p[0]], ['Capítulo 2', p[1]], ['Capítulo 3', p[2]]]);
  expect(pdf.pages).toBe((await readPdf(await A.makeBookPdf({ outline: false, printedToc: true }))).pages);   // o resto do PDF fica igual
});

test('sem sumário impresso: gera pelos títulos do texto', async ({ page }) => {
  await load(page, await A.makeTextPdf({ chapters: 3, paras: [A.LOREM.join(' ')] }));
  await expect(page.locator('#status')).toHaveText(/gerado dos títulos do texto/);
  expect(await titles(page)).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  expect(await pagesOf(page)).toEqual([1, 2, 3]);
  // "só do sumário impresso" não acha nada e avisa, sem apagar o que já está montado
  await page.selectOption('#idxSrc', 'printed');
  await page.click('#idxAuto');
  await expect(page.locator('#status')).toHaveText(/Não achei um sumário impresso/);
  expect(await titles(page)).toHaveLength(3);
});

test('PDF que já tem marcadores: abre com eles, em árvore, e o editor mexe em tudo; desfazer volta', async ({ page }) => {
  await load(page, await A.makeBookPdf({ outline: true }));
  await expect(page.locator('#idxInfo')).toContainText('os marcadores que o PDF já tinha');
  expect(await titles(page)).toEqual(['Capítulo 1', 'Primeira Seção', 'Capítulo 2', 'Capítulo 3']);
  expect(await levels(page)).toEqual([0, 1, 0, 0]);
  // renomear e mudar a página
  await rows(page).nth(2).locator('.t').fill('Capítulo Dois'); await rows(page).nth(2).locator('.t').press('Enter');
  await rows(page).nth(3).locator('.p').fill('5'); await rows(page).nth(3).locator('.p').press('Enter');
  expect(await titles(page)).toEqual(['Capítulo 1', 'Primeira Seção', 'Capítulo Dois', 'Capítulo 3']);
  expect((await pagesOf(page))[3]).toBe(5);
  // nível: "Capítulo 3" para dentro do anterior; "Capítulo 1" sobe levando a seção dele junto
  await rows(page).nth(3).click(); await page.click('[data-ix="in"]');
  expect(await levels(page)).toEqual([0, 1, 0, 1]);
  await rows(page).nth(2).click(); await page.click('[data-ix="up"]');   // "Capítulo Dois" (com o 3 dentro) acima do 1
  expect(await titles(page)).toEqual(['Capítulo Dois', 'Capítulo 3', 'Capítulo 1', 'Primeira Seção']);
  expect(await levels(page)).toEqual([0, 1, 0, 1]);
  await page.click('[data-ix="undo"]');
  expect(await titles(page)).toEqual(['Capítulo 1', 'Primeira Seção', 'Capítulo Dois', 'Capítulo 3']);
  await rows(page).nth(0).click(); await page.click('[data-ix="down"]');   // "Capítulo 1" (com a seção) depois do irmão seguinte inteiro
  expect(await titles(page)).toEqual(['Capítulo Dois', 'Capítulo 3', 'Capítulo 1', 'Primeira Seção']);
  await page.click('[data-ix="undo"]');
  // remover e criar olhando a página
  await rows(page).nth(1).click(); await page.click('[data-ix="del"]');
  expect(await titles(page)).toEqual(['Capítulo 1', 'Capítulo Dois', 'Capítulo 3']);
  await expect(page.locator('#idxCv')).toHaveAttribute('data-page', /\d+/);
  await rows(page).nth(0).click();
  await page.click('[data-ix="np"]');
  await expect(page.locator('#idxPg')).toHaveText(/^2 \//);
  await page.click('#idxAdd');
  await rows(page).nth(1).locator('.t').fill('Marcador Novo'); await rows(page).nth(1).locator('.t').press('Enter');
  expect(await titles(page)).toEqual(['Capítulo 1', 'Marcador Novo', 'Capítulo Dois', 'Capítulo 3']);
  expect((await pagesOf(page))[1]).toBe(2);
  // "usar esta página": o selecionado passa a apontar para a página mostrada
  await rows(page).nth(3).click(); await page.click('[data-ix="np"]');
  const shown = +(/^(\d+)/.exec(await page.locator('#idxPg').innerText())[1]);
  await page.click('#idxUse');
  expect((await pagesOf(page))[3]).toBe(shown);
  await shot(page, 'indice-editor');
  const pdf = await readPdf((await save(page)).buf);
  expect(pdf.outline.map(o => o.title)).toEqual(['Capítulo 1', 'Marcador Novo', 'Capítulo Dois']);
  expect(pdf.outline[2].items.map(o => [o.title, o.page + 1])).toEqual([['Capítulo 3', shown]]);
});

test('limpar tudo e salvar: o PDF sai sem índice; arquivo que não é PDF dá aviso', async ({ page }) => {
  await load(page, await A.makeBookPdf({ outline: true }));
  await page.click('[data-ix="clear"]');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#idxList .vazio')).toBeVisible();
  const pdf = await readPdf((await save(page)).buf);
  expect(pdf.hasOutline).toBe(false);
  await page.setInputFiles('#file', [A.file('x.pdf', Buffer.from('não é pdf'), 'application/pdf')]);
  await expect(page.locator('#status')).toHaveText('x.pdf: não consegui ler este PDF.');
  await expect(page.locator('#idxSave')).toBeDisabled();
});
