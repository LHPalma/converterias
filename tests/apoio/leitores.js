// Leitores das saídas do app, escritos a partir dos formatos (independentes do código de src/):
// PDF (pdf-lib), EPUB (JSZip), AZW3/KF8 (PalmDB + PalmDOC + índices) e KFX (contêiner CONT + Amazon Ion).
const crypto = require('crypto');
const JSZip = require('../../vendor/jszip.min.js');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } = require('../../vendor/pdf-lib.min.js');

/* ---------- PDF ---------- */
async function readPdf(buf) {
  const pdf = await PDFDocument.load(buf, { updateMetadata: false });
  const ctx = pdf.context, pages = pdf.getPages();
  const pageIdx = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  // marcadores: [{ title, page, items }]
  const outline = [];
  const decode = o => o && (o.decodeText ? o.decodeText() : String(o));
  const walk = (ref, out) => {
    for (let r = ref; r;) {
      const d = ctx.lookup(r, PDFDict);
      const dest = d.lookup(PDFName.of('Dest'));
      const node = { title: decode(d.lookup(PDFName.of('Title'))), page: dest instanceof PDFArray ? pageIdx.get(dest.get(0).toString()) : null, items: [] };
      const first = d.get(PDFName.of('First'));
      if (first) walk(first, node.items);
      out.push(node);
      r = d.get(PDFName.of('Next'));
    }
  };
  const root = pdf.catalog.get(PDFName.of('Outlines'));
  if (root) { const first = ctx.lookup(root, PDFDict).get(PDFName.of('First')); if (first) walk(first, outline); }
  return {
    pdf,
    pages: pdf.getPageCount(),
    title: pdf.getTitle(),
    author: pdf.getAuthor(),
    producer: pdf.getProducer(),
    sizes: pages.map(p => p.getSize()),
    rotations: pages.map(p => p.getRotation().angle),
    hasOutline: !!root,
    outline,
    fonts: [...new Set(pages.flatMap(p => { const f = p.node.Resources()?.lookup(PDFName.of('Font')); return f ? f.keys().map(k => ctx.lookup(f.get(k)).lookup(PDFName.of('BaseFont'))?.toString()) : []; }))],
    images: pages.map(p => { const x = p.node.Resources()?.lookup(PDFName.of('XObject')); return x ? x.keys().length : 0; }),
  };
}

