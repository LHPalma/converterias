// Unitários (Node puro, sem navegador): a lógica dos módulos de src/ que não depende da página.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('../vendor/jszip.min.js');
const Spell = require('../src/spell.js');
const Ocr = require('../src/ocr.js');
const { ROOT } = require('./helpers');

// azw3.js e kfx.js só existem como globais do navegador: carrega num contexto isolado
const load = (file, name) => {
  const ctx = { TextEncoder, TextDecoder, Uint8Array, console };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8') + `\nthis.${name} = ${name};`, ctx);
  return ctx[name];
};

test.describe('Spell (corretor do OCR)', () => {
  let dict;
  test.beforeAll(() => {
    dict = new Spell.Dict(fs.readFileSync(path.join(ROOT, 'vendor/ocr/pt.aff'), 'utf8'), fs.readFileSync(path.join(ROOT, 'vendor/ocr/pt.dic'), 'utf8'));
  });
  const fix = (text, low = []) => { const stats = { fixed: [] }; return [Spell.fixText(text, dict, new Set(low), stats), stats.fixed]; };

  test('reconhece palavras do dicionário com flexões', () => {
    for (const w of ['casa', 'casas', 'navegar', 'navegação', 'construção']) expect(dict.known(w), w).toBe(true);
    expect(dict.known('xptoqwe')).toBe(false);
  });

  test('corrige palavra duvidosa do OCR com uma correção clara', () => {
    const [out, fixed] = fix('o paralelepipedo caiu', ['paralelepipedo']);
    expect(out).toBe('o paralelepípedo caiu');
    expect(fixed).toEqual([{ de: 'paralelepipedo', para: 'paralelepípedo' }]);
  });

  test('separa palavra funcional colada no começo', () => {
    expect(fix('quevirão amanhã', ['quevirão'])[0]).toBe('que virão amanhã');
  });

  test('junta hifenização de fim de linha que o OCR não juntou', () => {
    expect(fix('a constru- ção acabou')[0]).toBe('a construção acabou');
    expect(fix('o parale- lepípedo caiu')[0]).toBe('o paralelepípedo caiu');
  });

  test('não mexe no que não deve', () => {
    const keep = [
      'O computa- dor ligou',                         // "computa" existe: pode ser hífen de verdade
      'Joaozinho chegou',                             // nome próprio sem dúvida do OCR
      'O PARALELEPIPEDO',                             // sigla / maiúsculas
      'Ligue 2023 ou veja www.exemplo.com/abcdefghij', // número e endereço
      'Ele viu a casa amarela',                       // tudo certo
    ];
    for (const t of keep) expect(fix(t)[0], t).toBe(t);
  });
});

test.describe('Ocr (reconstrução do texto)', () => {
  const line = (t, y, c = 95) => ({ text: t, confidence: c, words: t.split(' ').map(w => ({ text: w, confidence: c })), bbox: { x0: 100, x1: 1100, y0: y, y1: y + 30 } });

  test('rowsFromLines: ordena, converte para pontos e descarta lixo', () => {
    const rows = Ocr.rowsFromLines([
      line('segunda linha do texto', 300),
      line('| primeira linha do texto', 200),   // barra de margem lida como letra
      line('~~ ## %%', 400, 30),                // mancha
      line('lixo qualquer aqui', 500, 40),      // confiança baixa demais
    ], 1190);
    expect(rows.map(r => r.t)).toEqual(['primeira linha do texto', 'segunda linha do texto']);
    expect(rows[0].x0).toBeCloseTo(50);       // 1190 px -> 595 pt
    expect(rows[0].y).toBeCloseTo(107.5);
  });

  test('countLow conta só palavras duvidosas com letras', () => {
    const rows = [{ w: [{ t: 'certa', c: 99 }, { t: 'duvidosa', c: 10 }, { t: '12', c: 10 }] }];
    expect(Ocr.countLow([{ rows }])).toBe(1);
  });

  test('buildEpub: junta as linhas em parágrafos e monta um EPUB válido', async () => {
    // página cheia (com até 11 linhas o app a trata como ilustração): 3 parágrafos de 5 linhas, recuo na primeira
    const words = 'Era uma vez um conversor que rodava inteiro no navegador sem mandar nada para servidor algum e todo mundo ficou feliz com isso'.split(' ');
    const rows = [], paras = [];
    let y = 100;
    for (let p = 0; p < 3; p++) {
      const ws = words.map(w => w + (p + 1)).concat(words.map(w => w + (p + 1))).slice(0, 30);
      paras.push(ws.join(' '));
      for (let k = 0; k < ws.length; k += 6, y += 16) {
        const t = ws.slice(k, k + 6).join(' ');
        rows.push({ x0: k ? 60 : 75, x1: 535, y, t, w: t.split(' ').map(x => ({ t: x, c: 95 })), c: 95 });
      }
      y += 6;
    }
    const pages = [{ W: 595, H: 842, rows, ink: 0.05, img: null }];
    const r = await Ocr.buildEpub(JSZip, pages, { title: 'Livro', author: 'Autora', cover: 0 });
    expect(r.chapters).toBe(1);
    const zip = await JSZip.loadAsync(r.bytes);
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    const opf = await zip.file('OEBPS/content.opf').async('string');
    expect(opf).toContain('<dc:title>Livro</dc:title>');
    const xhtml = await zip.file('OEBPS/c01.xhtml').async('string');
    for (const t of paras) expect(xhtml).toContain('<p>' + t + '</p>');
  });
});

