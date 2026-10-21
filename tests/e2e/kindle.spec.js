// Para Kindle: EPUB (ou PDF) → AZW3 (KF8) ou KFX. As saídas são abertas pelos leitores de tests/apoio/leitores.js,
// que remontam o livro como o Kindle faz (texto PalmDOC, esqueleto + fragmentos, sumário, recursos).
const { test, expect, open, run } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readAzw3, readKfx } = require('../apoio/leitores');
const JSZip = require('../../vendor/jszip.min.js');

const epub = (o, name = 'livro.epub') => A.makeEpub(o).then(b => A.file(name, b, 'application/epub+zip'));
const azw3 = async (page, files, o) => (await run(page, 'kindle', files, o)).map(x => ({ ...x, book: readAzw3(x.buf) }));
const kfx = async (page, files, o = {}) => (await run(page, 'kindle', files, { ...o, setup: async p => { await p.click('.tabs button[data-mode="kindle"]'); await p.selectOption('#kFmt', 'kfx'); if (o.setup) await o.setup(p); } })).map(x => ({ ...x, book: readKfx(x.buf) }));

const LINKS = '<h1 id="dois">Dois</h1><p>Veja o <a href="c1.xhtml#t1">primeiro capítulo</a>, a <a href="#fim">nota no fim</a> e um <a href="https://exemplo.com">link de fora</a>.</p>' +
  '<p>Link para <a href="../nao-existe.xhtml">fora do livro</a> e <a href="javascript:void(0)">script</a>.</p>' + '<p>texto </p>'.repeat(40) + '<p id="fim">Fim do capítulo dois.</p>';

test('AZW3: estrutura KF8 válida, metadados EXTH, capa e miniatura', async ({ page }) => {
  const [{ name, book: k }] = await azw3(page, [await epub({ title: 'o nome do vento' })]);
  expect(name).toBe('O Nome do Vento (Patrick Rothfuss).azw3');
  expect(k.head).toMatchObject({ compression: 2, magic: 'MOBI', encoding: 65001, version: 8, recordSize: 4096, extraFlags: 3, lang: 22 });
  expect(k.full.length).toBe(k.head.textLength);
  expect(k.title).toBe('o nome do vento');
  expect(k.exth).toMatchObject({ 100: 'Patrick Rothfuss', 101: 'Editora Teste', 103: 'Um livro de teste.', 105: 'Ficção', 106: '2020-05-01', 501: 'EBOK', 503: 'o nome do vento', 524: 'pt', 525: 'horizontal-lr', 125: 2, 201: 0, 202: 1 });
  expect(k.exth[129]).toBe('kindle:embed:0001');
  expect(k.resources[0].subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));   // capa PNG passa direto
  expect(k.resources[1].subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));               // miniatura JPEG
  expect(k.files).toHaveLength(3);
  expect(k.files[0]).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<html /);
  for (const f of k.files) expect(f).toMatch(/<\/body>\n<\/html>\n$/);
  expect(k.text).toContain('Era uma vez um conversor');
  // sumário: entradas do nav, com o nível
  expect(k.toc.map(t => [t.title, t.depth])).toEqual([['Capítulo 1', 0], ['Capítulo 2', 0], ['Capítulo 3', 0], ['Seção 1.1', 1]]);
  expect(k.record(k.head.flis).toString('latin1', 0, 4)).toBe('FLIS');
  expect(k.record(k.head.fcis).toString('latin1', 0, 4)).toBe('FCIS');
  await expect(page.locator('#list .s.ok')).toHaveText(/✓ 3 capítulos · /);
});

test('AZW3: links internos apontam para o elemento certo; externos ficam; os que saem do livro somem', async ({ page }) => {
  const [{ book: k }] = await azw3(page, [await epub({ chapters: [A.RICH_CHAPTER, LINKS], cover: false })]);
  const html = k.files.join('\n');
  expect(html).toContain('href="https://exemplo.com"');
  expect(html).not.toContain('nao-existe');
  expect(html).not.toContain('javascript:');
  expect(k.links).toHaveLength(2);
  expect(k.links[0].at).toMatch(/^<h1 id="t1"/);
  expect(k.links[1].at).toMatch(/^<p id="fim"/);
  // o que o diagramador não aproveita sai; o resto fica, com aid
  expect(html).toMatch(/<h6 aid="[0-9A-V]+">Nível 6<\/h6>/);
  expect(html).not.toContain('<script');
  expect(html).toContain('hidden="hidden"');   // o Kindle esconde
  expect(html).not.toContain('data:image');
});

