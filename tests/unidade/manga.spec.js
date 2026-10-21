// Unitários de src/manga.js: tons de cinza, contraste, moldura branca, limiar de Otsu, detecção de quadros e Panel View.
const { test, expect, inPage } = require('../apoio/app');
const A = require('../apoio/arquivos');

test('toGray, autoLevel e contentBox', async ({ page }) => {
  const r = await page.evaluate(() => {
    const px = (vals) => { const d = new Uint8ClampedArray(vals.length * 4); vals.forEach((v, i) => { d.set(Array.isArray(v) ? [...v, 255] : [v, v, v, 255], i * 4); }); return d; };
    const g = px([[255, 0, 0], [0, 255, 0], [0, 0, 255], [10, 20, 30]]); Manga._toGray(g);
    const gray = [0, 4, 8, 12].map(i => [g[i], g[i + 1], g[i + 2]]);
    const lo = px(Array.from({ length: 1000 }, (_, i) => 100 + (i % 30))); const before = [...lo]; Manga._autoLevel(lo);
    const hi = px(Array.from({ length: 1000 }, (_, i) => 50 + (i % 150))); Manga._autoLevel(hi);
    const W = 200, H = 300, page = px(Array.from({ length: W * H }, (_, i) => { const x = i % W, y = (i / W) | 0; return x >= 50 && x < 150 && y >= 60 && y < 240 ? 0 : 255; }));
    const empty = px(Array(W * H).fill(255));
    return { gray, loSame: before.every((v, i) => v === lo[i]), hiRange: [Math.min(...hi.filter((_, i) => i % 4 === 0)), Math.max(...hi.filter((_, i) => i % 4 === 0))],
      box: Manga._contentBox(page, W, H), emptyBox: Manga._contentBox(empty, W, H) };
  });
  expect(r.gray).toEqual([[76, 76, 76], [150, 150, 150], [27, 27, 27], [18, 18, 18]]);
  expect(r.loSame).toBe(true);          // pouco contraste: não mexe
  expect(r.hiRange).toEqual([0, 255]);  // estica para 0–255
  expect(r.box).toEqual({ x: 49, y: 59, w: 102, h: 182 });
  expect(r.emptyBox).toEqual({ x: 0, y: 0, w: 200, h: 300 });
});

test('otsu: limiar entre o papel e a tinta', async ({ page }) => {
  const t = await page.evaluate(() => { const h = new Uint32Array(256); h[30] = 500; h[40] = 300; h[220] = 2000; h[230] = 1000; return Manga._otsu(h, 3800); });
  expect(t).toBeGreaterThanOrEqual(40); expect(t).toBeLessThan(220);
});

test('detectPanels: quadros emoldurados passam; página vazia, um quadro só e texto sem moldura não', async ({ page }) => {
  const comic = await A.comicPage(page, { w: 1072, h: 1448, layout: [[0.6, 0.4], [1], [0.35, 0.65]] });   // no tamanho da tela, como no app
  const r = await inPage(page, async png => {
    const gray = async src => { const bm = src instanceof Uint8Array ? await createImageBitmap(new Blob([src])) : null, cv = document.createElement('canvas'); cv.width = 1072; cv.height = 1448;
      const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 1072, 1448); if (bm) c.drawImage(bm, 0, 0); else src(c);
      const d = c.getImageData(0, 0, 1072, 1448).data, g = new Uint8Array(1072 * 1448); for (let i = 0; i < g.length; i++) g[i] = d[i * 4]; return g; };
    const W = 1072, H = 1448, summary = x => ({ ok: x.ok, n: x.panels.length, reasons: x.reasons });
    const grid = await gray(png);
    const one = await gray(c => { c.lineWidth = 5; c.strokeRect(30, 30, 1000, 1380); });
    const text = await gray(c => { c.fillStyle = '#000'; c.font = '16px serif'; for (let y = 40; y < 1420; y += 22) c.fillText('linhas de texto corrido sem moldura nenhuma, como num livro de prosa, com bastante coisa', 30, y); });
    const dg = Manga._detectBest(grid, W, H, { rtl: true });   // a estrita, e as tolerantes se ela recusar
    return { grid: summary(dg), order: dg.panels.map(p => [(p.x0 + p.x1) / 2, p.y0]), ltr: Manga._detectBest(grid, W, H, { rtl: false }).panels.map(p => p.x0),
      empty: summary(Manga._detectPanels(new Uint8Array(W * H).fill(255), W, H)), one: summary(Manga._detectPanels(one, W, H)), text: summary(Manga._detectBest(text, W, H, {})) };
  }, comic);
  expect(r.grid).toEqual({ ok: true, n: 5, reasons: [] });
  // fileiras de cima para baixo, da direita para a esquerda
  expect(r.order.map(([x]) => x > 600 ? 'd' : x < 470 ? 'e' : 'meio')).toEqual(['d', 'e', 'meio', 'd', 'e']);
  expect(r.order[2][1]).toBeGreaterThan(r.order[0][1]);
  expect(r.ltr[0]).toBeLessThan(r.ltr[1]);
  expect(r.empty.ok).toBe(false);
  expect(r.empty.reasons).toContain('menos de dois quadros');
  expect(r.one.ok).toBe(false);
  expect(r.text.ok).toBe(false);
});