test.describe('Azw3 (gravador KF8)', () => {
  const Azw3 = load('azw3.js', 'Azw3');

  // descompressor PalmDOC de referência (o formato que o Kindle lê)
  const palmDecompress = src => {
    const out = [];
    for (let i = 0; i < src.length;) {
      const c = src[i++];
      if (c === 0 || (c >= 9 && c <= 0x7f)) out.push(c);
      else if (c <= 8) for (let k = 0; k < c; k++) out.push(src[i++]);
      else if (c >= 0xc0) out.push(32, c ^ 0x80);
      else { const v = (c << 8) | src[i++], d = (v >> 3) & 0x7ff, n = (v & 7) + 3; for (let k = 0; k < n; k++) out.push(out[out.length - d]); }
    }
    return Uint8Array.from(out);
  };

  test('palmCompress: ida e volta sem perda, e comprime texto repetitivo', () => {
    const enc = new TextEncoder();
    const samples = [
      '', 'a', 'ab ab ab ab ab ab ab ab ab ab',
      '<p>Olá, mundo! Ação, coração, informação.</p>'.repeat(60),
      String.fromCharCode(...Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)),
    ];
    for (const s of samples) {
      const src = typeof s === 'string' && s.length < 4096 ? enc.encode(s).subarray(0, 4096) : Uint8Array.from(s, ch => ch.charCodeAt(0));
      const z = Azw3.palmCompress(src);
      expect(Buffer.from(palmDecompress(z))).toEqual(Buffer.from(src));
    }
    const text = enc.encode('<p>Olá, mundo! Ação, coração, informação.</p>'.repeat(60)).subarray(0, 4096);
    expect(Azw3.palmCompress(text).length).toBeLessThan(text.length / 3);
  });

  test('vwi e b32 (números dos índices)', () => {
    expect([...Azw3.vwi(0)]).toEqual([0x80]);
    expect([...Azw3.vwi(127)]).toEqual([0xff]);
    expect([...Azw3.vwi(128)]).toEqual([0x01, 0x80]);
    expect(Azw3.b32(0, 4)).toBe('0000');
    expect(Azw3.b32(31)).toBe('V');
    expect(Azw3.b32(32 * 32 + 1, 4)).toBe('0101');
  });
});

test.describe('Kfx (Amazon Ion)', () => {
  const Kfx = load('kfx.js', 'Kfx');

  test('sha1 confere com o do Node', () => {
    const crypto = require('crypto');
    for (const s of ['', 'abc', 'Converterias '.repeat(100)]) {
      const got = Kfx._sha1(new TextEncoder().encode(s));
      const hex = typeof got === 'string' ? got : Buffer.from(got).toString('hex');
      expect(hex).toBe(crypto.createHash('sha1').update(s).digest('hex'));
    }
  });
});