test('AZW3: CSS do livro vira fluxo próprio, sem @media e com imagens trocadas por recursos', async ({ page }) => {
  const css = '@charset "utf-8"; @import url(outro.css); /* comentário */ p { color: red; } @media print { p { color: blue } } ' +
    'h1 { background: url(img/fundo.png) } h2 { background: url(img/nao-existe.png) } epub|type { x: y } [epub|type~="note"] { a: b } @page { margin: 0 } ' +
    '@font-face { font-family: "Livro"; font-weight: bold; src: url(fontes/livro.ttf) } @font-face { font-family: X; src: url(x.woff2) } .s::after { content: "}"; }';
  const [{ book: k }] = await azw3(page, [await epub({ css, images: { 'img/fundo.png': A.ICON }, fonts: { 'fontes/livro.ttf': A.FAKE_TTF }, cover: false })]);
  expect(k.css).toHaveLength(1);
  const c = k.css[0];
  expect(c).toContain('p { color: red; }');
  expect(c).toMatch(/h1 \{ background: url\(kindle:embed:000\d\?mime=image\/png\) \}/);
  expect(c).toContain('h2 { background: none }');
  expect(c).toContain('@page { margin: 0 }');
  expect(c).toMatch(/^@font-face \{ font-family: "Livro"; font-weight: bold; src: url\(kindle:embed:000\d\) \}/);   // fontes primeiro
  for (const gone of ['@media', '@import', '@charset', 'comentário', 'epub|type', 'x.woff2']) expect(c, gone).not.toContain(gone);
  expect(c).toContain('content: "}"');
  expect(k.files[0]).toContain('href="kindle:flow:0001?mime=text/css"');
  // a fonte vira registro FONT (zlib + XOR), do tamanho original declarado no cabeçalho
  const font = k.resources.find(r => r.toString('latin1', 0, 4) === 'FONT');
  expect(font.readUInt32BE(4)).toBe(A.FAKE_TTF.length);
});

test('AZW3: fonte ofuscada (IDPF e Adobe) volta ao original antes de entrar no livro', async ({ page }) => {
  const uid = 'urn:uuid:0f0e0d0c-0b0a-0908-0706-050403020100';
  for (const [alg, data] of [
    ['http://www.idpf.org/2008/embedding', A.idpfObfuscate(A.FAKE_TTF, uid)],
    ['http://ns.adobe.com/pdf/enc#RC', (() => { const key = Buffer.from('0f0e0d0c0b0a09080706050403020100', 'hex'), o = Buffer.from(A.FAKE_TTF); for (let i = 0; i < 1024; i++) o[i] ^= key[i % 16]; return o; })()],
  ]) {
    const [{ book: k }] = await azw3(page, [await epub({ uid, css: '@font-face { font-family: F; src: url(fontes/f.ttf) }', fonts: { 'fontes/f.ttf': data }, encryption: A.encryptionXml('OEBPS/fontes/f.ttf', alg), cover: false })]);
    expect(k.resources.some(r => r.toString('latin1', 0, 4) === 'FONT'), alg).toBe(true);
  }
  // ofuscação desconhecida: a fonte é descartada (sem quebrar o livro)
  const [{ book: k }] = await azw3(page, [await epub({ uid, css: '@font-face { font-family: F; src: url(fontes/f.ttf) }', fonts: { 'fontes/f.ttf': A.FAKE_TTF }, encryption: A.encryptionXml('OEBPS/fontes/f.ttf', 'urn:outra'), cover: false })]);
  expect(k.resources.some(r => r.toString('latin1', 0, 4) === 'FONT')).toBe(false);
  expect(k.css[0]).not.toContain('@font-face');
});

