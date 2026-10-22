  // src/app/epub2pdf.js: EPUB → PDF: o XHTML vira blocos (buildBlocks) e os blocos são diagramados no PDF com pdf-lib (epubToPdf).
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/epub2pdf.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- EPUB -> blocos ----------
  function buildBlocks(root, itemHref, blocks) {
    let cur = null;
    const trim = p => {
      const t = p.toks;
      while (t.length && t[0].sp) t.shift();
      while (t.length && t[t.length - 1].sp) t.pop();
    };
    const flush = () => { if (cur) { trim(cur); if (cur.toks.length) blocks.push(cur); cur = null; } };
    const ensure = ctx => {
      if (!cur) {
        let label = null;
        if (ctx.lab && !ctx.lab.used) { ctx.lab.used = true; label = ctx.lab.text; }
        cur = { t: 'p', kind: ctx.kind, align: ctx.align, quote: ctx.quote, label, pre: ctx.pre, toks: [] };
      }
      return cur;
    };
    const addSp = () => {
      if (!cur) return;
      const l = cur.toks[cur.toks.length - 1];
      if (l && !l.sp && !l.br) cur.toks.push({ sp: true });
    };
    const addWord = (w, ctx) => {
      const p = ensure(ctx);
      const l = p.toks[p.toks.length - 1];
      const part = { w, f: ctx.f, sup: ctx.sup };
      if (l && !l.sp && !l.br) l.parts.push(part); else p.toks.push({ parts: [part] });
    };
    const addText = (txt, ctx) => {
      txt = txt.replace(/[­​‌‍﻿]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
      if (ctx.pre) {
        txt.split('\n').forEach((line, i) => {
          if (i) ensure(ctx).toks.push({ br: true });
          line.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).forEach((w, k) => { if (k) addSp(); addWord(w, ctx); });
        });
        return;
      }
      const s = txt.replace(/\s+/g, ' ');
      if (!s.trim()) { if (s && cur) addSp(); return; }
      if (s[0] === ' ') addSp();
      s.trim().split(' ').forEach((w, i) => { if (i) addSp(); addWord(w, ctx); });
      if (s.endsWith(' ')) addSp();
    };

    const walk = (node, ctx) => {
      if (node.nodeType === 3) { addText(node.nodeValue, ctx); return; }
      if (node.nodeType !== 1) return;
      const tag = (node.localName || node.nodeName).toLowerCase();
      if (SKIP.has(tag) || node.hasAttribute('hidden')) return;
      const nid = node.getAttribute('id');   // destino de link/sumário: em que página cai (marcadores do PDF)
      if (nid) { const full = itemHref + '#' + nid; if (cur) (cur.ids || (cur.ids = [])).push(full); else blocks.push({ t: 'anchor', id: full }); }

      if (tag === 'img' || tag === 'image') {
        const v = node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href');
        if (v && !/^data:/i.test(v)) { flush(); blocks.push({ t: 'img', path: resolve(itemHref, v) }); }
        return;
      }
      if (tag === 'br') { if (cur) cur.toks.push({ br: true }); return; }
      if (tag === 'hr') { flush(); blocks.push({ t: 'hr' }); return; }

      let c = ctx;
      const style = node.getAttribute('style') || '', cls = node.getAttribute('class') || '';
      if (/text-align\s*:\s*center/i.test(style) || /center/i.test(cls) || node.getAttribute('align') === 'center') c = { ...c, align: 'center' };
      else if (/text-align\s*:\s*right/i.test(style) || /\bright\b/i.test(cls)) c = { ...c, align: 'right' };

      if (/^h[1-6]$/.test(tag)) {
        flush();
        walkKids(node, { ...c, kind: tag, f: c.f | 2, align: 'center' });
        flush(); return;
      }
      if (tag === 'em' || tag === 'i' || tag === 'cite' || tag === 'dfn' || tag === 'var') c = { ...c, f: c.f | 1 };
      else if (tag === 'strong' || tag === 'b') c = { ...c, f: c.f | 2 };
      else if (tag === 'sup') c = { ...c, sup: 1 };
      else if (tag === 'sub') c = { ...c, sup: -1 };
      else if (tag === 'td' || tag === 'th') { addSp(); walkKids(node, c); addSp(); return; }
      else if (tag === 'ul' || tag === 'ol') { flush(); walkKids(node, { ...c, list: { ol: tag === 'ol', n: 0 } }); flush(); return; }
      else if (tag === 'li') {
        flush();
        const L = c.list || { ol: false, n: 0 };
        L.n++;
        walkKids(node, { ...c, kind: 'li', lab: { text: L.ol ? L.n + '.' : '•', used: false } });
        flush(); return;
      }
      else if (tag === 'blockquote') { flush(); walkKids(node, { ...c, quote: c.quote + 1 }); flush(); return; }
      else if (tag === 'pre') { flush(); walkKids(node, { ...c, pre: true, align: 'left' }); flush(); return; }

      if (BLOCK.has(tag)) { flush(); walkKids(node, c); flush(); return; }
      walkKids(node, c);
    };
    const walkKids = (node, ctx) => { for (const ch of node.childNodes) walk(ch, ctx); };

    walkKids(root, { f: 0, sup: 0, kind: 'p', align: null, quote: 0, pre: false, list: null, lab: null });
    flush();
  }

  // ---------- conversão EPUB -> PDF ----------
  async function epubToPdf(file, say) {
    {
      say('Lendo o arquivo…'); await tick();
      const zip = await JSZip.loadAsync(file);
      const names = Object.keys(zip.files);
      const lower = new Map(names.map(n => [n.toLowerCase(), n]));
      const find = p => zip.file(p) || (lower.has(p.toLowerCase()) ? zip.file(lower.get(p.toLowerCase())) : null);
      const xml = (s, type = 'application/xml') => new DOMParser().parseFromString(s, type);

      const cont = find('META-INF/container.xml');
      if (!cont) throw new Error('Não parece um EPUB válido (sem container.xml).');
      const opfPath = xml(await cont.async('string')).querySelector('rootfile').getAttribute('full-path');
      const opf = xml(await find(opfPath).async('string'));

      const manifest = {};
      opf.querySelectorAll('manifest > item').forEach(it => {
        manifest[it.getAttribute('id')] = {
          href: resolve(opfPath, it.getAttribute('href')), type: it.getAttribute('media-type'),
          props: it.getAttribute('properties') || ''
        };
      });
      let spine = [...opf.querySelectorAll('spine > itemref')]
        .map(r => ({ id: r.getAttribute('idref'), linear: r.getAttribute('linear') !== 'no' }))
        .filter(r => manifest[r.id]);
      const linear = spine.filter(r => r.linear);
      if (linear.length) spine = linear;
      if (!spine.length) throw new Error('EPUB sem conteúdo no spine.');
      const meta = sel => { const e = opf.querySelector(sel); return e ? e.textContent.trim() : ''; };
      const title = meta('metadata > title, dc\\:title') || file.name.replace(/\.epub$/i, '');
      let creators = [...opf.querySelectorAll('metadata > creator, dc\\:creator')];
      const authorsOnly = creators.filter(c => { const r = c.getAttribute('opf:role'); return !r || r === 'aut'; });
      if (authorsOnly.length) creators = authorsOnly;
      const authors = creators.map(c => c.textContent.trim()).filter(Boolean);
      const author = authors.join(', ');

      // capa
      let coverPath = null;
      const ci = Object.values(manifest).find(m => /cover-image/.test(m.props));
      if (ci) coverPath = ci.href;
      else {
        const mc = opf.querySelector('meta[name=cover]');
        if (mc && manifest[mc.getAttribute('content')]) coverPath = manifest[mc.getAttribute('content')].href;
      }
      const isImg = m => /^image\//.test(m.type || '');
      if (!coverPath && opf.querySelector('meta[name=cover]')) {   // meta cover aponta para id inexistente: tenta pelo nome
        const cn = opf.querySelector('meta[name=cover]').getAttribute('content');
        const m = Object.values(manifest).find(m => isImg(m) && (m.href.toLowerCase().includes(cn.toLowerCase()) || /cover|capa/i.test(m.href)));
        if (m) coverPath = m.href;
      }
      if (!coverPath) {   // guide/reference type=cover -> 1ª imagem da página de capa
        const ref = opf.querySelector('guide > reference[type=cover]');
        if (ref) {
          const cp = resolve(opfPath, ref.getAttribute('href'));
          const cf = find(cp);
          if (cf) {
            const mm = (await cf.async('string')).match(/(?:src|href)\s*=\s*["']([^"']+\.(?:jpe?g|png|gif|webp|svg))["']/i);
            if (mm) coverPath = resolve(cp, mm[1]);
          }
        }
      }
      if (!coverPath) {   // último recurso: imagem do manifesto com "cover"/"capa" no nome
        const m = Object.values(manifest).find(m => isImg(m) && /(^|[\/_.-])(cover|capa)\b/i.test(m.href));
        if (m) coverPath = m.href;
      }

      // conteúdo -> blocos
      const blocks = [];
      for (let i = 0; i < spine.length; i++) {
        say(`Lendo capítulo ${i + 1} de ${spine.length}…`); await tick();
        const item = manifest[spine[i].id];
        const f = find(item.href);
        if (!f) continue;
        const raw = await f.async('string');
        let doc = xml(raw, /html/.test(item.type) ? 'application/xhtml+xml' : 'text/html');
        if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(raw, 'text/html');
        const root = doc.querySelector('body') || doc.documentElement;
        blocks.push({ t: 'chap', href: item.href });
        buildBlocks(root, item.href, blocks);
      }
      // sumário do livro (nav do EPUB 3 ou toc.ncx do EPUB 2) -> marcadores do PDF
      const toc = [], tocTarget = (base, href) => { const h = href.split('#'); let f = h[1] || ''; try { f = decodeURIComponent(f); } catch (e) {} return resolve(base, h[0] || base.split('/').pop()) + (f ? '#' + f : ''); };
      try {
        const navItem = Object.values(manifest).find(m => /\bnav\b/.test(m.props)), navF = navItem && find(navItem.href);
        const navDoc = navF && xml(await navF.async('string'), 'application/xhtml+xml');
        const navEl = navDoc && [...navDoc.getElementsByTagNameNS('*', 'nav')].find(n => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || ''));
        const ol0 = navEl && [...navEl.getElementsByTagNameNS('*', 'ol')][0];
        const fromOl = ol => [...ol.children].filter(e => e.localName === 'li').map(li => {
          const a = [...li.children].find(e => e.localName === 'a' || e.localName === 'span'), sub = [...li.children].find(e => e.localName === 'ol');
          return { title: a ? a.textContent.replace(/\s+/g, ' ').trim() : '', target: a && a.getAttribute('href') ? tocTarget(navItem.href, a.getAttribute('href')) : null, items: sub ? fromOl(sub) : [] };
        });
        if (ol0) toc.push(...fromOl(ol0));
        else {
          const tocId = (opf.querySelector('spine') || { getAttribute: () => null }).getAttribute('toc');
          const ncx = manifest[tocId] || Object.values(manifest).find(m => m.type === 'application/x-dtbncx+xml'), ncxF = ncx && find(ncx.href);
          const nd = ncxF && xml(await ncxF.async('string'));
          const fromPts = el => [...el.children].filter(e => e.localName === 'navPoint').map(np => {
            const lab = np.getElementsByTagNameNS('*', 'text')[0], c = np.getElementsByTagNameNS('*', 'content')[0];
            return { title: lab ? lab.textContent.replace(/\s+/g, ' ').trim() : '', target: c ? tocTarget(ncx.href, c.getAttribute('src') || '') : null, items: fromPts(np) };
          });
          const map = nd && nd.getElementsByTagNameNS('*', 'navMap')[0];
          if (map) toc.push(...fromPts(map));
        }
      } catch (e) { console.warn('sumário ignorado', e); }

      const useCover = $('cover').checked && coverPath;
      if (useCover) {  // a capa vira a 1ª página; remove a repetição nos primeiros capítulos
        let chaps = 0;
        for (let i = 0; i < blocks.length; i++) {
          if (blocks[i].t === 'chap') { if (++chaps > 2) break; }
          else if (blocks[i].t === 'img' && blocks[i].path === coverPath) { blocks.splice(i, 1); i--; }
        }
      }
      if (!blocks.some(b => b.t === 'p')) throw new Error('Não consegui extrair texto do EPUB.');

      // ---------- PDF ----------
      say('Preparando fontes…'); await tick();
      const { PDFDocument } = PDFLib;
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
      const mk = async (key, id) => {
        const font = await pdf.embedFont(b64(FONT_DATA[key]), { subset: true });
        return { id, font, cs: new Set(font.getCharacterSet()) };
      };
      const Fr = await mk('r', 1), Fi = await mk('i', 2), Fb = await mk('b', 3), Fbi = await mk('bi', 4),
            Frx = await mk('rx', 5), Fix = await mk('ix', 6), Frg = await mk('rg', 7), Fig = await mk('ig', 8);
      const FS = { r: [Fr, Frx, Frg], i: [Fi, Fix, Fig], b: [Fb, Frx, Frg], bi: [Fbi, Fix, Fig] };

      const memo = new Map();
      const measure = (F, text, size) => {
        const k = F.id + '|' + size + '|' + text;
        let w = memo.get(k);
        if (w === undefined) { w = F.font.widthOfTextAtSize(text, size); memo.set(k, w); }
        return w;
      };
      const segsOf = tok => {
        const out = [];
        for (const part of tok.parts) {
          const key = (part.f & 2) ? ((part.f & 1) ? 'bi' : 'b') : ((part.f & 1) ? 'i' : 'r');
          const list = FS[key], k = part.sup ? 0.62 : 1, rise = part.sup > 0 ? 0.36 : part.sup < 0 ? -0.12 : 0;
          const push = ch => {
            const F = list.find(x => x.cs.has(ch.codePointAt(0)));
            if (!F) return;
            const l = out[out.length - 1];
            if (l && l.F === F && l.k === k && l.rise === rise) l.text += ch; else out.push({ F, text: ch, k, rise });
          };
          for (const ch of part.w) {
            if (list.some(x => x.cs.has(ch.codePointAt(0)))) { push(ch); continue; }
            const n = ch.normalize('NFKC');
            if (n !== ch) { [...n].forEach(push); continue; }   // ligaduras etc.
            const base = ch.normalize('NFD').replace(/\p{M}/gu, '');   // acentos que a fonte não tem: usa a letra base
            if (base && base !== ch) [...base].forEach(push);          // o que ainda não existir é descartado
          }
        }
        return out;
      };
      const wordW = (tok, size) => {
        if (!tok.segs) tok.segs = segsOf(tok);
        let w = 0;
        for (const s of tok.segs) w += measure(s.F, s.text, size * s.k);
        return w;
      };
      const splitLong = (tok, size, maxW) => {   // palavra maior que a linha (ex.: URL)
        const pieces = []; let segs = [], w = 0;
        for (const s of tok.segs) for (const ch of s.text) {
          const cw = measure(s.F, ch, size * s.k);
          if (w + cw > maxW && segs.length) { pieces.push({ segs }); segs = []; w = 0; }
          const l = segs[segs.length - 1];
          if (l && l.F === s.F && l.k === s.k && l.rise === s.rise) l.text += ch; else segs.push({ F: s.F, text: ch, k: s.k, rise: s.rise });
          w += cw;
        }
        if (segs.length) pieces.push({ segs });
        pieces.forEach((p, i) => { if (i) p.glue = true; });
        return pieces;
      };

      const [W, H] = PAGES[$('size').value] || PAGES.letter;
      const num = (id, d) => { const v = parseFloat($(id).value); return isNaN(v) ? d : Math.max(0, v); };
      const mT = num('mt', 25.5) * MM, mL = num('ms', 27.2) * MM, mB = num('mb', 31) * MM;
      const body = Math.min(30, Math.max(6, num('font', 15)));
      const justify = $('just').checked;
      const textW = W - 2 * mL;
      if (textW < 60 || H - mT - mB < 60) throw new Error('Margens grandes demais para esse tamanho de página.');
      const bodyLh = body * 1.4;
      const HS = { h1: 1.413, h2: 1.2, h3: 1.1, h4: 1.05, h5: 1.0, h6: 1.0 };

      const breakLines = (toks, size, w1, w) => {
        const lines = []; let L = { words: [], width: 0, forced: false }, avail = w1;
        const spw = measure(Fr, ' ', size);
        const push = forced => { L.forced = forced; lines.push(L); L = { words: [], width: 0, forced: false }; avail = w; };
        for (const t of toks) {
          if (t.br) { push(true); continue; }
          if (t.sp) continue;
          const pieces = wordW(t, size) > w ? splitLong(t, size, w) : [t];
          for (const q of pieces) {
            const ww = wordW(q, size);
            const gap = L.words.length && !q.glue ? spw : 0;
            if (L.words.length && L.width + gap + ww > avail) { push(false); L.words.push({ t: q, w: ww, gap: 0 }); L.width = ww; }
            else { L.words.push({ t: q, w: ww, gap }); L.width += gap + ww; }
          }
        }
        if (L.words.length) { L.forced = true; lines.push(L); }
        return lines;
      };

      // imagens
      const imgCache = new Map();
      const getImage = async path => {
        if (imgCache.has(path)) return imgCache.get(path);
        let res = null;
        try {
          const f = find(path);
          if (f) {
            const bytes = await f.async('uint8array');
            const ext = path.split('.').pop().toLowerCase();
            let img = null;
            try {
              if (ext === 'png') img = await pdf.embedPng(bytes);
              else if (ext === 'jpg' || ext === 'jpeg') img = await pdf.embedJpg(bytes);
            } catch (e) { img = null; }
            if (!img) {   // gif/webp/svg/jpeg exótico -> converte via canvas
              const mime = { gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || 'image/*';
              const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
              const im = new Image();
              await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = url; });
              const cw = im.naturalWidth || 800, ch = im.naturalHeight || 600;
              const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
              const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(im, 0, 0, cw, ch);
              URL.revokeObjectURL(url);
              const png = await new Promise(r => cv.toBlob(r, 'image/png'));
              img = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()));
            }
            res = { img, w: img.width, h: img.height };
          }
        } catch (e) { console.warn('imagem ignorada', path, e); }
        imgCache.set(path, res);
        return res;
      };

      let page = null, y = 0;
      const newPage = () => { page = pdf.addPage([W, H]); y = H - mT; };

      if (useCover) {
        const im = await getImage(coverPath);
        if (im) {
          // página da capa com a proporção da própria imagem (mesma largura das demais): sem faixas brancas e sem distorcer
          const ch = Math.min(Math.max(W * im.h / im.w, W * 0.5), H * 2);
          const p = pdf.addPage([W, ch]);
          p.drawImage(im.img, { x: 0, y: 0, width: W, height: ch });
        }
      }

      // destinos (arquivo e arquivo#id) -> página onde o conteúdo seguinte começa; títulos, para quando não há sumário
      const firstPage = pdf.getPageCount(), at = new Map(), heads = [];
      let pend = [];
      const land = ids => { const k = pdf.getPageCount() - 1; for (const id of pend.concat(ids || [])) if (!at.has(id)) at.set(id, k); pend = []; };
      let needNew = true, firstInChap = true, prevHeading = false, n = 0;
      for (const b of blocks) {
        if (++n % 40 === 0) { say(`Montando páginas… ${Math.round(100 * n / blocks.length)}%`); await tick(); }
        if (b.t === 'chap') { needNew = true; firstInChap = true; prevHeading = false; pend.push(b.href); continue; }
        if (b.t === 'anchor') { pend.push(b.id); continue; }
        if (needNew || !page) { newPage(); needNew = false; }

        if (b.t === 'hr') { y -= bodyLh / 2; continue; }
        if (b.t === 'img') {
          const im = await getImage(b.path);
          if (!im) continue;
          const s = Math.min(1, textW / (im.w * 0.75), (H - mT - mB) / (im.h * 0.75));
          const dw = im.w * 0.75 * s, dh = im.h * 0.75 * s;
          if (y - dh < mB && y < H - mT - 1) newPage();
          land();
          page.drawImage(im.img, { x: mL + (textW - dw) / 2, y: y - dh, width: dw, height: dh });
          y -= dh + bodyLh * 0.6; firstInChap = false; prevHeading = false;
          continue;
        }

        // parágrafo / título
        const isH = /^h[1-6]$/.test(b.kind);
        const size = isH ? body * HS[b.kind] : body, lh = isH ? size * 1.3 : size * 1.4;
        const off = b.quote * 2 * body + (b.label ? 1.5 * body : 0);
        const w = textW - off;
        const align = isH ? 'center' : (b.align || (b.pre ? 'left' : (justify ? 'justify' : 'left')));
        const indent = (!isH && !b.label && !b.quote && !b.pre && !prevHeading && !firstInChap && align !== 'center') ? 1.5 * size : 0;
        const lines = breakLines(b.toks, size, w - indent, w);

        if (isH) {
          const atTop = y >= H - mT - 1;
          const before = atTop ? (firstInChap ? bodyLh * 2.9 : 0) : size * 1.2;
          if (!atTop && y - before - lines.length * lh - 2 * bodyLh < mB) newPage();   // título não fica sozinho no fim da página
          else y -= before;
        }
        let li = 0;
        for (const L of lines) {
          if (y - lh < mB - 0.01) newPage();
          if (li === 0) { land(b.ids); if (isH && (b.kind === 'h1' || b.kind === 'h2')) heads.push({ lvl: +b.kind[1], title: b.toks.map(t => t.parts ? t.parts.map(q => q.w).join('') : ' ').join('').replace(/\s+/g, ' ').trim(), page: pdf.getPageCount() - 1 }); }
          const baseline = y - size;
          const first = li === 0, last = li === lines.length - 1 || L.forced;
          const avail = w - (first ? indent : 0);
          let x = mL + off + (first ? indent : 0), extra = 0;
          if (align === 'center') x = mL + off + (w - L.width) / 2;
          else if (align === 'right') x = mL + off + w - L.width;
          else if (align === 'justify' && !last) {
            const gaps = L.words.filter(q => q.gap > 0).length;
            if (gaps) extra = Math.max(0, (avail - L.width) / gaps);
          }
          if (first && b.label) {
            const lw = measure(Fr, b.label, size);
            page.drawText(b.label, { x: mL + off - lw - size * 0.4, y: baseline, size, font: Fr.font });
          }
          for (const q of L.words) {
            x += q.gap > 0 ? q.gap + extra : 0;
            let sx = x;
            for (const s of q.t.segs) {
              page.drawText(s.text, { x: sx, y: baseline + s.rise * size, size: size * s.k, font: s.F.font });
              sx += measure(s.F, s.text, size * s.k);
            }
            x += q.w;
          }
          y -= lh; li++;
        }
        if (isH) y -= size * 0.6;
        prevHeading = isH; firstInChap = false;
      }

      // números de página no rodapé (a capa não conta)
      if ($('pnum').checked) {
        const ps = Math.max(7, body * 0.72), pages = pdf.getPages();
        for (let k = firstPage; k < pages.length; k++) {
          const t = String(k - firstPage + 1), tw = measure(Fr, t, ps);
          pages[k].drawText(t, { x: (W - tw) / 2, y: Math.max(ps * 0.5, mB / 2 - ps / 3), size: ps, font: Fr.font });
        }
      }
      // marcadores: o sumário do livro, cada item na página do seu destino (sem sumário: os títulos h1/h2)
      const pageOf = t => t == null ? null : at.has(t) ? at.get(t) : at.has(t.split('#')[0]) ? at.get(t.split('#')[0]) : null;
      const mark = list => list.flatMap(e => { const p = pageOf(e.target), kids = mark(e.items); return e.title && p != null ? [{ title: e.title, page: p, items: kids }] : kids; });
      let tops = mark(toc);
      if (!tops.length && heads.length) {
        const top = Math.min(...heads.map(h => h.lvl));
        tops = [];
        for (const h of heads) { const e = { title: h.title, page: h.page, items: [] }; if (h.lvl === top || !tops.length) tops.push(e); else tops[tops.length - 1].items.push(e); }
      }
      if (tops.length) writeOutline(pdf, tops);

      pdf.setTitle(pdfTitle(title)); if (author) pdf.setAuthor(author);
      pdf.setProducer('epub2pdf (local)'); pdf.setCreator('epub2pdf');
      say('Gerando o PDF…'); await tick();
      const bytes = await pdf.save();
      return { bytes, pages: pdf.getPageCount(), title, authors };
    }
  }
