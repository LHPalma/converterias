// OCR no navegador (Tesseract.js, com os dados de vendor/ocr): Escaneado → PDF e a opção de OCR do PDF → EPUB.
const { test, expect, open, run, pdfText } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readPdf, readEpub } = require('../apoio/leitores');

test.describe.configure({ timeout: 300_000 });

const TXT = [
  'Era uma vez um conversor que rodava inteiro no navegador, sem mandar nada para servidor algum, e lia livros escaneados.',
  'Ele reconhecia as letras de cada página, juntava as linhas em parágrafos e devolvia arquivos prontos para cada leitor.',
  'Quando alguém mexia no código, os testes conferiam se tudo continuava funcionando como antes, página por página.',
];
const page4 = (n, header, extra = {}) => ({ header, number: String(n), paras: [...TXT, ...TXT].map((t, k) => `${t} (${n}.${k + 1})`), ...extra });
const scanned = async (browser, specs, size = [595, 842]) => A.file('escaneado.pdf', await A.makeImagePdf(await A.scanPages(browser, specs), { size }), 'application/pdf');

test('Escaneado → PDF: texto reconhecido, capítulos pelo cabeçalho corrente, título e autor', async ({ page, browser }) => {
  const file = await scanned(browser, [page4(1, 'O COMEÇO'), page4(2, 'O COMEÇO'), page4(3, 'O FIM DE TUDO'), page4(4, 'O FIM DE TUDO')]);
  const [out] = await run(page, 'ocr', [file], { timeout: 240_000, setup: async p => {
    await p.fill('#oTitle', 'Livro Escaneado'); await p.fill('#oAuthor', 'Autora Teste'); await p.uncheck('#oCover');
  } });
  expect(out.name).toBe('Livro Escaneado (Autora Teste).pdf');
  const pdf = await readPdf(out.buf);
  expect(pdf.title).toBe('Livro Escaneado');
  expect(pdf.author).toBe('Autora Teste');
  const text = (await pdfText(page, out.buf)).join(' ');
  expect(text).toContain('O começo');            // cabeçalho em CAIXA ALTA vira título do capítulo
  expect(text).toContain('O fim de tudo');
  expect(text).toMatch(/rodava inteiro no\s+navegador/);
  expect(text).toMatch(/página por\s+página/);
  expect(text).not.toMatch(/\b2\.\d\) 3 /);      // número de página sai
  expect(text.indexOf('O começo')).toBeLessThan(text.indexOf('O fim de tudo'));
  await expect(page.locator('#list .s.ok')).toHaveText(/✓ \d+ páginas · /);
});

test('Escaneado → PDF: só um trecho de páginas, com a 1ª como capa', async ({ page, browser }) => {
  const file = await scanned(browser, [{ title: 'CAPA', paras: ['Uma capa qualquer.'] }, page4(2, null), page4(3, null)]);
  const [out] = await run(page, 'ocr', [file], { timeout: 240_000, setup: async p => { await p.fill('#oRange', '3-'); await p.uncheck('#oFix'); } });
  expect(out.name).toBe('Escaneado.pdf');          // sem título: o nome do arquivo
  const pdf = await readPdf(out.buf);
  expect(pdf.images[0]).toBe(1);                   // a capa (página 1 inteira em imagem)
  const text = (await pdfText(page, out.buf)).join(' ');
  expect(text).toContain('(3.1)');
  expect(text).not.toContain('(2.1)');            // fora do trecho pedido
});

test('Escaneado → PDF em inglês', async ({ page, browser }) => {
  const en = 'The quick brown fox jumps over the lazy dog while the converter reads every scanned page of the book.';
  const file = await scanned(browser, [{ paras: Array(14).fill(en) }], [595, 842]);
  const [out] = await run(page, 'ocr', [file], { timeout: 240_000, setup: async p => { await p.selectOption('#oLang', 'eng'); await p.uncheck('#oCover'); } });
  const text = (await pdfText(page, out.buf)).join(' ');
  expect(text).toMatch(/quick brown fox jumps over the lazy dog/);
});

test('PDF → EPUB com "Fazer OCR se o PDF for escaneado"', async ({ page, browser }) => {
  const file = await scanned(browser, [page4(1, null), page4(2, null)]);
  const [out] = await run(page, 'p2e', [file], { timeout: 240_000, setup: async p => {
    await p.check('#pOcr'); await expect(p.locator('#optOCR')).toBeVisible(); await p.uncheck('#oCover'); await p.fill('#oTitle', 'Com OCR');
  } });
  const ep = await readEpub(out.buf);
  expect(ep.title).toBe('Com OCR');
  expect(ep.text).toMatch(/juntava as linhas em\s+parágrafos/);
  // PDF com texto não passa pelo OCR mesmo com a opção marcada
  const [txt] = await run(page, 'p2e', [A.file('t.pdf', await A.makeTextPdf())]);
  expect((await readEpub(txt.buf)).title).toBe('Livro de Teste');
});

test('modelo de alta qualidade indisponível: avisa e usa o rápido; PDF ilegível dá erro', async ({ page, browser }) => {
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());   // sem rede para o tessdata_best
  const file = await scanned(browser, [page4(1, null)]);
  const seen = [];
  await page.exposeFunction('__status', t => seen.push(t));
  await page.evaluate(() => new MutationObserver(() => window.__status(document.getElementById('list').textContent)).observe(document.getElementById('list'), { childList: true, characterData: true, subtree: true }));
  const [out] = await run(page, 'ocr', [file], { timeout: 240_000, setup: async p => { await p.selectOption('#oQual', 'best'); await p.uncheck('#oCover'); } });
  expect(seen.some(t => t.includes('Não consegui baixar o modelo de alta qualidade; usando o rápido…'))).toBe(true);
  expect((await pdfText(page, out.buf)).join(' ')).toMatch(/rodava inteiro no\s+navegador/);
  await run(page, 'ocr', [A.file('ruim.pdf', Buffer.from('%PDF-1.4 nada'))], { expectError: /Pronto: 0 convertido/ });
  await expect(page.locator('#list .s.err')).toHaveText('Erro: Não parece um PDF válido.');
});
