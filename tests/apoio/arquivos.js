// Arquivos de entrada gerados na hora (nada de binário no repositório).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('../../vendor/jszip.min.js');
const { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, PDFArray, PDFNumber, rgb, degrees } = require('../../vendor/pdf-lib.min.js');

const ROOT = path.join(__dirname, '..', '..');
const ICON = fs.readFileSync(path.join(ROOT, 'icons', 'icon-192.png'));
const ICON_BIG = fs.readFileSync(path.join(ROOT, 'icons', 'icon-512.png'));

const LOREM = [
  'Era uma vez um conversor que rodava inteiro no navegador, sem mandar nada para servidor algum.',
  'Ele lia livros, remontava parágrafos e devolvia arquivos prontos para o leitor de cada um.',
  'Quando alguém mexia no código, os testes conferiam se tudo continuava funcionando como antes.',
];
const file = (name, buffer, mimeType) => ({ name, buffer, mimeType });

/* ---------- imagens mínimas feitas à mão ---------- */
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
function bmp(w, h, color = [200, 30, 30]) {   // BMP 24 bits sem compressão
  const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h, b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 54 + y * row + x * 3; b[o] = color[2]; b[o + 1] = color[1]; b[o + 2] = color[0]; }
  return b;
}
/* JPEG com segmento EXIF de orientação logo depois do SOI */
function withExif(jpeg, orientation, littleEndian = false) {
  const tiff = Buffer.alloc(26), le = littleEndian;
  const w16 = (v, o) => le ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o), w32 = (v, o) => le ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o);
  tiff.write(le ? 'II' : 'MM', 0, 'latin1'); w16(42, 2); w32(8, 4); w16(1, 8);
  w16(0x0112, 10); w16(3, 12); w32(1, 14); w16(orientation, 18); w32(0, 22);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}
/* imagem desenhada no canvas do navegador (PNG, JPEG ou WebP) */
async function drawImage(page, { w = 200, h = 120, type = 'image/png', quality = 0.9, draw = 'stripes', alpha = false } = {}) {
  const b64 = await page.evaluate(async ({ w, h, type, quality, draw, alpha }) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    if (!alpha) { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); }
    if (draw === 'stripes') for (let x = 0; x < w; x += 20) { c.fillStyle = x % 40 ? '#2f6fed' : '#e33'; c.fillRect(x, 0, 10, h); }
    else if (draw === 'circle') { c.fillStyle = 'rgba(0,128,0,0.6)'; c.beginPath(); c.arc(w / 2, h / 2, Math.min(w, h) / 3, 0, 7); c.fill(); }
    const blob = await new Promise(r => cv.toBlob(r, type, quality));
    const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s);
  }, { w, h, type, quality, draw, alpha });
  return Buffer.from(b64, 'base64');
}
/* página de quadrinho: quadros emoldurados numa grade, com calhas brancas */
async function comicPage(page, { w = 800, h = 1200, rows = 3, cols = 2, gutter = 24, double = false, koma = false, layout = null } = {}) {
  const b64 = await page.evaluate(({ w, h, rows, cols, gutter, double, koma, layout }) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    const m = 40, grid = (x0, y0, x1, y1, R, C) => {
      const pw = (x1 - x0 - (C - 1) * gutter) / C, ph = (y1 - y0 - (R - 1) * gutter) / R;
      for (let r = 0; r < R; r++) for (let k = 0; k < C; k++) {
        const x = x0 + k * (pw + gutter), y = y0 + r * (ph + gutter);
        c.lineWidth = 6; c.strokeStyle = '#000'; c.strokeRect(x, y, pw, ph);
        c.fillStyle = '#888'; c.beginPath(); c.arc(x + pw / 2, y + ph / 2, Math.min(pw, ph) / 4, 0, 7); c.fill();
        c.fillStyle = '#000'; c.font = '28px serif'; c.fillText(String(r * C + k + 1), x + 12, y + 36);
      }
    };
    // layout: fileiras com larguras diferentes, como mangá de verdade (sem calha vertical de alto a baixo)
    if (layout) {
      const rh = (h - 2 * m - (layout.length - 1) * gutter) / layout.length;
      layout.forEach((fr, r) => { let x = m; const y = m + r * (rh + gutter), span = w - 2 * m - (fr.length - 1) * gutter;
        fr.forEach((f, k) => { const pw = span * f; c.lineWidth = 6; c.strokeStyle = '#000'; c.strokeRect(x, y, pw, rh);
          c.fillStyle = '#888'; c.beginPath(); c.arc(x + pw / 2, y + rh / 2, Math.min(pw, rh) / 4, 0, 7); c.fill(); x += pw + gutter; }); });
    }
    else if (double) { grid(m, m, w / 2 - m, h - m, rows, cols); grid(w / 2 + m, m, w - m, h - m, rows, cols); }
    else if (koma) grid(m, m, w - m, h - m, 4, 2);
    else grid(m, m, w - m, h - m, rows, cols);
    return cv.toDataURL('image/png').split(',')[1];
  }, { w, h, rows, cols, gutter, double, koma, layout });
  return Buffer.from(b64, 'base64');
}

