// Unitários de src/kfx.js: codificador Amazon Ion (conferido pelo decodificador independente de tests/apoio), SHA-1 e imagens.
const crypto = require('crypto');
const { test, expect, inPage } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { ionDoc, Sym } = require('../apoio/leitores');

test('Ion: cada tipo vai e volta', async ({ page }) => {
  const docs = await page.evaluate(() => {
    const BVM = [0xe0, 1, 0, 0xea], doc = v => [...BVM, ...Kfx._ion(v)];
    return [
      null, true, false, 0, 1, 255, 256, 2 ** 40, -1, -300, 1.5, -0.25,
      '', 'curto', 'texto com mais de catorze bytes, acentuado: ação',
      'x'.repeat(15), 'y'.repeat(200), 'z'.repeat(20000),
      [1, 'a', [2, [3]]], { 5: 'cinco', 10: [true, null], 600: { 1: 2 } },
    ].map(doc).concat([doc(new Uint8Array([1, 2, 3]))]);
  });
  const vals = docs.map(d => ionDoc(Buffer.from(d)));
  expect(vals.slice(0, 20)).toEqual([
    null, true, false, 0, 1, 255, 256, 2 ** 40, -1, -300, 1.5, -0.25,
    '', 'curto', 'texto com mais de catorze bytes, acentuado: ação',
    'x'.repeat(15), 'y'.repeat(200), 'z'.repeat(20000),
    [1, 'a', [2, [3]]], { 5: 'cinco', 10: [true, null], 600: { 1: 2 } },
  ]);
  expect(vals[20]).toEqual(Buffer.from([1, 2, 3]));
});

test('Ion: símbolos e anotações (como o KFX usa)', async ({ page }) => {
  // o módulo não exporta Sym/Annot: são reconhecidos pelo container, então gera um contêiner mínimo e lê o símbolo de volta
  const bytes = await page.evaluate(() => {
    const st = { names: ['meu_simbolo'], maxId: 788 };
    const frag = Kfx._entity(145, 788, { 4: 'valor', 146: ['a', 'b'] });
    const raw = Kfx._entity(417, 789, new Uint8Array([9, 9, 9]), true);
    return [...Kfx._container([frag, raw], st, 'CR!TESTE')];
  });
  const buf = Buffer.from(bytes);
  expect(buf.toString('latin1', 0, 4)).toBe('CONT');
  const info = ionDoc(buf.subarray(buf.readUInt32LE(10), buf.readUInt32LE(10) + buf.readUInt32LE(14)));
  expect(info[409]).toBe('CR!TESTE');
  expect(info[412]).toBe(4096);
  const docSym = ionDoc(buf.subarray(info[415], info[415] + info[416]));
  expect(docSym.annots).toEqual([3]);                                  // $ion_symbol_table
  expect(docSym.value[7]).toEqual(['meu_simbolo']);
  expect(docSym.value[6][0]).toEqual({ 4: 'YJ_symbols', 5: 10, 8: 787 });
  const hdrLen = buf.readUInt32LE(6), payload = buf.subarray(hdrLen);
  const json = buf.toString('latin1', buf.readUInt32LE(10) + buf.readUInt32LE(14), hdrLen);
  expect(json).toContain(`"kfxgen_payload_sha1",value:"${crypto.createHash('sha1').update(payload).digest('hex')}"`);
  // tabela de fragmentos: id, tipo, posição e tamanho
  const idx = info[413];
  expect([buf.readUInt32LE(idx), buf.readUInt32LE(idx + 4)]).toEqual([788, 145]);
  expect([buf.readUInt32LE(idx + 24), buf.readUInt32LE(idx + 28)]).toEqual([789, 417]);
  const second = Number(buf.readBigUInt64LE(idx + 32));
  expect(payload.subarray(second + payload.readUInt32LE(second + 6))).toEqual(Buffer.from([9, 9, 9]));   // bruto, sem Ion
  expect(Sym).toBeTruthy();
});

test('sha1 em JS confere com o do Node (inclusive nos limites de bloco)', async ({ page }) => {
  const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'ação'.repeat(1000)];
  const got = await page.evaluate(i => i.map(s => Kfx._sha1(new TextEncoder().encode(s))), inputs);
  expect(got).toEqual(inputs.map(s => crypto.createHash('sha1').update(s).digest('hex')));
});

test('imgDims: JPEG, PNG, GIF e desconhecido', async ({ page }) => {
  const jpg = await A.drawImage(page, { w: 33, h: 44, type: 'image/jpeg' });
  const r = await inPage(page, list => list.map(b => Kfx._imgDims(b)), [jpg, A.ICON, A.GIF_1x1, Buffer.from('xx'), Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2])]);
  expect(r).toEqual([{ mime: 'image/jpeg', w: 33, h: 44 }, { mime: 'image/png', w: 192, h: 192 }, { mime: 'image/gif', w: 1, h: 1 }, null, { mime: 'image/jpeg', w: 0, h: 0 }]);
});

test('convert: EPUB sem nada no spine dá erro', async ({ page }) => {
  const bad = await A.makeEpub({ chapters: [] });
  await expect(inPage(page, b => Kfx.convert(b), bad)).rejects.toThrow(/EPUB sem conteúdo no spine/);
});

test('convert: listas, tabelas e células com blocos dentro; <br> e <pre>', async ({ page }) => {
  const { readKfx } = require('../apoio/leitores');
  const book = await A.makeEpub({ cover: false, chapters: ['<h2>Listas</h2><ul><li><p>item com parágrafo</p><p>e outro</p></li><li></li><li>simples</li></ul><ol><li>um</li></ol>' +
    '<table><thead><tr><th>A</th><th><p>B em bloco</p></th></tr></thead><tbody><tr><td></td><td>2</td></tr></tbody></table><hr/>' +
    '<div><p id="alvo">dentro de div</p><blockquote>citação</blockquote></div><p>linha<br/>quebrada</p><pre>  código\n    recuado\n</pre><p><span>em linha</span> <a href="#alvo">link</a></p>'] });
  const x = readKfx(await inPage(page, async b => (await Kfx.convert(b)).bytes, book));
  for (const t of ['item com parágrafo', 'e outro', 'simples', 'um', 'A', 'B em bloco', '2', 'dentro de div', 'citação', 'linha\nquebrada', '  código\n    recuado', 'em linha link'])
    expect(x.strings, t).toContain(t);
  const kinds = JSON.stringify(x.of(259)[0].value);
  for (const el of [276, 277, 278, 279, 454, 596]) expect(kinds, String(el)).toContain(`{"id":${el}}`);   // lista, item, tabela, linha, tbody, hr
});
