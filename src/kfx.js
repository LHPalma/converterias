// EPUB -> KFX (formato atual do Kindle). Container CONT + fragmentos em Amazon Ion.
const Kfx = (() => {
  const enc = new TextEncoder();
  const cat = ps => { let n = 0; for (const p of ps) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of ps) { o.set(p, k); k += p.length; } return o; };

  // ---------- Ion binário 1.0 ----------
  const varuint = n => { const b = [n % 128]; n = Math.floor(n / 128); while (n > 0) { b.unshift(n % 128); n = Math.floor(n / 128); } b[b.length - 1] |= 0x80; return Uint8Array.from(b); };
  const uintBytes = n => { if (n === 0) return new Uint8Array(0); const b = []; while (n > 0) { b.unshift(n % 256); n = Math.floor(n / 256); } return Uint8Array.from(b); };
  const head = (t, len) => len < 14 ? Uint8Array.of((t << 4) | len) : cat([Uint8Array.of((t << 4) | 14), varuint(len)]);
  const tv = (t, body) => cat([head(t, body.length), body]);
  class Sym { constructor(id) { this.id = id; } }
  class Annot { constructor(a, v) { this.annots = a; this.value = v; } }
  const S = n => new Sym(n), A = (t, v) => new Annot([t], v);
  function ion(v) {
    if (v === null || v === undefined) return Uint8Array.of(0x0f);
    if (v instanceof Sym) return tv(7, uintBytes(v.id));
    if (v instanceof Uint8Array) return tv(10, v);
    if (v instanceof Annot) {
      const inner = ion(v.value), al = cat(v.annots.map(a => varuint(a instanceof Sym ? a.id : a)));
      return tv(14, cat([varuint(al.length), al, inner]));
    }
    if (typeof v === 'boolean') return Uint8Array.of(v ? 0x11 : 0x10);
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return v === 0 ? Uint8Array.of(0x20) : v > 0 ? tv(2, uintBytes(v)) : tv(3, uintBytes(-v));
      const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return tv(4, b);
    }
    if (typeof v === 'string') return tv(8, enc.encode(v));
    if (Array.isArray(v)) return tv(11, cat(v.map(ion)));
    return tv(13, cat(Object.entries(v).map(([k, val]) => cat([varuint(+k), ion(val)]))));
  }
  const BVM = Uint8Array.of(0xe0, 0x01, 0x00, 0xea);
  const ionDoc = v => cat([BVM, ion(v)]);

  // ---------- SHA-1 ----------
  function sha1(bytes) {
    const rol = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
    const ml = bytes.length, total = (((ml + 8) >> 6) + 1) << 6;
    const b = new Uint8Array(total); b.set(bytes); b[ml] = 0x80;
    const dv = new DataView(b.buffer);
    dv.setUint32(total - 4, (ml * 8) >>> 0); dv.setUint32(total - 8, Math.floor(ml / 536870912));
    let h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    const w = new Uint32Array(80);
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let [a, bb, c, d, e] = h;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
        const k = i < 20 ? 0x5A827999 : i < 40 ? 0x6ED9EBA1 : i < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        const t = (rol(a, 5) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = rol(bb, 30); bb = a; a = t;
      }
      h = [(h[0] + a) >>> 0, (h[1] + bb) >>> 0, (h[2] + c) >>> 0, (h[3] + d) >>> 0, (h[4] + e) >>> 0];
    }
    return h.map(x => x.toString(16).padStart(8, '0')).join('');
  }

  // ---------- container ----------
  const u16 = n => Uint8Array.of(n & 255, (n >> 8) & 255);
  const u32 = n => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const u64 = n => cat([u32(n % 4294967296), u32(Math.floor(n / 4294967296))]);
  const asc = s => Uint8Array.from([...s].map(c => c.charCodeAt(0)));
  const SYSN = 9, YJMAX = 778, LOCAL_BASE = SYSN + YJMAX + 1;   // símbolos locais começam em $788

  class SymTab {
    constructor() { this.names = []; this.index = new Map(); }
    id(name) {
      if (this.index.has(name)) return this.index.get(name);
      const n = LOCAL_BASE + this.names.length;
      this.names.push(name); this.index.set(name, n); return n;
    }
    get maxId() { return LOCAL_BASE + this.names.length - 1; }
  }
  function entity(typeIdnum, idIdnum, value, raw) {
    const info = ionDoc({ 410: 0, 411: 0 });
    const hd = cat([asc('ENTY'), u16(1), u32(10 + info.length), info]);
    return { typeIdnum, idIdnum, bytes: cat([hd, raw ? value : ionDoc(value)]) };
  }
  function container(frags, symtab, containerId) {
    const table = [], datas = []; let off = 0;
    for (const f of frags) {
      table.push(cat([u32(f.idIdnum), u32(f.typeIdnum), u64(off), u64(f.bytes.length)]));
      datas.push(f.bytes); off += f.bytes.length;
    }
    const idx = cat(table), payload = cat(datas);
    const docSym = ionDoc(A(3, { 8: symtab.maxId, 6: [{ 4: 'YJ_symbols', 5: 10, 8: SYSN + YJMAX }], 7: symtab.names }));
    const fmt = ionDoc(A(593, [{ 492: 'kfxgen.textBlock', 5: 1 }]));
    const HDR = 18;
    const info = { 409: containerId, 410: 0, 411: 0, 413: HDR, 414: idx.length,
                   415: HDR + idx.length, 416: docSym.length, 412: 4096,
                   594: HDR + idx.length + docSym.length, 595: fmt.length };
    const infoBytes = ionDoc(info);
    const infoOff = HDR + idx.length + docSym.length + fmt.length;
    const json = `[{key:"kfxgen_package_version",value:""},{key:"kfxgen_application_version",value:"Converterias"},`
      + `{key:"kfxgen_payload_sha1",value:"${sha1(payload)}"},{key:"kfxgen_acr",value:"${containerId}"}]`;
    const hdrLen = infoOff + infoBytes.length + json.length;
    return cat([asc('CONT'), u16(2), u32(hdrLen), u32(infoOff), u32(infoBytes.length),
                idx, docSym, fmt, infoBytes, asc(json), payload]);
  }

  // ---------- tipos de elemento ($159) ----------
  const EL = { text: 269, image: 271, list: 276, item: 277, table: 278, row: 279, tbody: 454, hr: 596 };
  const MIME = { 'image/png': 284, 'image/jpeg': 285, 'image/gif': 286 };
  const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'article', 'aside', 'figure', 'figcaption', 'dd', 'dt', 'caption', 'li', 'td', 'th']);
  const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'audio', 'video', 'iframe', 'object', 'embed', 'canvas', 'nav', 'template', 'noscript']);
  const HSIZE = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, h5: 0.83, h6: 0.67 };

  function imgDims(b) {
    if (b[0] === 0xFF && b[1] === 0xD8) {
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xFF) { i++; continue; }
        if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }
        const len = (b[i + 2] << 8) | b[i + 3];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
          return { mime: 'image/jpeg', w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
        if (m === 0xDA) break;
        i += 2 + len;
      }
      return { mime: 'image/jpeg', w: 0, h: 0 };
    }
    if (b[0] === 0x89 && b[1] === 0x50) { const dv = new DataView(b.buffer, b.byteOffset); return { mime: 'image/png', w: dv.getUint32(16), h: dv.getUint32(20) }; }
    if (b[0] === 0x47 && b[1] === 0x49) return { mime: 'image/gif', w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
    return null;
  }

  async function convert(epubBytes, opt = {}) {
    const say = opt.say || (() => {}), tick = opt.tick || (() => Promise.resolve());
    say('Lendo o EPUB…'); await tick();
    const ep = await Azw3._readEpub(epubBytes);
    const { book, spine, find } = ep;
    if (!spine.length) throw new Error('o EPUB não tem capítulos.');
    const lang = book.lang || 'en';

    const st = new SymTab(), frags = [];
    const add = (t, id, v, raw) => frags.push(entity(t, id, v, raw));
    const containerId = 'CR!' + Array.from({ length: 28 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');

    // símbolos reservados na ordem de uso
    const secSym = spine.map((_, i) => st.id('c' + i));
    const adSym = spine.map((_, i) => st.id('c' + i + '-ad'));
    const POOL_MAX = 8000;
    const pools = [{ sym: st.id('content_1'), strings: [], bytes: 0 }];
    const storySym = spine.map((_, i) => st.id('l' + i));
    const navSym = st.id('nav_0');

    // estilos (criados sob demanda, nomeados pelo conteúdo)
    const styles = new Map();
    const styleFor = key => {
      if (styles.has(key)) return styles.get(key);
      const name = 'st' + styles.size, sym = st.id(name);
      let props;
      if (key.startsWith('h')) props = { 16: { 307: HSIZE[key] || 1, 306: S(505) }, 761: [S(760)],
                                         49: { 307: 0.6, 306: S(310) }, 47: { 307: 0.6, 306: S(310) }, 10: lang };
      else if (key === 'pre') props = { 16: { 307: 0.9, 306: S(505) }, 10: lang, 47: { 307: 0.8, 306: S(310) } };
      else if (key === 'blockquote') props = { 16: { 307: 1, 306: S(505) }, 10: lang,
                                               48: { 307: 2, 306: S(314) }, 50: { 307: 2, 306: S(314) }, 47: { 307: 0.8, 306: S(310) } };
      else props = { 16: { 307: 1, 306: S(505) }, 10: lang, 47: { 307: 0.83, 306: S(310) } };
      styles.set(key, { sym, props }); return styles.get(key);
    };

    // recursos de imagem
    const resources = new Map();   // caminho -> { resSym, rawSym, dims }
    async function resourceFor(path) {
      if (resources.has(path)) return resources.get(path);
      const f = find(path);
      if (!f) { resources.set(path, null); return null; }
      const raw = await f.async('uint8array');
      // webp, bmp, svg e jpeg exótico são reconvertidos; o resto passa direto
      let img = null;
      try { img = await Azw3._prepareImage(raw, (ep.byPath.get(path) || {}).type); } catch (e) { img = null; }
      if (!img) { const d = imgDims(raw); if (d) img = { bytes: raw, mime: d.mime, w: d.w, h: d.h }; }
      if (!img || !MIME[img.mime]) { resources.set(path, null); return null; }
      const n = resources.size;
      const rname = 'resource/rsrc' + n;
      const r = { name: 'e' + n, resSym: st.id('e' + n), rawName: rname, rawSym: st.id(rname), bytes: img.bytes,
                  dims: { mime: img.mime, w: img.w, h: img.h } };
      resources.set(path, r); return r;
    }

    const posMap = [], navTargets = new Map();
    let eid = 1000, pos = 0;
    const bytesOf = s => enc.encode(s).length;
    const poolPut = text => {
      let p = pools[pools.length - 1];
      const n = bytesOf(text);
      if (p.bytes && p.bytes + n > POOL_MAX) { p = { sym: st.id('content_' + (pools.length + 1)), strings: [], bytes: 0 }; pools.push(p); }
      const idx = p.strings.length; p.strings.push(text); p.bytes += n;
      return { 4: S(p.sym), 403: idx };
    };
    // textos muito longos são partidos (o formato limita cada bloco a 8 KB)
    const splitText = text => {
      if (bytesOf(text) <= POOL_MAX) return [text];
      const parts = []; let cur = '';
      for (const w of text.split(/(\s+)/)) {
        if (cur && bytesOf(cur) + bytesOf(w) > POOL_MAX) { parts.push(cur); cur = ''; }
        cur += w;
      }
      if (cur) parts.push(cur);
      return parts;
    };
    const pushText = (text, styleKey, out) => {
      out[145] = poolPut(text);
      out[157] = S(styleFor(styleKey).sym);
      out[159] = S(EL.text);
      pos += [...text].length;
    };

    say('Montando o livro…'); await tick();
    const secEidLists = [];
    let maxSecPos = 0;
    for (let si = 0; si < spine.length; si++) {
      const it = spine[si];
      const raw = await find(it.path).async('string');
      let doc = ep.parse(raw, /html/.test(it.type) ? 'application/xhtml+xml' : 'text/html');
      if (doc.querySelector('parsererror')) doc = ep.parse(raw, 'text/html');
      const body = doc.querySelector('body') || doc.documentElement;
      const eids = [];
      const secStartPos = pos;
      const rootEid = eid++; eids.push(rootEid); posMap.push({ pos, eid: rootEid }); pos += 1;

      const regId = (n, e) => { const id = n.getAttribute && n.getAttribute('id'); if (id) navTargets.set(it.path + '#' + id, e); };
      const BREAKER = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'img', 'hr', 'li', 'td', 'th']);
      const isBlocky = n => BLOCK.has(n.localName) || BREAKER.has(n.localName);
      const hasBlocky = n => [...n.children].some(x => isBlocky(x) || hasBlocky(x));
      // texto de um trecho em linha, com <br> virando quebra
      const inlineText = n => {
        let s = '';
        for (const c of n.childNodes) {
          if (c.nodeType === 3) s += c.nodeValue;
          else if (c.nodeType === 1) {
            const nm = c.localName.toLowerCase();
            if (SKIP.has(nm) || c.hasAttribute('hidden')) continue;   // hidden: o Kindle (e o EPUB → PDF) não mostra
            if (nm === 'br') s += '\n'; else s += inlineText(c);
          }
        }
        return s;
      };
      const clean = s => s.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

      async function walk(node, styleKey) {
        const out = [];
        let buf = '';
        const flush = () => {
          const t = clean(buf); buf = '';
          if (!t) return;
          for (const part of splitText(t)) {
            const e = { 155: eid++ }; eids.push(e[155]); posMap.push({ pos, eid: e[155] });
            pushText(part, styleKey || 'p', e); out.push(e);
          }
        };
        const simple = (kind, c, extra) => {
          const e = { 155: eid++ }; eids.push(e[155]); posMap.push({ pos, eid: e[155] }); pos += 1;
          e[159] = S(kind); if (extra) Object.assign(e, extra);
          regId(c, e[155]); return e;
        };
        for (const c of node.childNodes) {
          if (c.nodeType === 3) { buf += c.nodeValue; continue; }
          if (c.nodeType !== 1) continue;
          const name = c.localName.toLowerCase();
          if (SKIP.has(name) || c.hasAttribute('hidden')) continue;
          if (name === 'br') { buf += '\n'; continue; }
          if (!isBlocky(c) && !hasBlocky(c)) { buf += inlineText(c); continue; }
          flush();
          if (name === 'img') {
            const src = c.getAttribute('src');
            if (!src || /^data:/i.test(src)) continue;
            const r = await resourceFor(Azw3._resolve(it.path, src));
            if (!r) continue;
            const alt = c.getAttribute('alt');
            out.push(simple(EL.image, c, Object.assign({ 175: S(r.resSym) }, alt ? { 584: alt } : {})));
            continue;
          }
          if (name === 'hr') { out.push(simple(EL.hr, c)); continue; }
          if (name === 'ul' || name === 'ol') {
            const e = simple(EL.list, c, { 100: S(name === 'ol' ? 342 : 340) });
            const kids = await walk(c, styleKey); if (kids.length) e[146] = kids;
            out.push(e); continue;
          }
          if (name === 'table' || name === 'thead' || name === 'tbody' || name === 'tr') {
            const e = simple(name === 'table' ? EL.table : name === 'tr' ? EL.row : EL.tbody, c);
            const kids = await walk(c, styleKey); if (kids.length) e[146] = kids;
            out.push(e); continue;
          }
          if (name === 'li' || name === 'td' || name === 'th') {
            const kind = name === 'li' ? EL.item : EL.text;
            if (!hasBlocky(c)) {
              const t = clean(inlineText(c));
              if (!t) { const e = simple(kind, c); out.push(e); }
              else {
                let first = true;
                for (const part of splitText(t)) {
                  const e = { 155: eid++ }; eids.push(e[155]); posMap.push({ pos, eid: e[155] });
                  if (first) { regId(c, e[155]); first = false; }
                  pushText(part, styleKey || 'p', e); e[159] = S(kind);
                  out.push(e);
                }
              }
            } else {
              const e = simple(kind, c);
              const kids = await walk(c, styleKey); if (kids.length) e[146] = kids;
              out.push(e);
            }
            continue;
          }
          // bloco comum
          const key = HSIZE[name] ? name : (name === 'pre' || name === 'blockquote' ? name : (styleKey || 'p'));
          if (!hasBlocky(c)) {
            const t = name === 'pre' ? (c.textContent || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '') : clean(inlineText(c));
            if (!t) continue;
            let first = true;
            for (const part of splitText(t)) {
              const e = { 155: eid++ }; eids.push(e[155]); posMap.push({ pos, eid: e[155] });
              if (first) { regId(c, e[155]); first = false; }
              pushText(part, key, e); out.push(e);
            }
          } else {
            regId(c, eid);
            out.push(...await walk(c, key));
          }
        }
        flush();
        return out;
      }
      const kids = await walk(body);
      add(259, storySym[si], { 176: S(storySym[si]), 146: kids });
      add(260, secSym[si], { 174: S(secSym[si]), 141: [{ 155: rootEid, 176: S(storySym[si]), 159: S(EL.text) }] });
      add(597, adSym[si], { 598: S(adSym[si]), 258: [{ 492: 'IS_TARGET_SECTION', 307: true }] });
      secEidLists.push({ sec: secSym[si], eids, first: rootEid });
      if (pos - secStartPos > maxSecPos) maxSecPos = pos - secStartPos;
      navTargets.set(it.path, rootEid);
      if (si % 5 === 4) { say(`Capítulo ${si + 1} de ${spine.length}…`); await tick(); }
    }

    const coverRes = ep.cover ? await resourceFor(ep.cover) : null;

    for (const p of pools) add(145, p.sym, { 4: S(p.sym), 146: p.strings });
    for (const { sym, props } of styles.values()) add(157, sym, Object.assign({ 173: S(sym) }, props));
    for (const r of resources.values()) {
      if (!r) continue;
      add(164, r.resSym, { 161: S(MIME[r.dims.mime]), 162: r.dims.mime, 165: r.rawName, 422: r.dims.w, 175: S(r.resSym), 423: r.dims.h });
      add(417, r.rawSym, r.bytes, true);
    }
    add(264, 348, secEidLists.map(x => ({ 181: x.eids.slice().sort((a, b) => a - b), 174: S(x.sec) })));
    add(265, 348, posMap.map(p => ({ 184: p.pos, 185: p.eid })).concat([{ 184: pos, 185: 0 }]));
    add(550, 348, [{ 182: [{ 155: secEidLists[0].first, 143: 0 }] }]);

    const navEntries = [];
    const walkToc = (list) => { for (const n of list || []) {
      const key = n.path ? (n.frag ? n.path + '#' + n.frag : n.path) : null;
      const target = key && (navTargets.get(key) ?? navTargets.get(n.path));
      const title = (n.title || '').replace(/\s+/g, ' ').trim();
      if (title && target) navEntries.push(A(393, { 241: { 244: title }, 246: { 155: target, 143: 0 } }));
      walkToc(n.items);
    } };
    walkToc(ep.toc);
    if (!navEntries.length) secEidLists.forEach((x, i) => navEntries.push(A(393, { 241: { 244: 'Capítulo ' + (i + 1) }, 246: { 155: x.first, 143: 0 } })));
    add(389, 348, [{ 178: S(351), 392: [A(391, { 235: S(212), 239: S(navSym), 247: navEntries })] }]);
    add(395, 348, { 247: [] });

    const ro = [{ 178: S(351), 170: secSym.map(s => S(s)) }];
    add(258, 348, { 169: ro });
    add(538, 348, { 192: S(376), 560: S(557), 16: { 307: 1, 306: S(308) }, 112: S(383), 436: S(441),
                    8: eid - 1000, 42: { 307: 1.2, 306: S(308) }, 477: S(56), 169: ro });
    add(490, 348, { 491: [
      { 495: 'kindle_title_metadata', 258: [
        { 492: 'title', 307: book.title || 'Livro' },
        { 492: 'author', 307: (book.authors || []).join(', ') },
        { 492: 'language', 307: lang },
        { 492: 'asset_id', 307: containerId },
        { 492: 'cde_content_type', 307: 'EBOK' },
        { 492: 'is_sample', 307: false },
        { 492: 'override_kindle_font', 307: false }]
        .concat(coverRes ? [{ 492: 'cover_image', 307: coverRes.name }] : []) },
      { 495: 'kindle_ebook_metadata', 258: [{ 492: 'nested_span', 307: 'enabled' }, { 492: 'selection', 307: 'enabled' }] },
      { 495: 'kindle_audit_metadata', 258: [{ 492: 'file_creator', 307: 'KPR' }, { 492: 'creator_version', 307: '3.48.0' }] },
      { 495: 'kindle_capability_metadata', 258: [] }] });
    // seções longas precisam declarar o tamanho de refluxo esperado pelo leitor
    const reflowSize = maxSecPos > 65536 ? Math.min(Math.floor((maxSecPos - 65536) / 16384) + 2, 256) : 1;
    const feats = [{ 586: 'com.amazon.yjconversion', 492: 'reflow-style', 589: { 5: { 587: 1, 588: 0 } } }];
    if (reflowSize > 1) feats.push({ 586: 'com.amazon.yjconversion', 492: 'reflow-section-size', 589: { 5: { 587: reflowSize, 588: 0 } } });
    feats.push({ 586: 'SDK.Marker', 492: 'CanonicalFormat', 589: { 5: { 587: 1, 588: 0 } } });
    add(585, 348, { 590: feats });
    const ids = frags.map(f => f.idIdnum).filter(x => x !== 348);
    add(419, 348, { 252: [{ 155: containerId, 181: ids.map(x => S(x)) }] });

    say('Gerando o KFX…'); await tick();
    return { bytes: container(frags, st, containerId), title: book.title, authors: book.authors,
             sections: spine.length, images: [...resources.values()].filter(Boolean).length };
  }
  return { convert, _ion: ion, _sha1: sha1, _imgDims: imgDims, _container: container, _entity: entity };
})();
