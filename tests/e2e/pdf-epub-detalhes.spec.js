// PDF → EPUB, casos finos da reconstrução: equações, capitular, marcadores desenhados, logotipo repetido,
// acentos do TeX em trechos separados, títulos em duas linhas, cabeçalho de tabela em duas linhas e glifos sem Unicode.
const { test, expect, run } = require('../apoio/app');
const A = require('../apoio/arquivos');
const { readEpub } = require('../apoio/leitores');
const { PDFDocument, StandardFonts, PDFName, rgb } = require('../../vendor/pdf-lib.min.js');

const T = 'Este parágrafo tem frases suficientes para ocupar várias linhas da página, como num livro de verdade, e assim o conversor mede a margem.';

async function bookWith(draw, { pages = 3, title = 'Detalhes' } = {}) {
  const pdf = await PDFDocument.create();
  const F = { r: await pdf.embedFont(StandardFonts.TimesRoman), b: await pdf.embedFont(StandardFonts.TimesRomanBold), i: await pdf.embedFont(StandardFonts.TimesRomanItalic) };
  pdf.setTitle(title);
  const ctx = { pdf, F, W: 420, H: 620 };
  ctx.para = (pg, y, s = T, x0 = 50, x1 = 370, indent = 15) => {
    let line = '', first = true;
    const out = () => { pg.drawText(line, { x: x0 + (first ? indent : 0), y, size: 11, font: F.r }); y -= 15; line = ''; first = false; };
    for (const w of s.split(' ')) { const t = line ? line + ' ' + w : w; if (F.r.widthOfTextAtSize(t, 11) > x1 - x0 - (first ? indent : 0) && line) { out(); line = w; } else line = t; }
    if (line) out();
    return y - 3;
  };
  for (let k = 0; k < pages; k++) await draw(pdf.addPage([ctx.W, ctx.H]), k, ctx);
  return Buffer.from(await pdf.save());
}
const convert = async (page, buf) => { const ep = await readEpub((await run(page, 'p2e', [A.file('d.pdf', buf, 'application/pdf')], { setup: async p => { await p.click('.tabs button[data-mode="p2e"]'); await p.uncheck('#pCover'); } }))[0].buf); if (process.env.SONDA) console.log(ep.html.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<head>.*?<\/head>/gs, '').replace(/Este parágrafo tem frases[^<]*?margem\./g, '[T]')); return ep; };

test('equação numerada em destaque vira imagem; o parágrafo continua depois dela', async ({ page }) => {
  const ep = await convert(page, await bookWith(async (pg, k, { F, para }) => {
    let y = 560;
    for (let n = 0; n < 3; n++) y = para(pg, y);
    if (k === 1) { pg.drawText('E = m c', { x: 170, y: y - 10, size: 11, font: F.i }); pg.drawText('(2.1.3)', { x: 330, y: y - 10, size: 11, font: F.r }); y -= 35; }
    for (let n = 0; n < 3; n++) y = para(pg, y);
  }));
  expect(ep.html).toMatch(/<p class="eq"><img src="img\/p2-\d+\.jpg" alt="E = m c \(2\.1\.3\)"/);
  expect(ep.manifest.filter(m => /p2-\d+\.jpg$/.test(m.href))).toHaveLength(1);
});

test('inicial grande numa linha própria volta para o começo do parágrafo', async ({ page }) => {
  const ep = await convert(page, await bookWith(async (pg, k, { F, para }) => {
    let y = 560;
    if (k === 0) {
      pg.drawText('E', { x: 50, y: y + 22, size: 34, font: F.r });   // acima da 1ª linha (se descer até a 2ª, o pdf.js a junta a ela)
      pg.drawText('ra uma vez, numa terra distante, um conversor de livros que', { x: 80, y, size: 11, font: F.r });
      pg.drawText('morava num navegador e nunca mandava nada para servidor algum.', { x: 80, y: y - 15, size: 11, font: F.r });
      y -= 45;
    }
    for (let n = 0; n < 5; n++) y = para(pg, y);
  }));
  expect(ep.html).toMatch(/<p[^>]*>Era uma vez, numa terra distante/);
  expect(ep.html).not.toMatch(/<h\d[^>]*>E<\/h\d>/);
});

