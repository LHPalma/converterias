  // src/app/indice.js: Aba Índice do PDF: marcadores gerados (pdfDocToEpub com opt.index) e editor manual.
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/indice.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- Índice do PDF: marcadores gerados automaticamente e editados à mão ----------
  // itens planos { title, page (0..n-1), level (0..) }; o nível de cada um é no máximo o do anterior + 1
  const idxList = $('idxList'), idxCv = $('idxCv');
  function idxReset() {
    if (idx) { try { idx.doc.destroy(); } catch (e) {} }
    idx = null; $('idxList').innerHTML = ''; $('idxPrev').hidden = true;
    $('idxInfo').textContent = 'Escolha um PDF para montar o índice (os marcadores do PDF).';
    $('optIdx').querySelectorAll('button, select').forEach(b => b.disabled = true);
  }
  const idxFix = () => { idx.items.forEach((it, k) => { it.level = Math.max(0, Math.min(it.level, k ? idx.items[k - 1].level + 1 : 0)); }); };
  function idxInfo() {
    const o = idx; if (!o) return;
    $('idxInfo').textContent = `${o.file.name} · ${o.n} ${o.n === 1 ? 'página' : 'páginas'} · ${o.items.length} ${o.items.length === 1 ? 'marcador' : 'marcadores'}${o.note ? ' · ' + o.note : ''}`;
    $('optIdx').querySelectorAll('button, select').forEach(b => b.disabled = false);
    $('idxUndo').disabled = !o.hist.length;
    for (const k of ['up', 'down', 'out', 'in', 'del']) $('optIdx').querySelector(`[data-ix="${k}"]`).disabled = o.sel < 0;
    $('idxUse').disabled = o.sel < 0;
  }
  function idxRender() {
    const o = idx;
    idxList.innerHTML = '';
    if (!o.items.length) idxList.innerHTML = '<li class="vazio">Sem marcadores. Gere automaticamente ou crie com “+ Marcador”.</li>';
    o.items.forEach((it, k) => {
      const li = document.createElement('li'); li.dataset.i = k; li.className = k === o.sel ? 'sel' : ''; li.style.paddingLeft = (6 + 20 * it.level) + 'px';
      li.innerHTML = `<input class="t" aria-label="Título"><input class="p" type="number" min="1" max="${o.n}" inputmode="numeric" aria-label="Página">`;
      li.querySelector('.t').value = it.title; li.querySelector('.p').value = it.page + 1;
      idxList.appendChild(li);
    });
    idxInfo();
  }
  function idxDo(fn) {   // alteração com desfazer
    idx.hist.push(JSON.stringify([idx.items, idx.sel])); if (idx.hist.length > 80) idx.hist.shift();
    fn(); idxFix(); outBtns.style.display = 'none'; say(''); idxRender();
  }
  let idxDrawing = null;
  async function idxShow(pg) {   // mostra uma página na prévia
    const o = idx; if (!o) return;
    o.prev = Math.max(0, Math.min(o.n - 1, pg)); $('idxPrev').hidden = false; $('idxPg').textContent = `${o.prev + 1} / ${o.n}`;
    const want = o.prev;
    if (idxDrawing) await idxDrawing.catch(() => {});
    if (idx !== o || o.prev !== want) return;
    idxDrawing = (async () => {
      const page = await o.doc.getPage(want + 1), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 700 / Math.max(v1.width, v1.height) });
      idxCv.width = Math.ceil(vp.width); idxCv.height = Math.ceil(vp.height);
      const cx = idxCv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, idxCv.width, idxCv.height);
      await page.render({ canvasContext: cx, viewport: vp }).promise; page.cleanup();
      idxCv.dataset.page = want + 1;
    })();
    await idxDrawing.catch(() => {});
  }
  const flatOutline = (list, level = 0) => list.flatMap(e => [{ title: e.title, page: e.page, level }, ...flatOutline(e.items, level + 1)]);
  async function idxLoad(file) {
    idxReset(); initPdfjs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise; }
    catch (e) { say(`${file.name}: ${e.name === 'PasswordException' ? 'PDF protegido por senha.' : 'não consegui ler este PDF.'}`, true); return; }
    const o = idx = { file, bytes, doc, n: doc.numPages, items: [], sel: -1, prev: 0, hist: [], note: '' };
    o.items = flatOutline(await pdfOutline(bytes.slice(), o.n));
    if (idx !== o) return;
    o.note = o.items.length ? 'os marcadores que o PDF já tinha' : '';
    idxFix(); idxRender(); idxShow(0);
    if (!o.items.length) await idxGenerate();   // sem índice nenhum: já gera um
  }
  async function idxGenerate() {
    const o = idx; if (!o || busy) return;
    busy = true; cancelled = false; outBtns.style.display = 'none';
    $('optIdx').querySelectorAll('button, select').forEach(b => b.disabled = true);
    try {
      const prefer = $('idxSrc').value;
      const r = await pdfDocToEpub(o.doc, o.file, m => say(m), { index: { skipOutline: true, prefer } });
      if (idx !== o) return;
      if (!r.entries.length) { say(prefer === 'printed' ? 'Não achei um sumário impresso neste PDF. Tente “dos títulos do texto”.' : 'Não achei títulos nem sumário impresso neste PDF: crie os marcadores à mão.', true); return; }
      idxDo(() => { o.items = r.entries.map(e => ({ title: e.title, page: Math.min(o.n - 1, Math.max(0, e.page)), level: e.level })); o.sel = -1; });
      o.note = r.source === 'sumario' ? 'gerado do sumário impresso' : 'gerado dos títulos do texto';
      idxInfo();
      say(`Pronto: ${o.items.length} marcadores (${o.note}). Confira, ajuste e salve.`);
    } catch (e) { console.error(e); if (idx === o) say('Erro: ' + (e.message || e), true); }
    finally { busy = false; if (idx === o) idxInfo(); }
  }
  async function idxSave() {
    const o = idx; if (!o || busy) return;
    busy = true; outBtns.style.display = 'none';
    try {
      say('Gerando o PDF…'); await tick();
      const { PDFDocument, PDFName } = PDFLib;
      let out;
      try { out = await PDFDocument.load(o.bytes, { updateMetadata: false }); }
      catch (e) { throw new Error(/encrypt/i.test(e.name + e.message) ? 'PDF protegido por senha.' : 'não consegui ler este PDF.'); }
      out.catalog.delete(PDFName.of('Outlines'));   // o índice antigo sai inteiro; o novo entra no lugar
      const tree = [], stack = [];
      for (const it of o.items) {
        const node = { title: it.title.trim() || 'Sem título', page: it.page, items: [] }, L = Math.min(it.level, stack.length);
        stack.length = L; (L ? stack[L - 1].items : tree).push(node); stack.push(node);
      }
      if (tree.length) writeOutline(out, tree);
      const data = await out.save();
      results.forEach(r => URL.revokeObjectURL(r.url)); results = [];
      results.push({ name: o.file.name, url: URL.createObjectURL(new Blob([data], { type: 'application/pdf' })), bytes: data, mime: 'application/pdf' });
      await showOut(MODES.idx);
      say(`Pronto: PDF com ${o.items.length} ${o.items.length === 1 ? 'marcador' : 'marcadores'}. Toque em baixar.`);
    } catch (e) { console.error(e); say('Erro: ' + (e.message || e), true); }
    busy = false;
  }
  $('idxAuto').addEventListener('click', idxGenerate);
  $('idxSave').addEventListener('click', idxSave);
  $('idxAdd').addEventListener('click', () => { if (!idx) return; idxDo(() => {
    const at = idx.sel >= 0 ? idx.sel + 1 : idx.items.findIndex(it => it.page > idx.prev), k = at < 0 ? idx.items.length : at;
    idx.items.splice(k, 0, { title: 'Novo marcador', page: idx.prev, level: idx.sel >= 0 ? idx.items[idx.sel].level : k ? idx.items[k - 1].level : 0 }); idx.sel = k;
  }); const t = idxList.querySelector('li.sel .t'); if (t) { t.focus(); t.select(); } });
  $('idxUse').addEventListener('click', () => { if (idx && idx.sel >= 0) idxDo(() => { idx.items[idx.sel].page = idx.prev; }); });
  $('optIdx').addEventListener('click', e => {
    const b = e.target.closest('[data-ix]'); if (!b || !idx || b.disabled) return;
    const a = b.dataset.ix, o = idx, k = o.sel;
    if (a === 'pp' || a === 'np') return idxShow(o.prev + (a === 'np' ? 1 : -1));
    if (a === 'undo') { if (o.hist.length) { [o.items, o.sel] = JSON.parse(o.hist.pop()); outBtns.style.display = 'none'; idxRender(); } return; }
    if (a === 'clear') return idxDo(() => { o.items = []; o.sel = -1; });
    if (k < 0) return;
    idxDo(() => {
      // um marcador leva junto os de dentro dele (os seguintes de nível maior)
      const end = (() => { let j = k + 1; while (j < o.items.length && o.items[j].level > o.items[k].level) j++; return j; })();
      if (a === 'del') { o.items.splice(k, 1); o.sel = Math.min(k, o.items.length - 1); }
      else if (a === 'in') { for (let j = k; j < end; j++) o.items[j].level++; }
      else if (a === 'out') { if (o.items[k].level) for (let j = k; j < end; j++) o.items[j].level--; }
      else if (a === 'up' && k) {   // passa o irmão anterior inteiro (com o que está dentro dele)
        const L = o.items[k].level; let j = k - 1; while (j > 0 && o.items[j].level > L) j--;
        if (o.items[j].level !== L) j = k - 1;
        const block = o.items.splice(k, end - k); o.items.splice(j, 0, ...block); o.sel = j;
      } else if (a === 'down' && end < o.items.length) {   // passa o irmão seguinte inteiro
        const L = o.items[k].level; let e2 = end + 1;
        if (o.items[end].level === L) while (e2 < o.items.length && o.items[e2].level > L) e2++;
        const block = o.items.splice(k, end - k), at = e2 - block.length; o.items.splice(at, 0, ...block); o.sel = at;
      }
    });
  });
  idxList.addEventListener('click', e => {
    const li = e.target.closest('li[data-i]'); if (!li || !idx) return;
    const k = +li.dataset.i;
    if (idx.sel !== k) { idx.sel = k; idxList.querySelectorAll('li').forEach(x => x.classList.toggle('sel', x === li)); idxInfo(); }
    idxShow(idx.items[k].page);
  });
  idxList.addEventListener('change', e => {
    const li = e.target.closest('li[data-i]'); if (!li || !idx) return;
    const k = +li.dataset.i, it = idx.items[k];
    if (e.target.classList.contains('t')) { const v = e.target.value.replace(/\s+/g, ' ').trim(); if (v !== it.title) idxDo(() => { it.title = v; }); }
    else { const v = Math.round(+e.target.value); if (v >= 1 && v <= idx.n) { if (v - 1 !== it.page) idxDo(() => { it.page = v - 1; }); idxShow(v - 1); } else e.target.value = it.page + 1; }
  });
