// Unitários de src/azw3.js (gravador KF8): compressão, números, imagens, fontes, CSS, índices e leitura do EPUB.
const zlib = require('zlib');
const { test, expect, inPage } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { palmDecompress } = require('../apoio/leitores');

test('palmCompress: ida e volta sem perda em textos difíceis, e comprime texto repetitivo', async ({ page }) => {
  const samples = [
    Buffer.alloc(0), Buffer.from('a'), Buffer.from('ab ab ab ab ab ab ab ab ab ab ab'),
    Buffer.from('<p>Olá, mundo! Ação, coração, informação.</p>'.repeat(90)).subarray(0, 4096),
    Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)),           // bytes "especiais" (1-8 e 0x80+)
    Buffer.from(Array.from({ length: 3000 }, (_, i) => [1, 2, 3, 0x80, 0xff, 0, 9][i % 7])),
    Buffer.from(' A B C D @ ~ \x7f'.repeat(100)),                                     // espaço + caractere (0x40-0x7f) vira 1 byte
    Buffer.from('xyz'.repeat(1400)).subarray(0, 4096),                                // repetição longa (distância e tamanho máximos)
  ];
  const out = await inPage(page, list => list.map(b => Azw3.palmCompress(b)), samples);
  out.forEach((z, k) => expect(palmDecompress(z).equals(samples[k]), `amostra ${k}`).toBe(true));
  expect(out[3].length).toBeLessThan(samples[3].length / 3);
  expect(out[6].length).toBeLessThan(samples[6].length * 0.6);
});

test('vwi, b32, ulen e clean', async ({ page }) => {
  const r = await page.evaluate(() => ({
    vwi: [0, 1, 127, 128, 16383, 16384, 2 ** 31].map(n => [...Azw3.vwi(n)]),
    b32: [Azw3.b32(0, 4), Azw3.b32(31), Azw3.b32(32 * 32 + 1, 4), Azw3.b32(1e6), Azw3.b32(5, 10)],
    ulen: ['', 'abc', 'ação', '€', '😀', 'a😀b'].map(Azw3._ulen),
    clean: Azw3._clean('a\u0001b\u000bc\ud800d\udc00e😀f￾'),
  }));
  expect(r.vwi).toEqual([[0x80], [0x81], [0xff], [0x01, 0x80], [0x7f, 0xff], [0x01, 0x00, 0x80], [0x08, 0x00, 0x00, 0x00, 0x80]]);
  expect(r.b32).toEqual(['0000', 'V', '0101', 'UGI0', '0000000005']);
  expect(r.ulen).toEqual([0, 3, 6, 3, 4, 6]);
  expect(r.clean).toBe('abcde😀f');
});

test('sniff e jpegInfo: tipo, tamanho, progressivo e orientação', async ({ page }) => {
  const jpg = await A.drawImage(page, { w: 37, h: 21, type: 'image/jpeg' });
  const prog = Buffer.from(jpg); for (let i = 2; i < prog.length; i++) if (prog[i] === 0xff && prog[i + 1] === 0xc0) { prog[i + 1] = 0xc2; break; }
  const webp = await A.drawImage(page, { type: 'image/webp' });
  const r = await inPage(page, (list, j, p, e) => ({
    kinds: list.map(b => Azw3._sniff(b)),
    info: Azw3._jpegInfo(j), prog: Azw3._jpegInfo(p).progressive, exif: Azw3._jpegInfo(e).orient,
  }), [jpg, A.ICON, A.GIF_1x1, webp, A.bmp(2, 2), Buffer.from('nada aqui')], jpg, prog, A.withExif(jpg, 8, true));
  expect(r.kinds).toEqual(['jpeg', 'png', 'gif', 'webp', 'bmp', null]);
  expect(r.info).toEqual({ comps: 3, progressive: false, orient: 1, w: 37, h: 21 });
  expect(r.prog).toBe(true);
  expect(r.exif).toBe(8);
});