test('capitular que desce até a 2ª linha (o caso comum) volta para o começo do parágrafo', async ({ page }) => {
  // o agrupamento de linhas junta a letra à 2ª linha; ela volta para o começo da 1ª
  const ep = await convert(page, await bookWith(async (pg, k, { F, para }) => {
    let y = 560;
    if (k === 0) {
      pg.drawText('E', { x: 50, y: y - 15, size: 34, font: F.r });
      pg.drawText('ra uma vez, numa terra distante, um conversor de livros que', { x: 80, y, size: 11, font: F.r });
      pg.drawText('morava num navegador e nunca mandava nada para servidor algum.', { x: 80, y: y - 15, size: 11, font: F.r });
      y -= 45;
    }
    for (let n = 0; n < 5; n++) y = para(pg, y);
  }));
  expect(ep.html).toContain('Era uma vez, numa terra distante, um conversor de livros que morava num navegador');
  expect(ep.html).not.toMatch(/que E morava/);
});

test('capitular de 3 linhas volta para o começo do parágrafo, não da 2ª linha', async ({ page }) => {
  const ep = await convert(page, await bookWith(async (pg, k, { F, para }) => {
    let y = 560;
    if (k === 0) {
      y = para(pg, y);                                                   // parágrafo anterior, logo acima
      pg.drawText('U', { x: 50, y: y - 30, size: 50, font: F.r });
      pg.drawText('ma vez, numa terra distante, havia um conversor de', { x: 92, y, size: 11, font: F.r });
      pg.drawText('livros que morava num navegador e que nunca mandava', { x: 92, y: y - 15, size: 11, font: F.r });
      pg.drawText('nada para servidor algum, nem mesmo um bilhete.', { x: 92, y: y - 30, size: 11, font: F.r });
      y -= 60;
    }
    for (let n = 0; n < 4; n++) y = para(pg, y);
  }));
  expect(ep.html).toContain('Uma vez, numa terra distante, havia um conversor de livros que morava');
  expect(ep.html).not.toMatch(/margem\. ?U|que U|livros U/);
});

test('marcadores de lista desenhados (quadradinhos) viram "•"; logotipo repetido em toda página sai', async ({ page }) => {
  const ep = await convert(page, await bookWith(async (pg, k, { pdf, F, para }) => {
    if (!pdf.__logo) pdf.__logo = await pdf.embedPng(A.ICON);
    pg.drawImage(pdf.__logo, { x: 340, y: 560, width: 40, height: 40 });   // mesmo desenho, mesmo lugar, toda página
    let y = 540;
    for (let n = 0; n < 2; n++) y = para(pg, y);
    if (k === 0) for (const it of ['item desenhado um', 'item desenhado dois', 'item desenhado três']) {
      pg.drawRectangle({ x: 62, y: y + 2, width: 4, height: 4, color: rgb(0, 0, 0) }); pg.drawText(it, { x: 74, y, size: 11, font: F.r }); y -= 15;
    }
    y -= 6;
    for (let n = 0; n < 3; n++) y = para(pg, y);
  }, { pages: 4 }));
  expect(ep.html).toContain('<p class="l">• item desenhado dois</p>');
  expect(ep.html).not.toContain('<img');   // o logotipo repetido é decoração
});