/* ---------- EPUB ---------- */
/* EPUB configurável. chapters: lista de HTML do corpo (ou número de capítulos padrão). */
async function makeEpub(o = {}) {
  const {
    title = 'o nome do vento', authors = ['Patrick Rothfuss'], lang = 'pt-BR', chapters = 3, cover = 'cover-image', version = 3,
    images = {}, css = null, extraFiles = {}, encryption = null, uid = 'urn:uuid:12345678-1234-1234-1234-123456789abc',
    rtl = false, linearNo = [], role = null, publisher = 'Editora Teste', description = 'Um <b>livro</b> de teste.', subjects = ['Ficção'], fonts = {},
    nav = true, ncx = version === 2, opfDir = 'OEBPS/', doctype = version === 2, svgCover = false, missingSpineFile = false,
  } = o;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfDir}content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  let mani = '', spine = '', navLis = '', ncxPts = '', meta = '', guide = '';
  const D = opfDir;
  if (cover) {
    zip.file(D + 'img/capa.png', ICON_BIG);
    if (cover === 'cover-image') mani += '<item id="capa" href="img/capa.png" media-type="image/png" properties="cover-image"/>';
    else mani += '<item id="capa" href="img/capa.png" media-type="image/png"/>';
    if (cover === 'meta') meta += '<meta name="cover" content="capa"/>';
    if (cover === 'meta-nome') meta += '<meta name="cover" content="img-capa-inexistente"/>';
    if (cover === 'guide') {
      zip.file(D + 'capa.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capa</title></head><body>${svgCover ? '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512"><image width="512" height="512" xlink:href="img/capa.png"/></svg>' : '<img src="img/capa.png" alt=""/>'}</body></html>`);
      mani += '<item id="pcapa" href="capa.xhtml" media-type="application/xhtml+xml"/>';
      spine += '<itemref idref="pcapa"/>';
      guide = '<guide><reference type="cover" href="capa.xhtml" title="Capa"/></guide>';
    }
  }
  for (const [name, bytes] of Object.entries(images)) {
    zip.file(D + name, bytes);
    const ext = name.split('.').pop().toLowerCase();
    mani += `<item id="im-${name.replace(/\W/g, '_')}" href="${name}" media-type="${{ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[ext]}"/>`;
  }
  for (const [name, bytes] of Object.entries(fonts)) { zip.file(D + name, bytes); mani += `<item id="ft-${name.replace(/\W/g, '_')}" href="${name}" media-type="font/ttf"/>`; }
  if (css) { zip.file(D + 'estilo.css', css); mani += '<item id="css" href="estilo.css" media-type="text/css"/>'; }
  const bodies = typeof chapters === 'number'
    ? Array.from({ length: chapters }, (_, k) => `<h1 id="t${k + 1}">Capítulo ${k + 1}</h1>` + LOREM.map((t, j) => `<p>${j === 1 ? `<em>${t}</em>` : t} (cap. ${k + 1}, §${j + 1})</p>`).join(''))
    : chapters;
  bodies.forEach((body, k) => {
    const i = k + 1, fn = `texto/c${i}.xhtml`;
    const dt = doctype ? '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">' : '';
    if (!(missingSpineFile && i === bodies.length))
      zip.file(D + fn, `<?xml version="1.0" encoding="utf-8"?>${dt}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}"><head><title>Capítulo ${i}</title>${css ? '<link rel="stylesheet" type="text/css" href="../estilo.css"/>' : ''}</head><body>${body}</body></html>`);
    mani += `<item id="c${i}" href="${fn}" media-type="application/xhtml+xml"/>`;
    spine += `<itemref idref="c${i}"${linearNo.includes(i) ? ' linear="no"' : ''}/>`;
    navLis += `<li><a href="${fn}">Capítulo ${i}</a>${i === 1 ? `<ol><li><a href="${fn}#t1">Seção 1.1</a></li></ol>` : ''}</li>`;
    ncxPts += `<navPoint id="n${i}" playOrder="${i}"><navLabel><text>Capítulo ${i}</text></navLabel><content src="${fn}"/></navPoint>`;
  });
  for (const [name, content] of Object.entries(extraFiles)) zip.file(name, content);
  if (version === 3 && nav) {
    zip.file(D + 'nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head><body><nav epub:type="toc"><ol>${navLis}</ol></nav></body></html>`);
    mani += '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>';
  }
  if (ncx) {
    zip.file(D + 'toc.ncx', `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${title}</text></docTitle><navMap>${ncxPts}</navMap></ncx>`);
    mani += '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>';
  }
  if (encryption) zip.file('META-INF/encryption.xml', encryption);
  const creators = authors.map(a => `<dc:creator${role ? ` opf:role="${role}"` : ''}>${a}</dc:creator>`).join('');
  const dcmeta = `<dc:identifier id="id">${uid}</dc:identifier><dc:title>${title}</dc:title>${creators}<dc:language>${lang}</dc:language>` +
    (publisher ? `<dc:publisher>${publisher}</dc:publisher>` : '') + (description ? `<dc:description>${description.replace(/</g, '&lt;')}</dc:description>` : '') +
    subjects.map(s => `<dc:subject>${s}</dc:subject>`).join('') + '<dc:date>2020-05-01</dc:date>';
  zip.file(D + 'content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" xmlns:opf="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${dcmeta}${version === 3 ? '<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>' : ''}${meta}</metadata><manifest>${mani}</manifest><spine${ncx ? ' toc="ncx"' : ''}${rtl ? ' page-progression-direction="rtl"' : ''}>${spine}</spine>${guide}</package>`);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

/* capítulo com quase todos os elementos que o diagramador trata */
const RICH_CHAPTER = `<h1 id="t1">Capítulo Rico</h1>
<h2>Uma seção</h2><h3>Subseção</h3><h4>Nível 4</h4><h5>Nível 5</h5><h6>Nível 6</h6>
<p>Texto com <i>itálico</i>, <b>negrito</b>, <strong><em>os dois</em></strong>, nota<sup>1</sup> e H<sub>2</sub>O.</p>
<p class="center">Linha centralizada</p><p style="text-align:right">Linha à direita</p>
<p>Uma palavra muito longa: https://exemplo.com.br/um/endereco/enorme/que/nao/cabe/na/linha/de/jeito/nenhum/mesmo/de/verdade/mesmo/</p>
<p>Ligadura ﬁ e caracteres raros: Ǆ ǅ ꜳ — e grego: αβγ λόγος.</p>
<ul><li>primeiro item</li><li>segundo item</li></ul><ol><li>um</li><li>dois</li></ol>
<blockquote><p>Uma citação recuada, com texto suficiente para ocupar mais de uma linha na página do livro gerado.</p></blockquote>
<pre>codigo  com   espacos
  e segunda linha</pre>
<p>Antes da quebra<br/>depois da quebra</p><hr/>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<p hidden="hidden">texto escondido</p><script>var nao = 1;</script>
<p><img src="data:image/png;base64,iVBORw0KGgo=" alt=""/>imagem embutida em data: é ignorada</p>`;

/* fonte "TTF" falsa: só o cabeçalho conta para o app (sniffFont); os bytes passam adiante */
const FAKE_TTF = Buffer.concat([Buffer.from([0, 1, 0, 0]), crypto.randomBytes(1500)]);
/* ofuscação de fontes do IDPF: XOR dos 1040 primeiros bytes com o SHA-1 do identificador */
function idpfObfuscate(data, uid) {
  const key = crypto.createHash('sha1').update(uid.replace(/[ \u0009\u000d\u000a]/g, '')).digest(), out = Buffer.from(data);
  for (let i = 0; i < Math.min(1040, out.length); i++) out[i] ^= key[i % key.length];
  return out;
}
/* encryption.xml: com prefixo (enc:EncryptedData, como no exemplo da especificação e no Calibre) ou com o namespace padrão */
const encryptionXml = (uri, alg = 'http://www.idpf.org/2008/embedding', prefix = true) => prefix
  ? `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`
  : `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="${alg}"/><CipherData><CipherReference URI="${uri}"/></CipherData></EncryptedData></encryption>`;

/* ---------- PDF ---------- */
/* PDF de texto corrido (como um livro diagramado), com título e autor nos metadados. */
async function makeTextPdf({ title = 'Livro de Teste', author = 'Fulana de Tal', chapters = 2, paras = LOREM, size = [420, 595], heading = c => `Capítulo ${c}` } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  if (title) pdf.setTitle(title);
  if (author) pdf.setAuthor(author);
  for (let c = 1; c <= chapters; c++) {
    const page = pdf.addPage(size);
    let y = size[1] - 75;
    const ht = heading(c); page.drawText(ht, { x: (size[0] - bold.widthOfTextAtSize(ht, 20)) / 2, y, size: 20, font: bold }); y -= 50;
    for (const para of paras) {
      const words = para.split(' '); let line = '', first = true;
      const flush = () => { page.drawText(line, { x: first ? 62 : 50, y, size: 11, font }); y -= 15; line = ''; first = false; };
      for (const w of words) { if ((line + ' ' + w).length > 58) flush(); line = line ? line + ' ' + w : w; }
      if (line) flush();
      y -= 4;
    }
  }
  return Buffer.from(await pdf.save());
}

/* PDF de N páginas com um número grande em cada uma (para conferir ordem e rotação). */
async function makeNumberedPdf(n = 3, { size = [300, 400], outline = false, title = null } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) pdf.addPage(size).drawText(`Pagina ${i}`, { x: 60, y: 200, size: 32, font });
  if (title) pdf.setTitle(title);
  if (outline) addOutline(pdf, typeof outline === 'object' ? outline : Array.from({ length: n }, (_, i) => ({ title: `Marcador ${i + 1}`, page: i, items: [] })));
  return Buffer.from(await pdf.save());
}

/* marcadores no PDF (pdf-lib não tem API pronta): [{ title, page, items, top? }] */
function addOutline(pdf, nodes) {
  const ctx = pdf.context, pages = pdf.getPages(), root = ctx.nextRef();
  const build = (list, parent) => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach((n, i) => {
      const pg = pages[n.page], dest = n.named
        ? PDFString.of(n.named)
        : ctx.obj(n.top != null ? [pg.ref, PDFName.of('XYZ'), null, n.top, null] : [pg.ref, PDFName.of('Fit')]);
      const d = { Title: PDFHexString.fromText(n.title), Parent: parent, Dest: dest };
      if (i) d.Prev = refs[i - 1];
      if (i < list.length - 1) d.Next = refs[i + 1];
      if (n.items && n.items.length) { const k = build(n.items, refs[i]); d.First = k.first; d.Last = k.last; d.Count = n.items.length; }
      ctx.assign(refs[i], ctx.obj(d));
    });
    return { first: refs[0], last: refs[refs.length - 1] };
  };
  const k = build(nodes, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: k.first, Last: k.last, Count: nodes.length }));
  pdf.catalog.set(PDFName.of('Outlines'), root);
  // destinos nomeados usados acima
  const named = [];
  const collect = ns => ns.forEach(n => { if (n.named) named.push(n); collect(n.items || []); });
  collect(nodes);
  if (named.length) {
    const names = ctx.obj({ Names: named.flatMap(n => [PDFString.of(n.named), ctx.obj([pages[n.page].ref, PDFName.of('Fit')])]) });
    pdf.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: names }));
  }
}