test('prepareImage: PNG/JPEG/GIF passam direto; o resto é convertido para o Kindle', async ({ page }) => {
  const jpg = await A.drawImage(page, { w: 50, h: 40, type: 'image/jpeg' });
  const huge = await A.drawImage(page, { w: 5000, h: 1000, type: 'image/png' });
  const alpha = await A.drawImage(page, { w: 30, h: 30, alpha: true, draw: 'circle', type: 'image/webp' });
  const svgVb = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><rect width="300" height="150" fill="red"/></svg>');
  const svgNoSize = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  const r = await inPage(page, async list => {
    const out = [];
    for (const b of list) { const x = await Azw3._prepareImage(b, 'image/x'); out.push(x && { mime: x.mime, w: x.w, h: x.h, same: x.bytes === b }); }
    return out;
  }, [A.ICON, jpg, A.GIF_1x1, A.withExif(jpg, 6), A.bmp(20, 10), alpha, huge, svgVb, svgNoSize, Buffer.from('lixo')]);
  expect(r).toEqual([
    { mime: 'image/png', w: 192, h: 192, same: true },
    { mime: 'image/jpeg', w: 50, h: 40, same: true },
    { mime: 'image/gif', w: 1, h: 1, same: true },
    { mime: 'image/jpeg', w: 40, h: 50, same: false },    // EXIF girado: endireita
    { mime: 'image/jpeg', w: 20, h: 10, same: false },    // BMP
    { mime: 'image/png', w: 30, h: 30, same: false },     // WebP com transparência fica PNG
    { mime: 'image/png', w: 3200, h: 640, same: false },  // maior que 4096: reduz para 3200
    { mime: 'image/jpeg', w: 300, h: 150, same: false },  // SVG pelo viewBox
    { mime: 'image/png', w: 300, h: 150, same: false },   // SVG sem tamanho: o tamanho padrão do Chrome, fundo transparente
    null,
  ]);
});

test('thumbnail: miniatura JPEG de até 330 px de altura', async ({ page }) => {
  const r = await inPage(page, async (big, small) => {
    const dims = async b => { const bm = await createImageBitmap(new Blob([b])); return [bm.width, bm.height]; };
    const t1 = await Azw3._thumbnail({ bytes: big, mime: 'image/png' }), t2 = await Azw3._thumbnail({ bytes: small, mime: 'image/png' });
    return { t1: await dims(t1), t2: await dims(t2), jpeg: t1[0] === 0xff, bad: await Azw3._thumbnail({ bytes: new Uint8Array([1, 2]), mime: 'image/png' }) };
  }, A.ICON_BIG, A.ICON);
  expect(r).toEqual({ t1: [330, 330], t2: [192, 192], jpeg: true, bad: null });
});

test('sha1: crypto.subtle e a versão em JS (páginas não seguras) dão o mesmo resultado', async ({ page }) => {
  const crypto = require('crypto');
  const inputs = ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'Converterias '.repeat(500)];
  const r = await page.evaluate(async inputs => {
    const hex = u => [...u].map(x => x.toString(16).padStart(2, '0')).join(''), enc = new TextEncoder();
    const a = []; for (const s of inputs) a.push(hex(await Azw3._sha1(enc.encode(s))));
    const subtle = Object.getOwnPropertyDescriptor(Crypto.prototype, 'subtle');
    Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true });
    const b = []; try { for (const s of inputs) b.push(hex(await Azw3._sha1(enc.encode(s)))); } finally { Object.defineProperty(Crypto.prototype, 'subtle', subtle); }
    return { a, b };
  }, inputs);
  const want = inputs.map(s => crypto.createHash('sha1').update(s).digest('hex'));
  expect(r.a).toEqual(want);
  expect(r.b).toEqual(want);
});

test('fontRecord: cabeçalho FONT, chave XOR e dados zlib que voltam à fonte original', async ({ page }) => {
  const rec = await inPage(page, f => Azw3._fontRecord(f), A.FAKE_TTF);
  expect(rec.toString('latin1', 0, 4)).toBe('FONT');
  expect(rec.readUInt32BE(4)).toBe(A.FAKE_TTF.length);
  expect([rec.readUInt32BE(8), rec.readUInt32BE(12), rec.readUInt32BE(16), rec.readUInt32BE(20)]).toEqual([3, 44, 20, 24]);
  const key = rec.subarray(24, 44), z = Buffer.from(rec.subarray(44));
  for (let i = 0; i < Math.min(1040, z.length); i++) z[i] ^= key[i % 20];
  expect(zlib.inflateSync(z).equals(A.FAKE_TTF)).toBe(true);
});

