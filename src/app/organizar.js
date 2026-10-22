  // src/app/organizar.js: Aba Organizar PDF: miniaturas, seleção, mover/girar/duplicar/remover com desfazer, e exportar.
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/organizar.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- organizar páginas de um PDF ----------
  const rotated = (base, deg) => {   // miniatura girada
    const r = ((deg % 360) + 360) % 360, sw = r === 90 || r === 270, c = document.createElement('canvas');
    c.width = sw ? base.height : base.width; c.height = sw ? base.width : base.height;
    const x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(r * Math.PI / 180); x.drawImage(base, -base.width / 2, -base.height / 2);
    return c;
  };
  function orgReset() {
    if (org) { try { org.doc.destroy(); } catch (e) {} }
    org = null; orgGrid.innerHTML = ''; $('orgInfo').textContent = 'Escolha um PDF para ver as páginas.';
    ['orgSave', 'orgSaveSel', 'orgGo', 'orgUndo'].forEach(id => $(id).disabled = true);
    $('orgAct').querySelectorAll('button').forEach(b => b.disabled = true);
  }
  function orgInfo() {
    if (!org) return;
    const sel = org.pages.filter(p => p.sel).length, done = org.thumbs.filter(Boolean).length;
    $('orgInfo').textContent = `${org.file.name} · ${org.pages.length} ${org.pages.length === 1 ? 'página' : 'páginas'}${org.pages.length !== org.n ? ` (de ${org.n})` : ''} · ${sel} selecionada${sel === 1 ? '' : 's'}${done < org.n ? ` · miniaturas ${done}/${org.n}` : ''}`;
    $('orgSave').disabled = !org.pages.length;
    $('orgSaveSel').disabled = !sel;
    $('orgGo').disabled = !sel;
    $('orgUndo').disabled = !org.hist.length;
    $('orgAct').querySelectorAll('button').forEach(b => b.disabled = !sel);
  }
  function orgFill(card) {
    const pg = org.pages[+card.dataset.i], base = org.thumbs[pg.src], tw = card.querySelector('.tw');
    if (base && base !== 'err') tw.replaceChildren(rotated(base, pg.rot)); else tw.textContent = base === 'err' ? '?' : '…';
  }
  function orgRender() {
    orgGrid.innerHTML = '';
    org.pages.forEach((pg, i) => {
      const d = document.createElement('div');
      d.className = 'oc' + (pg.sel ? ' sel' : ''); d.draggable = true; d.dataset.i = i;
      d.innerHTML = `<div class="tw"></div><div class="no">${i + 1}<span>${pg.src !== i || pg.rot ? ` · orig. ${pg.src + 1}${pg.rot ? ' ↻' + ((pg.rot % 360 + 360) % 360) : ''}` : ''}</span></div>`;
      orgFill(d); orgGrid.appendChild(d);
    });
    orgInfo();
  }
  function orgDo(fn) {   // aplica uma alteração com desfazer
    org.hist.push(JSON.stringify(org.pages)); if (org.hist.length > 60) org.hist.shift();
    fn(); outBtns.style.display = 'none'; say(''); orgRender();
  }
  async function orgLoad(file) {
    orgReset(); initPdfjs();
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) { say(`${file.name}: ${e.name === 'PasswordException' ? 'PDF protegido por senha.' : 'não consegui ler este PDF.'}`, true); return; }
    const o = org = { file, doc, n: doc.numPages, thumbs: new Array(doc.numPages).fill(null), pages: Array.from({ length: doc.numPages }, (_, i) => ({ src: i, rot: 0, sel: false })), hist: [] };
    orgRender();
    for (let i = 0; i < o.n && org === o; i++) {   // miniaturas, uma por vez, em segundo plano
      try {
        const page = await doc.getPage(i + 1), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 240 / Math.max(v1.width, v1.height) });
        const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: cx, viewport: vp }).promise; page.cleanup();
        o.thumbs[i] = cv;
      } catch (e) { o.thumbs[i] = org === o ? 'err' : null; }
      if (org !== o) return;
      orgGrid.querySelectorAll('.oc').forEach(c => { if (org.pages[+c.dataset.i].src === i) orgFill(c); });
      orgInfo();
      await new Promise(r => setTimeout(r, 0));
    }
  }
  async function orgExport(onlySel) {
    const o = org, list = o.pages.filter(p => !onlySel || p.sel);
    if (!list.length) return;
    busy = true; cancelled = false; outBtns.style.display = 'none';
    ['orgSave', 'orgSaveSel'].forEach(id => $(id).disabled = true);
    try {
      say('Gerando o PDF…'); await tick();
      const { PDFDocument, degrees } = PDFLib, bytes = new Uint8Array(await o.file.arrayBuffer());
      let src;
      try { src = await PDFDocument.load(bytes, { updateMetadata: false }); }
      catch (e) { throw new Error(/encrypt/i.test(e.name + e.message) ? 'PDF protegido por senha.' : 'não consegui ler este PDF.'); }
      const out = await PDFDocument.create(), firsts = [...new Set(list.map(p => p.src))];
      const copies = new Map((await out.copyPages(src, firsts)).map((p, k) => [firsts[k], p])), pos = new Map();
      for (let k = 0; k < list.length; k++) {   // 1ª ocorrência de cada página vem do lote; repetidas ganham cópia própria (cada uma com sua rotação)
        const p = list[k], first = !pos.has(p.src);
        const page = first ? copies.get(p.src) : (await out.copyPages(src, [p.src]))[0];
        if (first) pos.set(p.src, k);
        if (p.rot) page.setRotation(degrees((((page.getRotation().angle + p.rot) % 360) + 360) % 360));
        out.addPage(page);
        if (k % 25 === 24) await tick();
      }
      for (const [k, f] of [['Title', 'getTitle'], ['Author', 'getAuthor'], ['Subject', 'getSubject']]) { const v = src[f](); if (v) out['set' + k](v); }
      out.setProducer('Converterias'); out.setCreator('Converterias');
      const remap = ns => ns.flatMap(x => { const items = remap(x.items); return pos.has(x.page) ? [{ title: x.title, page: pos.get(x.page), items }] : items; });
      const tree = remap(await pdfOutline(bytes, o.n));   // marcadores das páginas que ficaram
      if (tree.length) writeOutline(out, tree);
      const data = await out.save();
      results.forEach(r => URL.revokeObjectURL(r.url)); results = [];
      const name = `${stem(o.file).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'PDF'} (${onlySel ? 'selecionadas' : 'organizado'}).pdf`;
      results.push({ name, url: URL.createObjectURL(new Blob([data], { type: 'application/pdf' })), bytes: data, mime: 'application/pdf' });
      await showOut({ ext: 'pdf', mime: 'application/pdf', many: 'PDFs' });
      say(`Pronto: ${out.getPageCount()} ${out.getPageCount() === 1 ? 'página' : 'páginas'} (${(data.length / 1048576).toFixed(1)} MB). Toque em baixar.`);
    } catch (e) { console.error(e); say('Erro: ' + (e.message || e), true); }
    busy = false; if (org === o) orgInfo();
  }

  orgGrid.addEventListener('click', e => {
    const c = e.target.closest('.oc');
    if (!c || !org) return;
    const pg = org.pages[+c.dataset.i]; pg.sel = !pg.sel;
    c.classList.toggle('sel', pg.sel); orgInfo();
  });
  let dragFrom = null;
  orgGrid.addEventListener('dragstart', e => { const c = e.target.closest('.oc'); if (!c) return; dragFrom = +c.dataset.i; c.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); });
  orgGrid.addEventListener('dragend', () => { dragFrom = null; orgGrid.querySelectorAll('.drag,.over').forEach(c => c.classList.remove('drag', 'over')); });
  orgGrid.addEventListener('dragover', e => { const c = e.target.closest('.oc'); if (!c || dragFrom == null) return; e.preventDefault(); orgGrid.querySelectorAll('.over').forEach(x => x.classList.remove('over')); c.classList.add('over'); });
  orgGrid.addEventListener('drop', e => {
    const c = e.target.closest('.oc');
    if (!c || dragFrom == null || !org) return;
    e.preventDefault();
    const to = +c.dataset.i, from = dragFrom; dragFrom = null;
    if (to !== from) orgDo(() => { const [m] = org.pages.splice(from, 1); org.pages.splice(to, 0, m); });
  });

  const orgSelect = fn => { if (!org) return; org.pages.forEach((p, i) => p.sel = fn(p, i)); orgRender(); };
  const orgMove = d => orgDo(() => {   // sobe ou desce as selecionadas um lugar
    const p = org.pages;
    if (d < 0) for (let i = 1; i < p.length; i++) { if (p[i].sel && !p[i - 1].sel) [p[i - 1], p[i]] = [p[i], p[i - 1]]; }
    else for (let i = p.length - 2; i >= 0; i--) { if (p[i].sel && !p[i + 1].sel) [p[i + 1], p[i]] = [p[i], p[i + 1]]; }
  });
  const orgMoveTo = at => orgDo(() => {   // leva as selecionadas, na mesma ordem, para a posição `at` (0 = início)
    const sel = org.pages.filter(p => p.sel), rest = org.pages.filter(p => !p.sel);
    rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...sel); org.pages = rest;
  });
  $('optOrg').addEventListener('click', e => {
    const b = e.target.closest('button[data-org]');
    if (!b || !org || busy) return;
    const a = b.dataset.org;
    if (a === 'all') orgSelect(() => true);
    else if (a === 'none') orgSelect(() => false);
    else if (a === 'inv') orgSelect(p => !p.sel);
    else if (a === 'odd') orgSelect((p, i) => i % 2 === 0);
    else if (a === 'even') orgSelect((p, i) => i % 2 === 1);
    else if (a === 'left') orgMove(-1);
    else if (a === 'right') orgMove(1);
    else if (a === 'first') orgMoveTo(0);
    else if (a === 'last') orgMoveTo(1e9);
    else if (a === 'cw') orgDo(() => org.pages.forEach(p => { if (p.sel) p.rot = (p.rot + 90) % 360; }));
    else if (a === 'ccw') orgDo(() => org.pages.forEach(p => { if (p.sel) p.rot = (p.rot + 270) % 360; }));
    else if (a === 'dup') orgDo(() => { org.pages = org.pages.flatMap(p => p.sel ? [p, { ...p, sel: false }] : [p]); });
    else if (a === 'del') orgDo(() => { org.pages = org.pages.filter(p => !p.sel); });
    else if (a === 'rev') orgDo(() => org.pages.reverse());
    else if (a === 'undo') { if (org.hist.length) { org.pages = JSON.parse(org.hist.pop()); outBtns.style.display = 'none'; orgRender(); } }
  });
  $('orgGo').addEventListener('click', () => { if (org && !busy) orgMoveTo((parseInt($('orgPos').value, 10) || 1) - 1); });
  $('orgSave').addEventListener('click', () => { if (org && !busy) orgExport(false); });
  $('orgSaveSel').addEventListener('click', () => { if (org && !busy) orgExport(true); });
