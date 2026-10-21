/* OCR de livros escaneados: reconstrói parágrafos, capítulos e ilustrações a partir das linhas lidas pelo
   Tesseract e monta um EPUB (que o conversor EPUB → PDF do app transforma em PDF).
   Cada página é { W, H, rows, ink, img }: W e H em "pontos" normalizados (largura 595), rows = linhas
   { x0, x1, y, t } com coordenadas nessa mesma escala, ink = fração de tinta, img = Blob JPEG da página. */
const Ocr = (() => {
  const PT_W = 595;
  const med = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const isUpper = t => t === t.toUpperCase() && t !== t.toLowerCase();
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sentence = t => isUpper(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;   // cabeçalho em CAIXA ALTA -> só a 1ª maiúscula
  const dice = (a, b) => {   // semelhança de 0 a 1 (bigramas)
    if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0;
    const g = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
    const A = g(a), B = g(b); let hit = 0;
    for (const [k, v] of A) hit += Math.min(v, B.get(k) || 0);
    return 2 * hit / (a.length - 1 + b.length - 1);
  };

  const LOW_WORD = 70;    // palavra com confiança abaixo disso é "duvidosa"
  const JUNK_LINE = 60;   // linha cuja confiança média (ponderada pelo tamanho) fica abaixo disso é lixo do OCR

  /* linhas do Tesseract (px) -> linhas em pontos, de cima para baixo.
     Cada linha guarda as palavras com a confiança: w = [{ t, c }]; c = confiança média da linha. */
  function rowsFromLines(lines, pxW) {
    const f = PT_W / pxW, out = [];
    for (const l of lines) {
      let w = (l.words || []).map(x => ({ t: (x.text || '').trim(), c: x.confidence == null ? 100 : x.confidence })).filter(x => x.t);
      if (!w.length) { const t = (l.text || '').replace(/\s+/g, ' ').trim(); w = t ? t.split(' ').map(x => ({ t: x, c: l.confidence == null ? 100 : l.confidence })) : []; }
      const t = w.map(x => x.t).join(' ');
      if (!t || !/[\p{L}\p{N}]/u.test(t)) continue;
      const len = w.reduce((s, x) => s + x.t.length, 0), c = w.reduce((s, x) => s + x.c * x.t.length, 0) / len;
      const letters = (t.match(/\p{L}/gu) || []).length;
      if (c < JUNK_LINE || (c < 80 && letters < 6 && !/^[\d\s|.]+$/.test(t))) continue;   // lixo: ilustração, mancha ou borda lidas como letras
      const b = l.bbox, h = (b.y1 - b.y0) * f;
      if (h > 30) continue;          // manchas e ilustrações lidas como letras enormes
      out.push({ x0: b.x0 * f, x1: b.x1 * f, y: (b.y0 + b.y1) / 2 * f, t, w, c });
    }
    return out.sort((a, b) => a.y - b.y);
  }

  /* palavras duvidosas (só letras) nas páginas, para o aviso ao usuário */
  const countLow = pages => pages.reduce((n, p) => n + p.rows.reduce((m, r) => m + r.w.filter(x => x.c < LOW_WORD && /\p{L}{2,}/u.test(x.t)).length, 0), 0);

  class Book {
    constructor(pages) {
      this.p = pages;
      const cnt = new Map(), raw = pages.map((_, i) => this.rawHeader(i));
      raw.forEach(h => { if (h) cnt.set(h, (cnt.get(h) || 0) + 1); });
      this.head = raw.map(h => h && cnt.get(h) >= 2 ? h : null);   // cabeçalho corrente aparece em várias páginas
    }
    rawHeader(i) {
      const r = this.p[i].rows[0];
      if (r && r.y < .09 * this.p[i].H && isUpper(r.t) && r.t.length > 3 && r.t.length <= 70) return r.t;
      return null;
    }
    bodyRows(i, opener) {
      const H = this.p[i].H;
      return this.p[i].rows.filter(x => {
        if (x.y > .915 * H && /^[\d\s|]+$/.test(x.t)) return false;                          // nº de página
        if (x.y < .09 * H && isUpper(x.t) && x.t.length > 3 && !opener) return false;        // cabeçalho corrente
        return (x.t.match(/[\p{L}\p{N}]/gu) || []).length >= 2;
      });
    }
    kind(rows, opener) {
      if (opener && rows.length >= 8) return 'text';
      if (rows.length <= 11) return 'img';
      const L = med(rows.map(x => x.x0));
      return rows.filter(x => Math.abs(x.x0 - L) < 30).length / rows.length >= .6 ? 'text' : 'img';
    }

    /* Capítulos pelos cabeçalhos correntes. A abertura (sequência de páginas "cheias" logo antes do
       primeiro cabeçalho) e a ilustração colada nela entram no capítulo novo. */
    autoChapters(first, last, fallbackTitle) {
      const idx = []; for (let i = first - 1; i < last; i++) if (this.head[i]) idx.push(i);
      if (!idx.length) return [{ title: fallbackTitle, start: first, end: last, opener: null }];
      const chs = [];
      idx.forEach((i, k) => { if (!k || this.head[i] !== this.head[idx[k - 1]]) chs.push({ title: sentence(this.head[i]), hdr: i, start: i + 1, end: last, opener: null }); });
      chs.forEach((c, k) => {
        const prev = k ? chs[k - 1].hdr : null, lo = prev == null ? first - 1 : prev + 1, run = [];
        for (let j = c.hdr - 1; j >= lo && !this.head[j]; j--) run.push(j);
        const chain = [];
        for (const j of run) { if (this.bodyRows(j, true).length >= 14) chain.push(j); else break; }
        if (!chain.length) { if (prev != null) c.start = c.hdr + 1; return; }
        const op = chain[chain.length - 1]; c.opener = op + 1; c.start = op + 1;
        for (let j = op - 1; run.includes(j) && this.p[j].ink > .18 && this.p[j].ink < .5; j--) c.start = j + 1;   // ilustração colada
      });
      chs.forEach((c, k) => { c.end = k + 1 < chs.length ? chs[k + 1].start - 1 : last; });
      return chs;
    }

    /* [{ t: 'p', text } | { t: 'img', i }] */
    paragraphs(sect, openers) {
      const blocks = []; let cur = null, lastShort = false;
      const flush = () => { if (cur) { blocks.push({ t: 'p', text: cur }); cur = null; } };
      for (const [i, r] of sect) {
        if (this.kind(r, openers.has(i + 1)) === 'img') { flush(); blocks.push({ t: 'img', i }); continue; }
        const L = med(r.map(x => x.x0)), R = r.map(x => x.x1).sort((a, b) => a - b)[Math.floor(r.length * .75)];
        let prev = null;
        for (const x of r) {
          let np;
          if (cur == null) np = true;
          else if (!prev) np = x.x0 > L + 10 || lastShort;                  // começo de página
          else np = x.x0 > L + 10 || prev.x1 < R - 35;
          if (np) { flush(); cur = x.t; }
          else if (cur.endsWith('-') && /^\p{Ll}/u.test(x.t)) cur = cur.slice(0, -1) + x.t;   // hifenização de fim de linha
          else cur += ' ' + x.t;
          prev = x;
        }
        lastShort = prev.x1 < R - 35;
      }
      flush(); return blocks;
    }
  }

  /* recorta as bordas do scan e a numeração; devolve JPEG (Uint8Array) */
  async function crop(blob, { maxW = 1400, edge = .06, q = .82, dropNo = true } = {}) {
    const bmp = await createImageBitmap(blob), W = bmp.width, H = bmp.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); bmp.close();
    const ex = Math.floor(W * edge), ey = Math.floor(H * .03), w = W - 2 * ex, h = H - 2 * ey;
    const d = cx.getImageData(ex, ey, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (d[o] * .299 + d[o + 1] * .587 + d[o + 2] * .114 <= 170) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    let sx = ex, sy = ey, sw = w, sh = h;
    if (x1 >= 0) { sx = ex + x0; sy = ey + y0; sw = x1 - x0 + 1; sh = y1 - y0 + 1; }
    if (dropNo) sh = Math.max(1, Math.floor(sh * .955));
    const k = Math.min(1, maxW / sw), o = document.createElement('canvas');
    o.width = Math.max(1, Math.round(sw * k)); o.height = Math.max(1, Math.round(sh * k));
    o.getContext('2d').drawImage(cv, sx, sy, sw, sh, 0, 0, o.width, o.height);
    const out = await new Promise(r => o.toBlob(r, 'image/jpeg', q));
    return new Uint8Array(await out.arrayBuffer());
  }

  /* monta o EPUB; meta = { title, author, lang, cover (nº da página, 0 = sem), chapters } */
  async function buildEpub(JSZip, pages, meta, tick) {
    const book = new Book(pages), n = pages.length;
    const first = Math.max(1, meta.first || 1), last = Math.min(n, meta.last || n);
    const chapters = meta.chapters || book.autoChapters(first, last, meta.title);
    const openers = new Set(chapters.map(c => c.opener).filter(Boolean));
    const imgs = new Map(), files = [];
    const addImg = async i => {
      const name = `img/p${String(i + 1).padStart(3, '0')}.jpg`;
      if (!imgs.has(name)) imgs.set(name, await crop(pages[i].img));
      return name;
    };
    const stats = { fixed: [] }, low = new Set();
    if (meta.spell) for (const pg of pages) for (const r of pg.rows) for (const x of r.w) if (x.c < LOW_WORD) low.add(x.t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''));
    const clean = t => { t = t.replace(/--/g, '-').replace(/\s*[|¦]\s*/g, ' ').trim(); return meta.spell ? Spell.fixText(t, meta.spell, low, stats) : t; };
    let cn = 0;
    for (const c of chapters) {
      if (tick) await tick(`Montando o capítulo ${++cn} de ${chapters.length}…`);
      const sect = [];
      for (let i = c.start - 1; i < c.end; i++) {
        const r = book.bodyRows(i, openers.has(i + 1));
        if (i + 1 === c.opener) {   // tira o título decorado que o OCR leu na abertura
          const T = norm(c.title);
          while (r.length) {
            const s = norm(r[0].t);
            if (dice(s, T) > .6 || (s.length > 3 && T.includes(s)) || /^(capitulo )?\d{1,2}$/.test(s)) r.shift(); else break;
          }
        }
        sect.push([i, r]);
      }
      const blocks = book.paragraphs(sect, openers), fig = async b => `<p class="fig"><img src="${await addImg(b.i)}" alt=""/></p>`;
      let body = '';
      while (blocks.length && blocks[0].t === 'img') body += await fig(blocks.shift());   // ilustração de abertura vem antes do título
      body += `<h1>${esc(c.title)}</h1>`;
      for (const b of blocks) body += b.t === 'p' ? `<p>${esc(clean(b.text))}</p>` : await fig(b);
      files.push({ name: `c${String(files.length + 1).padStart(2, '0')}.xhtml`, title: c.title, body });
    }
    const X = '<?xml version="1.0" encoding="utf-8"?>\n', lang = meta.lang || 'pt-BR';
    const page = (t, b) => X + `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}"><head><title>${esc(t)}</title></head><body>${b}</body></html>`;
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', X + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    let mani = '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', spine = '';
    if (meta.cover) {
      zip.file('OEBPS/img/capa.jpg', await crop(pages[meta.cover - 1].img, { maxW: 1600, edge: .03, q: .88, dropNo: false }));
      mani += '<item id="cover-image" href="img/capa.jpg" media-type="image/jpeg" properties="cover-image"/>';
    }
    files.forEach((f, k) => { mani += `<item id="f${k}" href="${f.name}" media-type="application/xhtml+xml"/>`; spine += `<itemref idref="f${k}"/>`; zip.file('OEBPS/' + f.name, page(f.title, f.body)); });
    let k = 0; for (const [name, bytes] of imgs) { mani += `<item id="i${k++}" href="${name}" media-type="image/jpeg"/>`; zip.file('OEBPS/' + name, bytes); }
    zip.file('OEBPS/nav.xhtml', X + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head><body><nav epub:type="toc"><ol>' + files.map(f => `<li><a href="${f.name}">${esc(f.title)}</a></li>`).join('') + '</ol></nav></body></html>');
    const uid = 'urn:ocr:' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    zip.file('OEBPS/content.opf', X + `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${uid}</dc:identifier><dc:title>${esc(meta.title)}</dc:title>${meta.author ? `<dc:creator>${esc(meta.author)}</dc:creator>` : ''}<dc:language>${lang}</dc:language><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata><manifest>${mani}</manifest><spine>${spine}</spine></package>`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
    return { bytes, chapters: files.length, plan: chapters, fixed: stats.fixed.length, fixes: stats.fixed };
  }

  return { PT_W, LOW_WORD, rowsFromLines, countLow, buildEpub, Book };
})();