test('normCss: só regras de estilo e @page; descarta @-regras, namespaces e blocos quebrados', async ({ page }) => {
  const r = await page.evaluate(() => [
    'p { a: 1 }  /* c */ @media x { p { b: 2 } } h1 { c: "}" }',
    '@import "x.css"; @charset "utf-8"; div{d:4}',
    'epub|type { x: y } [epub|type~="n"] { z: 1 } svg|a { w: 1 } a[href|="en"] { ok: 1 }',
    '@page { margin: 0 } @font-face { src: url(x) } @keyframes k { from { a: b } }',
    'p { a: 1 } q { b: 2 ',
    ';;; } ok { c: 3 }',
  ].map(Azw3._normCss));
  expect(r).toEqual([
    'p { a: 1 }\nh1 { c: "}" }',
    'div{d:4}',
    'a[href|="en"] { ok: 1 }',
    '@page { margin: 0 }',
    'p { a: 1 }',
    'ok { c: 3 }',
  ]);
});

test('fontFaces e fixCss: fontes TTF/OTF do livro ficam; urls viram recursos (ou none)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const res = p => p.endsWith('falta.png') ? null : 'R:' + p, font = p => 'F:' + p;
    return {
      faces: Azw3._fontFaces('@font-face { font-family: "A"; font-style: italic; src: url("../f/a.ttf") format("truetype"), url(a.woff) } @font-face { src: url(b.ttf) } @font-face { font-family: C; src: url(c.woff2) } @font-face { font-family: D }', 'OEBPS/css/s.css', font),
      fixed: Azw3._fixCss('h1 { background: url(\'../img/a.png\') } h2 { background: url(data:image/png;base64,xx) } h3 { background: url(#frag) } h4 { background: url(falta.png) }', 'OEBPS/css/s.css', res, font),
    };
  });
  expect(r.faces).toEqual(['@font-face { font-family: "A"; font-style: italic; src: url(F:OEBPS/f/a.ttf) }']);
  expect(r.fixed).toBe('h1 { background: url(R:OEBPS/img/a.png) }\nh2 { background: url(data:image/png;base64,xx) }\nh3 { background: url(#frag) }\nh4 { background:none}');
});

test('buildCncx e buildIndex: textos com tamanho VWI, cabeçalho INDX/TAGX e IDXT', async ({ page }) => {
  const r = await page.evaluate(() => {
    const c = Azw3._buildCncx(['um', 'dois', 'três']);
    const big = Azw3._buildCncx(Array.from({ length: 3000 }, (_, i) => 'texto de rótulo número ' + i));
    const recs = Azw3._buildIndex([[1, 1, 1, 0]], Array.from({ length: 5000 }, (_, i) => ({ key: String(i).padStart(6, '0'), ctrl: Uint8Array.of(1), data: Azw3.vwi(i) })), 2);
    const s = (u, a, b) => String.fromCharCode(...u.subarray(a, b)), u32 = (u, o) => new DataView(u.buffer, u.byteOffset).getUint32(o);
    return { offs: c.offs, rec0: [...c.records[0]], bigRecs: big.records.length, bigLast: big.offs[2999],
      n: recs.length, magic: s(recs[0], 0, 4), type: u32(recs[0], 16), count: u32(recs[0], 24), total: u32(recs[0], 36), ncncx: u32(recs[0], 52), tagx: s(recs[0], 192, 196),
      dataMagic: recs.slice(1).map(r => s(r, 0, 4)), entries: recs.slice(1).reduce((n, r) => n + u32(r, 24), 0), sizes: recs.map(r => r.length % 4) };
  });
  expect(r.offs).toEqual([0, 3, 8]);
  expect(r.rec0.slice(0, 3)).toEqual([0x82, 0x75, 0x6d]);   // vwi(2) + "um"
  expect(r.bigRecs).toBe(2);                                // passa de 64 KB: segundo registro, deslocamentos a partir de 0x10000
  expect(r.bigLast).toBeGreaterThan(0x10000);
  expect(r).toMatchObject({ magic: 'INDX', type: 2, total: 5000, ncncx: 2, tagx: 'TAGX' });
  expect(r.n - 1).toBe(r.count);
  expect(r.count).toBeGreaterThan(1);                       // dividido em vários registros de até 60 KB
  expect(r.dataMagic.every(m => m === 'INDX')).toBe(true);
  expect(r.entries).toBe(5000);
  expect(r.sizes.every(x => x === 0)).toBe(true);           // tudo alinhado em 4 bytes
});