/* PDF "escaneado": cada página é só uma imagem (PNG ou JPEG), sem camada de texto. */
async function makeImagePdf(images, { size, title, author } = {}) {
  const pdf = await PDFDocument.create();
  for (const img of images) {
    const e = img[0] === 0x89 ? await pdf.embedPng(img) : await pdf.embedJpg(img);
    const [w, h] = typeof size === 'function' ? size(e) : size || [e.width, e.height];
    pdf.addPage([w, h]).drawImage(e, { x: 0, y: 0, width: w, height: h });
  }
  if (title) pdf.setTitle(title);
  if (author) pdf.setAuthor(author);
  return Buffer.from(await pdf.save());
}

/* PDF protegido por senha: dicionário /Encrypt no trailer (os leitores pedem a senha antes de abrir) */
async function makeEncryptedPdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 300]);
  const ctx = pdf.context;
  const enc = ctx.register(ctx.obj({ Filter: PDFName.of('Standard'), V: 1, R: 2, Length: 40, P: -44,
    O: PDFHexString.of('a'.repeat(64)), U: PDFHexString.of('b'.repeat(64)) }));
  ctx.trailerInfo.Encrypt = enc;
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of('0123456789abcdef0123456789abcdef'), PDFHexString.of('0123456789abcdef0123456789abcdef')]);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