/* ---------- EPUB ---------- */
async function readEpub(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  const text = async n => zip.file(n).async('string');
  const container = await text('META-INF/container.xml');
  const opfPath = container.match(/full-path="([^"]+)"/)[1];
  const opf = await text(opfPath);
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = [...opf.matchAll(/<item\s([^>]*?)\/?>/g)].map(m => {
    const a = k => (m[1].match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`)) || [])[1];
    return { id: a('id'), href: a('href'), type: a('media-type'), props: a('properties') || '' };
  });
  const byId = new Map(manifest.map(m => [m.id, m]));
  const spine = [...opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)].map(m => m[1]);
  const spineHtml = [];
  for (const id of spine) { const m = byId.get(id); if (m && zip.file(dir + decodeURIComponent(m.href))) spineHtml.push(await text(dir + decodeURIComponent(m.href))); }
  const html = spineHtml.join('\n');
  const nav = manifest.find(m => /\bnav\b/.test(m.props));
  return {
    zip, names, opf, dir, manifest, spine, spineHtml, html,
    mimetypeFirst: Object.keys(zip.files)[0] === 'mimetype' && (await text('mimetype')) === 'application/epub+zip' && zip.files.mimetype._data.compression.magic === '\x00\x00',
    title: (opf.match(/<dc:title[^>]*>([^<]*)</) || [])[1],
    creators: [...opf.matchAll(/<dc:creator[^>]*>([^<]*)</g)].map(m => m[1]),
    lang: (opf.match(/<dc:language[^>]*>([^<]*)</) || [])[1],
    text: html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' '),
    nav: nav ? await text(dir + nav.href) : '',
    navTitles: nav ? [...((await text(dir + nav.href)).match(/<nav[^>]*toc[^>]*>[\s\S]*?<\/nav>/) || [''])[0].matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map(m => m[1]) : [],
    missing: manifest.filter(m => m.href && !/^[a-z]+:/i.test(m.href) && !zip.file(dir + decodeURIComponent(m.href))).map(m => m.href),
    file: n => zip.file(dir + n) ? zip.file(dir + n).async('nodebuffer') : null,
  };
}

/* ---------- AZW3 (KF8) ---------- */
function palmDecompress(src) {
  const out = [];
  for (let i = 0; i < src.length;) {
    const c = src[i++];
    if (c === 0 || (c >= 9 && c <= 0x7f)) out.push(c);
    else if (c <= 8) for (let k = 0; k < c; k++) out.push(src[i++]);
    else if (c >= 0xc0) out.push(32, c ^ 0x80);
    else { const v = (c << 8) | src[i++], d = (v >> 3) & 0x7ff, n = (v & 7) + 3; for (let k = 0; k < n; k++) out.push(out[out.length - d]); }
  }
  return Buffer.from(out);
}
const fwdVwi = (b, p) => { let v = 0; for (;;) { const x = b[p++]; v = (v << 7) | (x & 0x7f); if (x & 0x80) return [v, p]; } };
const trailingSize = d => { let n = 0; for (const v of d.subarray(Math.max(0, d.length - 4))) { if (v & 0x80) n = 0; n = (n << 7) | (v & 0x7f); } return n; };
const bits = m => { let n = 0; for (; m; m >>= 1) n += m & 1; return n; };

function readAzw3(buf) {
  if (buf.toString('latin1', 60, 68) !== 'BOOKMOBI') throw new Error('não é BOOKMOBI');
  const n = buf.readUInt16BE(76), offs = Array.from({ length: n }, (_, i) => buf.readUInt32BE(78 + 8 * i));
  const rec = i => buf.subarray(offs[i], i + 1 < n ? offs[i + 1] : buf.length);
  const r0 = rec(0), u32 = o => r0.readUInt32BE(o);
  const head = { compression: r0.readUInt16BE(0), textLength: u32(4), textRecords: r0.readUInt16BE(8), recordSize: r0.readUInt16BE(10),
    magic: r0.toString('latin1', 16, 20), headerLength: u32(20), encoding: u32(28), version: u32(36), firstNonBook: u32(0x50),
    lang: u32(0x5c), firstImage: u32(0x6c), fdst: u32(0xc0), fdstCount: u32(0xc4), fcis: u32(0xc8), flis: u32(0xd0),
    extraFlags: r0.readUInt16BE(0xf2), ncx: u32(0xf4), frag: u32(0xf8), skel: u32(0xfc) };
  const title = r0.toString('utf8', u32(0x54), u32(0x54) + u32(0x58));
  // EXTH
  const exth = {}, exthAll = [];
  const e = 16 + head.headerLength;
  if (r0.toString('latin1', e, e + 4) === 'EXTH') {
    for (let k = 0, p = e + 12, cnt = r0.readUInt32BE(e + 8); k < cnt; k++) {
      const t = r0.readUInt32BE(p), len = r0.readUInt32BE(p + 4), d = r0.subarray(p + 8, p + len);
      const v = len === 12 && [115, 116, 121, 125, 131, 201, 202, 203, 204, 205, 206, 207].includes(t) ? d.readUInt32BE(0) : d.toString('utf8');
      exthAll.push([t, v]); if (!(t in exth)) exth[t] = v; p += len;
    }
  }
  // texto: tira as entradas finais (TBS e sobra de caractere multibyte) e descomprime
  const parts = [], tbs = [];
  for (let i = 1; i <= head.textRecords; i++) {
    let d = rec(i);
    for (let b = 15; b >= 1; b--) if (head.extraFlags & (1 << b)) { const s = trailingSize(d); tbs.push(d.subarray(d.length - s)); d = d.subarray(0, d.length - s); }
    if (head.extraFlags & 1) d = d.subarray(0, d.length - ((d[d.length - 1] & 3) + 1));
    const t = palmDecompress(d);
    if (t.length > head.recordSize) throw new Error(`registro de texto ${i} com ${t.length} bytes`);
    parts.push(t);
  }
  const full = Buffer.concat(parts);
  // FDST: fluxos (0 = texto, depois CSS e SVG)
  const fd = rec(head.fdst);
  if (fd.toString('latin1', 0, 4) !== 'FDST') throw new Error('sem FDST');
  const flows = Array.from({ length: fd.readUInt32BE(8) }, (_, k) => full.subarray(fd.readUInt32BE(12 + 8 * k), fd.readUInt32BE(16 + 8 * k)));
  // índices INDX
  const readIndex = start => {
    const h = rec(start);
    if (h.toString('latin1', 0, 4) !== 'INDX') throw new Error('sem INDX em ' + start);
    const count = h.readUInt32BE(24), ncncx = h.readUInt32BE(52), tx = h.readUInt32BE(180);
    if (h.toString('latin1', tx, tx + 4) !== 'TAGX') throw new Error('sem TAGX');
    const tagx = [];
    for (let p = tx + 12; p < tx + h.readUInt32BE(tx + 4); p += 4) tagx.push([h[p], h[p + 1], h[p + 2], h[p + 3]]);
    const entries = [];
    for (let r = 1; r <= count; r++) {
      const d = rec(start + r), idxt = d.readUInt32BE(20), cnt = d.readUInt32BE(24);
      if (d.toString('latin1', idxt, idxt + 4) !== 'IDXT') throw new Error('sem IDXT');
      for (let k = 0; k < cnt; k++) {
        let p = d.readUInt16BE(idxt + 4 + 2 * k);
        const kl = d[p], key = d.toString('latin1', p + 1, p + 1 + kl); p += 1 + kl;
        const ctrl = d[p++], want = [];
        for (const [tag, vpe, mask, end] of tagx) {
          if (end) continue;
          let v = ctrl & mask;
          if (!v) continue;
          if (v === mask && bits(mask) > 1) { let c; [c, p] = fwdVwi(d, p); want.push([tag, null, c, vpe]); }
          else if (v === mask) want.push([tag, 1, null, vpe]);
          else { let m = mask; while (!(m & 1)) { m >>= 1; v >>= 1; } want.push([tag, v, null, vpe]); }
        }
        const tags = {};
        for (const [tag, cnt2, bytes, vpe] of want) {
          const vals = [];
          if (cnt2 != null) for (let q = 0; q < cnt2 * vpe; q++) { let v; [v, p] = fwdVwi(d, p); vals.push(v); }
          else { const stop = p + bytes; while (p < stop) { let v; [v, p] = fwdVwi(d, p); vals.push(v); } }
          tags[tag] = vals;
        }
        entries.push({ key, tags });
      }
    }
    const cncx = Buffer.concat(Array.from({ length: ncncx }, (_, k) => { const c = rec(start + 1 + count + k); return Buffer.concat([c, Buffer.alloc(0x10000 - c.length)]); }));
    const str = off => { const [len, p] = fwdVwi(cncx, off); return cncx.toString('utf8', p, p + len); };
    return { entries, total: h.readUInt32BE(36), str };
  };
  const skel = readIndex(head.skel), frag = readIndex(head.frag), ncx = readIndex(head.ncx);
  // remonta cada arquivo: esqueleto + fragmentos inseridos, como o leitor do Kindle
  const fidPos = new Map(), files = [];
  let fragK = 0;
  skel.entries.forEach((s, fi) => {
    const [nChunks, , start, len] = s.tags[1].concat(s.tags[6]);
    let html = full.subarray(start, start + len), phys = start + len;
    for (let k = 0; k < nChunks; k++, fragK++) {
      const f = frag.entries[fragK], [fileNo] = f.tags[3], [fid] = f.tags[4], [, size] = f.tags[6], ins = +f.key - start;
      if (fileNo !== fi) throw new Error(`fragmento ${fragK} do arquivo ${fileNo}, esperado ${fi}`);
      const chunk = full.subarray(phys, phys + size); phys += size;
      fidPos.set(fid, { file: fi, pos: ins, selector: frag.str(f.tags[2][0]) });
      html = Buffer.concat([html.subarray(0, ins), chunk, html.subarray(ins)]);
    }
    files.push(html.toString('utf8'));
  });
  // sumário
  const toc = ncx.entries.map(x => ({ title: ncx.str(x.tags[3][0]), pos: x.tags[1][0], len: x.tags[2][0], depth: x.tags[4][0], parent: x.tags[21] ? x.tags[21][0] : null, fid: x.tags[6][0], off: x.tags[6][1] }));
  // destino de um kindle:pos (fid + deslocamento) dentro do arquivo remontado
  const target = (fid, off) => { const t = fidPos.get(fid); return t && { file: t.file, at: Buffer.from(files[t.file]).subarray(t.pos + off).toString('utf8') }; };
  const links = files.flatMap(h => [...h.matchAll(/kindle:pos:fid:([0-9A-V]{4}):off:([0-9A-V]{10})/g)].map(m => target(parseInt(m[1], 32), parseInt(m[2], 32))));
  const resources = [];
  if (head.firstImage !== 0xffffffff) for (let k = 0; k < (exth[125] || 0); k++) resources.push(rec(head.firstImage + k));
  return { head, title, exth, exthAll, full, flows, css: flows.slice(1).map(f => f.toString('utf8')), files, text: files.join('\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
    toc, links, resources, records: n, skel, frag, fidPos, tbs, record: rec };
}

/* ---------- KFX (contêiner CONT + Ion binário) ---------- */
class Sym { constructor(id) { this.id = id; } }
function ionRead(b, p, end) {
  const t = b[p] >> 4; let len = b[p] & 15; p++;
  if (len === 15) return [null, p];
  if (len === 14 && t !== 1) { let v = 0; for (;;) { const x = b[p++]; v = (v << 7) | (x & 0x7f); if (x & 0x80) break; } len = v; }
  const body = b.subarray(p, p + len), q = p + len;
  const uint = d => d.reduce((v, x) => v * 256 + x, 0);
  const varu = (d, i) => { let v = 0; for (;;) { const x = d[i++]; v = v * 128 + (x & 0x7f); if (x & 0x80) return [v, i]; } };
  switch (t) {
    case 0: return [undefined, q];
    case 1: return [len === 1, p];
    case 2: return [uint(body), q];
    case 3: return [-uint(body), q];
    case 4: return [len ? body.readDoubleBE(0) : 0, q];
    case 7: return [new Sym(uint(body)), q];
    case 8: return [body.toString('utf8'), q];
    case 10: return [Buffer.from(body), q];
    case 11: case 12: { const out = []; for (let i = 0; i < body.length;) { let v; [v, i] = ionRead(body, i, body.length); out.push(v); } return [out, q]; }
    case 13: { const out = {}; for (let i = 0; i < body.length;) { let k; [k, i] = varu(body, i); let v; [v, i] = ionRead(body, i, body.length); out[k] = v; } return [out, q]; }
    case 14: { let al, i; [al, i] = varu(body, 0); const annots = []; for (const stop = i + al; i < stop;) { let a; [a, i] = varu(body, i); annots.push(a); } const [v] = ionRead(body, i, body.length); return [{ annots, value: v }, q]; }
    default: throw new Error(`tipo Ion ${t} em ${p - 1}`);
  }
}
const ionDoc = b => { if (b[0] !== 0xe0 || b[1] !== 1 || b[2] !== 0 || b[3] !== 0xea) throw new Error('sem BVM do Ion'); return ionRead(b, 4, b.length)[0]; };

function readKfx(buf) {
  if (buf.toString('latin1', 0, 4) !== 'CONT') throw new Error('não é CONT');
  const hdrLen = buf.readUInt32LE(6), infoOff = buf.readUInt32LE(10), infoLen = buf.readUInt32LE(14);
  const info = ionDoc(buf.subarray(infoOff, infoOff + infoLen));
  const idxOff = info[413], idxLen = info[414];
  const docSym = ionDoc(buf.subarray(info[415], info[415] + info[416]));
  const names = docSym.value[7], LOCAL = 9 + 778 + 1;
  const name = s => s instanceof Sym ? (s.id >= LOCAL ? names[s.id - LOCAL] : '$' + s.id) : s;
  const json = buf.toString('latin1', infoOff + infoLen, hdrLen);
  const payload = buf.subarray(hdrLen);
  const frags = [];
  for (let p = idxOff; p < idxOff + idxLen; p += 24) {
    const id = buf.readUInt32LE(p), type = buf.readUInt32LE(p + 4), off = Number(buf.readBigUInt64LE(p + 8)), len = Number(buf.readBigUInt64LE(p + 16));
    const d = payload.subarray(off, off + len);
    if (d.toString('latin1', 0, 4) !== 'ENTY') throw new Error('fragmento sem ENTY');
    const hl = d.readUInt32LE(6), body = d.subarray(hl);
    let value = null;
    try { if (type !== 417) value = ionDoc(body); } catch (e) { throw new Error(`fragmento tipo ${type}: ${e.message}`); }
    frags.push({ id, type, raw: type === 417 ? Buffer.from(body) : null, value });
  }
  const of = t => frags.filter(f => f.type === t);
  const strings = of(145).flatMap(f => f.value[146]);
  const meta = {};
  for (const g of of(490)[0].value[491]) for (const kv of g[258]) meta[kv[492]] = kv[307];
  const nav = of(389).flatMap(f => f.value.flatMap(r => r[392].flatMap(c => c.value[247].map(e => e.value[241][244]))));
  const sha = (json.match(/kfxgen_payload_sha1",value:"([0-9a-f]+)"/) || [])[1];
  return { info, names, name, json, frags, of, strings, text: strings.join(' '), meta, nav, sections: of(260).length, images: of(417).map(f => f.raw),
    shaOk: sha === crypto.createHash('sha1').update(payload).digest('hex') };
}

module.exports = { readPdf, readEpub, readAzw3, readKfx, palmDecompress, Sym, ionDoc };
