  // src/app/metadados.js: Aba Metadados: editor manual, capa, busca no Open Library (src/meta.js) e gravação.
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/metadados.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- Metadados: editor manual + busca no Open Library (src/meta.js) e salvar ----------
  const MT = { title: 'mtTitle', authors: 'mtAuthors', publisher: 'mtPublisher', date: 'mtDate', isbn: 'mtIsbn', lang: 'mtLang', series: 'mtSeries', seriesIndex: 'mtSeriesIdx', rating: 'mtRating', tags: 'mtTags', description: 'mtDesc' };
  const mtGet = () => {
    const v = Object.fromEntries(Object.entries(MT).map(([k, id]) => [k, $(id).value.trim()]));
    v.authors = v.authors.split(/\s*;\s*/).filter(Boolean); v.tags = v.tags.split(/\s*,\s*/).filter(Boolean); v.rating = +v.rating || 0;
    return v;
  };
  const mtPut = v => { for (const [k, id] of Object.entries(MT)) $(id).value = Array.isArray(v[k]) ? v[k].join(k === 'tags' ? ', ' : '; ') : v[k] == null ? (k === 'rating' ? '0' : '') : v[k]; mtMarks(); };
  const mtSnap = () => ({ v: mtGet(), newCover: mt.newCover, removeCover: mt.removeCover });
  const mtPush = () => { mt.hist.push(mtSnap()); if (mt.hist.length > 80) mt.hist.shift(); };
  function mtMarks() {   // o que mudou em relação ao arquivo fica destacado
    if (!mt) return;
    const now = mtGet(), orig = mt.book.meta, same = (a, b) => (Array.isArray(a) ? a.join('|') : String(a ?? '')) === (Array.isArray(b) ? b.join('|') : String(b ?? ''));
    let n = 0;
    for (const [k, id] of Object.entries(MT)) { const d = !same(now[k], k === 'rating' ? orig.rating || 0 : orig[k]); $(id).classList.toggle('mud', d); n += d; }
    const capa = mt.newCover || mt.removeCover; n += !!capa;
    $('mtDirty').textContent = n ? `${n} ${n === 1 ? 'alteração' : 'alterações'} ainda não salva${n === 1 ? '' : 's'}` : '';
    $('mtIsbn').setCustomValidity(now.isbn && !Meta.isbn13(now.isbn) ? 'ISBN inválido' : '');
  }
  function mtCoverShow() {
    const c = mt && !mt.removeCover && (mt.newCover || mt.book.meta.cover), img = $('mtCover');
    if (mt && mt.coverUrl) { URL.revokeObjectURL(mt.coverUrl); mt.coverUrl = null; }
    if (!c) { img.hidden = true; $('mtCoverInfo').textContent = mt && mt.removeCover ? 'Sem capa (a atual sai ao salvar).' : 'Sem capa.'; }
    else {
      mt.coverUrl = URL.createObjectURL(new Blob([c.bytes], { type: c.type })); img.src = mt.coverUrl; img.hidden = false;
      $('mtCoverInfo').textContent = mt.newCover ? `${mt.newCover.from || 'Capa nova'}${c.w ? ` (${c.w}×${c.h})` : ''}: entra no lugar da antiga ao salvar.` : 'Capa atual do livro.';
    }
    if (mt) { $('mtCoverDel').disabled = busy || !c; $('mtCoverOrig').disabled = busy || !(mt.newCover || mt.removeCover) || !mt.book.meta.cover; }
    mtMarks();
  }
  function mtReset() {
    if (mt) { if (mt.abort) mt.abort.abort(); if (mt.coverUrl) URL.revokeObjectURL(mt.coverUrl); }
    mt = null; $('optMeta').querySelectorAll('input, textarea').forEach(e => { e.value = ''; e.classList.remove('mud'); }); $('mtRating').value = '0'; $('mtRes').innerHTML = '';   // roda antes das constantes acima existirem (setMode inicial)
    $('mtCover').hidden = true; $('mtCoverInfo').textContent = 'Sem capa.'; $('mtDirty').textContent = '';
    $('mtInfo').textContent = 'Escolha um EPUB ou PDF para ver e editar os metadados.';
    $('optMeta').querySelectorAll('input, textarea, button, select').forEach(e => e.disabled = true);
    $('optMeta').querySelector('label.btnlike').classList.add('off');
  }
  function mtState() {
    if (!mt) return;
    $('optMeta').querySelectorAll('input, textarea, button, select').forEach(e => e.disabled = busy);
    $('optMeta').querySelector('label.btnlike').classList.toggle('off', busy);
    $('mtUndo').disabled = busy || !mt.hist.length;
    $('optMeta').querySelectorAll('.mt-epub').forEach(e => e.hidden = mt.book.kind !== 'epub');
    mtCoverShow();
  }
  async function mtLoad(file) {
    mtReset();
    try {
      const b = await Meta.open(new Uint8Array(await file.arrayBuffer()), file.name);
      mt = { file, book: b, hist: [], newCover: null, removeCover: false, cands: [] };
      mtPut(b.meta); mtState();
      $('mtInfo').textContent = `${file.name} · ${b.kind.toUpperCase()}`;
    } catch (e) { say(e.message || String(e), true); }
  }
  // edição à mão: cada campo alterado entra no Desfazer
  $('optMeta').addEventListener('focusin', e => { if (mt && e.target.id in Object.fromEntries(Object.values(MT).map(i => [i, 1]))) mt.focusSnap = mtSnap(); });
  $('optMeta').addEventListener('change', e => {
    if (!mt || !Object.values(MT).includes(e.target.id)) return;
    if (mt.focusSnap && JSON.stringify(mt.focusSnap.v) !== JSON.stringify(mtGet())) { mt.hist.push(mt.focusSnap); mt.focusSnap = mtSnap(); }
    mtMarks(); mtState();
  });
  $('optMeta').addEventListener('input', e => { if (mt && Object.values(MT).includes(e.target.id)) mtMarks(); });
  const mtEdit = fn => { if (!mt || busy) return; mtPush(); fn(); mtState(); say(''); };
  $('mtTc').addEventListener('click', () => mtEdit(() => { $('mtTitle').value = pdfTitle($('mtTitle').value); mtMarks(); }));
  $('mtSwap').addEventListener('click', () => mtEdit(() => { const t = $('mtTitle').value, a = $('mtAuthors').value; $('mtTitle').value = a; $('mtAuthors').value = t; mtMarks(); }));
  $('mtFromName').addEventListener('click', () => mtEdit(() => {   // "Título - Subtítulo (Autor, Autor).epub"
    const n = stem(mt.file), m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(n);
    $('mtTitle').value = (m ? m[1] : n).replace(/[_]+/g, ' ').trim();
    if (m) $('mtAuthors').value = m[2].split(/\s*,\s*/).filter(Boolean).join('; ');
    mtMarks();
  }));
  $('mtCoverFile').addEventListener('change', async () => {
    const f = $('mtCoverFile').files[0]; $('mtCoverFile').value = '';
    if (!f || !mt) return;
    try {
      const bm = await createImageBitmap(f), w = bm.width, h = bm.height; bm.close();
      if (w < 50 || h < 50) throw new Error('imagem pequena demais para capa.');
      const type = /^image\/(jpeg|png)$/.test(f.type) ? f.type : 'image/jpeg';
      let bytes = new Uint8Array(await f.arrayBuffer());
      if (type !== f.type) { const b2 = await createImageBitmap(f), cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(b2, 0, 0); b2.close(); bytes = new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.92)).arrayBuffer()); }
      mtEdit(() => { mt.newCover = { bytes, type, w, h, from: `Capa de ${f.name}` }; mt.removeCover = false; });
    } catch (e) { say('Erro: ' + (e.message || 'não consegui abrir essa imagem.'), true); }
  });
  $('mtCoverGen').addEventListener('click', async () => {   // capa simples: título e autor sobre uma cor tirada do título
    if (!mt) return;
    const v = mtGet(), W = 1200, H = 1800, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'), hue = [...(v.title || 'Livro')].reduce((a, c) => (a * 31 + c.codePointAt(0)) % 360, 7);
    const g = cx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `hsl(${hue} 35% 30%)`); g.addColorStop(1, `hsl(${hue} 40% 14%)`);
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    cx.strokeStyle = 'rgba(255,255,255,.55)'; cx.lineWidth = 6; cx.strokeRect(70, 70, W - 140, H - 140);
    cx.fillStyle = '#fff'; cx.textAlign = 'center'; cx.textBaseline = 'alphabetic';
    const wrap = (text, font, maxW) => { cx.font = font; const out = []; let line = ''; for (const w of text.split(/\s+/).filter(Boolean)) { const t = line ? line + ' ' + w : w; if (cx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
    const [main, ...subs] = (v.title || 'Livro').split(/\s+-\s+/);
    let size = 120, lines; do { lines = wrap(main, `700 ${size}px Georgia, 'Times New Roman', serif`, W - 260); size -= 8; } while (lines.length > 5 && size > 50);
    size += 8; let y = H * 0.36 - (lines.length - 1) * size * 0.6;
    cx.font = `700 ${size}px Georgia, 'Times New Roman', serif`; for (const l of lines) { cx.fillText(l, W / 2, y); y += size * 1.2; }
    if (subs.length) { const sl = wrap(subs.join(' - '), `italic 56px Georgia, serif`, W - 300); y += 20; cx.font = 'italic 56px Georgia, serif'; for (const l of sl.slice(0, 3)) { cx.fillText(l, W / 2, y); y += 70; } }
    cx.fillRect(W / 2 - 80, H * 0.72, 160, 4);
    const au = v.authors.join(', ') || ''; if (au) { const al = wrap(au, `400 60px Georgia, serif`, W - 260); let ay = H * 0.80; cx.font = '400 60px Georgia, serif'; for (const l of al.slice(0, 2)) { cx.fillText(l, W / 2, ay); ay += 76; } }
    const bytes = new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.9)).arrayBuffer());
    mtEdit(() => { mt.newCover = { bytes, type: 'image/jpeg', w: W, h: H, from: 'Capa gerada' }; mt.removeCover = false; });
  });
  $('mtCoverDel').addEventListener('click', () => mtEdit(() => { mt.newCover = null; mt.removeCover = true; }));
  $('mtCoverOrig').addEventListener('click', () => mtEdit(() => { mt.newCover = null; mt.removeCover = false; }));
  $('mtRevert').addEventListener('click', () => mtEdit(() => { mtPut(mt.book.meta); mt.newCover = null; mt.removeCover = false; }));
  $('mtUndo').addEventListener('click', () => { const h = mt && mt.hist.pop(); if (!h) return; mtPut(h.v); mt.newCover = h.newCover; mt.removeCover = h.removeCover; mtState(); say(''); });
  function mtRender() {
    const ul = $('mtRes'); ul.innerHTML = '';
    if (!mt || !mt.cands.length) return;
    for (const [k, c] of mt.cands.entries()) {
      const li = document.createElement('li'), d = document.createElement('div'), b = document.createElement('button');
      if (c.thumb) { const im = document.createElement('img'); im.src = c.thumb; im.alt = ''; im.loading = 'lazy'; li.appendChild(im); } else { const x = document.createElement('div'); x.className = 'sem'; li.appendChild(x); }
      d.className = 'd'; const t = document.createElement('b'); t.textContent = c.title + (c.subtitle ? ': ' + c.subtitle : ''); const i = document.createElement('span');
      i.textContent = [c.authors.slice(0, 3).join(', '), c.date, c.publisher, c.isbn && 'ISBN ' + c.isbn].filter(Boolean).join(' · ');
      d.append(t, i); b.type = 'button'; b.className = 'sm'; b.textContent = 'Usar este'; b.dataset.k = k;
      li.append(d, b); ul.appendChild(li);
    }
    const f = document.createElement('li'); f.className = 'fonte'; f.innerHTML = 'Dados e capas do <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a> (licença aberta).'; ul.appendChild(f);
  }
  async function mtSearch() {
    if (!mt || busy) return;
    const v = mtGet(), o = mt;
    busy = true; mtState(); say('Buscando no Open Library…'); o.abort = new AbortController();
    try {
      o.cands = (await Meta.search({ isbn: v.isbn, title: v.title, authors: v.authors, lang: v.lang }, { signal: o.abort.signal })).slice(0, 6);
      if (mt !== o) return;
      mtRender();
      say(o.cands.length ? `${o.cands.length} ${o.cands.length > 1 ? 'resultados' : 'resultado'} no Open Library: toque em “Usar este” no certo.` : 'Nada encontrado no Open Library. Confira o título e o autor (ou o ISBN) e busque de novo.', !o.cands.length);
    } catch (e) { if (mt === o) say('Erro: ' + (e.message || e), true); }
    finally { busy = false; if (mt === o) mtState(); }
  }
  async function mtUse(k) {
    const o = mt, c = o && o.cands[k]; if (!c || busy) return;
    busy = true; mtState(); say('Buscando descrição e capa…'); o.abort = new AbortController();
    try {
      const [full, cov] = await Promise.all([Meta.details(c, { signal: o.abort.signal }), Meta.cover(c.cover, { signal: o.abort.signal })]);
      if (mt !== o) return;
      mtPush();
      // como no Calibre: o que a fonte traz entra; o que ela não traz fica como estava
      const v = mtGet(), title = full.title + (full.subtitle ? ' - ' + full.subtitle : '');
      mtPut({ ...v, title: title || v.title, authors: full.authors.length ? full.authors : v.authors, publisher: full.publisher || v.publisher, date: full.date || v.date,
        isbn: full.isbn || v.isbn, lang: v.lang && full.lang && v.lang.toLowerCase().startsWith(full.lang) ? v.lang : full.lang || v.lang,   // "pt-BR" não vira "pt"
        tags: full.tags.length ? full.tags : v.tags, description: full.description || v.description });
      if (cov && o.book.kind === 'epub') { o.newCover = { ...cov, from: 'Capa nova do Open Library' }; o.removeCover = false; }
      say(`Preenchido com o Open Library${cov ? ', com capa' : ', sem capa'}. Confira e salve.`);
    } catch (e) { if (mt === o) say('Erro: ' + (e.message || e), true); }
    finally { busy = false; if (mt === o) mtState(); }
  }
  async function mtSave() {
    const o = mt; if (!o || busy) return;
    busy = true; mtState(); outBtns.style.display = 'none';
    try {
      say('Gravando…'); await tick();
      const v = mtGet();
      if (v.isbn && !Meta.isbn13(v.isbn)) throw new Error(`o ISBN "${v.isbn}" não é válido (confira os dígitos).`);
      if (v.date && !/^\d{4}(-\d{2}(-\d{2})?)?([T ][\d:.+Z-]*)?$/.test(v.date)) throw new Error(`a data "${v.date}" não está no formato AAAA, AAAA-MM ou AAAA-MM-DD.`);
      const data = await Meta.save(o.book, { ...v, newCover: o.newCover, removeCover: o.removeCover });
      const ext = o.book.kind, mime = ext === 'pdf' ? 'application/pdf' : 'application/epub+zip';
      const name = makeName(v.title || stem(o.file), v.authors) + '.' + ext;
      results.forEach(r => URL.revokeObjectURL(r.url)); results = [];
      results.push({ name, url: URL.createObjectURL(new Blob([data], { type: mime })), bytes: data, mime });
      await showOut({ ext, mime, many: ext === 'pdf' ? 'PDFs' : 'EPUBs' });
      say(`Pronto: ${name}. Toque em baixar.`);
      o.book = await Meta.open(data, name); o.newCover = null; o.removeCover = false; o.hist = []; mtPut(o.book.meta);   // o salvo vira a base de novas edições
    } catch (e) { console.error(e); say('Erro: ' + (e.message || e), true); }
    finally { busy = false; if (mt === o) mtState(); }
  }
  $('mtSearch').addEventListener('click', mtSearch);
  $('mtSave').addEventListener('click', mtSave);
  $('mtRes').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) mtUse(+b.dataset.k); });