test('panelPlan e panelHtml: quantas regiões e onde ficam', async ({ page }) => {
  const r = await page.evaluate(() => {
    const dev = { w: 1000, h: 1500 };
    return {
      none: Manga._panelPlan({ w: 1000, h: 1500 }, dev, 0, true),
      four: Manga._panelPlan({ w: 1000, h: 1500 }, dev, 4, true),
      fourLtr: Manga._panelPlan({ w: 1000, h: 1500 }, dev, 4, false).order,
      two: Manga._panelPlan({ w: 800, h: 1500 }, dev, 2, true),
      wide: Manga._panelPlan({ w: 1000, h: 400 }, dev, 4, true),
      fits: Manga._panelPlan({ w: 400, h: 400 }, dev, 2, true),
      html: Manga._panelHtml({ boxes: ['PV-T', 'PV-B'], order: [1, 2], mw: 1000, mh: 1600, x: 0, y: -3 }, 'img/p1.jpg'),
    };
  });
  expect(r.none).toBeNull();
  expect(r.four).toMatchObject({ mw: 1600, mh: 2400, boxes: ['PV-TL', 'PV-TR', 'PV-BL', 'PV-BR'], order: [2, 1, 4, 3] });
  expect(r.fourLtr).toEqual([1, 2, 3, 4]);
  expect(r.two).toMatchObject({ mw: 1000, mh: 1875, boxes: ['PV-T', 'PV-B'], order: [1, 2] });
  expect(r.wide.boxes).toEqual(['PV-L', 'PV-R']);
  expect(r.fits).toBeNull();
  expect(r.html).toContain(`data-app-amzn-magnify='{"targetId":"PV-T-P", "ordinal":1}'`);
  expect(r.html).toContain('<img style="position:absolute;bottom:0;left:0%;" src="img/p1.jpg" width="1000" height="1600"/>');
});

test('detectedHtml: área de toque por quadro, máscara em volta e ampliação limitada', async ({ page }) => {
  const r = await page.evaluate(() => {
    const dev = { w: 1000, h: 1500 }, p = { w: 1000, h: 1500, x: 0, y: 0 };
    const det = { panels: [{ x0: 0, y0: 0, x1: 500, y1: 500 }, { x0: 500, y0: 0, x1: 1000, y1: 500 }, { x0: 0, y0: 500, x1: 1000, y1: 1500 }] };
    const all = { panels: [{ x0: 0, y0: 0, x1: 1000, y1: 1500 }] };
    return { h: Manga._detectedHtml(p, dev, det, 'img/p1.jpg'), keep: Manga._detectedHtml(p, dev, all, 'img/p1.jpg'), none: Manga._detectedHtml(p, dev, { panels: [] }, 'x') };
  });
  expect((r.h.match(/class="app-amzn-magnify"/g) || []).length).toBe(2);   // o quadro que já ocupa a tela não ganha ampliação
  expect(r.h).toContain('"ordinal":1}');
  expect(r.h).toContain('background:#ffffff');                             // máscara
  expect(r.h).toMatch(/width="2000" height="3000"/);                       // 2× (limite de ampliação 4×)
  expect(r.keep).toContain('"ordinal":1}');                               // com menos de dois úteis, mantém todos
  expect(r.none).toBeNull();
});

