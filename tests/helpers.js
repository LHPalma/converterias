// Arquivos de entrada gerados na hora (nada de binário no repositório) e leitores das saídas do app.
const fs = require('fs');
const path = require('path');
const JSZip = require('../vendor/jszip.min.js');
const { PDFDocument, StandardFonts, PDFName } = require('../vendor/pdf-lib.min.js');

const ROOT = path.join(__dirname, '..');
const ICON = fs.readFileSync(path.join(ROOT, 'icons', 'icon-192.png'));

const LOREM = [
  'Era uma vez um conversor que rodava inteiro no navegador, sem mandar nada para servidor algum.',
  'Ele lia livros, remontava parágrafos e devolvia arquivos prontos para o leitor de cada um.',
  'Quando alguém mexia no código, os testes conferiam se tudo continuava funcionando como antes.',
];

/* EPUB 3 mínimo, mas completo: OPF com metadados, nav, capítulos, imagem e capa. */
async function makeEpub({ title = 'o nome do vento', authors = ['Patrick Rothfuss'], chapters = 3, cover = true } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  let mani = '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', spine = '', nav = '';
  if (cover) {
    zip.file('OEBPS/capa.png', ICON);
    mani += '<item id="capa" href="capa.png" media-type="image/png" properties="cover-image"/>';
  }
  for (let i = 1; i <= chapters; i++) {
    const body = `<h1>Capítulo ${i}</h1>` + LOREM.map((t, k) => `<p>${k === 1 ? `<em>${t}</em>` : t} (cap. ${i}, §${k + 1})</p>`).join('') +
      (i === 1 ? '<p><img src="capa.png" alt=""/></p><blockquote><p>Uma citação recuada.</p></blockquote><ul><li>primeiro</li><li>segundo</li></ul>' : '');
    zip.file(`OEBPS/c${i}.xhtml`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Capítulo ${i}</title></head><body>${body}</body></html>`);
    mani += `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`;
    spine += `<itemref idref="c${i}"/>`;
    nav += `<li><a href="c${i}.xhtml">Capítulo ${i}</a></li>`;
  }
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head><body><nav epub:type="toc"><ol>${nav}</ol></nav></body></html>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier><dc:title>${title}</dc:title>${authors.map(a => `<dc:creator>${a}</dc:creator>`).join('')}<dc:language>pt-BR</dc:language><meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>${cover ? '<meta name="cover" content="capa"/>' : ''}</metadata><manifest>${mani}</manifest><spine>${spine}</spine></package>`);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

/* PDF de texto corrido (como um livro diagramado), com título e autor nos metadados. */
async function makeTextPdf({ title = 'Livro de Teste', author = 'Fulana de Tal', chapters = 2 } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  pdf.setTitle(title); pdf.setAuthor(author);
  for (let c = 1; c <= chapters; c++) {
    const page = pdf.addPage([420, 595]);
    let y = 520;
    page.drawText(`Capítulo ${c}`, { x: 150, y, size: 20, font: bold }); y -= 50;
    for (const para of LOREM) {
      // quebra simples em linhas de ~60 caracteres, com recuo na primeira
      const words = para.split(' '); let line = '', first = true;
      const flush = () => { page.drawText(line, { x: first ? 62 : 50, y, size: 11, font }); y -= 15; line = ''; first = false; };
      for (const w of words) { if ((line + ' ' + w).length > 58) flush(); line = line ? line + ' ' + w : w; }
      if (line) flush();
      y -= 4;
    }
  }
  return Buffer.from(await pdf.save());
}

/* PDF de N páginas com um número grande em cada uma (para conferir ordem/rotação). */
async function makeNumberedPdf(n = 3, { size = [300, 400] } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) pdf.addPage(size).drawText(`Pagina ${i}`, { x: 60, y: 200, size: 32, font });
  return Buffer.from(await pdf.save());
}

/* PDF "escaneado": cada página é só uma imagem (PNG ou JPEG), sem camada de texto. */
async function makeImagePdf(images, { size } = {}) {
  const pdf = await PDFDocument.create();
  for (const img of images) {
    const isPng = img[0] === 0x89;
    const e = isPng ? await pdf.embedPng(img) : await pdf.embedJpg(img);
    const [w, h] = size || [e.width, e.height];
    pdf.addPage([w, h]).drawImage(e, { x: 0, y: 0, width: w, height: h });
  }
  return Buffer.from(await pdf.save());
}

/* ---------- leitores das saídas ---------- */
async function readPdf(buf) {
  const pdf = await PDFDocument.load(buf, { updateMetadata: false });
  return {
    pdf,
    pages: pdf.getPageCount(),
    title: pdf.getTitle(),
    author: pdf.getAuthor(),
    sizes: pdf.getPages().map(p => p.getSize()),
    rotations: pdf.getPages().map(p => p.getRotation().angle),
    hasOutline: !!pdf.catalog.get(PDFName.of('Outlines')),
  };
}

async function readEpub(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const text = async n => zip.file(n).async('string');
  const container = await text('META-INF/container.xml');
  const opfPath = container.match(/full-path="([^"]+)"/)[1];
  const opf = await text(opfPath);
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const xhtml = names.filter(n => /\.x?html?$/i.test(n));
  let body = '';
  for (const n of xhtml) body += await text(n);
  return {
    zip, names, opf, dir,
    mimetypeFirst: names[0] === 'mimetype' && (await text('mimetype')) === 'application/epub+zip',
    title: (opf.match(/<dc:title[^>]*>([^<]*)</) || [])[1],
    creators: [...opf.matchAll(/<dc:creator[^>]*>([^<]*)</g)].map(m => m[1]),
    spine: [...opf.matchAll(/<itemref[^>]*idref="([^"]+)"/g)].map(m => m[1]),
    text: body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    html: body,
  };
}

/* AZW3/MOBI: banco PalmDB com cabeçalho MOBI e versão do formato. */
function readPalm(buf) {
  const type = buf.toString('latin1', 60, 68);
  const nrec = buf.readUInt16BE(76);
  const rec0 = buf.readUInt32BE(78);
  const mobi = buf.toString('latin1', rec0 + 16, rec0 + 20);
  const version = buf.readUInt32BE(rec0 + 16 + 20);
  const exth = {};   // registros EXTH (metadados): { tipo: texto }
  const e = rec0 + 16 + buf.readUInt32BE(rec0 + 20);
  if (buf.toString('latin1', e, e + 4) === 'EXTH') {
    for (let k = 0, p = e + 12, n = buf.readUInt32BE(e + 8); k < n; k++) {
      const t = buf.readUInt32BE(p), len = buf.readUInt32BE(p + 4);
      exth[t] = buf.toString('utf8', p + 8, p + len);
      p += len;
    }
  }
  return { type, nrec, mobi, version, exth, name: buf.toString('latin1', 0, 32).replace(/\0.*$/, '') };
}

module.exports = { ROOT, ICON, LOREM, makeEpub, makeTextPdf, makeNumberedPdf, makeImagePdf, readPdf, readEpub, readPalm };
