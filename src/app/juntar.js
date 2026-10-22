  // src/app/juntar.js: Juntar PDFs (com marcadores) ou EPUBs (com sumário) e leitura/gravação dos marcadores de um PDF.
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/juntar.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- juntar PDFs ou EPUBs ----------
  const stem = f => f.name.replace(/\.(pdf|epub|cbz|cbr|jpe?g|png|webp|gif|bmp|avif)$/i, '');
  async function kindOf(f) {
    const head = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
    const s = String.fromCharCode(...head);
    return s.includes('%PDF-') ? 'pdf' : s.startsWith('PK') ? 'epub' : null;
  }
  function guessTitle(list) {
    const names = list.map(stem);
    let p = names[0];
    for (const n of names) {
      let i = 0;
      while (i < p.length && i < n.length && p[i].toLowerCase() === n[i].toLowerCase()) i++;
      p = p.slice(0, i);
    }
    p = p.replace(/[^\p{L}\p{N}]+$/u, '').replace(/\s+\d+$/, '').replace(/[^\p{L}]+$/u, '');
    return p.length >= 3 ? p : names[0] + (names.length > 1 ? ` (+${names.length - 1})` : '');
  }

  async function pdfOutline(bytes, count) {   // marcadores do PDF: [{ title, page, items }]
    initPdfjs();
    let doc;
    try {
      doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      const walk = async list => {
        const out = [];
        for (const it of list || []) {
          let page = null;
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await doc.getDestination(dest);
            if (Array.isArray(dest) && dest[0] != null) page = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0];
          } catch (e) {}
          const title = (it.title || '').replace(/\s+/g, ' ').trim(), items = await walk(it.items);
          if (title && page != null && page >= 0 && page < count) out.push({ title, page, items });
          else out.push(...items);
        }
        return out;
      };
      return await walk(await doc.getOutline());
    } catch (e) { return []; }
    finally { if (doc) doc.destroy(); }
  }

  function writeOutline(out, tops) {   // marcadores: [{ title, page, items }], com page = índice no PDF de saída
    const { PDFName, PDFHexString } = PDFLib;
    const ctx = out.context, pgs = out.getPages(), rootRef = ctx.nextRef();
    const build = (nodes, parent) => {
      const refs = nodes.map(() => ctx.nextRef());
      nodes.forEach((n, i) => {
        const d = { Title: PDFHexString.fromText(n.title), Parent: parent, Dest: [pgs[Math.min(Math.max(n.page, 0), pgs.length - 1)].ref, 'Fit'] };
        if (i) d.Prev = refs[i - 1];
        if (i < nodes.length - 1) d.Next = refs[i + 1];
        if (n.items.length) { const k = build(n.items, refs[i]); d.First = k.first; d.Last = k.last; d.Count = -n.items.length; }
        ctx.assign(refs[i], ctx.obj(d));
      });
      return { first: refs[0], last: refs[refs.length - 1] };
    };
    const k = build(tops, rootRef);
    ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: k.first, Last: k.last, Count: tops.length }));
    out.catalog.set(PDFName.of('Outlines'), rootRef);
    out.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  }

  async function mergePdfs(list, title, say) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    const tops = [];
    for (let i = 0; i < list.length; i++) {
      say(`Juntando ${i + 1} de ${list.length}…`); setItem(i, 'Lendo…'); await tick();
      const bytes = new Uint8Array(await list[i].arrayBuffer());
      let src;
      try { src = await PDFDocument.load(bytes, { updateMetadata: false }); }
      catch (e) { throw new Error(`${list[i].name}: ` + (/encrypt/i.test(e.name + e.message) ? 'PDF protegido por senha.' : 'não consegui ler este PDF.')); }
      const start = out.getPageCount(), n = src.getPageCount();
      (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
      const shift = ns => ns.map(x => ({ title: x.title, page: x.page + start, items: shift(x.items) }));
      tops.push({ title: stem(list[i]), page: start, items: shift(await pdfOutline(bytes, n)) });
      setItem(i, `✓ ${n} ${n > 1 ? 'páginas' : 'página'}`, 'ok'); await tick();
    }
    writeOutline(out, tops);   // um marcador por arquivo, com os marcadores originais dentro
    out.setTitle(pdfTitle(title)); out.setProducer('Converterias'); out.setCreator('Converterias');
    say('Gerando o PDF…'); await tick();
    const bytes = await out.save();
    return { bytes, pages: out.getPageCount(), title, authors: [] };
  }

  const urlEnc = p => p.split('/').map(encodeURIComponent).join('/');
  async function mergeEpubs(list, title, say) {
    const xml = (s, type = 'application/xml') => new DOMParser().parseFromString(s, type);
    const kids = (e, name) => [...e.children].filter(c => c.localName === name);
    const out = new JSZip();
    out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });   // tem de ser o primeiro do zip
    const man = [], spine = [], books = [], authors = [];
    let lang = '', coverId = null;
    for (let i = 0; i < list.length; i++) {
      say(`Juntando ${i + 1} de ${list.length}…`); setItem(i, 'Lendo…'); await tick();
      const p = 'b' + (i + 1) + '_', dir = 'b' + (i + 1) + '/';
      const fail = m => new Error(`${list[i].name}: ${m}`);
      let zip;
      try { zip = await JSZip.loadAsync(list[i]); } catch (e) { throw fail('não consegui abrir este EPUB.'); }
      const lower = new Map(Object.keys(zip.files).map(n => [n.toLowerCase(), n]));
      const find = q => zip.file(q) || (lower.has(q.toLowerCase()) ? zip.file(lower.get(q.toLowerCase())) : null);
      const cont = find('META-INF/container.xml');
      if (!cont) throw fail('não parece um EPUB válido (sem container.xml).');
      const opfPath = xml(await cont.async('string')).querySelector('rootfile').getAttribute('full-path');
      const opfFile = find(opfPath);
      if (!opfFile) throw fail('EPUB sem arquivo de pacote (.opf).');
      const opf = xml(await opfFile.async('string'));
      const items = new Map();
      opf.querySelectorAll('manifest > item').forEach(it => {
        const href = it.getAttribute('href') || '';
        items.set(it.getAttribute('id'), { id: it.getAttribute('id'), remote: /^[a-z][a-z0-9+.-]*:/i.test(href), href,
          path: resolve(opfPath, href), type: it.getAttribute('media-type') || '', props: (it.getAttribute('properties') || '').split(/\s+/).filter(Boolean),
          fallback: it.getAttribute('fallback') });
      });
      const refs = [...opf.querySelectorAll('spine > itemref')].filter(r => items.has(r.getAttribute('idref')));
      if (!refs.length) throw fail('EPUB sem conteúdo no spine.');
      const meta = sel => { const e = opf.querySelector(sel); return e ? e.textContent.trim() : ''; };
      const bookTitle = meta('metadata > title, dc\\:title') || stem(list[i]);
      let creators = [...opf.querySelectorAll('metadata > creator, dc\\:creator')];
      const only = creators.filter(c => { const r = c.getAttribute('opf:role'); return !r || r === 'aut'; });
      if (only.length) creators = only;
      creators.map(c => c.textContent.trim()).filter(Boolean).forEach(a => { if (!authors.includes(a)) authors.push(a); });
      if (!lang) lang = meta('metadata > language, dc\\:language').split('-')[0].toLowerCase();

      // fontes ofuscadas (IDPF): desfaz, pois o identificador do livro muda ao juntar
      const unob = new Map();
      const enc = find('META-INF/encryption.xml');
      if (enc) {
        const uidRef = opf.documentElement.getAttribute('unique-identifier');
        const uidEl = uidRef && [...opf.querySelectorAll('metadata > identifier, dc\\:identifier')].find(e => e.getAttribute('id') === uidRef);
        const uid = uidEl ? uidEl.textContent.replace(/[ \u0009\u000d\u000a]/g, '') : '';
        for (const ed of xml(await enc.async('string')).getElementsByTagNameNS('*', 'EncryptedData')) {
          const alg = (ed.getElementsByTagNameNS('*', 'EncryptionMethod')[0] || {}).getAttribute?.('Algorithm') || '';
          const ref = ed.getElementsByTagNameNS('*', 'CipherReference')[0];
          if (!ref) continue;
          if (alg !== 'http://www.idpf.org/2008/embedding' || !uid) throw fail('EPUB com proteção (DRM): não dá para juntar.');
          let u = ref.getAttribute('URI'); try { u = decodeURIComponent(u); } catch (e) {}
          unob.set(u.replace(/^\//, ''), new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(uid))));
        }
      }

      // sumário original: nav (EPUB 3) ou NCX (EPUB 2)
      const navItem = [...items.values()].find(m => m.props.includes('nav'));
      const ncxItem = items.get(opf.querySelector('spine')?.getAttribute('toc')) || [...items.values()].find(m => m.type === 'application/x-dtbncx+xml');
      const target = (base, href) => { const [h, frag] = (href || '').split('#'); const path = h ? resolve(base, h) : base; return { path, frag }; };
      let toc = [];
      try {
        if (navItem && find(navItem.path)) {
          const raw = await find(navItem.path).async('string');
          let d = xml(raw, 'application/xhtml+xml'); if (d.querySelector('parsererror')) d = new DOMParser().parseFromString(raw, 'text/html');
          const navs = [...d.getElementsByTagName('nav')];
          const nv = navs.find(n => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || navs[0];
          const walk = ol => kids(ol, 'li').map(li => {
            const a = kids(li, 'a')[0] || kids(li, 'span')[0], sub = kids(li, 'ol')[0];
            return { title: a ? a.textContent.replace(/\s+/g, ' ').trim() : '', ...(a && a.getAttribute('href') ? target(navItem.path, a.getAttribute('href')) : {}), items: sub ? walk(sub) : [] };
          });
          if (nv && kids(nv, 'ol')[0]) toc = walk(kids(nv, 'ol')[0]);
        } else if (ncxItem && find(ncxItem.path)) {
          const d = xml(await find(ncxItem.path).async('string'));
          const walk = parent => kids(parent, 'navPoint').map(np => {
            const t = np.querySelector('navLabel > text'), c = kids(np, 'content')[0];
            return { title: t ? t.textContent.replace(/\s+/g, ' ').trim() : '', ...(c ? target(ncxItem.path, c.getAttribute('src')) : {}), items: walk(np) };
          });
          const nm = d.getElementsByTagName('navMap')[0];
          if (nm) toc = walk(nm);
        }
      } catch (e) { console.warn('sumário ilegível', e); }

      // arquivos
      const cov = i === 0 && ([...items.values()].find(m => m.props.includes('cover-image')) || items.get(opf.querySelector('meta[name=cover]')?.getAttribute('content')));
      if (cov) coverId = p + cov.id;
      const first = items.get(refs[0].getAttribute('idref'));
      const inSpine = new Set(refs.map(r => r.getAttribute('idref')));
      const have = new Set();
      for (const m of items.values()) {
        if (m.type === 'application/x-dtbncx+xml' || m.type === 'application/smil+xml' || (m === navItem && !inSpine.has(m.id))) continue;
        const props = m.props.filter(x => x !== 'nav' && x !== 'cover-image');
        if (m === cov) props.push('cover-image');
        let data = null;
        if (!m.remote && /xhtml/.test(m.type) && find(m.path)) {   // EPUB 3 exige declarar svg, mathml e scripts
          data = await find(m.path).async('uint8array');
          const s = new TextDecoder().decode(data);
          for (const [re, pr] of [[/<svg[\s>]/i, 'svg'], [/<(m:)?math[\s>]/i, 'mathml'], [/<script[\s>]/i, 'scripted']]) if (re.test(s) && !props.includes(pr)) props.push(pr);
        }
        let attrs = `id="${p}${xesc(m.id)}" href="${m.remote ? xesc(m.href) : dir + urlEnc(m.path)}" media-type="${xesc(m.type)}"${props.length ? ` properties="${props.join(' ')}"` : ''}`;
        if (m.fallback && items.has(m.fallback)) attrs += ` fallback="${p}${xesc(m.fallback)}"`;
        if (!m.remote) {
          const f = find(m.path);
          if (!f) continue;
          data = data || await f.async('uint8array');
          if (unob.has(m.path)) { const key = unob.get(m.path); data = data.slice(); for (let k = 0; k < Math.min(1040, data.length); k++) data[k] ^= key[k % key.length]; }
          else if (/xhtml/.test(m.type)) {   // EPUB 2: DOCTYPE do XHTML 1.1 vira o do EPUB 3
            const s = new TextDecoder().decode(data);
            if (/<!DOCTYPE\s+html\s+PUBLIC/i.test(s)) data = new TextEncoder().encode(s.replace(/<!DOCTYPE\s+html\s+PUBLIC[^>]*>/i, '<!DOCTYPE html>'));
          }
          out.file('OEBPS/' + dir + m.path, data, { compression: /^(image\/(jpeg|png|gif|webp)|audio|video|font|application\/(font|vnd\.ms-opentype))/.test(m.type) ? 'STORE' : 'DEFLATE' });
          have.add(m.path);
        }
        man.push(`<item ${attrs}/>`);
      }
      refs.forEach(r => {
        const id = r.getAttribute('idref');
        if (items.get(id).remote || have.has(items.get(id).path))
          spine.push(`<itemref idref="${p}${xesc(id)}"${r.getAttribute('linear') === 'no' ? ' linear="no"' : ''}${r.getAttribute('properties') ? ` properties="${xesc(r.getAttribute('properties'))}"` : ''}/>`);
      });
      const firstHref = have.has(first.path) ? dir + urlEnc(first.path) : null;
      books.push({ title: bookTitle, href: firstHref, items: toc, dir, have });
      setItem(i, `✓ ${refs.length} ${refs.length > 1 ? 'seções' : 'seção'}`, 'ok'); await tick();
    }
    if (coverId && !man.some(s => s.startsWith(`<item id="${coverId}" `))) coverId = null;
    if (!lang) lang = 'pt';

    // sumário novo: um item por livro, com o sumário original dentro
    const link = (b, n) => n.path && b.have.has(n.path) ? b.dir + urlEnc(n.path) + (n.frag ? '#' + n.frag : '') : null;
    const clean = (b, ns) => ns.flatMap(n => {
      const items = clean(b, n.items), href = link(b, n);
      return n.title && href ? [{ title: n.title, href, items }] : items;
    });
    const tree = books.map(b => ({ title: b.title, href: b.href, items: clean(b, b.items) })).filter(n => n.href);
    const navOl = ns => `<ol>${ns.map(n => `<li><a href="${xesc(n.href)}">${xesc(n.title)}</a>${n.items.length ? navOl(n.items) : ''}</li>`).join('')}</ol>`;
    let order = 0, pid = 0; const played = new Map();
    const ncx = ns => ns.map(n => { const o = played.get(n.href) || played.set(n.href, ++order).get(n.href); return `<navPoint id="n${++pid}" playOrder="${o}"><navLabel><text>${xesc(n.title)}</text></navLabel><content src="${xesc(n.href)}"/>${ncx(n.items)}</navPoint>`; }).join('');
    const tocName = { pt: 'Sumário', en: 'Contents', es: 'Índice', fr: 'Sommaire', de: 'Inhalt', it: 'Indice', ru: 'Содержание', zh: '目录', ja: '目次', ko: '목차', ar: 'المحتويات', he: 'תוכן עניינים', el: 'Περιεχόμενα' }[lang] || 'Contents';
    const id = 'urn:uuid:' + uuid();
    out.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    out.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${xesc(tocName)}</title></head>
<body><nav epub:type="toc" id="toc"><h1>${xesc(tocName)}</h1>${navOl(tree)}</nav></body>
</html>`);
    out.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${xesc(title)}</text></docTitle><navMap>${ncx(tree)}</navMap></ncx>`);
    out.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${id}</dc:identifier>
<dc:title>${xesc(title)}</dc:title>
${authors.map(a => `<dc:creator>${xesc(a)}</dc:creator>`).join('\n')}
<dc:language>${lang}</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
${coverId ? `<meta name="cover" content="${xesc(coverId)}"/>` : ''}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${man.join('\n')}
</manifest>
<spine toc="ncx"${['ar', 'he'].includes(lang) ? ' page-progression-direction="rtl"' : ''}>
${spine.join('\n')}
</spine>
</package>`);
    say('Gerando o EPUB…'); await tick();
    const bytes = await out.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
    return { bytes, chapters: spine.length, title, authors };
  }