test('buildEpub: EPUB de layout fixo com metadados do Kindle', async ({ page }) => {
  const r = await inPage(page, async png => {
    const dev = Manga.deviceById('kpw5');
    const pages = [{ bytes: png, mime: 'image/png', w: 1236, h: 1648, x: 0, y: 0 }, { bytes: png, mime: 'image/jpeg', w: 1000, h: 1648, x: 118, y: 0, det: { ok: false } }];
    const meta = { title: 'T & <x>', author: 'A', lang: 'ja', rtl: false, uuid: 'u-1', panels: 'auto' };
    const zip = await JSZip.loadAsync(await Manga._buildEpub(pages, dev, meta));
    return { files: Object.keys(zip.files).sort(), opf: await zip.file('OEBPS/content.opf').async('string'), p2: await zip.file('OEBPS/p2.xhtml').async('string'), regionMag: meta.regionMag, detected: meta.detected,
      dev: Manga.deviceById('nao-existe').id, devices: Manga.DEVICES.length };
  }, A.ICON);
  expect(r.files).toEqual(['META-INF/', 'META-INF/container.xml', 'OEBPS/', 'OEBPS/content.opf', 'OEBPS/img/', 'OEBPS/img/p1.png', 'OEBPS/img/p2.jpg', 'OEBPS/p1.xhtml', 'OEBPS/p2.xhtml', 'OEBPS/style.css', 'OEBPS/toc.ncx', 'mimetype']);
  for (const m of ['<dc:title>T &amp; &lt;x&gt;</dc:title>', '<dc:language>ja</dc:language>', '<dc:creator>A</dc:creator>', 'name="fixed-layout" content="true"', 'name="original-resolution" content="1236x1648"', 'name="primary-writing-mode" content="horizontal-lr"', 'name="RegionMagnification" content="false"', 'page-progression-direction="ltr"', 'properties="cover-image"'])
    expect(r.opf, m).toContain(m);
  expect(r.p2).toContain('style="top:0px; left:118px; width:1000px; height:1648px"');
  expect(r.regionMag).toBe(false);
  expect(r.detected).toBe(0);
  expect(r.dev).toBe('kpw34');
  expect(r.devices).toBe(7);
});

test('convert direto: título padrão, PDF ilegível e o EPUB intermediário', async ({ page }) => {
  const pdf = await A.makeImagePdf([A.ICON]);
  const r = await inPage(page, async (b, bad) => {
    window.__converterias.initPdfjs();
    const o = await Manga.convert(new File([b], 'x.pdf'), { panels: 0, _epub: true });
    let err; try { await Manga.convert(new File([bad], 'y.pdf')); } catch (e) { err = e.message; }
    return { title: o.title, pages: o.pages, panels: o.panels, epub: o.epub.length > 0, err };
  }, pdf, Buffer.from('nada'));
  expect(r).toEqual({ title: 'Mangá', pages: 1, panels: 0, epub: true, err: 'não consegui ler este PDF.' });
});

test('toEink: arredonda para os 16 tons de cinza do e-ink', async ({ page }) => {
  const r = await page.evaluate(() => {
    const d = new Uint8ClampedArray(256 * 4); for (let v = 0; v < 256; v++) d.set([v, v, v, 255], v * 4);
    Manga._toEink(d);
    const out = []; for (let v = 0; v < 256; v++) out.push(d[v * 4]);
    return { levels: [...new Set(out)], at: [0, 8, 9, 25, 26, 128, 246, 247, 255].map(v => out[v]), alpha: d[3], same: out.every((x, v) => d[v * 4 + 1] === x && d[v * 4 + 2] === x) };
  });
  expect(r.levels).toEqual(Array.from({ length: 16 }, (_, k) => k * 17));
  expect(r.at).toEqual([0, 0, 17, 17, 34, 136, 238, 255, 255]);   // o tom mais próximo
  expect(r.alpha).toBe(255);
  expect(r.same).toBe(true);
});
