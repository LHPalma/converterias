// Metadados: ler e editar os do EPUB/PDF, buscar no Open Library (simulado aqui, sem rede) e gravar.
const { test, expect, open, download } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readPdf, readEpub } = require('../apoio/leitores');
const JSZip = require('../../vendor/jszip.min.js');

const CORS = { 'access-control-allow-origin': '*' };
const DOCS = [
  { key: '/works/OL1W', title: 'O nome do vento (edição de bolso)', author_name: ['Patrick Rothfuss'], first_publish_year: 2009, publisher: ['Outra'], language: ['por'] },   // sem capa, título não exato
  { key: '/works/OL2W', title: 'O Nome do Vento', author_name: ['Patrick Rothfuss'], first_publish_year: 2007, publisher: ['Arqueiro', 'DAW'],
    isbn: ['8599296493', '9788599296493'], language: ['eng', 'por'], subject: ['Fantasia', 'Magia', 'Um assunto comprido demais para virar etiqueta de verdade aqui'], cover_i: 12345 },
];
/* Open Library falso: guarda as consultas e responde como a API de verdade */
async function fakeOl(page, { docs = DOCS, fail = false } = {}) {
  const calls = [];
  await page.route('https://openlibrary.org/**', async r => {
    const u = new URL(r.request().url()); calls.push(u);
    if (fail) return r.abort('internetdisconnected');
    if (u.pathname === '/search.json') return r.fulfill({ json: { numFound: docs.length, docs: u.searchParams.get('q') ? [] : docs }, headers: CORS });
    if (u.pathname === '/works/OL2W.json') return r.fulfill({ json: { description: { type: '/type/text', value: 'Kvothe conta a própria história.' } }, headers: CORS });
    return r.fulfill({ status: 404, json: {}, headers: CORS });
  });
  await page.route('https://covers.openlibrary.org/**', r => r.fulfill({ body: A.ICON_BIG, contentType: 'image/png', headers: CORS }));
  return calls;
}
async function load(page, file) {
  await open(page, 'meta');
  await page.setInputFiles('#file', [file]);
  await expect(page.locator('#mtInfo')).toContainText(file.name);
}
async function save(page) {
  await page.click('#mtSave');
  await expect(page.locator('#status')).toHaveText(/^Pronto: /);
  return (await download(page, '#sepBtn'))[0];
}

