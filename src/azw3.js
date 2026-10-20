// EPUB -> AZW3 (KF8): gravador escrito a partir do formato do arquivo (PalmDB + MOBI 8 + índices SKEL/FRAG/NCX).
const Azw3 = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const B32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
  const b32 = (n, w = 0) => { let s = ''; do { s = B32[n % 32] + s; n = Math.floor(n / 32); } while (n); return s.padStart(w, '0'); };
  const u16 = n => Uint8Array.of(n >> 8 & 255, n & 255);
  const u32 = n => Uint8Array.of(n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255);
  const cat = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const vwi = n => { const b = [n & 127]; n = Math.floor(n / 128); while (n) { b.unshift((n & 127) | 0); n = Math.floor(n / 128); } b[b.length - 1] |= 128; return Uint8Array.from(b); };
  const pad4 = a => a.length % 4 ? cat([a, new Uint8Array(4 - a.length % 4)]) : a;
  const ulen = s => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? (i++, 4) : 3; } return n; };
  const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const attr = s => xml(s).replace(/"/g, '&quot;');
  const clean = s => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])/g, '').replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, '$1');

  // ---------- compressão PalmDOC (por registro de 4096 bytes) ----------
  function palmCompress(src) {
    const n = src.length, out = [], head = new Int32Array(1 << 15).fill(-1), prev = new Int32Array(n);
    const hash = i => ((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) & 0x7fff;
    const add = p => { if (p + 2 < n) { const h = hash(p); prev[p] = head[h]; head[h] = p; } };
    let i = 0;
    while (i < n) {
      let best = 0, bd = 0;
      if (i + 2 < n) {
        const max = Math.min(10, n - i);
        for (let c = head[hash(i)], steps = 0; c >= 0 && i - c <= 2047 && steps < 32; c = prev[c], steps++) {
          let l = 0; while (l < max && src[c + l] === src[i + l]) l++;
          if (l > best) { best = l; bd = i - c; if (l === max) break; }
        }
      }
      if (best >= 3) {
        const v = 0x8000 | (bd << 3) | (best - 3);
        out.push(v >> 8, v & 255);
        for (let k = 0; k < best; k++) add(i + k);
        i += best;
        continue;
      }
      const b = src[i];
      if (b === 0x20 && i + 1 < n && src[i + 1] >= 0x40 && src[i + 1] <= 0x7f) { out.push(src[i + 1] ^ 0x80); add(i); add(i + 1); i += 2; continue; }
      if (b === 0 || (b >= 9 && b <= 0x7f)) { out.push(b); add(i); i++; continue; }
      let e = i, k = 0;   // sequência de bytes "especiais" (1-8 e 0x80+): precedida pela contagem
      while (e < n && k < 8 && (src[e] === 0 ? false : (src[e] <= 8 || src[e] >= 0x80))) { e++; k++; }
      out.push(k);
      for (let p = i; p < e; p++) { out.push(src[p]); add(p); }
      i = e;
    }
    return Uint8Array.from(out);
  }

  // ---------- caminhos ----------
  const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
  function resolve(base, rel) {
    rel = rel.split('#')[0].split('?')[0];
    try { rel = decodeURIComponent(rel); } catch (e) {}
    const parts = (rel.startsWith('/') ? rel.slice(1) : dirname(base) + rel).split('/'), out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    return out.join('/');
  }
  const fragOf = href => { const i = (href || '').indexOf('#'); if (i < 0) return ''; try { return decodeURIComponent(href.slice(i + 1)); } catch (e) { return href.slice(i + 1); } };

  // ---------- leitura do EPUB ----------
  async function readEpub(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const lower = new Map(Object.keys(zip.files).map(n => [n.toLowerCase(), n]));
    const find = p => zip.file(p) || (lower.has(p.toLowerCase()) ? zip.file(lower.get(p.toLowerCase())) : null);
    const parse = (s, type = 'application/xml') => new DOMParser().parseFromString(s, type);
    const cont = find('META-INF/container.xml');
    if (!cont) throw new Error('Não parece um EPUB válido (sem container.xml).');
    const opfPath = parse(await cont.async('string')).querySelector('rootfile').getAttribute('full-path');
    const opfFile = find(opfPath);
    if (!opfFile) throw new Error('EPUB sem arquivo de pacote (.opf).');
    const opf = parse(await opfFile.async('string'));
    const items = new Map();
    opf.querySelectorAll('manifest > item').forEach(it => {
      const href = it.getAttribute('href') || '';
      items.set(it.getAttribute('id'), { id: it.getAttribute('id'), href, path: resolve(opfPath, href), type: (it.getAttribute('media-type') || '').toLowerCase(), props: (it.getAttribute('properties') || '').split(/\s+/).filter(Boolean) });
    });
    const byPath = new Map([...items.values()].map(m => [m.path, m]));
    const refs = [...opf.querySelectorAll('spine > itemref')].map(r => items.get(r.getAttribute('idref'))).filter(Boolean);
    const spine = refs.filter(m => /html|xml/.test(m.type) && find(m.path));
    if (!spine.length) throw new Error('EPUB sem conteúdo no spine.');
    const meta = sel => { const e = opf.querySelector(sel); return e ? e.textContent.trim() : ''; };
    const all = sel => [...opf.querySelectorAll(sel)].map(e => e.textContent.trim()).filter(Boolean);
    let creators = [...opf.querySelectorAll('metadata > creator, dc\\:creator')];
    const only = creators.filter(c => { const r = c.getAttribute('opf:role'); return !r || r === 'aut'; });
    if (only.length) creators = only;
    const book = {
      title: meta('metadata > title, dc\\:title') || 'Livro', authors: creators.map(c => c.textContent.trim()).filter(Boolean),
      lang: (meta('metadata > language, dc\\:language') || 'en').split('-')[0].toLowerCase(), publisher: meta('metadata > publisher, dc\\:publisher'),
      description: meta('metadata > description, dc\\:description'), subjects: all('metadata > subject, dc\\:subject'), date: meta('metadata > date, dc\\:date'),
      rtl: opf.querySelector('spine')?.getAttribute('page-progression-direction') === 'rtl',
      writing: opf.querySelector('meta[name="primary-writing-mode"]')?.getAttribute('content') || '',
    };
    // sumário: nav (EPUB 3) ou NCX
    const kids = (e, name) => [...e.children].filter(c => c.localName === name);
    const target = (base, href) => { const [h] = (href || '').split('#'); return { path: h ? resolve(base, h) : base, frag: fragOf(href) }; };
    const navItem = [...items.values()].find(m => m.props.includes('nav'));
    const ncxItem = items.get(opf.querySelector('spine')?.getAttribute('toc')) || [...items.values()].find(m => m.type === 'application/x-dtbncx+xml');
    let toc = [];
    try {
      if (navItem && find(navItem.path)) {
        const raw = await find(navItem.path).async('string');
        let d = parse(raw, 'application/xhtml+xml'); if (d.querySelector('parsererror')) d = parse(raw, 'text/html');
        const navs = [...d.getElementsByTagName('nav')];
        const nv = navs.find(n => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || navs[0];
        const walk = ol => kids(ol, 'li').map(li => {
          const a = kids(li, 'a')[0] || kids(li, 'span')[0], sub = kids(li, 'ol')[0];
          return { title: a ? a.textContent.replace(/\s+/g, ' ').trim() : '', ...(a && a.getAttribute('href') ? target(navItem.path, a.getAttribute('href')) : {}), items: sub ? walk(sub) : [] };
        });
        if (nv && kids(nv, 'ol')[0]) toc = walk(kids(nv, 'ol')[0]);
      }
      if (!toc.length && ncxItem && find(ncxItem.path)) {
        const d = parse(await find(ncxItem.path).async('string'));
        const walk = parent => kids(parent, 'navPoint').map(np => {
          const t = np.querySelector('navLabel > text'), c = kids(np, 'content')[0];
          return { title: t ? t.textContent.replace(/\s+/g, ' ').trim() : '', ...(c ? target(ncxItem.path, c.getAttribute('src')) : {}), items: walk(np) };
        });
        const nm = d.getElementsByTagName('navMap')[0];
        if (nm) toc = walk(nm);
      }
    } catch (e) { console.warn('sumário ilegível', e); }
    // fontes ofuscadas (IDPF ou Adobe): desfaz, pois no AZW3 as fontes vão sem ofuscação do EPUB
    const obf = new Map();
    const encF = find('META-INF/encryption.xml');
    if (encF) {
      try {
        const uidRef = opf.documentElement.getAttribute('unique-identifier');
        const uidEl = uidRef && [...opf.querySelectorAll('metadata > identifier, dc\\:identifier')].find(e => e.getAttribute('id') === uidRef);
        const uid = uidEl ? uidEl.textContent : '';
        for (const ed of parse(await encF.async('string')).getElementsByTagName('EncryptedData')) {
          const alg = ed.getElementsByTagName('EncryptionMethod')[0]?.getAttribute('Algorithm') || '', ref = ed.getElementsByTagName('CipherReference')[0];
          if (!ref) continue;
          let u = ref.getAttribute('URI'); try { u = decodeURIComponent(u); } catch (e) {}
          obf.set(u.replace(/^\//, ''), { alg, uid });
        }
      } catch (e) { console.warn('encryption.xml ilegível', e); }
    }
    const deob = async (path, data) => {   // devolve os bytes da fonte sem ofuscação, ou null se não der
      const o = obf.get(path);
      if (!o) return data;
      let key, n;
      if (o.alg === 'http://www.idpf.org/2008/embedding' && o.uid) { key = await sha1(enc.encode(o.uid.replace(/[\u0020\u0009\u000d\u000a]/g, ''))); n = 1040; }
      else if (o.alg === 'http://ns.adobe.com/pdf/enc#RC' && o.uid) { const h = o.uid.replace(/^urn:uuid:/i, '').replace(/-/g, ''); if (!/^[0-9a-f]{32}$/i.test(h)) return null; key = Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16))); n = 1024; }
      else return null;
      const out = data.slice(); for (let i = 0; i < Math.min(n, out.length); i++) out[i] ^= key[i % key.length];
      return out;
    };
    // capa
    let cover = [...items.values()].find(m => m.props.includes('cover-image'));
    if (!cover) { const mc = opf.querySelector('meta[name=cover]'); if (mc) cover = items.get(mc.getAttribute('content')); }
    if (cover && !/^image\//.test(cover.type)) cover = null;
    return { zip, find, book, items, byPath, spine, toc, cover: cover ? cover.path : null, parse, deob };
  }

  // ---------- imagens ----------
  const sniff = b => b[0] === 0xFF && b[1] === 0xD8 ? 'jpeg' : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 ? 'png' : b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 ? 'gif'
    : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 ? 'webp' : b[0] === 0x42 && b[1] === 0x4D ? 'bmp' : null;
  function jpegInfo(b) {   // componentes, progressivo, orientação EXIF e tamanho
    let comps = 3, progressive = false, orient = 1, w = 0, h = 0;
    for (let i = 2; i + 4 < b.length;) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { comps = b[i + 9]; progressive = m === 0xC2; h = (b[i + 5] << 8) | b[i + 6]; w = (b[i + 7] << 8) | b[i + 8]; break; }
      if (m === 0xDA) break;
      if (m === 0xE1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
        const t = i + 10, le = b[t] === 0x49, u16r = o => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
        const u32r = o => le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
        const ifd = t + u32r(t + 4), n = u16r(ifd);
        for (let k = 0; k < n && ifd + 14 + k * 12 < b.length; k++) if (u16r(ifd + 2 + k * 12) === 0x0112) orient = u16r(ifd + 10 + k * 12);
      }
      i += 2 + len;
    }
    return { comps, progressive, orient, w, h };
  }
  const toBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
  // decodifica com <img>, caminho para SVG (o createImageBitmap do Chrome não aceita)
  function decodeViaImg(raw, type, svg) {
    return new Promise(res => {
      const url = URL.createObjectURL(new Blob([raw], { type: type || 'image/svg+xml' }));
      const im = new Image();
      im.onload = () => {
        let w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
        if (svg && (!w || !h)) {
          const vb = /viewBox\s*=\s*["']([-\d.eE\s,]+)["']/.exec(dec.decode(raw.subarray(0, 4096)));
          const n = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : null;
          if (n && n.length === 4 && n[2] > 0 && n[3] > 0) { w = Math.round(n[2]); h = Math.round(n[3]); }
          else { w = 600; h = 800; }
          im.width = w; im.height = h;
        }
        if (!w || !h) { URL.revokeObjectURL(url); return res(null); }
        res({ src: im, width: w, height: h, close: () => URL.revokeObjectURL(url) });
      };
      im.onerror = () => { URL.revokeObjectURL(url); res(null); };
      im.src = url;
    });
  }
  // devolve { bytes, mime, w, h } em formato que o Kindle lê (JPEG, PNG, GIF)
  async function prepareImage(raw, hint) {
    const kind = sniff(raw);
    let w0 = 0, h0 = 0, needs = !kind || kind === 'webp' || kind === 'bmp';
    if (kind === 'jpeg') { const j = jpegInfo(raw); w0 = j.w; h0 = j.h; needs = j.comps === 4 || j.progressive || j.orient > 1; }
    else if (kind === 'png') { const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength); w0 = dv.getUint32(16); h0 = dv.getUint32(20); }
    else if (kind === 'gif') { w0 = raw[6] | (raw[7] << 8); h0 = raw[8] | (raw[9] << 8); }
    if (kind && !needs && Math.max(w0, h0) <= 4096 && w0 > 0 && h0 > 0 && raw.length <= 8 * 1048576) return { bytes: raw, mime: 'image/' + kind, w: w0, h: h0 };
    let svg = false;
    if (!kind && /<svg[\s>]/i.test(dec.decode(raw.subarray(0, 2048)))) svg = true;
    const type = svg ? 'image/svg+xml' : kind ? 'image/' + kind : (hint || '');
    let bmp;
    try { const ib = await createImageBitmap(new Blob([raw], { type }), { imageOrientation: 'from-image' });
          bmp = { src: ib, width: ib.width, height: ib.height, close: () => ib.close() }; }
    catch (e) { bmp = null; }
    if (!bmp) bmp = await decodeViaImg(raw, type, svg);   // SVG e afins que o createImageBitmap recusa
    if (!bmp) return null;
    const MAX = 3200, k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); cx.drawImage(bmp.src, 0, 0, w, h); if (bmp.close) bmp.close();
    let alpha = false;
    if (kind !== 'jpeg') { const d = cx.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { alpha = true; break; } }
    if (alpha || kind === 'png' || kind === 'gif') return { bytes: new Uint8Array(await (await toBlob(cv, 'image/png')).arrayBuffer()), mime: 'image/png', w, h };
    const flat = document.createElement('canvas'); flat.width = w; flat.height = h;
    const fx = flat.getContext('2d'); fx.fillStyle = '#fff'; fx.fillRect(0, 0, w, h); fx.drawImage(cv, 0, 0);
    return { bytes: new Uint8Array(await (await toBlob(flat, 'image/jpeg', 0.9)).arrayBuffer()), mime: 'image/jpeg', w, h };
  }
  async function thumbnail(img) {   // miniatura da capa (JPEG, até 330 px de altura)
    try {
      const bmp = await createImageBitmap(new Blob([img.bytes], { type: img.mime }));
      const k = Math.min(1, 330 / bmp.height), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(bmp, 0, 0, w, h); bmp.close();
      return new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.85)).arrayBuffer());
    } catch (e) { return null; }
  }

  async function sha1(data) {   // crypto.subtle só existe em páginas seguras; fora delas, versão em JS
    if (globalThis.crypto && crypto.subtle) return new Uint8Array(await crypto.subtle.digest('SHA-1', data));
    const rol = (x, n) => (x << n) | (x >>> (32 - n));
    const len = data.length, padLen = ((len + 8) >> 6 << 6) + 64, buf = new Uint8Array(padLen);
    buf.set(data); buf[len] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(padLen - 4, len * 8 >>> 0); dv.setUint32(padLen - 8, Math.floor(len / 0x20000000));
    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    const w = new Uint32Array(80);
    for (let o = 0; o < padLen; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d, k = i < 20 ? 0x5A827999 : i < 40 ? 0x6ED9EBA1 : i < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        const tmp = (rol(a, 5) + f + e + k + w[i]) >>> 0; e = d; d = c; c = rol(b, 30) >>> 0; b = a; a = tmp;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20), ov = new DataView(out.buffer); [h0, h1, h2, h3, h4].forEach((x, i) => ov.setUint32(i * 4, x));
    return out;
  }
  const sniffFont = b => (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || (b[0] === 0x74 && b[1] === 0x72 && b[2] === 0x75 && b[3] === 0x65) || (b[0] === 0x4f && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4f) || (b[0] === 0x74 && b[1] === 0x74 && b[2] === 0x63 && b[3] === 0x66);   // TTF, OTF, TTC
  async function fontRecord(raw) {   // 'FONT': cabeçalho de 44 bytes + dados zlib, com os 1040 primeiros bytes passados por XOR com uma chave
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const key = crypto.getRandomValues(new Uint8Array(20));
    for (let i = 0; i < Math.min(1040, z.length); i++) z[i] ^= key[i % 20];
    return cat([enc4('FONT'), u32(raw.length), u32(3), u32(44), u32(20), u32(24), key, z]);
  }

  // ---------- estruturas de índice ----------
  // entradas: [{ key, ctrl: Uint8Array, data: Uint8Array }]; devolve os registros INDX (cabeçalho, dados) e CNCX
  const idxHeader = ({ type, idxt, count, enc, total, ncncx, tagx }) => {
    const h = new Uint8Array(192), dv = new DataView(h.buffer);
    h.set(enc4('INDX'), 0); dv.setUint32(4, 192); dv.setUint32(12, type === 2 ? 0 : 1); dv.setUint32(16, type); dv.setUint32(20, idxt); dv.setUint32(24, count);
    dv.setUint32(28, enc); dv.setUint32(32, 0xffffffff); dv.setUint32(36, total); dv.setUint32(52, ncncx); dv.setUint32(180, tagx);
    return h;
  };
  const enc4 = s => Uint8Array.from([...s].map(c => c.charCodeAt(0)));
  function buildIndex(tagxEntries, entries, cncxCount) {
    // TAGX: cada tag = [tag, nvalores, máscara, 0]; fim = [0,0,0,1]
    const tagx = pad4(cat([enc4('TAGX'), u32(12 + 4 * (tagxEntries.length + 1)), u32(1), ...tagxEntries.map(t => Uint8Array.from(t)), Uint8Array.of(0, 0, 0, 1)]));
    // divide as entradas em registros de dados
    const recs = []; let cur = [], size = 192;
    for (const e of entries) {
      const len = 1 + e.key.length + e.ctrl.length + e.data.length;
      if (cur.length && size + len + 2 * (cur.length + 1) + 8 > 60000) { recs.push(cur); cur = []; size = 192; }
      cur.push(e); size += len;
    }
    if (cur.length) recs.push(cur);
    const dataRecs = recs.map(list => {
      const body = [], offs = []; let p = 192;
      for (const e of list) { const k = enc4(e.key); const b = cat([Uint8Array.of(k.length), k, e.ctrl, e.data]); offs.push(p); body.push(b); p += b.length; }
      const ent = pad4(cat(body)), idxt = 192 + ent.length;
      return pad4(cat([idxHeader({ type: 0, idxt, count: list.length, enc: 0xffffffff, total: 0, ncncx: 0, tagx: 0 }), ent, enc4('IDXT'), ...offs.map(u16)]));
    });
    const geo = recs.map(list => { const k = enc4(list[list.length - 1].key); return cat([Uint8Array.of(k.length), k, u16(list.length)]); });
    const geoOffs = []; let gp = 192 + tagx.length;
    for (const g of geo) { geoOffs.push(gp); gp += g.length; }
    const geoBlock = pad4(cat(geo));
    const header = pad4(cat([idxHeader({ type: 2, idxt: 192 + tagx.length + geoBlock.length, count: recs.length, enc: 65001, total: entries.length, ncncx: cncxCount, tagx: 192 }), tagx, geoBlock, enc4('IDXT'), ...geoOffs.map(u16)]));
    return [header, ...dataRecs];
  }
  // CNCX: sequência de textos (tamanho em VWI + UTF-8); devolve { offsets, records }
  function buildCncx(strings) {
    const recs = [], offs = []; let cur = [], size = 0, base = 0;
    for (const s of strings) {
      const b = enc.encode(s), item = cat([vwi(b.length), b]);
      if (size + item.length > 0x10000 - 4) { recs.push(pad4(cat(cur))); cur = []; size = 0; base += 0x10000; }
      offs.push(base + size); cur.push(item); size += item.length;
    }
    if (cur.length) recs.push(pad4(cat(cur)));
    return { offs, records: recs };
  }
  const ctrlOf = bits => Uint8Array.of(bits);

  // ---------- TBS: sequências de bytes finais de cada registro de texto (ligam o texto ao índice do sumário) ----------
  const vwiBack = n => { const b = [n & 127]; n = Math.floor(n / 128); while (n) { b.unshift(n & 127); n = Math.floor(n / 128); } b[0] |= 128; return b; };
  function tbsRecord(pre, s, t) {   // pre: entradas do sumário em pré-ordem, com { idx, pos, len, depth, parent }
    const nodes = pre.filter(e => e.pos < t && e.pos + e.len > s);
    const finish = data => { let n = data.length + 1, sz = vwiBack(n); while (data.length + sz.length !== n) { n = data.length + sz.length; sz = vwiBack(n); } return Uint8Array.from([...data, ...sz]); };
    if (!nodes.length) return finish([]);
    const kind = e => { const a = e.pos, b = e.pos + e.len; return a < s && b > t ? 'spans' : a >= s && b <= t ? 'completes' : a >= s ? 'starts' : 'ends'; };
    const strands = [];
    for (const n of nodes) {
      const cur = strands[strands.length - 1];
      if (cur) { const last = cur[cur.length - 1]; if (n.parent === last.idx || n.parent === last.parent) { cur.push(n); continue; } }
      strands.push([n]);
    }
    const label = n => n.idx - (n.parent === undefined ? 0 : n.parent);
    const seqs = [];
    strands.forEach((st, si) => {
      const groups = [];
      for (const n of st) { const g = groups[groups.length - 1]; if (g && g[0].depth === n.depth) g.push(n); else groups.push([n]); }
      groups.forEach((gr, gi) => {
        if (si > 0 && gi === 0) { seqs.push({ idx: strands[si - 1][strands[si - 1].length - 1].idx - st[0].idx, f1: false, f4: gr.length > 1 ? gr.length : 0, f8: true }); return; }
        seqs.push({ idx: label(gr[0]), f1: false, f4: gr.length > 1 ? gr.length : 0, f8: false, span: si === 0 && gr.every(n => kind(n) === 'spans'), si });
      });
    });
    let chain = null;   // flag 0b1: o grupo mais interno, dentro do prefixo de nós que atravessam o registro inteiro
    for (const q of seqs) { if (q.si === 0 && q.span) chain = q; else if (q.si === 0) break; }
    if (chain) chain.f1 = true;
    const out = [];
    seqs.forEach((q, i) => {
      if (i === 0) {
        out.push(...vwi((q.idx * 8) | 2 | (q.f1 ? 1 : 0) | (q.f4 ? 4 : 0)), ...vwi(8));
      } else {
        out.push(...vwi((q.idx * 16) | (q.f1 ? 1 : 0) | (q.f4 ? 4 : 0) | (q.f8 ? 8 : 0)));
      }
      if (q.f4) out.push(q.f4);
      if (q.f1) out.push(...vwi(0));
    });
    return finish(out);
  }

  // ---------- CSS ----------
  function normCss(css) {   // mantém regras de estilo e @page; descarta @media, @import, @font-face etc. (o Kindle não os aproveita) e blocos mal formados
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const n = css.length;
    const skipStr = (i, q) => { for (i++; i < n; i++) { if (css[i] === '\\') i++; else if (css[i] === q) return i + 1; } return n; };
    const endBlock = i => {   // i: posição do '{'; devolve o índice depois do '}' correspondente, ou -1
      let d = 0;
      for (; i < n; i++) {
        const c = css[i];
        if (c === '"' || c === "'") { i = skipStr(i, c) - 1; continue; }
        if (c === '{') d++; else if (c === '}' && --d === 0) return i + 1;
      }
      return -1;
    };
    const out = [];
    let i = 0;
    while (i < n) {
      while (i < n && /\s/.test(css[i])) i++;
      if (i >= n) break;
      let j = i, brace = -1, semi = -1;
      for (; j < n; j++) {
        const c = css[j];
        if (c === '"' || c === "'") { j = skipStr(j, c) - 1; continue; }
        if (c === '{') { brace = j; break; }
        if (c === ';') { semi = j; break; }
        if (c === '}') { j++; break; }
      }
      if (brace < 0) { i = Math.max(j, semi + 1, i + 1); continue; }   // ponto e vírgula solto (@import, @charset…) ou lixo
      const end = endBlock(brace);
      if (end < 0) break;
      const prelude = css.slice(i, brace).trim();
      if ((!prelude.startsWith('@') && !/\[\s*[\w*-]*\|(?!=)/.test(prelude) && !/(^|[\s,>+~(])[\w*-]*\|(?!=)[\w*]/.test(prelude)) || /^@page\b/i.test(prelude)) out.push(css.slice(i, end).trim());   // seletores com namespace (epub|type) o Kindle não entende
      i = end;
    }
    return out.join('\n');
  }
  function fontFaces(css, base, resFont) {   // @font-face com fonte TTF/OTF do próprio livro; o resto das @-regras é descartado
    const out = [];
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
      const body = m[1], src = body.match(/src\s*:([^;}]*)/i);
      if (!src) continue;
      const urls = [...src[1].matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map(x => x[2]).filter(u => !/^(data:|#)/i.test(u) && !/\.(woff2?|eot|svg)(\?|#|$)/i.test(u));
      if (!urls.length) continue;
      const decl = ['font-family', 'font-weight', 'font-style'].map(k => { const v = body.match(new RegExp('(?:^|[;\\s])' + k + '\\s*:\\s*([^;}]+)', 'i')); return v ? `${k}: ${v[1].trim()};` : ''; }).filter(Boolean).join(' ');
      if (!/font-family/.test(decl)) continue;
      out.push(`@font-face { ${decl} src: url(${resFont(resolve(base, urls[0]))}) }`);
    }
    return out;
  }
  function fixCss(css, base, resImg, resFont) {
    const faces = fontFaces(css, base, resFont);
    const body = normCss(css).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => {
      if (/^(data:|#)/i.test(u)) return m;
      const r = resImg(resolve(base, u));
      return r ? `url(${r})` : 'none';
    }).replace(/:\s*none\s*(;|\}|$)/g, ':none$1');
    return [...faces, body].join('\n');
  }

  // ---------- conversão ----------
  async function convert(epubBytes, opt = {}) {
    const say = opt.say || (() => {}), tick = opt.tick || (() => Promise.resolve());
    say('Lendo o EPUB…'); await tick();
    const ep = await readEpub(epubBytes);
    const { book, spine, find } = ep;
    const lang = book.lang;

    // recursos de imagem: numerados na ordem em que aparecem
    const imgs = [], imgIdx = new Map();   // recursos reservados (imagens e fontes): path -> número reservado (1-based)
    const embed = (path, kind = 'img') => {   // reserva um número; o recurso real é preparado depois
      if (!imgIdx.has(path)) { imgs.push({ path, kind }); imgIdx.set(path, imgs.length); }
      return { n: imgIdx.get(path), token: `\u0001EMB${imgIdx.get(path)}\u0002` };
    };

    const cssRaw = new Map();   // caminho -> texto do CSS
    const svgFlows = [];   // SVGs do corpo: cada um vira um fluxo próprio, referenciado por <img src="kindle:flow:…">

    // documentos: árvore do corpo (nós de texto, elementos e blocos prontos como SVG), com aid/cid e marcadores de link e de imagem
    const ALLOWED_VOID = new Set(['br', 'hr', 'img', 'input', 'col', 'wbr', 'area', 'base', 'param', 'source', 'track']);
    const DROP = new Set(['script', 'style', 'audio', 'video', 'iframe', 'object', 'embed', 'canvas', 'map', 'noscript', 'template', 'math', 'head', 'title', 'meta', 'link']);
    const docs = [];
    const spinePaths = new Set(spine.map(s => s.path));
    const links = [];   // { path, frag } por marcador
    let cidCounter = 0;   // cid: elementos com id dentro de tabelas (numeração do livro inteiro)
    for (let fi = 0; fi < spine.length; fi++) {
      const it = spine[fi];
      say(`Lendo capítulo ${fi + 1} de ${spine.length}…`); await tick();
      const raw = await find(it.path).async('string');
      let d = ep.parse(raw, /html/.test(it.type) ? 'application/xhtml+xml' : 'text/html');
      if (d.querySelector('parsererror')) d = ep.parse(raw, 'text/html');
      const head = d.querySelector('head');
      const sheets = [];
      if (head) for (const n of head.children) {
        const ln = n.localName;
        if (ln === 'link' && /stylesheet/i.test(n.getAttribute('rel') || '') && n.getAttribute('href')) {
          const p = resolve(it.path, n.getAttribute('href')), f = find(p);
          if (f) { if (!cssRaw.has(p)) cssRaw.set(p, await f.async('string')); sheets.push({ path: p }); }
        } else if (ln === 'style') sheets.push({ path: it.path + '#style' + sheets.length, text: n.textContent });
      }
      const body = d.querySelector('body') || d.documentElement;
      const base = fi * 1000000;
      let counter = 0;
      const aid = () => b32(base + counter++);
      const svgString = svg => {   // SVG simples (p. ex. capa): mantém, trocando imagens por recursos
        const rec = n => {
          if (n.nodeType === 3) return xml(clean(n.nodeValue));
          if (n.nodeType !== 1) return '';
          const nm = n.localName;
          if (/^(script|style|foreignObject)$/i.test(nm)) return '';
          const at = [];
          if (nm === 'svg') at.push('xmlns="http://www.w3.org/2000/svg"', 'xmlns:xlink="http://www.w3.org/1999/xlink"');
          for (const a of n.attributes) {
            if (/^xmlns(:|$)/.test(a.name)) continue;
            if (nm === 'image' && /href$/.test(a.name)) { at.push(`xlink:href="${embed(resolve(it.path, a.value)).token}"`); continue; }
            at.push(`${a.name}="${attr(clean(a.value))}"`);
          }
          const open = `<${nm}${at.length ? ' ' + at.join(' ') : ''}`;
          return n.childNodes.length ? `${open}>${[...n.childNodes].map(rec).join('')}</${nm}>` : open + '/>';
        };
        return rec(svg);
      };
      const walk = (node, inTable) => {
        const out = [];
        for (const c of node.childNodes) {
          if (c.nodeType === 3) { const s = clean(c.nodeValue); if (s) out.push({ k: 't', s }); continue; }
          if (c.nodeType !== 1) continue;
          const name = c.localName.toLowerCase();
          if (DROP.has(name)) continue;
          if (name === 'svg') { svgFlows.push(svgString(c)); out.push({ k: 'raw', s: `<img src="\u0001SVG${svgFlows.length - 1}\u0002"/>` }); continue; }
          const isVoid = ALLOWED_VOID.has(name), tbl = inTable || name === 'table';
          const attrs = []; let hasId = false, res;
          for (const a of c.attributes) {
            const an = a.name;
            if (/^xmlns(:|$)/.test(an) || an === 'aid' || an === 'cid') continue;
            if (/^epub:/.test(an) && an !== 'epub:type') continue;
            let v = a.value;
            if (name === 'a' && an === 'href') {
              if (/^(https?:|mailto:|tel:|ftp:)/i.test(v)) { attrs.push(`href="${attr(v)}"`); continue; }
              if (/^[a-z][a-z0-9+.-]*:/i.test(v)) continue;
              const tp = v.startsWith('#') ? it.path : resolve(it.path, v);
              if (!spinePaths.has(tp)) continue;   // destino fora do livro: sem link
              links.push({ path: tp, frag: fragOf(v) });
              attrs.push(`href="kindle:pos:fid:${b32(links.length - 1, 4)}:off:0000000000"`);
              continue;
            }
            if (name === 'img' && an === 'src') {
              if (/^data:/i.test(v)) continue;
              const e = embed(resolve(it.path, v)); res = e.n;
              attrs.push(`src="${e.token}"`);
              continue;
            }
            v = clean(v);
            if (an === 'style') v = v.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => /^(data:|#)/i.test(u) ? m : `url(${embed(resolve(it.path, u)).token})`);
            if (an === 'id' && v) hasId = true;
            attrs.push(`${an}="${attr(v)}"`);
          }
          const node2 = { k: 'e', name, attrs, void: isVoid, tbl, res, kids: [] };
          if (!isVoid && !tbl) { node2.aid = aid(); attrs.push(`aid="${node2.aid}"`); }   // aid em quase todo elemento; não em vazios (img, br…) nem em tabelas
          else if (tbl && hasId) attrs.push(`cid="c${++cidCounter}"`);
          if (!isVoid) node2.kids = walk(c, tbl);
          out.push(node2);
        }
        return out;
      };
      const bodyAttrs = [];
      for (const a of body.attributes || []) { if (/^xmlns(:|$)/.test(a.name) || a.name === 'aid') continue; if (/^epub:/.test(a.name) && a.name !== 'epub:type') continue; bodyAttrs.push(`${a.name}="${attr(clean(a.value))}"`); }
      counter = 0;
      const bodyAid = aid();
      let tree = walk(body, false);
      if (!tree.length || (tree.length === 1 && tree[0].k === 't' && !tree[0].s.trim())) tree = [{ k: 'e', name: 'div', attrs: [], void: false, tbl: false, kids: [], aid: aid() }], tree[0].attrs.push(`aid="${tree[0].aid}"`);   // documento vazio: um bloco vazio
      const title = (d.querySelector('title')?.textContent || '').trim() || book.title;
      const htmlLang = (d.documentElement.getAttribute('lang') || d.documentElement.getAttribute('xml:lang') || lang);
      const htmlAttrs = ['dir', 'class', 'id'].filter(k => d.documentElement.hasAttribute(k)).map(k => ` ${k}="${attr(clean(d.documentElement.getAttribute(k)))}"`).join('');
      docs.push({ path: it.path, fi, tree, sheets, bodyAttrs, bodyAid, title, htmlLang, htmlAttrs });
    }

    // folhas de estilo -> fluxos
    say('Preparando estilos e imagens…'); await tick();
    const cssText = new Map();
    for (const dc of docs) for (const s of dc.sheets) {
      if (s.text != null) cssText.set(s.path, s.text); else if (!cssText.has(s.path)) cssText.set(s.path, cssRaw.get(s.path) || '');
    }
    const cssNames = [...cssText.keys()];
    const cssFlow = new Map(cssNames.map((p, i) => [p, i + 1]));
    const cssOut = cssNames.map(p => fixCss(cssText.get(p), p.replace(/#style\d+$/, ''), q => embed(q).token, q => embed(q, 'font').token));

    // imagens: prepara (os números já foram reservados)
    const resources = [];   // { bytes, mime }
    const resNum = new Map();   // índice reservado -> número final (1-based) ou 0
    for (let i = 0; i < imgs.length; i++) {
      const im = imgs[i], f = find(im.path);
      if (!f) { resNum.set(i + 1, 0); continue; }
      const raw = await f.async('uint8array');
      const hint = ep.byPath.get(im.path)?.type;
      let r = null;
      try {
        if (im.kind === 'font') { const fd = await ep.deob(im.path, raw); r = fd && sniffFont(fd) ? { bytes: await fontRecord(fd), font: true } : null; }
        else r = await prepareImage(raw, hint);
      } catch (e) { r = null; }
      if (!r) { resNum.set(i + 1, 0); continue; }
      resources.push(r); resNum.set(i + 1, resources.length);
      if (i % 5 === 4) { say(`Imagens: ${i + 1} de ${imgs.length}…`); await tick(); }
    }
    // capa
    let coverIdx = -1, thumbIdx = -1;
    if (ep.cover) {
      const n = imgIdx.get(ep.cover);
      let fin = n ? resNum.get(n) : 0;
      if (n === undefined && find(ep.cover)) { const raw = await find(ep.cover).async('uint8array'); const r = await prepareImage(raw, ep.byPath.get(ep.cover)?.type).catch(() => null); if (r) { resources.push(r); fin = resources.length; } }
      if (fin) { coverIdx = fin - 1; const t = await thumbnail(resources[coverIdx]); if (t) { resources.push({ bytes: t, mime: 'image/jpeg' }); thumbIdx = resources.length - 1; } }
    }
    const embedTo = text => text.replace(/\u0001EMB(\d+)\u0002/g, (m, n) => {
      const f = resNum.get(+n);
      return f ? `kindle:embed:${b32(f, 4)}${resources[f - 1].font ? '' : '?mime=' + resources[f - 1].mime}` : '';
    }).replace(/\u0001SVG(\d+)\u0002/g, (m, n) => `kindle:flow:${b32(cssNames.length + 1 + +n, 4)}?mime=image/svg+xml`);
    for (let i = 0; i < cssOut.length; i++) cssOut[i] = embedTo(cssOut[i]).replace(/@font-face\s*\{[^}]*url\(\)[^}]*\}/g, '').replace(/url\(\)/g, 'none');

    // ---- esqueleto e fragmentos, como o KindleGen: elementos grandes ficam no esqueleto só como "invólucro" e o conteúdo vira
    // fragmentos bem formados (até 8 KB) inseridos nele; texto muito longo é cortado em pedaços (os seguintes dentro de <span>) ----
    const LIMIT = 8192, BIG = '<span class="AmznBigTextBlock">', BIGEND = '</span>', BIGW = ulen(BIG + BIGEND);
    const openOf = e => `<${e.name}${e.attrs.length ? ' ' + embedTo(e.attrs.join(' ')) : ''}${e.void ? '/>' : '>'}`;
    const html = n => n.k === 't' ? xml(n.s) : n.k === 'raw' ? embedTo(n.s) : n.void ? openOf(n) : openOf(n) + n.kids.map(html).join('') + `</${n.name}>`;
    const prune = kids => kids.filter(n => { if (n.k === 'e') { if (n.res !== undefined && !resNum.get(n.res)) return false; n.kids = prune(n.kids); } return true; });
    const sz = n => n.sz ?? (n.sz = n.k === 't' ? ulen(xml(n.s)) : n.k === 'raw' ? ulen(embedTo(n.s)) : n.void ? ulen(openOf(n)) : ulen(openOf(n)) + n.kids.reduce((s, k) => s + sz(k), 0) + ulen(`</${n.name}>`));
    const textPieces = s => {   // texto maior que o limite: 1º pedaço cru (até 8192 bytes), os demais em <span> (cabem em 8192 com o invólucro)
      const out = []; let i = 0; const n = s.length;
      while (i < n) {
        const cap = out.length ? LIMIT - BIGW : LIMIT; let j = i, b = 0;
        while (j < n) {
          const c = s.charCodeAt(j), hi = c >= 0xd800 && c < 0xdc00, w = c === 38 ? 5 : c === 60 || c === 62 ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : hi ? 4 : 3;
          if (b + w > cap) break;
          b += w; j += hi ? 2 : 1;
        }
        const piece = xml(s.slice(i, j));
        out.push(out.length ? BIG + piece + BIGEND : piece); i = j;
      }
      return out;
    };
    const files = [];
    for (const dc of docs) {
      dc.tree = prune(dc.tree);
      const head = `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${attr(dc.htmlLang)}" xml:lang="${attr(dc.htmlLang)}"${dc.htmlAttrs}>\n  <head>\n    <title>${xml(clean(dc.title))}</title>\n    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>\n${dc.sheets.map(s => `<link rel="stylesheet" type="text/css" href="kindle:flow:${b32(cssFlow.get(s.path), 4)}?mime=text/css"/>\n`).join('')}  </head>\n  `;
      let sk = head + `<body${dc.bodyAttrs.length ? ' ' + dc.bodyAttrs.join(' ') : ''} aid="${dc.bodyAid}">\n`.replace(/>\n$/, '>');
      let skB = ulen(sk);
      const chunks = [], shells = [];
      const proc = (list, anchor) => {
        let run = [], runB = 0;
        const flush = () => {
          if (!run.length) return;
          chunks.push({ text: run.join(''), bytes: runB, insert: skB, sel: `${anchor.mode}-//*[@aid='${anchor.aid}']` });
          run = []; runB = 0;
        };
        const add = (s, b) => { if (run.length && runB + b > LIMIT) flush(); run.push(s); runB += b; };
        for (const n of list) {
          if (n.k === 't') {
            if (sz(n) <= LIMIT) add(xml(n.s), sz(n)); else textPieces(n.s).forEach(p => add(p, ulen(p)));
            continue;
          }
          if (n.k === 'raw' || n.void || n.tbl || sz(n) <= LIMIT || !n.kids.length) { add(html(n), sz(n)); continue; }
          flush();   // elemento grande: fica no esqueleto como invólucro; o conteúdo vira fragmentos dentro dele
          const open = openOf(n), shell = { ids: [...open.matchAll(/ (?:id|name)="([^"]*)"/g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')), so: skB, chunkIdx: chunks.length };
          shells.push(shell);
          sk += open; skB += ulen(open);
          proc(n.kids, { mode: 'P', aid: n.aid });
          const close = `</${n.name}>`; sk += close; skB += ulen(close);
          anchor = { mode: 'S', aid: n.aid };
        }
        flush();
      };
      proc(dc.tree, { mode: 'P', aid: dc.bodyAid });
      const bodyClose = '</body>\n</html>\n';
      files.push({ dc, headLen: ulen(head), skelText: sk + bodyClose, skelLen: skB + ulen(bodyClose), chunks, shells, title: dc.title });
    }
    // posições: o esqueleto de cada arquivo, seguido pelos seus fragmentos
    let textPos = 0, fid = 0;
    for (const f of files) {
      f.skelStart = textPos; f.bodyTagPos = textPos + f.headLen;
      let rel = 0;
      for (const ch of f.chunks) { ch.fid = fid++; ch.rel = rel; ch.key = textPos + ch.insert + rel; rel += ch.bytes; }
      textPos += f.skelLen + rel;
      // alvos de links e sumário: id -> { fid, off, pos }
      f.idTarget = new Map();
      for (const ch of f.chunks) {
        const re = /<([a-zA-Z][^\s>/]*)([^>]*?)\/?>/g; let m, last = 0, bo = 0;
        while ((m = re.exec(ch.text))) {
          bo += ulen(ch.text.slice(last, m.index));
          const am = / (?:id|name)="([^"]*)"/g; let x;
          while ((x = am.exec(m[2]))) { const k = x[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); if (!f.idTarget.has(k)) f.idTarget.set(k, { fid: ch.fid, off: bo, pos: ch.key + bo }); }
          bo += ulen(m[0]); last = re.lastIndex;
        }
      }
      for (const sh of f.shells) {   // invólucro: aponta para o 1º fragmento dentro dele
        const pos = f.skelStart + sh.so + f.chunks.filter(c => c.insert <= sh.so).reduce((s, c) => s + c.bytes, 0);
        for (const k of sh.ids) if (!f.idTarget.has(k)) f.idTarget.set(k, { fid: f.chunks[sh.chunkIdx].fid, off: 0, pos });
      }
    }
    const textLen = textPos;
    const fileByPath = new Map(files.map(f => [f.dc.path, f]));
    const locate = (path, frag) => {
      const f = fileByPath.get(path);
      if (!f) return null;
      const t = frag && f.idTarget.get(frag);
      return t || { fid: f.chunks[0].fid, off: 0, pos: f.bodyTagPos, file: true };
    };
    const patchLinks = s => s.replace(/kindle:pos:fid:([0-9A-V]{4}):off:0{10}/g, (m, n) => {
      const l = links[parseInt(n, 32)], t = l && locate(l.path, l.frag);
      return t ? `kindle:pos:fid:${b32(t.fid, 4)}:off:${b32(t.off, 10)}` : m;
    });
    for (const f of files) { f.skelText = patchLinks(f.skelText); for (const ch of f.chunks) ch.text = patchLinks(ch.text); }

    // texto final: fluxo 0 + CSS
    // ordem física: esqueleto inteiro e, em seguida, os fragmentos
    const phys = [];
    for (const f of files) { phys.push(enc.encode(f.skelText)); for (const ch of f.chunks) phys.push(enc.encode(ch.text)); }
    const mainText = cat(phys);
    if (mainText.length !== textLen) throw new Error(`Erro interno: tamanhos não batem (${mainText.length} x ${textLen}).`);
    const flowTexts = [...cssOut.map(c => enc.encode(c.endsWith('\n') ? c : c + '\n')), ...svgFlows.map(s => enc.encode(embedTo(s).replace(/ xlink:href=""/g, '')))];
    const fullText = cat([mainText, ...flowTexts]);
    const fdst = []; { let p = 0; for (const b of [mainText, ...flowTexts]) { fdst.push([p, p + b.length]); p += b.length; } }

    // sumário (nível a nível)
    const build = (list, depth) => {
      const out = [];
      for (const n of list) {
        const title = (n.title || '').replace(/\s+/g, ' ').trim();
        let t = n.path ? locate(n.path, n.frag) : null;
        const kids = build(n.items || [], depth + 1);
        if (!t && kids.length) t = { fid: kids[0].fid, off: kids[0].off, pos: kids[0].pos, file: kids[0].file };
        if (!title || !t) { out.push(...kids); continue; }
        out.push({ title, depth, ...t, kids });
      }
      return out;
    };
    let tree = build(ep.toc, 0);
    const norm = (list, depth) => list.map(n => ({ ...n, depth, kids: norm(n.kids, depth + 1) }));
    tree = norm(tree, 0);
    if (!tree.length) tree = files.map(f => ({ title: f.title, depth: 0, fid: f.chunks[0].fid, off: 0, pos: f.bodyTagPos, file: true, kids: [] }));
    // mantém a ordem do documento: descarta entradas que voltam atrás e limita as que caem num mesmo registro (o TBS guarda a contagem em 1 byte)
    let lastPos = -1;
    const perRec = new Map();
    const mono = list => list.flatMap(n => {
      const r = Math.floor(n.pos / 4096), c = perRec.get(r) || 0;
      if (n.pos < lastPos || c >= 250) return mono(n.kids);
      perRec.set(r, c + 1); lastPos = n.pos; return [{ ...n, kids: mono(n.kids) }];
    });
    tree = norm(mono(tree), 0);   // as entradas removidas sobem os filhos de nível: refaz as profundidades
    // comprimentos: até o próximo item de mesmo nível ou acima
    const pre = []; const walkPre = list => list.forEach(n => { pre.push(n); walkPre(n.kids); }); walkPre(tree);
    { const open = [];
      for (const m of pre) { while (open.length && open[open.length - 1].depth >= m.depth) { const n = open.pop(); n.len = Math.max(0, m.pos - n.pos); } open.push(m); }
      for (const n of open) n.len = Math.max(0, mainText.length - n.pos); }
    // ordem do índice: por nível
    const levels = []; const lv = (list, d) => list.forEach(n => { (levels[d] = levels[d] || []).push(n); lv(n.kids, d + 1); }); lv(tree, 0);
    const order = levels.flat(); order.forEach((n, i) => n.idx = i);
    order.forEach(n => { n.kids.forEach(k => k.parent = n.idx); });
    const labels = buildCncx(order.map(n => n.title));
    const hexw = Math.max(2, (order.length - 1).toString(16).length);
    const ncxEntries = order.map((n, i) => {
      let bits = 1 | 2 | 4 | 8 | 0x80; const parts = [vwi(n.pos), vwi(n.len), vwi(labels.offs[i]), vwi(n.depth)];
      if (n.parent !== undefined) { bits |= 0x10; parts.push(vwi(n.parent)); }
      if (n.kids.length) { bits |= 0x20 | 0x40; parts.push(vwi(n.kids[0].idx), vwi(n.kids[n.kids.length - 1].idx)); }
      parts.push(vwi(n.fid), vwi(n.off));
      return { key: i.toString(16).toUpperCase().padStart(hexw, '0'), ctrl: ctrlOf(bits), data: cat(parts) };
    });
    const ncxTagx = [[1, 1, 1], [2, 1, 2], [3, 1, 4], [4, 1, 8], [21, 1, 16], [22, 1, 32], [23, 1, 64], [6, 2, 128]].map(t => [...t, 0]);
    const ncxRecs = [...buildIndex(ncxTagx, ncxEntries, labels.records.length), ...labels.records];

    // índice de fragmentos e de esqueletos
    const selList = [], selIdx = new Map();   // seletor do elemento onde cada fragmento entra: "P-" dentro dele, "S-" logo depois dele
    for (const f of files) for (const ch of f.chunks) if (!selIdx.has(ch.sel)) { selIdx.set(ch.sel, selList.length); selList.push(ch.sel); }
    const selC = buildCncx(selList);
    const fragEntries = [];
    files.forEach((f, fi) => f.chunks.forEach(ch => {
      fragEntries.push({ key: String(ch.key).padStart(10, '0'), ctrl: ctrlOf(15), data: cat([vwi(selC.offs[selIdx.get(ch.sel)]), vwi(fi), vwi(ch.fid), vwi(ch.rel), vwi(ch.bytes)]) });
    }));
    const fragTagx = [[2, 1, 1], [3, 1, 2], [4, 1, 4], [6, 2, 8]].map(t => [...t, 0]);
    const fragRecs = [...buildIndex(fragTagx, fragEntries, selC.records.length), ...selC.records];
    const skelEntries = files.map((f, i) => ({ key: 'SKEL' + String(i).padStart(10, '0'), ctrl: ctrlOf(10), data: cat([vwi(f.chunks.length), vwi(f.chunks.length), vwi(f.skelStart), vwi(f.skelLen), vwi(f.skelStart), vwi(f.skelLen)]) }));
    const skelTagx = [[1, 1, 3], [6, 2, 12]].map(t => [...t, 0]);
    const skelRecs = buildIndex(skelTagx, skelEntries, 0);

    // registros de texto
    say('Compactando o texto…'); await tick();
    const RS = 4096, nText = Math.ceil(fullText.length / RS), textRecs = [];
    for (let i = 0; i < nText; i++) {
      const s = i * RS, e = Math.min(fullText.length, s + RS);
      let overlap = new Uint8Array(0);
      if (e < fullText.length && (fullText[e] & 0xC0) === 0x80) {   // caractere de vários bytes cortado ao meio
        let p = e - 1; while (p > s && (fullText[p] & 0xC0) === 0x80) p--;
        const lead = fullText[p], need = (lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : 2) - (e - p);
        if (need > 0) overlap = fullText.slice(e, e + need);
      }
      textRecs.push(cat([palmCompress(fullText.subarray(s, e)), overlap, Uint8Array.of(overlap.length), tbsRecord(pre, s, e)]));
      if (i % 200 === 199) await tick();
    }

    // EXTH
    const uuid = (() => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128; const h = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; })();
    const exth = [];
    const eStr = (t, s) => exth.push([t, enc.encode(s)]);
    const eNum = (t, n) => exth.push([t, u32(n)]);
    (book.authors.length ? book.authors : ['Desconhecido']).forEach(a => eStr(100, a));
    if (book.publisher) eStr(101, book.publisher);
    if (book.description) eStr(103, book.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    book.subjects.forEach(s => eStr(105, s));
    eStr(106, book.date || new Date().toISOString());
    eStr(108, 'Converterias');
    eStr(112, 'converterias:' + uuid);
    eStr(113, uuid);
    eNum(125, resources.length);
    if (coverIdx >= 0) eStr(129, `kindle:embed:${b32(coverIdx + 1, 4)}`);
    eNum(131, 0);
    if (coverIdx >= 0) { eNum(201, coverIdx); if (thumbIdx >= 0) eNum(202, thumbIdx); }
    eNum(203, 0);
    eNum(204, 201); eNum(205, 2); eNum(206, 9); eNum(207, 0);
    eStr(501, 'EBOK');
    eStr(503, book.title);
    eStr(524, lang);
    eStr(525, book.writing || (book.rtl ? 'horizontal-rl' : 'horizontal-lr'));
    eStr(528, 'true');
    eStr(535, '0730-890adc2');
    const exBody = cat(exth.map(([t, d]) => cat([u32(t), u32(8 + d.length), d])));
    const exthRec = pad4(cat([enc4('EXTH'), u32(12 + exBody.length), u32(exth.length), exBody]));
    const exthLen = 12 + exBody.length;

    // ordem dos registros
    const recs = [null, ...textRecs, Uint8Array.of(0, 0, 0)];
    const firstNonBook = recs.length;
    const add = list => { const i = recs.length; recs.push(...list); return i; };
    const fragIdx = add(fragRecs), skelIdx = add(skelRecs), ncxIdx = add(ncxRecs);
    const firstImage = recs.length;
    resources.forEach(r => recs.push(r.bytes));
    const fdstRec = cat([enc4('FDST'), u32(12), u32(fdst.length), ...fdst.flatMap(([a, b]) => [u32(a), u32(b)])]);
    const flisRec = Uint8Array.from([0x46, 0x4c, 0x49, 0x53, 0, 0, 0, 8, 0, 0x41, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 1, 0, 3, 0, 0, 0, 3, 0, 0, 0, 1, 255, 255, 255, 255]);
    const fcisRec = cat([enc4('FCIS'), u32(0x14), u32(0x10), u32(2), u32(0), u32(fullText.length), u32(0), u32(0x28), u32(0), u32(0x28), u32(8), u32(0x00010001), u32(0)]);
    const fdstIdx = recs.length; recs.push(fdstRec);
    const flisIdx = recs.length; recs.push(flisRec);
    const fcisIdx = recs.length; recs.push(fcisRec);
    recs.push(Uint8Array.of(0xe9, 0x8e, 0x0d, 0x0a));

    // registro 0
    const LANG = { pt: 22, en: 9, es: 10, fr: 12, de: 7, it: 16, ru: 25, ja: 17, zh: 4, ko: 18, ar: 1, he: 13, el: 8, nl: 19, sv: 29, pl: 21, tr: 31, uk: 34, cs: 5, da: 6, fi: 11, hu: 14, no: 20, ro: 24, hi: 57, th: 30 };
    const shortTitle = clean(book.title);
    const titleBytes = enc.encode(shortTitle);
    const mobi = new Uint8Array(0x118), dv = new DataView(mobi.buffer);
    const setU32 = (o, v) => dv.setUint32(o, v >>> 0);
    mobi.set([0, 2, 0, 0], 0); setU32(4, fullText.length); dv.setUint16(8, nText); dv.setUint16(10, RS);
    mobi.set(enc4('MOBI'), 0x10); setU32(0x14, 264); setU32(0x18, 2); setU32(0x1c, 65001);
    setU32(0x20, crypto.getRandomValues(new Uint32Array(1))[0]); setU32(0x24, 8);
    for (let o = 0x28; o < 0x50; o += 4) setU32(o, 0xffffffff);
    setU32(0x50, firstNonBook);
    const nameOff = pad4(cat([mobi, exthRec])).length;
    setU32(0x54, nameOff); setU32(0x58, titleBytes.length); setU32(0x5c, LANG[lang] || 0); setU32(0x68, 8); setU32(0x6c, resources.length ? firstImage : 0xffffffff);
    setU32(0x80, 0x50); setU32(0xa4, 0xffffffff); setU32(0xa8, 0xffffffff);
    setU32(0xc0, fdstIdx); setU32(0xc4, fdst.length); setU32(0xc8, fcisIdx); setU32(0xcc, 1); setU32(0xd0, flisIdx); setU32(0xd4, 1);
    setU32(0xe0, 0xffffffff); setU32(0xe8, 0xffffffff); setU32(0xec, 0xffffffff);
    setU32(0xf0, 3); setU32(0xf4, ncxIdx); setU32(0xf8, fragIdx); setU32(0xfc, skelIdx); setU32(0x100, 0xffffffff); setU32(0x104, 0xffffffff);
    setU32(0x108, 0xffffffff); setU32(0x110, 0xffffffff);
    recs[0] = cat([pad4(cat([mobi, exthRec])), titleBytes, new Uint8Array(8192)]);

    // PalmDB
    const n = recs.length, hdr = new Uint8Array(78), hv = new DataView(hdr.buffer);
    hdr.set(enc4(shortTitle.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 31) || 'book'), 0);
    const now = Math.floor(Date.now() / 1000) + 2082844800;
    hv.setUint32(36, now); hv.setUint32(40, now); hdr.set(enc4('BOOKMOBI'), 60); hv.setUint32(68, 2 * n - 1); hv.setUint16(76, n);
    let off = 78 + 8 * n + 2;
    const list = [];
    recs.forEach((r, i) => { const e = new Uint8Array(8), ev = new DataView(e.buffer); ev.setUint32(0, off); ev.setUint32(4, 2 * i); list.push(e); off += r.length; });
    const bytes = cat([hdr, ...list, new Uint8Array(2), ...recs]);
    return { bytes, title: book.title, authors: book.authors, lang, textLength: fullText.length, records: n, images: resources.length, sections: files.length };
  }

  return { convert, palmCompress, vwi, b32, _readEpub: readEpub, _resolve: resolve, _prepareImage: prepareImage };
})();
