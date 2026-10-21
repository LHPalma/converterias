// Organizar PDF: selecionar, mover, girar, duplicar, remover, desfazer e salvar (com marcadores e metadados).
const { test, expect, open, download } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readPdf, } = require('../apoio/leitores');

const cards = page => page.locator('#orgGrid .oc');
const order = page => page.locator('#orgGrid .oc .no').allInnerTexts().then(t => t.map(s => s.replace(/\s+/g, ' ').trim()));
const act = (page, a) => page.click(`[data-org="${a}"]`);
async function load(page, n = 5, o = {}) {
  await open(page, 'org');
  await expect(page.locator('#go')).toBeHidden();
  await page.setInputFiles('#file', [A.file('doc.pdf', await A.makeNumberedPdf(n, o))]);
  await expect(cards(page)).toHaveCount(n);
  await expect(page.locator('#orgInfo')).toHaveText(`doc.pdf · ${n} páginas · 0 selecionadas`);   // miniaturas prontas
}
async function save(page, button = '#orgSave') {
  await page.click(button);
  await expect(page.locator('#status')).toHaveText(/^Pronto/);
  return (await download(page, '#sepBtn'))[0];
}
// texto de cada página (o número desenhado nela) para conferir a ordem
const pageNumbers = async (page, buf) => (await require('../apoio/app').pdfText(page, buf)).map(t => +t.replace(/\D+/g, ''));

test('seleção: tocar, todas, nenhuma, inverter, ímpares e pares', async ({ page }) => {
  await load(page);
  await cards(page).nth(1).click();
  await expect(page.locator('#orgInfo')).toHaveText('doc.pdf · 5 páginas · 1 selecionada');
  await expect(page.locator('#orgAct button').first()).toBeEnabled();
  await act(page, 'all'); await expect(page.locator('#orgGrid .oc.sel')).toHaveCount(5);
  await act(page, 'none'); await expect(page.locator('#orgGrid .oc.sel')).toHaveCount(0);
  await expect(page.locator('#orgAct button').first()).toBeDisabled();
  await expect(page.locator('#orgSaveSel')).toBeDisabled();
  await act(page, 'odd'); await expect(page.locator('#orgGrid .oc.sel .no')).toHaveText(['1', '3', '5']);
  await act(page, 'inv'); await expect(page.locator('#orgGrid .oc.sel .no')).toHaveText(['2', '4']);
  await act(page, 'even'); await expect(page.locator('#orgGrid .oc.sel .no')).toHaveText(['2', '4']);
});

test('mover uma posição, para o início, para o fim e para uma posição; desfazer passo a passo', async ({ page }) => {
  await load(page);
  await cards(page).nth(2).click();                  // página 3
  await act(page, 'left');
  expect(await order(page)).toEqual(['1', '2 · orig. 3', '3 · orig. 2', '4', '5']);
  await act(page, 'first');
  expect(await order(page)).toEqual(['1 · orig. 3', '2 · orig. 1', '3 · orig. 2', '4', '5']);
  await act(page, 'last');
  expect(await order(page)).toEqual(['1', '2', '3 · orig. 4', '4 · orig. 5', '5 · orig. 3']);
  await act(page, 'right');                           // já está no fim: nada muda
  await page.fill('#orgPos', '2'); await page.click('#orgGo');
  expect(await order(page)).toEqual(['1', '2 · orig. 3', '3 · orig. 2', '4', '5']);
  await act(page, 'right');
  expect(await order(page)).toEqual(['1', '2', '3', '4', '5']);
  await expect(page.locator('#orgUndo')).toBeEnabled();
  for (let k = 0; k < 6; k++) await act(page, 'undo');
  expect(await order(page)).toEqual(['1', '2', '3', '4', '5']);
  await expect(page.locator('#orgUndo')).toBeDisabled();
});

test('girar, duplicar, remover e inverter; salvar o PDF organizado', async ({ page }) => {
  await load(page, 4, { title: 'Meu Documento' });
  await cards(page).nth(0).click();
  await act(page, 'cw'); await act(page, 'cw');      // 180°
  await act(page, 'dup');                            // a cópia entra logo depois, sem seleção
  await act(page, 'none');
  await cards(page).nth(2).click();                  // página 2 (original)
  await act(page, 'ccw');                            // 270°
  await act(page, 'none');
  await cards(page).nth(4).click();                  // página 4
  await act(page, 'del');
  await act(page, 'rev');                            // 3, 2, 1', 1
  expect(await order(page)).toEqual(['1 · orig. 3', '2 · orig. 2 ↻270', '3 · orig. 1 ↻180', '4 · orig. 1 ↻180']);
  await expect(page.locator('#orgInfo')).toHaveText('doc.pdf · 4 páginas · 0 selecionadas');
  await cards(page).nth(0).click(); await act(page, 'del');
  await expect(page.locator('#orgInfo')).toHaveText('doc.pdf · 3 páginas (de 4) · 0 selecionadas');
  await act(page, 'undo');
  const out = await save(page);
  expect(out.name).toBe('doc (organizado).pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.pages).toBe(4);
  expect(pdf.rotations).toEqual([0, 270, 180, 180]);
  expect(pdf.title).toBe('Meu Documento');            // metadados preservados
  expect(await pageNumbers(page, out.buf)).toEqual([3, 2, 1, 1]);
});

test('salvar só as selecionadas mantém os marcadores das páginas que ficam', async ({ page }) => {
  await load(page, 4, { outline: true });
  await cards(page).nth(1).click(); await cards(page).nth(3).click();
  const out = await save(page, '#orgSaveSel');
  expect(out.name).toBe('doc (selecionadas).pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.pages).toBe(2);
  expect(pdf.outline).toEqual([{ title: 'Marcador 2', page: 0, items: [] }, { title: 'Marcador 4', page: 1, items: [] }]);
  expect(await pageNumbers(page, out.buf)).toEqual([2, 4]);
});

test('arrastar uma página para outro lugar', async ({ page }) => {
  await load(page, 3);
  await cards(page).nth(0).dragTo(cards(page).nth(2));
  expect(await order(page)).toEqual(['1 · orig. 2', '2 · orig. 3', '3 · orig. 1']);
  await act(page, 'undo');
  expect(await order(page)).toEqual(['1', '2', '3']);
});

test('PDF que não abre: aviso e nenhuma página', async ({ page }) => {
  await open(page, 'org');
  await page.setInputFiles('#file', [A.file('ruim.pdf', Buffer.from('%PDF nada'))]);
  await expect(page.locator('#status')).toHaveText('ruim.pdf: não consegui ler este PDF.');
  await page.setInputFiles('#file', [A.file('senha.pdf', await A.makeEncryptedPdf())]);
  await expect(page.locator('#status')).toHaveText('senha.pdf: PDF protegido por senha.');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('#orgSave')).toBeDisabled();
});

test('trocar de PDF recomeça do zero; só um arquivo por vez', async ({ page }) => {
  await load(page, 3);
  await cards(page).nth(0).click(); await act(page, 'del');
  await page.setInputFiles('#file', [A.file('a.pdf', await A.makeNumberedPdf(2)), A.file('b.pdf', await A.makeNumberedPdf(6))]);
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('#orgInfo')).toHaveText('a.pdf · 2 páginas · 0 selecionadas');
  await expect(page.locator('#orgUndo')).toBeDisabled();
});