test('EPUB: mostra os metadados, busca pelo título e 1º autor, escolhe o resultado (descrição e capa) e grava no OPF', async ({ page }) => {
  const calls = await fakeOl(page);
  await load(page, A.file('livro.epub', await A.makeEpub({ cover: false, publisher: 'Editora Teste' })));
  await expect(page.locator('#mtTitle')).toHaveValue('o nome do vento');
  await expect(page.locator('#mtAuthors')).toHaveValue('Patrick Rothfuss');
  await expect(page.locator('#mtPublisher')).toHaveValue('Editora Teste');
  await expect(page.locator('#mtCoverInfo')).toHaveText('Sem capa.');
  await page.click('#mtSearch');
  await expect(page.locator('#mtRes li button')).toHaveCount(2);
  const q = calls.find(u => u.pathname === '/search.json').searchParams;
  expect([q.get('title'), q.get('author'), q.get('isbn')]).toEqual(['o nome do vento', 'Patrick Rothfuss', null]);
  // com capa e título exato vem primeiro, mesmo a fonte tendo mandado em 2º
  await expect(page.locator('#mtRes li').first()).toContainText('O Nome do Vento');
  await expect(page.locator('#mtRes li').first()).toContainText('2007 · Arqueiro · ISBN 9788599296493');
  await expect(page.locator('#mtRes .fonte')).toContainText('Open Library');
  await page.locator('#mtRes li button').first().click();
  await expect(page.locator('#status')).toHaveText(/Preenchido com o Open Library, com capa/);
  { const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..', '..', 'simulador'); fs.mkdirSync(dir, { recursive: true }); await page.locator('#optMeta').screenshot({ path: path.join(dir, 'metadados.png') }); }
  await expect(page.locator('#mtTitle')).toHaveValue('O Nome do Vento');
  await expect(page.locator('#mtPublisher')).toHaveValue('Arqueiro');
  await expect(page.locator('#mtDate')).toHaveValue('2007');
  await expect(page.locator('#mtIsbn')).toHaveValue('9788599296493');
  await expect(page.locator('#mtLang')).toHaveValue('pt-BR');                      // o idioma do livro já existia: não muda
  await expect(page.locator('#mtTags')).toHaveValue('Fantasia, Magia');            // assunto comprido demais fica de fora
  await expect(page.locator('#mtDesc')).toHaveValue('Kvothe conta a própria história.');
  await expect(page.locator('#mtCover')).toBeVisible();
  await page.fill('#mtSeries', 'A Crônica do Matador do Rei'); await page.fill('#mtSeriesIdx', '1');
  const out = await save(page);
  expect(out.name).toBe('O Nome do Vento (Patrick Rothfuss).epub');
  const ep = await readEpub(out.buf);
  expect(ep.title).toBe('O Nome do Vento');
  for (const s of ['<dc:publisher>Arqueiro</dc:publisher>', '<dc:date>2007</dc:date>', '<dc:identifier>urn:isbn:9788599296493</dc:identifier>', '<dc:subject>Fantasia</dc:subject>',
    '<dc:description>Kvothe conta a própria história.</dc:description>', 'name="calibre:series" content="A Crônica do Matador do Rei"', 'name="calibre:series_index" content="1"', 'property="belongs-to-collection"', 'name="cover" content="capa-openlibrary"'])
    expect(ep.opf, s).toContain(s);
  expect(ep.opf).toContain('unique-identifier="');                                 // o identificador único continua
  const zip = await JSZip.loadAsync(out.buf);
  expect(Object.keys(zip.files)[0]).toBe('mimetype');
  expect((await zip.file('OEBPS/capa-openlibrary.png').async('uint8array')).length).toBe(A.ICON_BIG.length);
});

test('EPUB com capa e ISBN: busca só pelo ISBN; a capa nova entra no arquivo da antiga; Desfazer volta tudo', async ({ page }) => {
  const calls = await fakeOl(page);
  const epub = await A.makeEpub({ uid: 'urn:isbn:9788599296493' });
  await load(page, A.file('livro.epub', epub));
  await expect(page.locator('#mtIsbn')).toHaveValue('9788599296493');
  await expect(page.locator('#mtCoverInfo')).toHaveText('Capa atual do livro.');
  await page.click('#mtSearch');
  await expect(page.locator('#mtRes li button')).toHaveCount(2);
  const q = calls.find(u => u.pathname === '/search.json').searchParams;
  expect([q.get('isbn'), q.get('title')]).toEqual(['9788599296493', null]);
  await expect(page.locator('#mtRes li').first()).toContainText('ISBN 9788599296493');   // o ISBN igual ao da consulta vem primeiro
  await page.locator('#mtRes li button').first().click();
  await expect(page.locator('#mtCoverInfo')).toContainText('Capa nova do Open Library (512×512)');
  await page.click('#mtUndo');
  await expect(page.locator('#mtTitle')).toHaveValue('o nome do vento');
  await expect(page.locator('#mtCoverInfo')).toHaveText('Capa atual do livro.');
  await page.locator('#mtRes li button').first().click();
  await expect(page.locator('#mtCoverInfo')).toContainText('Capa nova');
  const ep = await readEpub((await save(page)).buf);
  expect(ep.manifest.filter(m => /cover-image/.test(m.props))).toHaveLength(1);         // a mesma capa de antes, com a imagem nova
  expect(ep.opf).not.toContain('capa-openlibrary');
  expect(ep.opf.match(/urn:isbn:9788599296493/g)).toHaveLength(1);                     // o identificador único já era o ISBN: não duplica
});

test('PDF: só os campos que o PDF guarda; grava título, autores, descrição e assuntos', async ({ page }) => {
  await fakeOl(page);
  await load(page, A.file('relatorio.pdf', await A.makeTextPdf({ title: 'Relatório Anual', author: 'Ana; Bia' })));
  await expect(page.locator('#mtTitle')).toHaveValue('Relatório Anual');
  await expect(page.locator('#mtAuthors')).toHaveValue('Ana; Bia');
  await expect(page.locator('#mtPublisher')).toBeHidden();
  await expect(page.locator('#mtCoverBox')).toBeHidden();
  await page.fill('#mtDesc', 'Resumo do ano.'); await page.fill('#mtTags', 'contas, 2026');
  const out = await save(page);
  expect(out.name).toBe('Relatório Anual (Ana, Bia).pdf');
  const pdf = await readPdf(out.buf);
  expect([pdf.title, pdf.author, pdf.pdf.getSubject(), pdf.pdf.getKeywords()]).toEqual(['Relatório Anual', 'Ana; Bia', 'Resumo do ano.', 'contas 2026']);
});

test('sem internet, nada encontrado, ISBN inválido e arquivo errado: avisos claros', async ({ page }) => {
  await fakeOl(page, { fail: true });
  await load(page, A.file('livro.epub', await A.makeEpub()));
  await page.click('#mtSearch');
  await expect(page.locator('#status')).toHaveText('Erro: não consegui falar com o Open Library (sem internet?).');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await fakeOl(page, { docs: [] });
  await page.click('#mtSearch');
  await expect(page.locator('#status')).toHaveText(/^Nada encontrado no Open Library/);
  await page.fill('#mtTitle', ''); await page.fill('#mtIsbn', '');
  await page.click('#mtSearch');
  await expect(page.locator('#status')).toHaveText('Erro: preencha o título ou o ISBN para buscar.');
  await page.fill('#mtTitle', 'X'); await page.fill('#mtIsbn', '978-85-99296-49-0');
  await page.click('#mtSave');
  await expect(page.locator('#status')).toHaveText('Erro: o ISBN "978-85-99296-49-0" não é válido (confira os dígitos).');
  await page.setInputFiles('#file', [A.file('nota.pdf', Buffer.from('não é pdf'), 'application/pdf')]);
  await expect(page.locator('#status')).toHaveText('nota.pdf: a aba Metadados recebe EPUB ou PDF.');
  await expect(page.locator('#mtSave')).toBeDisabled();
});

test('ISBN e tokens da consulta (como no Calibre)', async ({ page }) => {
  const r = await page.evaluate(() => ({
    i: ['85-99296-49-3', '8599296493', '978-85-99296-49-3', 'urn:isbn:9788599296493', '8599296494', '9788599296490', 'abc', '080442957X'].map(Meta.isbn13),
    t: ['The Lord of the Rings (Paperback)', 'Duna: a saga', 'Livro - Subtítulo [2010]', '1,000 Ideias & Mais'].map(Meta._titleQuery),
    a: [['Rothfuss, Patrick'], ['Desconhecido', 'J. R. R. Tolkien'], ['Ludwig van Beethoven'], []].map(Meta._authorQuery),
  }));
  expect(r.i).toEqual(['9788599296493', '9788599296493', '9788599296493', '9788599296493', '', '', '', '9780804429573']);
  expect(r.t).toEqual(['Lord of Rings', 'Duna', 'Livro', '1000 Ideias Mais']);
  expect(r.a).toEqual(['Patrick Rothfuss', 'Tolkien', 'Ludwig Beethoven', '']);
});
