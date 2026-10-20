// PDF -> mangá para Kindle: páginas em imagem num AZW3 (KF8) de layout fixo.
// As resoluções são as dos perfis do Kindle Comic Converter; os metadados de layout
// fixo saem no AZW3 (ver src/azw3.js), conferidos contra o kindlegen da Amazon.
const Manga = (() => {
  const enc = new TextEncoder();

  // tela de cada aparelho, em pixels
  const DEVICES = [
    { id: 'kpw34', label: 'Paperwhite 3/4, Voyage, Oasis 1, Kindle 11 (1072 × 1448)', w: 1072, h: 1448 },
    { id: 'kpw5', label: 'Paperwhite 5 e Signature (1236 × 1648)', w: 1236, h: 1648 },
    { id: 'ko', label: 'Oasis 2/3, Libra (1264 × 1680)', w: 1264, h: 1680 },
    { id: 'kpw6', label: 'Paperwhite 12ª geração e Colorsoft (1272 × 1696)', w: 1272, h: 1696 },
    { id: 'ks', label: 'Scribe (1860 × 2480)', w: 1860, h: 2480 },
    { id: 'kpw12', label: 'Paperwhite 1/2 (758 × 1024)', w: 758, h: 1024 },
    { id: 'k57', label: 'Kindle básico antigo (600 × 800)', w: 600, h: 800 },
  ];
  const deviceById = id => DEVICES.find(d => d.id === id) || DEVICES[0];

  const toBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
  const canvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
  const free = cv => { cv.width = cv.height = 0; };

  // tons de cinza no próprio ImageData (o e-ink não mostra cor)
  function toGray(d) {
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
  }

  // estica o contraste: o preto mais claro vira 0 e o branco mais escuro vira 255
  function autoLevel(d) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
    const total = d.length >> 2, cut = Math.max(1, Math.floor(total * 0.004));
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
    if (hi - lo < 40) return;   // página de pouco contraste (arte em cinza): não mexe
    const lut = new Uint8Array(256), k = 255 / (hi - lo);
    for (let v = 0; v < 256; v++) lut[v] = v <= lo ? 0 : v >= hi ? 255 : Math.round((v - lo) * k);
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lut[d[i]];
  }

  // caixa do conteúdo: descarta a moldura branca das digitalizações
  function contentBox(d, w, h) {
    const DARK = 232, MIN = Math.max(2, Math.round(w * 0.002));
    let top = 0, bottom = h - 1, left = 0, right = w - 1;
    const rowHas = y => { let n = 0; for (let x = 0; x < w; x++) if (d[(y * w + x) << 2] < DARK && ++n >= MIN) return true; return false; };
    const colHas = x => { let n = 0; for (let y = 0; y < h; y++) if (d[(y * w + x) << 2] < DARK && ++n >= MIN) return true; return false; };
    while (top < bottom && !rowHas(top)) top++;
    while (bottom > top && !rowHas(bottom)) bottom--;
    while (left < right && !colHas(left)) left++;
    while (right > left && !colHas(right)) right--;
    if (right - left < w * 0.2 || bottom - top < h * 0.2) return { x: 0, y: 0, w, h };   // página quase vazia: deixa como está
    const padX = Math.round(w * 0.004), padY = Math.round(h * 0.004);
    const x = Math.max(0, left - padX), y = Math.max(0, top - padY);
    return { x, y, w: Math.min(w, right + padX + 1) - x, h: Math.min(h, bottom + padY + 1) - y };
  }

  // desenha a imagem dentro da tela do aparelho, centralizada e sem distorcer
  async function place(src, sx, sy, sw, sh, dev, fmt, quality) {
    const k = Math.min(dev.w / sw, dev.h / sh);
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const cv = canvas(w, h), cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    const blob = await toBlob(cv, fmt, quality);
    free(cv);
    if (!blob) throw new Error('não consegui gerar a imagem da página (memória).');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: fmt, w, h,
             x: Math.round((dev.w - w) / 2), y: Math.round((dev.h - h) / 2) };
  }

  // uma página do PDF -> uma ou duas páginas de mangá
  async function pageToImages(page, dev, o) {
    const v1 = page.getViewport({ scale: 1 });
    const alvo = o.split ? Math.max(dev.w, dev.h) * 2 : Math.max(dev.w, dev.h);
    let scale = 1.15 * Math.max(dev.w / v1.width, dev.h / v1.height);
    if (o.split && v1.width > v1.height) scale *= 1.6;   // página dupla: cada metade precisa de resolução própria
    scale = Math.min(scale, 6, alvo * 3 / Math.max(v1.width, v1.height));
    let vp = page.getViewport({ scale });
    const cap = 40e6;
    if (vp.width * vp.height > cap) vp = page.getViewport({ scale: scale * Math.sqrt(cap / (vp.width * vp.height)) });
    const W = Math.max(1, Math.ceil(vp.width)), H = Math.max(1, Math.ceil(vp.height));
    const cv = canvas(W, H), cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
    await page.render({ canvasContext: cx, viewport: vp }).promise;

    const img = cx.getImageData(0, 0, W, H);
    toGray(img.data);
    if (o.level) autoLevel(img.data);
    const box = o.crop ? contentBox(img.data, W, H) : { x: 0, y: 0, w: W, h: H };
    cx.putImageData(img, 0, 0);

    const out = [];
    if (o.split && box.w > box.h) {   // página dupla: parte em duas, na ordem de leitura
      const half = Math.floor(box.w / 2);
      const esq = [box.x, box.y, half, box.h], dir = [box.x + half, box.y, box.w - half, box.h];
      for (const [sx, sy, sw, sh] of (o.rtl ? [dir, esq] : [esq, dir]))
        out.push(await place(cv, sx, sy, sw, sh, dev, o.fmt, o.quality));
    } else {
      out.push(await place(cv, box.x, box.y, box.w, box.h, dev, o.fmt, o.quality));
    }
    free(cv);
    return out;
  }

  // EPUB de layout fixo: uma página por XHTML, a imagem posicionada em pixels
  function buildEpub(pages, dev, meta) {
    const zip = new JSZip();
    const xml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const ext = p => p.mime === 'image/png' ? 'png' : 'jpg';
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml',
      '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    zip.file('OEBPS/style.css',
      `@page { margin: 0; }\n` +
      `html, body { margin: 0; padding: 0; width: ${dev.w}px; height: ${dev.h}px; }\n` +
      `div.fs { margin: 0; padding: 0; width: ${dev.w}px; height: ${dev.h}px; position: relative; background: #ffffff; }\n` +
      `img.pg { position: absolute; }\n`);

    pages.forEach((p, i) => {
      const n = i + 1, f = `p${n}.${ext(p)}`;
      zip.file('OEBPS/img/' + f, p.bytes, { compression: 'STORE' });
      zip.file(`OEBPS/p${n}.xhtml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n` +
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${n}</title>\n` +
        `<meta name="viewport" content="width=${dev.w}, height=${dev.h}"/>\n` +
        `<link rel="stylesheet" type="text/css" href="style.css"/></head>\n` +
        `<body><div class="fs"><img src="img/${f}" alt="" class="pg" ` +
        `style="top:${p.y}px; left:${p.x}px; width:${p.w}px; height:${p.h}px"/></div></body></html>`);
    });

    const mani = pages.map((p, i) => `<item id="x${i + 1}" href="p${i + 1}.xhtml" media-type="application/xhtml+xml"/>` +
      `<item id="i${i + 1}" href="img/p${i + 1}.${ext(p)}" media-type="${p.mime}"${i ? '' : ' properties="cover-image"'}/>`).join('');
    const spine = pages.map((p, i) => `<itemref idref="x${i + 1}" linear="yes"/>`).join('');
    const dir = meta.rtl ? 'rtl' : 'ltr';
    zip.file('OEBPS/content.opf',
      `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bid">\n` +
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">` +
      `<dc:identifier id="bid">urn:uuid:${meta.uuid}</dc:identifier>` +
      `<dc:title>${xml(meta.title)}</dc:title><dc:language>${xml(meta.lang)}</dc:language>` +
      (meta.author ? `<dc:creator>${xml(meta.author)}</dc:creator>` : '') +
      `<meta name="cover" content="i1"/>` +
      `<meta name="fixed-layout" content="true"/><meta name="book-type" content="comic"/>` +
      `<meta name="orientation-lock" content="portrait"/><meta name="original-resolution" content="${dev.w}x${dev.h}"/>` +
      `<meta name="primary-writing-mode" content="horizontal-${meta.rtl ? 'rl' : 'lr'}"/>` +
      `<meta name="zero-gutter" content="true"/><meta name="zero-margin" content="true"/>` +
      `</metadata>\n<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>` +
      `<item id="css" href="style.css" media-type="text/css"/>${mani}</manifest>\n` +
      `<spine toc="ncx" page-progression-direction="${dir}">${spine}</spine>\n</package>`);
    zip.file('OEBPS/toc.ncx',
      `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">` +
      `<head><meta name="dtb:uid" content="urn:uuid:${meta.uuid}"/></head>` +
      `<docTitle><text>${xml(meta.title)}</text></docTitle><navMap>` +
      `<navPoint id="n1" playOrder="1"><navLabel><text>Início</text></navLabel><content src="p1.xhtml"/></navPoint>` +
      `</navMap></ncx>`);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  }

  async function convert(file, opt = {}) {
    const say = opt.say || (() => {}), tick = opt.tick || (() => Promise.resolve());
    const dev = opt.dev || DEVICES[0];
    const o = { rtl: opt.rtl !== false, split: !!opt.split, crop: opt.crop !== false, level: !!opt.level,
                fmt: opt.png ? 'image/png' : 'image/jpeg', quality: 0.9 };

    say('Lendo o PDF…'); await tick();
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) { throw new Error(e.name === 'PasswordException' ? 'PDF protegido por senha.' : 'não consegui ler este PDF.'); }

    const pages = [];
    try {
      let title = '', author = '';
      try {   // o título de dentro do PDF vale mais que o nome do arquivo
        const md = (await doc.getMetadata()).info || {};
        if (md.Title) title = String(md.Title).trim();
        if (md.Author) author = String(md.Author).trim();
      } catch (e) { /* PDF sem metadados */ }
      if (!title) title = (opt.title || '').trim() || 'Mangá';
      if (!author) author = (opt.author || '').trim();

      for (let i = 0; i < doc.numPages; i++) {
        say(`Página ${i + 1} de ${doc.numPages}…`); await tick();
        const page = await doc.getPage(i + 1);
        try { pages.push(...await pageToImages(page, dev, o)); } finally { page.cleanup(); }
      }
      if (!pages.length) throw new Error('o PDF não tem páginas.');

      say('Montando o livro…'); await tick();
      const uuid = (() => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
        const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; })();
      const epub = await buildEpub(pages, dev, { title, author, lang: opt.lang || 'pt', rtl: o.rtl, uuid });

      const a = await Azw3.convert(epub, { say, tick, fixed: { w: dev.w, h: dev.h, rtl: o.rtl, bookType: 'comic' } });
      return { bytes: a.bytes, title: a.title, authors: a.authors, pages: pages.length, device: dev };
    } finally { doc.destroy(); }
  }

  return { convert, DEVICES, deviceById, _contentBox: contentBox, _autoLevel: autoLevel };
})();