test('AZW3: capítulo enorme (texto e acentos cortados entre registros) volta igual', async ({ page }) => {
  const words = Array.from({ length: 6000 }, (_, i) => ['ação', 'coração', 'λόγος', 'naïve', '😀', 'palavra'][i % 6] + i).join(' ');
  const big = `<h1>Grande</h1><p>${words}</p><div>${'<p>parágrafo curto com acentuação é ó ã</p>'.repeat(300)}</div>`;
  const [{ book: k }] = await azw3(page, [await epub({ chapters: [big, '<h1>Depois</h1><p>fim</p>'], cover: false })]);
  expect(k.head.textRecords).toBeGreaterThan(20);
  const html = k.files[0];
  expect(html.replace(/<span class="AmznBigTextBlock">|<\/span>/g, '')).toContain(words);   // texto longo partido em pedaços de até 8 KB
  expect((html.match(/parágrafo curto com acentuação é ó ã/g) || []).length).toBe(300);
  expect(k.frag.entries.length).toBeGreaterThan(5);
  for (const f of k.frag.entries) expect(f.tags[6][1]).toBeLessThanOrEqual(8192);
  expect(k.files[1]).toContain('<p aid="');
});

test('AZW3: SVG no corpo vira fluxo próprio; imagens WebP/BMP/JPEG progressivo são convertidas', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50"><rect width="100" height="50"/><image xlink:href="../img/a.png" width="10" height="10"/><script>x</script></svg>';
  const imgs = { 'img/a.png': A.ICON, 'img/b.webp': await A.drawImage(page, { type: 'image/webp' }), 'img/c.bmp': A.bmp(30, 20), 'img/d.gif': A.GIF_1x1, 'img/e.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20"/></svg>') };
  const body = `<h1>Img</h1>${svg}` + Object.keys(imgs).map(n => `<p><img src="../${n}" alt="x"/></p>`).join('') + '<p><img src="../img/falta.png"/></p>';
  const [{ book: k }] = await azw3(page, [await epub({ chapters: [body], images: imgs, cover: false })]);
  expect(k.flows).toHaveLength(2);
  expect(k.flows[1].toString()).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(k.flows[1].toString()).toContain('xlink:href="kindle:embed:0001?mime=image/png"');
  expect(k.flows[1].toString()).not.toContain('<script');
  expect(k.files[0]).toContain('<img src="kindle:flow:0001?mime=image/svg+xml"/>');   // sem CSS: o SVG é o fluxo 1
  const kinds = k.resources.map(r => r[0] === 0x89 ? 'png' : r[0] === 0xff ? 'jpeg' : r.toString('latin1', 0, 3));
  expect(kinds).toEqual(['png', 'jpeg', 'jpeg', 'GIF', 'jpeg']);   // webp, bmp e svg (sem transparência) viram JPEG; PNG e GIF passam
  expect(k.files[0]).not.toContain('falta.png');                  // imagem que não existe: o <img> sai
});

test('AZW3: EPUB 2 com NCX, livro da direita para a esquerda e sumário que volta atrás', async ({ page }) => {
  const [{ book: k }] = await azw3(page, [await epub({ version: 2, rtl: true, lang: 'ja' })]);
  expect(k.exth[525]).toBe('horizontal-rl');
  expect(k.head.lang).toBe(17);
  expect(k.toc.map(t => t.title)).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  // sumário fora de ordem: entradas que voltam atrás saem
  const b = await A.makeEpub({ cover: false });
  const z = await JSZip.loadAsync(b);
  const nav = (await z.file('OEBPS/nav.xhtml').async('string')).replace(/<ol>.*<\/ol>/s, '<ol><li><a href="texto/c2.xhtml">Dois</a></li><li><a href="texto/c1.xhtml">Um</a></li><li><span>Só rótulo</span><ol><li><a href="texto/c3.xhtml">Três</a></li></ol></li></ol>');
  z.file('OEBPS/nav.xhtml', nav);
  const [{ book: k2 }] = await azw3(page, [A.file('x.epub', Buffer.from(await z.generateAsync({ type: 'uint8array' })))]);
  expect(k2.toc.map(t => t.title)).toEqual(['Dois', 'Só rótulo', 'Três']);
});

test('AZW3: sem sumário no EPUB, um item por capítulo; PDF passa por EPUB antes', async ({ page }) => {
  const [{ book: k }] = await azw3(page, [await epub({ nav: false, cover: false })]);
  expect(k.toc.map(t => t.title)).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  const [{ name, book: p } ] = await azw3(page, [A.file('livro.pdf', await A.makeTextPdf(), 'application/pdf')]);
  expect(name).toBe('Livro de Teste (Fulana de Tal).azw3');
  expect(p.text).toContain(A.LOREM[0]);
  expect(p.toc.map(t => t.title)).toEqual(['Capítulo 1', 'Capítulo 2']);
});

