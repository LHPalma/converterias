  // src/app/simulador.js: Tela do simulador de Kindle (src/kindle.js lê o arquivo; aqui ficam a tela, as opções de leitura e a navegação).
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/simulador.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- simulador de Kindle (src/kindle.js lê o arquivo gerado; aqui é a tela) ----------
  const sim = { book: null, page: 0, panel: -1, chap: 0, sub: 0, subs: 1, zoom: 1, frame: null };
  const simEl = $('sim'), simScreen = $('simScreen');
  Manga.DEVICES.forEach((d, i) => $('simDev').add(new Option(d.label, d.id, !i, !i)));
  const simPct = v => (v * 100).toFixed(3) + '%';
  let simFonts = null;   // a serifada embutida no app (a mesma do EPUB → PDF), para a tela não depender das fontes do sistema
  const simFontCss = () => {
    if (simFonts == null) {
      const face = (k, style, weight) => FONT_DATA[k] ? `@font-face { font-family:'Kindle Serif'; font-style:${style}; font-weight:${weight}; src:url(${URL.createObjectURL(new Blob([Uint8Array.from(atob(FONT_DATA[k]), c => c.charCodeAt(0))], { type: 'font/woff' }))}) format('woff'); }` : '';
      simFonts = face('r', 'normal', 400) + face('i', 'italic', 400) + face('b', 'normal', 700) + face('bi', 'italic', 700);
    }
    return simFonts;
  };
  async function simOpen(bytes, name) {
    if (sim.book) sim.book.close();
    try { initPdfjs(); sim.book = await Kindle.open(bytes); }
    catch (e) { console.error(e); say('Não consegui abrir no simulador: ' + (e.message || e), true); return; }
    const b = sim.book;
    Object.assign(sim, { page: 0, panel: -1, chap: 0, sub: 0, zoom: 1 });
    $('simTitle').textContent = `${b.title || (name || 'Livro').replace(/\.[^.]+$/, '')}${b.authors.length ? ' · ' + b.authors.join(', ') : ''} (${b.kind.toUpperCase()})`;
    $('simDev').hidden = b.fixed && !b.pdf;   // layout fixo: o tamanho da tela vem do próprio arquivo (o PDF se ajusta ao aparelho)
    $('simSmaller').hidden = $('simBigger').hidden = $('simFont').hidden = $('simMargin').hidden = $('simSpace').hidden = b.fixed;
    $('simFont').value = b.hasFonts ? 'editor' : 'serif';   // como o Kindle: com fontes embutidas, começa na fonte do editor
    $('simAreas').hidden = !b.fixed || b.pdf; $('simExit').hidden = true;
    // capítulos de texto: tamanho de cada um, para a porcentagem lida no rodapé
    sim.lens = (b.chapters || []).map(c => c.html.replace(/<[^>]*>/g, '').length + 1);
    const toc = $('simToc'); toc.innerHTML = ''; toc.hidden = !b.toc.length || (b.fixed && !b.pdf);
    b.toc.forEach((t, k) => toc.add(new Option('\u2003'.repeat(Math.min(3, t.depth)) + t.title, k)));
    if (!simEl.open) simEl.showModal();
    simRender();
  }
  function simSize() {
    if (sim.book.fixed && !sim.book.pdf) { const p = sim.book.pages[0]; return [p.W, p.H]; }
    const d = Manga.deviceById($('simDev').value); return [d.w, d.h];
  }
  function simRender() {
    const b = sim.book, [W, H] = simSize();
    simScreen.style.aspectRatio = `${W} / ${H}`;
    simScreen.innerHTML = ''; sim.tocSub = null;
    if (b.fixed) return simFixed();
    // texto: o capítulo numa tela do tamanho real do aparelho (em pixels), paginado em colunas como o Kindle, e reduzido para caber
    // as opções do Kindle: fonte (a do editor respeita o CSS do livro), margens e espaçamento entre linhas
    const ch = b.chapters[sim.chap] || { html: '', css: '', attrs: '' }, fs = Math.round(H / 46 * sim.zoom);
    const m = Math.round(W * [0.03, 0.06, 0.11][+$('simMargin').value]), lh = [1.25, 1.45, 1.7][+$('simSpace').value], foot = Math.round(fs * 1.9);
    const font = $('simFont').value, fam = font === 'sans' ? "'Amazon Ember', system-ui, 'Helvetica Neue', Arial, sans-serif" : "Bookerly, 'Kindle Serif', Georgia, serif";
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-same-origin'); f.setAttribute('aria-hidden', 'true'); f.setAttribute('tabindex', '-1');
    f.width = W; f.height = H; f.style.width = W + 'px'; f.style.height = H + 'px';
    f.style.transform = `scale(${simScreen.clientWidth / W})`;
    const isKfx = b.kind === 'kfx';
    f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${isKfx ? '' : ch.css}</style><style>
      html { margin:0; padding:0; height:${H}px; overflow:hidden; background:#e9e7e1; }
      ${simFontCss()}
      body { margin:0 !important; padding:${m}px ${m}px ${foot}px; height:${H - m - foot}px; box-sizing:content-box; column-width:${W - 2 * m}px; column-gap:${2 * m}px; column-fill:auto;
        font:${fs}px/${lh} ${fam}; color:#111; text-align:justify; hyphens:auto; overflow-wrap:break-word; }
      p, li, blockquote, dd, dt, div { line-height:${lh} !important; }
      ${font === 'editor' ? '' : `body, body :not(pre):not(code):not(kbd):not(samp):not(tt) { font-family:${fam} !important; }`}
      img, svg { max-width:100% !important; max-height:${H - m - foot}px !important; height:auto; break-inside:avoid; }
      h1, h2, h3, h4 { break-after:avoid; text-align:center; } p { margin:0; text-indent:1.4em; } pre { white-space:pre-wrap; font-size:.8em; text-align:left; }
      ${isKfx ? 'p.img { text-align:center; text-indent:0; } h1,h2,h3,h4 { margin:1em 0 .6em; }' : ''}
      a { color:inherit; } </style></head><body${ch.attrs}>${ch.html}</body></html>`;
    f.addEventListener('load', () => {
      const doc = f.contentDocument, se = doc && doc.scrollingElement;
      if (!se) return;
      sim.subs = Math.max(1, Math.round(se.scrollWidth / W));
      // em que tela de cada item do sumário cai a âncora (vários capítulos podem estar no mesmo arquivo)
      const at = id => { const el = id && doc.getElementById(id); return el ? Math.max(0, Math.floor((el.getBoundingClientRect().left + se.scrollLeft) / W)) : 0; };
      sim.tocSub = new Map(b.toc.map((t, k) => [k, t.file === sim.chap ? at(t.id) : -1]).filter(([, v]) => v >= 0));
      if (sim.jump != null) { sim.sub = sim.tocSub.get(sim.jump) || 0; sim.jump = null; }
      if (sim.sub < 0) sim.sub = sim.subs - 1;
      sim.sub = Math.min(sim.sub, sim.subs - 1);
      se.scrollLeft = sim.sub * W;
      simInfo();
    });
    simScreen.appendChild(f); sim.frame = f;
    const ft = document.createElement('div'); ft.className = 'kfoot'; ft.style.fontSize = (fs * 0.62 * simScreen.clientWidth / W) + 'px';
    ft.innerHTML = '<span></span><span></span>'; simScreen.appendChild(ft);
    for (const [side, dir] of [['left', -1], ['right', 1]]) {   // tocar nas bordas vira a página, como no aparelho
      const t = document.createElement('button'); t.type = 'button'; t.className = 'kturn'; t.style[side] = 0; t.setAttribute('aria-label', dir > 0 ? 'Avançar' : 'Voltar');
      t.addEventListener('click', () => simGo(dir * (b.rtl ? -1 : 1))); simScreen.appendChild(t);
    }
    simInfo();
  }
  function simFixed() {
    const b = sim.book, p = b.pages[sim.page], img = document.createElement('img');
    img.alt = 'Página ' + (sim.page + 1); img.draggable = false;
    const place = (el, r) => { el.style.left = simPct(r.x); el.style.top = simPct(r.y); el.style.width = simPct(r.w); el.style.height = simPct(r.h); };
    if (b.pdf) {   // PDF: a página inteira, reduzida para caber na tela do aparelho; as bordas viram a página
      const k = sim.page, [W, H] = simSize(), rid = sim.rid = (sim.rid || 0) + 1;   // só o desenho mais recente entra na tela
      b.render(k, W, H).then(r => { if (sim.book !== b || sim.rid !== rid) return; img.src = r.src; place(img, r.box); simScreen.prepend(img); })
        .catch(e => { console.error(e); $('simHint').textContent = 'Não consegui desenhar esta página.'; });
      for (const [side, dir] of [['left', -1], ['right', 1]]) {
        const t = document.createElement('button'); t.type = 'button'; t.className = 'kturn'; t.style[side] = 0; t.setAttribute('aria-label', dir > 0 ? 'Avançar' : 'Voltar');
        t.addEventListener('click', () => simGo(dir)); simScreen.appendChild(t);
      }
      return simInfo();
    }
    img.src = p.src;
    if (sim.panel < 0) {
      place(img, p.box); simScreen.appendChild(img);
      p.panels.forEach((q, i) => {
        const h = document.createElement('button'); h.type = 'button'; h.className = 'khit'; h.title = 'Quadro ' + (i + 1); h.innerHTML = `<b>${i + 1}</b>`;
        place(h, q.tap); h.addEventListener('click', e => { e.stopPropagation(); sim.panel = i; simRender(); });
        simScreen.appendChild(h);
      });
    } else {
      const q = p.panels[sim.panel], w = q.win; place(img, q.img); simScreen.appendChild(img);
      for (const r of [{ x: 0, y: 0, w: 1, h: w.y }, { x: 0, y: w.y + w.h, w: 1, h: 1 - w.y - w.h }, { x: 0, y: w.y, w: w.x, h: w.h }, { x: w.x + w.w, y: w.y, w: 1 - w.x - w.w, h: w.h }]) {
        if (r.w <= 0 || r.h <= 0) continue;
        const d = document.createElement('div'); d.className = 'kmask'; place(d, r); simScreen.appendChild(d);
      }
    }
    simInfo();
  }
  function simInfo() {
    const b = sim.book;
    if (b.pdf) {
      $('simCount').textContent = `${sim.page + 1} / ${b.pages.length}`;
      $('simHint').textContent = 'PDF: o Kindle mostra a página inteira reduzida à tela, sem ajustar a letra. Para ler com letra ajustável, use a aba Para Kindle.';
      $('simPrev').disabled = sim.page === 0; $('simNext').disabled = sim.page === b.pages.length - 1;
      let t = b.toc.reduce((k, e, i) => e.page <= sim.page ? i : k, -1); if (t >= 0) $('simToc').value = t;
    } else if (b.fixed) {
      const p = b.pages[sim.page], n = p.panels.length;
      $('simCount').textContent = sim.panel < 0 ? `${sim.page + 1} / ${b.pages.length}` : `quadro ${sim.panel + 1} / ${n}`;
      $('simHint').textContent = sim.panel >= 0 ? 'Avançar vai para o próximo quadro.' : n ? `${n} ${n > 1 ? 'quadros' : 'quadro'}: toque num deles para ampliar.` : 'Página sem painéis.';
      $('simExit').hidden = sim.panel < 0;
      $('simPrev').disabled = sim.panel < 0 && sim.page === 0; $('simNext').disabled = sim.panel < 0 && sim.page === b.pages.length - 1;
    } else {
      $('simCount').textContent = `${sim.chap + 1}.${sim.sub + 1} / ${b.chapters.length}`;
      $('simHint').textContent = `Arquivo ${sim.chap + 1} de ${b.chapters.length}, tela ${sim.sub + 1} de ${sim.subs}. A diagramação é uma aproximação: o Kindle usa o motor e as fontes dele.`;
      $('simPrev').disabled = sim.chap === 0 && sim.sub === 0; $('simNext').disabled = sim.chap === b.chapters.length - 1 && sim.sub >= sim.subs - 1;
      let t = -1;
      if (sim.tocSub) for (const [k, v] of sim.tocSub) if (v <= sim.sub && (t < 0 || v > sim.tocSub.get(t))) t = k;
      if (t < 0) t = b.toc.findIndex(e => e.file === sim.chap); if (t < 0) t = b.toc.reduce((k, e, i) => e.file <= sim.chap ? i : k, -1); if (t >= 0) $('simToc').value = t;
      // rodapé como o do Kindle: o capítulo à esquerda e a porcentagem lida à direita
      const ft = simScreen.querySelector('.kfoot'), all = sim.lens.reduce((a, v) => a + v, 0) || 1;
      const done = sim.lens.slice(0, sim.chap).reduce((a, v) => a + v, 0) + (sim.lens[sim.chap] || 0) * (sim.sub + 1) / sim.subs;
      if (ft) { ft.children[0].textContent = t >= 0 ? b.toc[t].title : ''; ft.children[1].textContent = Math.min(100, Math.round(done / all * 100)) + '%'; }
    }
  }
  function simGo(dir) {   // +1 = avança na leitura
    const b = sim.book;
    if (b.fixed) {
      if (sim.panel >= 0) {
        const k = sim.panel + dir;
        if (k >= 0 && k < b.pages[sim.page].panels.length) sim.panel = k;
        else { sim.panel = -1; if (dir > 0 && sim.page < b.pages.length - 1) sim.page++; }
      } else if (sim.page + dir >= 0 && sim.page + dir < b.pages.length) sim.page += dir;
      return simRender();
    }
    if (sim.sub + dir >= 0 && sim.sub + dir < sim.subs) { sim.sub += dir; sim.frame.contentDocument.scrollingElement.scrollLeft = sim.sub * simSize()[0]; return simInfo(); }
    if (sim.chap + dir < 0 || sim.chap + dir >= b.chapters.length) return;
    sim.chap += dir; sim.sub = dir > 0 ? 0 : -1; simRender();
  }
  $('simPrev').addEventListener('click', () => simGo(sim.book.rtl && !sim.book.fixed ? 1 : -1));
  $('simNext').addEventListener('click', () => simGo(sim.book.rtl && !sim.book.fixed ? -1 : 1));
  $('simExit').addEventListener('click', () => { sim.panel = -1; simRender(); });
  simScreen.addEventListener('click', () => { if (sim.book && sim.book.fixed && sim.panel >= 0) { sim.panel = -1; simRender(); } });
  $('simAreas').addEventListener('click', () => { const on = !simScreen.classList.contains('areas'); simScreen.classList.toggle('areas', on); $('simAreas').setAttribute('aria-pressed', String(on)); });
  $('simDev').addEventListener('change', () => { sim.sub = 0; simRender(); });
  $('simToc').addEventListener('change', () => { const t = sim.book.toc[+$('simToc').value]; if (!t) return; if (sim.book.pdf) sim.page = t.page; else { sim.chap = t.file; sim.sub = 0; sim.jump = +$('simToc').value; } simRender(); });
  for (const id of ['simFont', 'simMargin', 'simSpace']) $(id).addEventListener('change', () => { sim.sub = 0; simRender(); });
  $('simSmaller').addEventListener('click', () => { sim.zoom = Math.max(0.6, sim.zoom / 1.15); sim.sub = 0; simRender(); });
  $('simBigger').addEventListener('click', () => { sim.zoom = Math.min(2.5, sim.zoom * 1.15); sim.sub = 0; simRender(); });
  $('simClose').addEventListener('click', () => simEl.close());
  simEl.addEventListener('close', () => { if (sim.book) { sim.book.close(); sim.book = null; } simScreen.innerHTML = ''; });
  simEl.addEventListener('cancel', e => { if (sim.book && sim.book.fixed && sim.panel >= 0) { e.preventDefault(); sim.panel = -1; simRender(); } });   // Esc no quadro: sai do quadro
  document.addEventListener('keydown', e => {
    if (!sim.book || !simEl.open) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); simGo((e.key === 'ArrowRight' ? 1 : -1) * (sim.book.rtl && !sim.book.fixed ? -1 : 1)); }
    else if (e.key === 'Escape' && sim.book.fixed && sim.panel >= 0) { e.preventDefault(); sim.panel = -1; simRender(); }
  });