test('acentos do TeX em trechos separados e cedilha solta; título "CAPÍTULO II" + subtítulo vira um só', async ({ page }) => {
  const ep = await convert(page, await bookWith(async (pg, k, { F, para }) => {
    let y = 560;
    if (k === 0) {
      const w = s => F.r.widthOfTextAtSize(s, 11);
      // "ent" + "˜" num trecho e "ao" no seguinte; "cora" + "¸" + "c˜ao"
      let x = 50; for (const s of ['Ent', '˜', 'ao a cora', '¸', 'c˜ao do livro ´e', ' ', '´agil.']) { pg.drawText(s, { x, y, size: 11, font: F.r }); x += s === '˜' || s === '¸' || s === '´' ? 0 : w(s); }
      y -= 30;
    }
    if (k === 1) {
      pg.drawText('CAPÍTULO II', { x: 160, y, size: 18, font: F.b }); y -= 26;
      pg.drawText('Do Governo Civil', { x: 150, y, size: 15, font: F.b }); y -= 40;
    }
    for (let n = 0; n < 4; n++) y = para(pg, y);
    pg.drawText('´e acento', { x: 50, y: 60, size: 9, font: F.r });   // ´ conta como acento em documento TeX
    pg.drawText('cora¸c˜ao p˜ao n˜ao', { x: 150, y: 60, size: 9, font: F.r });
  }));
  expect(ep.html).toContain('Então a coração do livro');
  expect(ep.html).toMatch(/<h1[^>]*>CAPÍTULO II — Do Governo Civil<\/h1>/);
});

test('tabela com cabeçalho em duas linhas', async ({ page }) => {
  const ep = await convert(page, await bookWith(async (pg, k, { F, para }) => {
    let y = 560;
    for (let n = 0; n < 2; n++) y = para(pg, y);
    if (k === 0) {
      // cabeçalho em duas linhas (colunas diferentes, quase na mesma altura) e números alinhados à direita
      pg.drawText('Nome', { x: 70, y, size: 11, font: F.r }); pg.drawText('Valor', { x: 290, y, size: 11, font: F.r }); y -= 11;
      pg.drawText('Unidade', { x: 180, y, size: 11, font: F.r }); y -= 18;
      for (const [a, b, c] of [['Peso', 'kg', '10'], ['Altura', 'm', '2'], ['Idade', 'anos', '30'], ['Pressão', 'Pa', '101']]) { pg.drawText(a, { x: 70, y, size: 11, font: F.r }); pg.drawText(b, { x: 180, y, size: 11, font: F.r }); pg.drawText(c, { x: 320 - F.r.widthOfTextAtSize(c, 11), y, size: 11, font: F.r }); y -= 16; }
      y -= 8;
    }
    for (let n = 0; n < 3; n++) y = para(pg, y);
  }));
  expect(ep.html).toMatch(/<table><tbody><tr><td>Nome<\/td><td>Unidade<\/td><td style="text-align:right">Valor<\/td><\/tr>/);
  expect(ep.html).toContain('<td>Pressão</td><td>Pa</td><td style="text-align:right">101</td>');
});

test('glifos sem Unicode viram imagens pequenas; ligaduras sem Unicode viram "fi"', async ({ page }) => {
  // fonte padrão com /Differences apontando códigos baixos para nomes que não existem: o pdf.js devolve caracteres de controle
  const buf = await bookWith(async (pg, k, { pdf, F, para }) => {
    if (!pdf.__odd) {
      const ctx = pdf.context;
      pdf.__odd = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Times-Roman', Encoding: ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [1, PDFName.of('g1'), PDFName.of('g2')] }) }));
    }
    const res = pg.node.Resources(); const fonts = res.lookup(PDFName.of('Font')) || (() => { const d = pdf.context.obj({}); res.set(PDFName.of('Font'), d); return d; })();
    let y = 560;
    for (let n = 0; n < 2; n++) y = para(pg, y);
    fonts.set(PDFName.of('FOdd'), pdf.__odd);
    // "x \001 y" com o glifo 1 (sem Unicode) e "\000" (código 0) entre letras, como ligadura
    const ops = `BT /FOdd 11 Tf 50 ${y} Td (simbolo \\001 aqui e \\000ca \\000m \\000lme \\000o) Tj ET`;
    const s = pdf.context.flateStream(ops); const ref = pdf.context.register(s);
    pg.node.addContentStream(ref);
    y -= 20;
    for (let n = 0; n < 3; n++) y = para(pg, y);
  });
  const ep = await convert(page, buf);
  expect(ep.html).toMatch(/simbolo <img class="g" src="img\/g\d+\.jpg" alt=""\/> aqui/);
  expect(ep.missing).toEqual([]);
});