test('KFX: contêiner CONT, texto, sumário, metadados, capa e SHA-1 conferem', async ({ page }) => {
  const [{ name, book: x }] = await kfx(page, [await epub({ chapters: [A.RICH_CHAPTER, LINKS] })]);
  expect(name).toBe('O Nome do Vento (Patrick Rothfuss).kfx');
  expect(x.shaOk).toBe(true);
  expect(x.meta).toMatchObject({ title: 'o nome do vento', author: 'Patrick Rothfuss', language: 'pt', cde_content_type: 'EBOK', cover_image: 'e0' });
  expect(x.meta.asset_id).toMatch(/^CR![A-Z0-9]{28}$/);
  expect(x.nav).toEqual(['Capítulo 1', 'Seção 1.1', 'Capítulo 2']);
  expect(x.sections).toBe(2);
  for (const t of ['Capítulo Rico', 'Nível 6', 'Linha centralizada', 'primeiro item', 'codigo  com   espacos\n  e segunda linha', 'Antes da quebra\ndepois da quebra', 'Fim do capítulo dois.'])
    expect(x.strings, t).toContain(t);
  expect(x.text).not.toContain('var nao');
  expect(x.images).toHaveLength(1);
  expect(x.images[0].subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await expect(page.locator('#note')).toHaveText(/^Gera KFX/);
  await expect(page.locator('#sepBtn')).toHaveText('Baixar o KFX');
});

test.fixme('KFX: texto de elemento escondido (hidden) não deveria aparecer no livro', async ({ page }) => {
  // O AZW3 mantém o atributo hidden (o Kindle esconde) e o EPUB → PDF pula; o KFX põe o texto no livro.
  const [{ book: x }] = await kfx(page, [await epub({ chapters: ['<h1>Um</h1><p>visível</p><p hidden="hidden">texto escondido</p>'], cover: false })]);
  expect(x.text).not.toContain('texto escondido');
});

test('KFX: capítulo enorme é partido em blocos de até 8 KB; imagens WebP viram JPEG', async ({ page }) => {
  const long = Array.from({ length: 4000 }, (_, i) => 'palavra' + i).join(' ');
  const [{ book: x }] = await kfx(page, [await epub({ chapters: [`<h1>Longo</h1><p>${long}</p><p><img src="../img/w.webp"/></p>`], images: { 'img/w.webp': await A.drawImage(page, { type: 'image/webp' }) }, cover: false })]);
  for (const s of x.strings) expect(Buffer.byteLength(s)).toBeLessThanOrEqual(8000);
  expect(x.strings.join('').replace(/\s+/g, ' ')).toContain(long.slice(0, 5000));
  expect(x.of(145).length).toBeGreaterThan(1);   // mais de um pool de texto
  expect(x.images[0].subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
});

test('KFX: sem sumário, "Capítulo N"; lote com PDF e EPUB', async ({ page }) => {
  const outs = await kfx(page, [await epub({ nav: false, cover: false }, 'a.epub'), A.file('b.pdf', await A.makeTextPdf({ title: 'Outro' }))]);
  expect(outs.map(o => o.name).sort()).toEqual(['O Nome do Vento (Patrick Rothfuss).kfx', 'Outro (Fulana de Tal).kfx']);
  const e = outs.find(o => /Vento/.test(o.name)).book;
  expect(e.nav).toEqual(['Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  await expect(page.locator('#sepBtn')).toHaveText('Baixar todos os KFX (sem ZIP)');
});

test('arquivo que não é EPUB nem PDF', async ({ page }) => {
  await open(page, 'kindle');
  await page.setInputFiles('#file', [A.file('nota.txt', Buffer.from('só texto'))]);
  await page.click('#go');
  await expect(page.locator('#list .s.err')).toHaveText('Erro: não é EPUB nem PDF.');
});

test('trocar o formato muda nota, botão e extensão', async ({ page }) => {
  await open(page, 'kindle');
  await expect(page.locator('#note')).toHaveText(/^Gera AZW3/);
  await page.selectOption('#kFmt', 'kfx');
  await expect(page.locator('#note')).toHaveText(/^Gera KFX/);
  await expect(page.locator('#optP2E')).toBeVisible();   // PDF passa pelas opções do PDF → EPUB
  await page.check('#pOcr');
  await expect(page.locator('#optOCR')).toBeVisible();
});
