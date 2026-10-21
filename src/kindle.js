// Simulador de Kindle: lê o AZW3 (KF8) ou o KFX que o app gerou e monta o que o aparelho mostra.
// O AZW3 é remontado como o Kindle faz (texto PalmDOC, esqueleto + fragmentos, fluxos de CSS e SVG, recursos);
// o layout fixo (mangá) vira páginas com as áreas de toque e os quadros ampliados do Panel View.
// O KFX é decodificado do Amazon Ion (seções, blocos de texto, imagens e sumário).
// EPUB (Enviar para Kindle) vira capítulos com o CSS e as imagens do livro; PDF vira páginas inteiras, reduzidas à tela.
const Kindle = (() => {
  const dec = new TextDecoder();
  const u16 = (b, o) => (b[o] << 8) | b[o + 1];
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const str = (b, a, n) => String.fromCharCode(...b.subarray(a, a + n));
  const cat = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
  const b32 = s => parseInt(s, 32);
  const mimeOf = b => b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif' : null;

  // ---------- AZW3 ----------
  function palmDecompress(src) {
    const out = [];
    for (let i = 0; i < src.length;) {
      const c = src[i++];
      if (c === 0 || (c >= 9 && c <= 0x7f)) out.push(c);
      else if (c <= 8) for (let k = 0; k < c; k++) out.push(src[i++]);
      else if (c >= 0xc0) out.push(32, c ^ 0x80);
      else { const v = (c << 8) | src[i++], d = (v >> 3) & 0x7ff, n = (v & 7) + 3; for (let k = 0; k < n; k++) out.push(out[out.length - d]); }
    }
    return Uint8Array.from(out);
  }
  const fwdVwi = (b, p) => { let v = 0; for (;;) { const x = b[p++]; v = v * 128 + (x & 0x7f); if (x & 0x80) return [v, p]; } };
  const trailingSize = d => { let n = 0; for (const v of d.subarray(Math.max(0, d.length - 4))) { if (v & 0x80) n = 0; n = (n << 7) | (v & 0x7f); } return n; };
  const bitCount = m => { let n = 0; for (; m; m >>= 1) n += m & 1; return n; };

  function readAzw3(buf) {
    if (str(buf, 60, 8) !== 'BOOKMOBI') throw new Error('não é um AZW3 (falta o cabeçalho BOOKMOBI).');
    const n = u16(buf, 76), offs = Array.from({ length: n }, (_, i) => u32(buf, 78 + 8 * i));
    const rec = i => buf.subarray(offs[i], i + 1 < n ? offs[i + 1] : buf.length);
    const r0 = rec(0), hl = u32(r0, 20);
    if (str(r0, 16, 4) !== 'MOBI' || u32(r0, 36) !== 8) throw new Error('não é KF8 (MOBI versão 8).');
    const H = { textRecords: u16(r0, 8), firstImage: u32(r0, 0x6c), fdst: u32(r0, 0xc0), flags: u16(r0, 0xf2), ncx: u32(r0, 0xf4), frag: u32(r0, 0xf8), skel: u32(r0, 0xfc) };
    const title = dec.decode(r0.subarray(u32(r0, 0x54), u32(r0, 0x54) + u32(r0, 0x58)));
    const exth = {};
    const e = 16 + hl;
    if (str(r0, e, 4) === 'EXTH') for (let k = 0, p = e + 12, cnt = u32(r0, e + 8); k < cnt; k++) {
      const t = u32(r0, p), len = u32(r0, p + 4), d = r0.subarray(p + 8, p + len);
      if (!(t in exth)) exth[t] = len === 12 && [125, 201, 202].includes(t) ? u32(d, 0) : dec.decode(d);
      p += len;
    }
    // texto
    const parts = [];
    for (let i = 1; i <= H.textRecords; i++) {
      let d = rec(i);
      for (let b = 15; b >= 1; b--) if (H.flags & (1 << b)) d = d.subarray(0, d.length - trailingSize(d));
      if (H.flags & 1) d = d.subarray(0, d.length - ((d[d.length - 1] & 3) + 1));
      parts.push(palmDecompress(d));
    }
    const full = cat(parts), fd = rec(H.fdst);
    const flows = Array.from({ length: u32(fd, 8) }, (_, k) => full.subarray(u32(fd, 12 + 8 * k), u32(fd, 16 + 8 * k)));
    // índices INDX (TAGX + IDXT + CNCX)
    const index = start => {
      const h = rec(start), count = u32(h, 24), ncncx = u32(h, 52), tx = u32(h, 180), tagx = [];
      for (let p = tx + 12; p < tx + u32(h, tx + 4); p += 4) tagx.push([h[p], h[p + 1], h[p + 2], h[p + 3]]);
      const entries = [];
      for (let r = 1; r <= count; r++) {
        const d = rec(start + r), idxt = u32(d, 20);
        for (let k = 0, cnt = u32(d, 24); k < cnt; k++) {
          let p = u16(d, idxt + 4 + 2 * k);
          const kl = d[p], key = str(d, p + 1, kl); p += 1 + kl;
          const ctrl = d[p++], want = [], tags = {};
          for (const [tag, vpe, mask, end] of tagx) {
            if (end) continue;
            let v = ctrl & mask;
            if (!v) continue;
            if (v === mask && bitCount(mask) > 1) { let c; [c, p] = fwdVwi(d, p); want.push([tag, null, c, vpe]); }
            else if (v === mask) want.push([tag, 1, null, vpe]);
            else { let m = mask; while (!(m & 1)) { m >>= 1; v >>= 1; } want.push([tag, v, null, vpe]); }
          }
          for (const [tag, c, bytes, vpe] of want) {
            const vals = [];
            if (c != null) for (let q = 0; q < c * vpe; q++) { let v; [v, p] = fwdVwi(d, p); vals.push(v); }
            else { const stop = p + bytes; while (p < stop) { let v; [v, p] = fwdVwi(d, p); vals.push(v); } }
            tags[tag] = vals;
          }
          entries.push({ key, tags });
        }
      }
      const cncx = [];
      for (let k = 0; k < ncncx; k++) cncx.push(rec(start + 1 + count + k));
      const label = off => { const c = cncx[Math.floor(off / 0x10000)], o = off % 0x10000; const [len, p] = fwdVwi(c, o); return dec.decode(c.subarray(p, p + len)); };
      return { entries, label };
    };
    const skel = index(H.skel), frag = index(H.frag);
    const files = [], fidAt = new Map();
    let fk = 0;
    skel.entries.forEach((s, fi) => {
      const [chunks] = s.tags[1], [start, len] = s.tags[6];
      let html = full.subarray(start, start + len), phys = start + len;
      for (let k = 0; k < chunks; k++, fk++) {
        const f = frag.entries[fk], [fid] = f.tags[4], [, size] = f.tags[6], at = +f.key - start;
        fidAt.set(fid, { file: fi, at });
        html = cat([html.subarray(0, at), full.subarray(phys, phys + size), html.subarray(at)]); phys += size;
      }
      files.push(html);
    });
    let toc = [];
    try {
      const ncx = index(H.ncx);
      toc = ncx.entries.map(x => ({ title: ncx.label(x.tags[3][0]), pos: x.tags[1][0], depth: x.tags[4][0], fid: x.tags[6][0] }))
        .sort((a, b) => a.pos - b.pos || a.depth - b.depth)   // o índice guarda por nível; o sumário vai na ordem do livro
        .map(t => ({ title: t.title, depth: t.depth, file: (fidAt.get(t.fid) || { file: 0 }).file }));
    } catch (e) { toc = []; }
    const resources = [];
    if (H.firstImage !== 0xffffffff) for (let k = 0; k < (exth[125] || 0); k++) resources.push(rec(H.firstImage + k));
    // posição de um kindle:pos dentro do arquivo remontado: arquivo + id do elemento mais próximo
    const posTarget = (fid, off) => {
      const t = fidAt.get(fid); if (!t) return null;
      const s = dec.decode(files[t.file].subarray(t.at + off, t.at + off + 400)), m = /^<[^>]*\sid="([^"]+)"/.exec(s);
      return { file: t.file, id: m ? m[1] : null };
    };
    return { kind: 'azw3', title, authors: exth[100] && exth[100] !== 'Desconhecido' ? [exth[100]] : [], exth, flows, files: files.map(f => dec.decode(f)), resources, toc, posTarget,
      fixed: exth[122] === 'true', rtl: exth[527] === 'rtl' || exth[525] === 'horizontal-rl', cover: exth[201] };
  }

  // ---------- KFX ----------
  class Sym { constructor(id) { this.id = id; } }
  function ion(b, p) {
    const t = b[p] >> 4; let len = b[p] & 15; p++;
    if (len === 15) return [null, p];
    if (len === 14 && t !== 1) { let v = 0; for (;;) { const x = b[p++]; v = v * 128 + (x & 0x7f); if (x & 0x80) break; } len = v; }
    const body = b.subarray(p, p + len), q = p + len;
    const uint = d => d.reduce((v, x) => v * 256 + x, 0);
    const varu = (d, i) => { let v = 0; for (;;) { const x = d[i++]; v = v * 128 + (x & 0x7f); if (x & 0x80) return [v, i]; } };
    switch (t) {
      case 1: return [len === 1, p];
      case 2: return [uint(body), q];
      case 3: return [-uint(body), q];
      case 4: return [len ? new DataView(body.buffer, body.byteOffset, 8).getFloat64(0) : 0, q];
      case 7: return [new Sym(uint(body)), q];
      case 8: return [dec.decode(body), q];
      case 10: return [body, q];
      case 11: case 12: { const out = []; for (let i = 0; i < body.length;) { let v; [v, i] = ion(body, i); out.push(v); } return [out, q]; }
      case 13: { const out = {}; for (let i = 0; i < body.length;) { let k, v; [k, i] = varu(body, i); [v, i] = ion(body, i); out[k] = v; } return [out, q]; }
      case 14: { let [al, i] = varu(body, 0); const stop = i + al; while (i < stop) i = varu(body, i)[1]; return [ion(body, i)[0], q]; }
      default: return [undefined, q];
    }
  }
  const ionDoc = b => ion(b, 4)[0];
  const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  function readKfx(buf) {
    if (str(buf, 0, 4) !== 'CONT') throw new Error('não é um KFX (falta o contêiner CONT).');
    const hdrLen = le32(buf, 6), infoOff = le32(buf, 10), info = ionDoc(buf.subarray(infoOff, infoOff + le32(buf, 14)));
    const names = ionDoc(buf.subarray(info[415], info[415] + info[416]))[7] || [], LOCAL = 788;
    const nameOf = id => id >= LOCAL ? names[id - LOCAL] : '$' + id;
    const payload = buf.subarray(hdrLen), byType = new Map(), byId = new Map();
    for (let p = info[413]; p < info[413] + info[414]; p += 24) {
      const id = le32(buf, p), type = le32(buf, p + 4), off = le32(buf, p + 8), len = le32(buf, p + 16);
      const d = payload.subarray(off, off + len), body = d.subarray(le32(d, 6));
      const f = { id, type, value: type === 417 ? body : ionDoc(body) };
      (byType.get(type) || byType.set(type, []).get(type)).push(f);
      byId.set(type + ':' + id, f);
    }
    const all = t => byType.get(t) || [];
    const pools = new Map(all(145).map(f => [f.value[4].id, f.value[146]]));
    const styles = new Map(all(157).map(f => [f.value[173].id, f.value]));
    const raw = new Map(all(417).map(f => [nameOf(f.id), f.value]));
    const res = new Map(all(164).map(f => [f.value[175].id, { bytes: raw.get(f.value[165]), mime: f.value[162], name: nameOf(f.value[175].id) }]));
    const meta = {};
    for (const g of (all(490)[0] || { value: { 491: [] } }).value[491]) for (const kv of g[258]) meta[kv[492]] = kv[307];
    const stories = new Map(all(259).map(f => [f.value[176].id, f.value[146] || []]));
    const order = ((all(258)[0] || { value: { 169: [{ 170: [] }] } }).value[169][0][170] || []).map(s => s.id);
    const sections = new Map(all(260).map(f => [f.value[174].id, f.value[141][0]]));
    const eidSection = new Map();
    // conteúdo -> HTML simples (o KFX não leva o CSS do EPUB: o Kindle usa os estilos dele)
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = (list, si) => list.map(el => {
      if (el[155] != null) eidSection.set(el[155], si);
      const type = el[159] && el[159].id, kids = el[146] ? html(el[146], si) : '';
      const st = el[157] ? styles.get(el[157].id) || {} : {}, fs = st[16] ? st[16][307] : 1, head = !!st[761];
      const text = el[145] ? (pools.get(el[145][4].id) || [])[el[145][403]] || '' : '';
      const id = el[155] != null ? ` id="e${el[155]}"` : '';
      if (type === 271) { const r = res.get(el[175] && el[175].id); return r ? `<p class="img"${id}><img src="${r.name}" alt=""/></p>` : ''; }
      if (type === 596) return `<hr${id}/>`;
      if (type === 276) return `<${el[100] && el[100].id === 342 ? 'ol' : 'ul'}${id}>${kids}</${el[100] && el[100].id === 342 ? 'ol' : 'ul'}>`;
      if (type === 277) return `<li${id}>${esc(text)}${kids}</li>`;
      if (type === 278) return `<table${id}>${kids}</table>`;
      if (type === 454) return `<tbody>${kids}</tbody>`;
      if (type === 279) return `<tr${id}>${kids}</tr>`;
      if (!text) return kids;
      const body = esc(text).replace(/\n/g, '<br/>');
      if (head) return `<h${fs >= 2 ? 1 : fs >= 1.5 ? 2 : fs >= 1.17 ? 3 : 4}${id}>${body}</h${fs >= 2 ? 1 : fs >= 1.5 ? 2 : fs >= 1.17 ? 3 : 4}>`;
      if (fs === 0.9) return `<pre${id}>${esc(text)}</pre>`;
      return `<p${id}>${body}</p>`;
    }).join('');
    const files = order.map((s, si) => { const sec = sections.get(s); return sec ? html(stories.get(sec[176].id) || [], si) : ''; });
    const toc = [];
    for (const f of all(389)) for (const r of f.value) for (const c of r[392] || []) for (const e of c[247] || []) toc.push({ title: e[241][244], depth: 0, file: eidSection.get(e[246][155]) || 0 });
    const resList = [...res.values()];
    return { kind: 'kfx', title: meta.title || 'Livro', authors: meta.author ? [meta.author] : [], files, toc, fixed: false, rtl: false, resources: resList,
      resByName: new Map(resList.map(r => [r.name, r])), coverName: meta.cover_image };
  }

  // ---------- layout fixo: páginas, áreas de toque e Panel View ----------
  // regiões dos modos de 2 e 4 painéis (como no CSS do src/manga.js)
  const BOX = { 'PV-TL': [0, 0, .495, .5], 'PV-TR': [.505, 0, .495, .5], 'PV-BL': [0, .5, .495, .5], 'PV-BR': [.505, .5, .495, .5],
    'PV-T': [0, 0, 1, .5], 'PV-B': [0, .5, 1, .5], 'PV-L': [0, 0, .495, 1], 'PV-R': [.505, 0, .495, 1] };
  const num = v => parseFloat(v || '0');
  function fixedPages(book, url) {
    return book.files.map(src => {
      const d = new DOMParser().parseFromString(src, 'application/xhtml+xml');
      const vp = /width=(\d+),\s*height=(\d+)/.exec((d.querySelector('meta[name="viewport"]') || { getAttribute: () => '' }).getAttribute('content') || '');
      const W = vp ? +vp[1] : 1072, H = vp ? +vp[2] : 1448;
      const pg = d.querySelector('img.pg') || d.querySelector('img'), s = pg ? pg.style : {};
      const m = pg && /kindle:embed:([0-9A-V]{4})/.exec(pg.getAttribute('src') || '');
      const page = { W, H, src: m ? url(b32(m[1])) : null,
        box: { x: num(s.left) / W, y: num(s.top) / H, w: (num(s.width) || W) / W, h: (num(s.height) || H) / H }, panels: [] };
      for (const a of d.querySelectorAll('a.app-amzn-magnify')) {
        let j; try { j = JSON.parse(a.getAttribute('data-app-amzn-magnify')); } catch (e) { continue; }
        const area = a.parentElement, view = d.getElementById(j.targetId);
        if (!area || !view) continue;
        const as = area.getAttribute('style') || '';
        const tap = /left:([\d.]+)%/.test(as)
          ? { x: num(/left:([\d.]+)%/.exec(as)[1]) / 100, y: num(/top:([\d.]+)%/.exec(as)[1]) / 100, w: num(/width:([\d.]+)%/.exec(as)[1]) / 100, h: num(/height:([\d.]+)%/.exec(as)[1]) / 100 }
          : (b => b ? { x: b[0], y: b[1], w: b[2], h: b[3] } : null)(BOX[area.id]);
        const im = view.querySelector('img'); if (!tap || !im) continue;
        const st = im.getAttribute('style') || '', iw = +im.getAttribute('width') || W, ih = +im.getAttribute('height') || H;
        const pos = (k, size, total) => { const m = new RegExp(`(?:^|;)\\s*${k}:\\s*(-?[\\d.]+)(px|%)`).exec(st); return m ? (m[2] === '%' ? +m[1] / 100 : +m[1] / total) : null; };
        let x = pos('left', iw, W), y = pos('top', ih, H);
        if (x == null) x = pos('right', iw, W) != null ? 1 - iw / W - pos('right', iw, W) : 0;
        if (y == null) y = pos('bottom', ih, H) != null ? 1 - ih / H - pos('bottom', ih, H) : 0;
        // máscara: as faixas brancas em volta do quadro ampliado
        let win = { x: 0, y: 0, w: 1, h: 1 };
        const bands = [...view.querySelectorAll('div')].map(b => { const t = b.getAttribute('style') || '', g = k => num((new RegExp(k + ':(-?[\\d.]+)px').exec(t) || [])[1]); return { x: g('left'), y: g('top'), w: g('width'), h: g('height') }; });
        if (bands.length) {
          let x0 = 0, y0 = 0, x1 = W, y1 = H;
          for (const b of bands) {
            if (b.w >= W - 1 && b.y === 0) y0 = Math.max(y0, b.h);
            else if (b.w >= W - 1) y1 = Math.min(y1, b.y);
            else if (b.x === 0) x0 = Math.max(x0, b.w);
            else x1 = Math.min(x1, b.x);
          }
          win = { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
        }
        page.panels.push({ ordinal: j.ordinal, tap, win, img: { x, y, w: iw / W, h: ih / H } });
      }
      page.panels.sort((a, b) => a.ordinal - b.ordinal);
      return page;
    });
  }

  // ---------- livro de texto: XHTML com CSS e imagens resolvidos ----------
  function textChapters(book, url) {
    if (book.kind === 'kfx') return book.files.map(h => ({ css: '', attrs: '', html: h.replace(/src="([^"]+)"/g, (m, n) => `src="${url(n)}"`) }));
    const css = book.flows.slice(1).map(f => dec.decode(f));
    const fix = s => s.replace(/kindle:embed:([0-9A-V]{4})(\?mime=[^)"']*)?/g, (m, k) => url(b32(k)))
      .replace(/kindle:flow:([0-9A-V]{4})\?mime=text\/css/g, (m, k) => url('css:' + b32(k)));
    return book.files.map(f => {
      const d = new DOMParser().parseFromString(f, 'application/xhtml+xml');
      const links = [...d.querySelectorAll('link[rel="stylesheet"]')].map(l => { const m = /kindle:flow:([0-9A-V]{4})/.exec(l.getAttribute('href') || ''); return m ? fix(css[b32(m[1]) - 1] || '') : ''; });
      const svg = k => { const t = css[k - 1] || ''; return /^<svg/.test(t) ? url('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fix(t))) : ''; };
      const body = d.querySelector('body');
      return { css: links.join('\n'), html: fix(body ? body.innerHTML : '').replace(/kindle:flow:([0-9A-V]{4})\?mime=image\/svg\+xml/g, (m, k) => svg(b32(k))), attrs: body ? [...body.attributes].filter(a => a.name !== 'aid').map(a => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('') : '' };
    });
  }

  // ---------- EPUB: o que o Kindle recebe pelo Enviar para Kindle (ele converte, mas a diagramação vem do XHTML e do CSS) ----------
  const join = (base, rel) => { try { return decodeURIComponent(new URL(rel, 'http://x/' + base).pathname.slice(1)); } catch (e) { return rel; } };
  const xml = (s, type) => { const d = new DOMParser().parseFromString(s, type || 'application/xhtml+xml'); return d.getElementsByTagName('parsererror').length && type !== 'text/html' ? xml(s, 'text/html') : d; };
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', css: 'text/css' };
  async function readEpub(buf) {
    let zip;
    try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new Error('não é um EPUB (o ZIP não abre).'); }
    const text = p => { const f = zip.file(p); return f ? f.async('string') : Promise.resolve(null); };
    const cont = await text('META-INF/container.xml');
    const opfPath = cont && (/full-path="([^"]+)"/.exec(cont) || [])[1];
    const opfText = opfPath && await text(opfPath);
    if (!opfText) throw new Error('não é um EPUB (falta o content.opf).');
    const opf = xml(opfText, 'application/xml'), tag = (d, n) => [...d.getElementsByTagNameNS('*', n)];
    const items = new Map(tag(opf, 'item').map(i => [i.getAttribute('id'), { href: join(opfPath, i.getAttribute('href') || ''), type: i.getAttribute('media-type') || '', props: i.getAttribute('properties') || '' }]));
    const spine = tag(opf, 'itemref').map(r => items.get(r.getAttribute('idref'))).filter(i => i && /html/.test(i.type));
    const fileOf = href => { const k = spine.findIndex(s => s.href === href.split('#')[0]); return k < 0 ? 0 : k; };
    const entry = (title, depth, base, href) => { const [f, id] = href.split('#'); return { title, depth, file: fileOf(join(base, f)), id: id ? decodeURIComponent(id) : null }; };
    const dc = n => tag(opf, n).map(e => e.textContent.trim()).filter(Boolean);
    const toc = [], walk = (ol, depth, base) => { for (const li of [...ol.children].filter(e => e.localName === 'li')) {
      const a = [...li.children].find(e => e.localName === 'a' || e.localName === 'span'), sub = [...li.children].find(e => e.localName === 'ol');
      if (a && a.getAttribute('href')) toc.push(entry(a.textContent.replace(/\s+/g, ' ').trim(), depth, base, a.getAttribute('href')));
      if (sub) walk(sub, depth + 1, base);
    } };
    const nav = [...items.values()].find(i => /\bnav\b/.test(i.props)), navDoc = nav && await text(nav.href);
    const navEl = navDoc && tag(xml(navDoc), 'nav').find(n => (n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '') === 'toc');
    const navOl = navEl && [...navEl.getElementsByTagNameNS('*', 'ol')][0];
    if (navOl) walk(navOl, 0, nav.href);
    else {   // EPUB 2: toc.ncx
      const ncx = items.get((tag(opf, 'spine')[0] || { getAttribute: () => null }).getAttribute('toc')) || [...items.values()].find(i => i.type === 'application/x-dtbncx+xml');
      const ncxText = ncx && await text(ncx.href);
      const pts = (el, depth) => { for (const p of [...el.children].filter(e => e.localName === 'navPoint')) {
        const label = tag(p, 'text')[0], c = tag(p, 'content')[0];
        if (label && c) toc.push(entry(label.textContent.trim(), depth, ncx.href, c.getAttribute('src') || ''));
        pts(p, depth + 1);
      } };
      const map = ncxText && tag(xml(ncxText, 'application/xml'), 'navMap')[0];
      if (map) pts(map, 0);
    }
    const coverId = (tag(opf, 'meta').find(m => m.getAttribute('name') === 'cover') || { getAttribute: () => null }).getAttribute('content');
    const cover = [...items.values()].find(i => /\bcover-image\b/.test(i.props)) || items.get(coverId);
    const spineEl = tag(opf, 'spine')[0];
    return { kind: 'epub', zip, items, spine, toc, title: dc('title')[0] || 'Livro', authors: dc('creator'), rtl: !!spineEl && spineEl.getAttribute('page-progression-direction') === 'rtl',
      fixed: false, coverHref: cover && cover.href, hasFonts: [...items.values()].some(i => /font|opentype|truetype/.test(i.type) || /\.(ttf|otf|woff2?)$/i.test(i.href)) };
  }
  async function epubChapters(book, blob) {
    const res = async (href, type) => { const f = book.zip.file(href); if (!f) return ''; const ext = (/\.(\w+)$/.exec(href) || [])[1] || ''; return blob(href, await f.async('uint8array'), type || MIME[ext.toLowerCase()] || 'application/octet-stream'); };
    const cssCache = new Map();
    const cssUrls = async (css, base) => {   // url(...) do CSS (fontes, fundos) relativos ao arquivo do CSS
      const out = [], re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g; let m, last = 0;
      while ((m = re.exec(css))) { out.push(css.slice(last, m.index), /^(data:|https?:|blob:)/.test(m[2]) ? m[0] : `url("${await res(join(base, m[2]))}")`); last = re.lastIndex; }
      return out.join('') + css.slice(last);
    };
    const sheet = async href => { if (!cssCache.has(href)) { const f = book.zip.file(href); cssCache.set(href, f ? await cssUrls(await f.async('string'), href) : ''); } return cssCache.get(href); };
    const out = [];
    for (const it of book.spine) {
      const f = book.zip.file(it.href), d = xml(f ? await f.async('string') : '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>');
      const css = [];
      for (const el of d.querySelectorAll('link, style')) {
        if (el.localName === 'style') css.push(await cssUrls(el.textContent, it.href));
        else if (/stylesheet/i.test(el.getAttribute('rel') || '')) css.push(await sheet(join(it.href, el.getAttribute('href') || '')));
      }
      for (const el of d.querySelectorAll('[src]')) { const s = el.getAttribute('src'); if (!/^(data:|https?:|blob:)/.test(s)) el.setAttribute('src', await res(join(it.href, s))); }
      for (const el of d.getElementsByTagNameNS('*', 'image')) {   // <image> do SVG (capa, ilustrações)
        const XL = 'http://www.w3.org/1999/xlink', s = el.getAttributeNS(XL, 'href') || el.getAttribute('href');
        if (s && !/^(data:|https?:|blob:)/.test(s)) { const u = await res(join(it.href, s)); el.setAttribute('href', u); if (el.hasAttributeNS(XL, 'href')) el.setAttributeNS(XL, 'xlink:href', u); }
      }
      for (const el of d.querySelectorAll('[style]')) if (/url\(/.test(el.getAttribute('style'))) el.setAttribute('style', await cssUrls(el.getAttribute('style'), it.href));
      const body = d.querySelector('body');
      out.push({ css: css.join('\n'), html: body ? body.innerHTML : '', attrs: body ? [...body.attributes].map(a => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('') : '' });
    }
    return out;
  }

  // ---------- PDF: o Kindle mostra a página inteira, reduzida para caber na tela (sem refluxo do texto) ----------
  async function openPdf(b, urls) {
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: b.slice(), isEvalSupported: false }).promise; } catch (e) { throw new Error('não consegui ler este PDF.'); }
    const info = await doc.getMetadata().catch(() => ({ info: {} })), I = info.info || {};
    const toc = [];
    const walk = async (list, depth) => { for (const o of list || []) {
      let page = 0;
      try { const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest; if (dest && dest[0]) page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]); } catch (e) { /* destino quebrado: primeira página */ }
      toc.push({ title: (o.title || '').trim(), depth, page }); await walk(o.items, depth + 1);
    } };
    await walk(await doc.getOutline().catch(() => null), 0);
    const cache = new Map();
    // desenha a página do tamanho da tela (W × H) e devolve o URL da imagem e a caixa onde ela fica
    const render = async (k, W, H) => {
      const key = k + ':' + W + 'x' + H;
      if (!cache.has(key)) cache.set(key, (async () => {
        const pg = await doc.getPage(k + 1), v1 = pg.getViewport({ scale: 1 }), s = Math.min(W / v1.width, H / v1.height), vp = pg.getViewport({ scale: s });
        const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
        await pg.render({ canvasContext: cx, viewport: vp }).promise;
        const u = URL.createObjectURL(await new Promise(r => cv.toBlob(r, 'image/png'))); urls.push(u);
        return { src: u, box: { x: (1 - cv.width / W) / 2, y: (1 - cv.height / H) / 2, w: cv.width / W, h: cv.height / H } };
      })());
      return cache.get(key);
    };
    return { kind: 'pdf', title: (I.Title || '').trim(), authors: I.Author ? [I.Author.trim()] : [], fixed: true, pdf: true, rtl: false, toc, cover: '', urls,
      pages: Array.from({ length: doc.numPages }, () => ({ panels: [] })), render, close: () => { urls.forEach(u => URL.revokeObjectURL(u)); doc.destroy(); } };
  }

  /* abre um livro: { kind, title, authors, fixed, rtl, toc, pages (layout fixo) | chapters (texto), urls (para liberar) } */
  async function open(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (str(b, 0, 5) === '%PDF-') return openPdf(b, []);
    const book = str(b, 0, 4) === 'CONT' ? readKfx(b) : str(b, 0, 2) === 'PK' ? await readEpub(b) : readAzw3(b);
    const urls = [], made = new Map();
    const blob = (key, data, type) => { if (!made.has(key)) { const u = URL.createObjectURL(new Blob([data], { type })); urls.push(u); made.set(key, u); } return made.get(key); };
    const url = key => {
      if (typeof key === 'string' && key.startsWith('data:')) return key;
      if (book.kind === 'kfx') { const r = book.resByName.get(key); return r ? blob(key, r.bytes, r.mime) : ''; }
      if (typeof key === 'number') { if (made.has(key)) return made.get(key); const r = book.resources[key - 1]; return r && mimeOf(r) ? blob(key, r, mimeOf(r)) : ''; }
      return '';
    };
    if (book.kind === 'azw3') {   // fontes embutidas: registro FONT (zlib + XOR) -> FontFace
      for (const [k, r] of book.resources.entries()) {
        if (str(r, 0, 4) !== 'FONT') continue;
        try {
          const key = r.subarray(u32(r, 16), u32(r, 16) + u32(r, 20)), z = r.slice(u32(r, 12));
          for (let i = 0; i < Math.min(1040, z.length); i++) z[i] ^= key[i % key.length];
          const ttf = new Uint8Array(await new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
          made.set(k + 1, blob('font' + k, ttf, 'font/ttf')); book.hasFonts = true;
        } catch (e) { /* fonte ilegível: o Kindle usaria a dele */ }
      }
    }
    const out = { kind: book.kind, title: book.title, authors: book.authors, fixed: book.fixed, rtl: book.rtl, toc: book.toc, urls, hasFonts: !!book.hasFonts };
    if (book.kind === 'epub') {
      out.chapters = await epubChapters(book, blob);
      out.cover = book.coverHref && made.get(book.coverHref) || '';
    } else {
      out.cover = book.kind === 'azw3' ? (book.cover != null ? url(book.cover + 1) : '') : (book.coverName ? url(book.coverName) : '');
      if (book.fixed) out.pages = fixedPages(book, url); else out.chapters = textChapters(book, url);
    }
    out.close = () => urls.forEach(u => URL.revokeObjectURL(u));
    return out;
  }

  return { open, _readAzw3: readAzw3, _readKfx: readKfx, _readEpub: readEpub, _palmDecompress: palmDecompress };
})();