/* Livro em PDF com o que o PDF → EPUB reconstrói, diagramado de verdade (o texto corre de página em página):
   cabeçalho corrente e número de página, capítulos, itálico, negrito, nota de rodapé, lista, citação,
   código, hifenização, acentos soltos (TeX), figura, tabela, duas colunas, sumário impresso e marcadores. */
async function makeBookPdf(o = {}) {
  const { outline = true, printedToc = false, title = 'Um Livro Completo', author = 'Silva, Maria; João Souza', chapters = 3,
          figure = true, table = true, code = true, twoCols = false, notes = true, rotatedPage = false, scannedPage = false,
          header = true, size: [W, H] = [420, 620] } = o;
  const pdf = await PDFDocument.create();
  const F = {
    r: await pdf.embedFont(StandardFonts.TimesRoman), i: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    b: await pdf.embedFont(StandardFonts.TimesRomanBold), m: await pdf.embedFont(StandardFonts.Courier), h: await pdf.embedFont(StandardFonts.Helvetica),
  };
  if (title) pdf.setTitle(title);
  if (author) pdf.setAuthor(author);
  const L = 50, R = W - 50, TOP = H - 70, BOTTOM = 70, size = 11, lh = 15;
  const tocPage = printedToc ? pdf.addPage([W, H]) : null;
  let page = null, y = 0, pageNo = printedToc ? 1 : 0, foot = [];
  const marks = [];   // { title, page, top }
  const newPage = () => {
    if (page && foot.length) { let fy = BOTTOM - 20; for (const t of foot) { page.drawText(t, { x: L, y: fy, size: 8, font: F.r }); fy -= 10; } foot = []; }
    page = pdf.addPage([W, H]); pageNo++; y = TOP;
    if (header) {
      page.drawText('UM LIVRO COMPLETO', { x: W / 2 - 45, y: H - 35, size: 8, font: F.h });
      page.drawText(String(pageNo), { x: W / 2 - 3, y: 30, size: 9, font: F.r });
    }
  };
  const need = h => { if (!page || y - h < BOTTOM) newPage(); };
  const wrap = (s, max, f, sz) => { const out = []; let line = ''; for (const w of s.split(' ')) { const t = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(t, sz) > max && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
  const para = (s, { indent = 15, x0 = L, x1 = R, font = F.r, sz = size, gap = 3 } = {}) => {
    wrap(s, x1 - x0 - indent, font, sz).forEach((ln, k) => { need(lh); page.drawText(ln, { x: x0 + (k ? 0 : indent), y, size: sz, font }); y -= lh; });
    y -= gap;
  };
  const line = (s, { x = L, font = F.r, sz = size, h = lh } = {}) => { need(h); page.drawText(s, { x, y, size: sz, font }); y -= h; };
  const texto = 'Este parágrafo tem frases suficientes para ocupar várias linhas da página, como num livro de verdade, e assim o conversor consegue medir a margem, o recuo e o espaçamento das linhas.';
  const P = n => `${texto} Parágrafo número ${n}.`;
  let pn = 0;
  for (let c = 1; c <= chapters; c++) {
    newPage();
    const t = `Capítulo ${c}`, tw = F.b.widthOfTextAtSize(t, 22);
    y -= 30; page.drawText(t, { x: (W - tw) / 2, y, size: 22, font: F.b }); marks.push({ title: t, page: pdf.getPageCount() - 1, top: y + 22 }); y -= 40;
    if (c === 1) {
      para('Primeiro parágrafo do livro, sem recuo, que termina com uma nota de rodapé no fim da frase.', { indent: 0, gap: 0 });
      if (notes) { page.drawText('1', { x: L + F.r.widthOfTextAtSize('frase.', size) + 4, y: y + lh + 5, size: 7, font: F.r }); foot.push('1 Esta é a nota de rodapé, em letra menor.'); }
      y -= 3;
      para(P(++pn));
      line('Uma frase inteira em itálico, sozinha na linha.', { font: F.i }); y -= 3;
      para(P(++pn));
      y -= 8; line('Negrito Isolado', { font: F.b }); y -= 8;
      // hifenização de fim de linha e acentos soltos de PDF gerado por TeX
      line('Este texto tem uma palavra com hifeni-', { x: L + 15 });
      line('zação no fim da linha e acentos soltos: ent˜ao, cora¸c˜ao, informa¸c˜oes e n˜ao.'); y -= 3;
      para(P(++pn));
    } else if (c === 2) {
      para(P(++pn));
      for (const it of ['• primeiro item da lista', '• segundo item da lista', '• terceiro item da lista']) line(it, { x: L + 10 });
      y -= 6;
      para('Uma citação recuada dos dois lados, com texto bastante para quebrar em mais de uma linha e mostrar o recuo dela.', { indent: 0, x0: L + 40, x1: R - 40 });
      if (code) { y -= 6; for (const k of ['function soma(a, b) {', '  return a + b;', '}']) line(k, { font: F.m, sz: 9, h: 12 }); y -= 8; }
      para(P(++pn));
      if (figure) {
        need(150); const img = await pdf.embedPng(ICON);
        page.drawImage(img, { x: W / 2 - 60, y: y - 120, width: 120, height: 120 }); y -= 135;
      }
      para(P(++pn));
      if (table) {
        y -= 6;
        for (const [k, r] of [['Produto', 'Preço', 'Qtd'], ['Livro', '10,00', '2'], ['Revista', '5,50', '10'], ['Jornal', '2,00', '30']].entries()) {
          need(lh + 2); r.forEach((cell, j) => page.drawText(cell, { x: L + 20 + j * 110, y, size, font: k ? F.r : F.b })); y -= lh + 2;
        }
        y -= 8;
      }
      para(P(++pn));
    } else {
      for (let k = 0; k < 8; k++) para(P(++pn));
    }
  }
  if (twoCols) {
    newPage();
    const col = (x0, x1) => { const y0 = y; for (let k = 0; k < 3; k++) para(`Coluna ${x0 === L ? 'esquerda' : 'direita'}: ${texto}`, { x0, x1, indent: 10, sz: 9 }); const y1 = y; y = y0; return y1; };
    col(L, W / 2 - 10); y = col(W / 2 + 10, R);
  }
  if (rotatedPage) {
    newPage();
    for (let k = 0; k < 12; k++) page.drawText(`Texto girado noventa graus na linha ${'abcdefghijkl'[k]}, como tabela em paisagem.`, { x: 80 + k * 20, y: 80, size: 10, font: F.r, rotate: degrees(90) });
  }
  if (scannedPage) { newPage(); page.drawImage(await pdf.embedPng(ICON_BIG), { x: 0, y: 0, width: W, height: H }); }
  if (page && foot.length) newPage();   // descarrega a última nota
  if (tocPage) {
    let ty = H - 80;
    tocPage.drawText('Sumário', { x: W / 2 - 30, y: ty, size: 18, font: F.b }); ty -= 40;
    for (const m of marks) { tocPage.drawText(`${m.title} ${'.'.repeat(50)} ${m.page + 1}`, { x: L, y: ty, size, font: F.r }); ty -= lh + 4; }
    tocPage.drawText(`Apêndice ${'.'.repeat(50)} 99`, { x: L, y: ty, size, font: F.r });
  }
  if (outline) addOutline(pdf, marks.map((m, k) => ({ ...m, items: k === 0 ? [{ title: 'Primeira Seção', page: m.page, top: m.top - 120, items: [] }] : [] })));
  return Buffer.from(await pdf.save());
}

/* páginas "escaneadas": screenshot de HTML (A4 a 150 dpi), com cabeçalho corrente e número de página opcionais */
async function scanPages(browser, specs, { lang = 'pt' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
  const out = [];
  for (const sp of specs) {
    const header = sp.header ? `<div style="position:absolute;top:90px;left:0;right:0;text-align:center;font:26px Georgia,serif;letter-spacing:2px">${sp.header}</div>` : '';
    const num = sp.number ? `<div style="position:absolute;bottom:90px;left:0;right:0;text-align:center;font:28px Georgia,serif">${sp.number}</div>` : '';
    const body = (sp.title ? `<h1 style="text-align:center;font-size:56px;margin:60px 0 50px">${sp.title}</h1>` : '') + (sp.html || (sp.paras || []).map(p => `<p style="margin:0;text-indent:2em">${p}</p>`).join(''));
    await page.setContent(`<html lang="${lang}"><body style="margin:0;background:#fff;color:#000"><div style="position:relative;width:1240px;height:1754px">${header}<div style="position:absolute;top:180px;left:150px;right:150px;font:32px/1.55 Georgia,serif;text-align:justify">${body}</div>${num}</div></body></html>`);
    out.push(await page.screenshot());
  }
  await page.close();
  return out;
}

module.exports = {
  ROOT, scanPages, ICON, ICON_BIG, LOREM, GIF_1x1, FAKE_TTF, RICH_CHAPTER, file, bmp, withExif, drawImage, comicPage,
  makeEpub, idpfObfuscate, encryptionXml, makeTextPdf, makeNumberedPdf, makeImagePdf, makeEncryptedPdf, makeBookPdf, addOutline,
};