test('tbsRecord: o tamanho declarado no fim de cada sequência confere', async ({ page }) => {
  const r = await page.evaluate(() => {
    const pre = [
      { idx: 0, pos: 0, len: 9000, depth: 0 }, { idx: 2, pos: 100, len: 3000, depth: 1, parent: 0 }, { idx: 3, pos: 3100, len: 5900, depth: 1, parent: 0 },
      { idx: 1, pos: 9000, len: 5000, depth: 0 },
    ];
    return [[0, 4096], [4096, 8192], [8192, 12288], [12288, 16384], [20000, 24096]].map(([s, t]) => [...Azw3._tbsRecord(pre, s, t)]);
  });
  const size = d => { let n = 0; for (const v of d.slice(-4)) { if (v & 0x80) n = 0; n = (n << 7) | (v & 0x7f); } return n; };
  for (const d of r) expect(size(d)).toBe(d.length);
  expect(r[4]).toEqual([0x81]);   // registro sem entradas: só o tamanho
  expect(r[0].length).toBeGreaterThan(3);
});

test('_readEpub: metadados, sumário (nav, ou NCX se o nav estiver vazio) e capa', async ({ page }) => {
  const nav = await A.makeEpub({ cover: 'meta' });
  const ncxOnly = await (async () => {
    const JSZip = require('../../vendor/jszip.min.js'), z = await JSZip.loadAsync(await A.makeEpub({ version: 3, ncx: true }));
    z.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><p>vazio</p></nav></body></html>');
    return Buffer.from(await z.generateAsync({ type: 'uint8array' }));
  })();
  const r = await inPage(page, async (a, b, bad) => {
    const x = await Azw3._readEpub(a), y = await Azw3._readEpub(b);
    let err = []; for (const z of bad) { try { await Azw3._readEpub(z); err.push('ok'); } catch (e) { err.push(e.message); } }
    const flat = t => t.map(n => n.title + (n.frag ? '#' + n.frag : '') + (n.items.length ? '[' + flat(n.items) + ']' : '')).join(',');
    return { book: x.book, cover: x.cover, toc: flat(x.toc), spine: x.spine.map(s => s.path), ncx: flat(y.toc), err };
  }, nav, ncxOnly, [await A.makeEpub({ chapters: [] }), Buffer.from(await (async () => { const JSZip = require('../../vendor/jszip.min.js'), z = new JSZip(); z.file('a', 'b'); return z.generateAsync({ type: 'uint8array' }); })())]);
  expect(r.book).toEqual({ title: 'o nome do vento', authors: ['Patrick Rothfuss'], lang: 'pt', publisher: 'Editora Teste', description: 'Um <b>livro</b> de teste.', subjects: ['Ficção'], date: '2020-05-01', rtl: false, writing: '' });
  expect(r.cover).toBe('OEBPS/img/capa.png');
  expect(r.toc).toBe('Capítulo 1[Seção 1.1#t1],Capítulo 2,Capítulo 3');
  expect(r.spine).toEqual(['OEBPS/texto/c1.xhtml', 'OEBPS/texto/c2.xhtml', 'OEBPS/texto/c3.xhtml']);
  expect(r.ncx).toBe('Capítulo 1,Capítulo 2,Capítulo 3');
  expect(r.err).toEqual(['EPUB sem conteúdo no spine.', 'Não parece um EPUB válido (sem container.xml).']);
});

test('convert: título vazio, sem autor e capítulo vazio ainda geram um livro', async ({ page }) => {
  const book = await A.makeEpub({ title: '', authors: [], chapters: ['', '<p>   </p>', '<h1>ok</h1>'], cover: false, publisher: '', description: '', subjects: [] });
  const r = await inPage(page, async b => { const o = await Azw3.convert(b); return { title: o.title, authors: o.authors, sections: o.sections, images: o.images, bytes: o.bytes }; }, book);
  expect(r).toMatchObject({ title: 'Livro', authors: [], sections: 3, images: 0 });
  const { readAzw3 } = require('../apoio/leitores');
  const k = readAzw3(r.bytes);
  expect(k.exth[100]).toBe('Desconhecido');
  expect(k.files[0]).toMatch(/<body aid="0"><div aid="1"><\/div><\/body>/);   // documento vazio vira um bloco vazio
});
