  // src/app/escaneado.js: PDF escaneado: OCR com Tesseract.js (src/ocr.js monta o livro), dicionário e a aba Escaneado → PDF.
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/escaneado.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- OCR (Tesseract.js, 100% local) ----------
  let ocrWorker = null, ocrKey = '';
  async function ocrStop() { if (ocrWorker) { try { await ocrWorker.terminate(); } catch (e) {} ocrWorker = null; ocrKey = ''; } }
  const BEST_URL = 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_best@4.1.0/';   // modelos "best" do Tesseract (só os dados do idioma; nada do seu arquivo sai do aparelho)
  async function ocrStart(lang, say, quality = 'fast') {
    if (typeof Tesseract === 'undefined') throw new Error('o motor de OCR não está nesta versão do app.');
    const key = lang + '|' + quality;
    if (ocrWorker && ocrKey === key) return ocrWorker;
    await ocrStop();
    const base = new URL('vendor/ocr/', location.href).href;
    // sem errorHandler, uma falha ao baixar o idioma vira erro solto e o createWorker nunca termina (o app ficava parado)
    const make = q => new Promise((ok, no) => Tesseract.createWorker(lang, 1, {
      workerPath: base + 'worker.min.js', corePath: base + 'tesseract-core-simd-lstm.wasm.js', gzip: false,
      langPath: q === 'best' ? BEST_URL : base, cacheMethod: q === 'best' ? 'write' : 'none',   // o modelo grande fica no cache do navegador (IndexedDB)
      logger: m => { if (m.status && /^(loading|initializ)/.test(m.status)) say(q === 'best' && /language/.test(m.status) ? `Baixando o modelo de alta qualidade… ${Math.round((m.progress || 0) * 100)}%` : 'Preparando o OCR…'); },
      errorHandler: e => no(new Error(String(e))),
    }).then(ok, no));
    try {
      try { ocrWorker = await make(quality); }
      catch (e) {
        if (quality !== 'best') throw e;
        console.warn('modelo de alta qualidade indisponível', e); say('Não consegui baixar o modelo de alta qualidade; usando o rápido…');
        quality = 'fast'; ocrWorker = await make('fast');
      }
    } catch (e) {
      ocrWorker = null;
      throw new Error('não consegui iniciar o OCR. Ele usa os arquivos da pasta vendor/ocr: abra o app pelo endereço do site (ou por um servidor local), não direto do arquivo .html. ' + (e && e.message ? e.message : e));
    }
    ocrKey = lang + '|' + quality; return ocrWorker;
  }
  let spellDict = null;
  async function loadSpell(say) {   // dicionário Hunspell pt-BR, carregado sob demanda (e guardado no cache do app)
    if (spellDict) return spellDict;
    say('Carregando o dicionário…');
    const base = new URL('vendor/ocr/', location.href).href, get = async n => { const r = await fetch(base + n); if (!r.ok) throw new Error(n); return r.text(); };
    const [aff, dic] = await Promise.all([get('pt.aff'), get('pt.dic')]);
    return (spellDict = new Spell.Dict(aff, dic));
  }
  async function isScanned(doc) {   // amostra páginas espalhadas: sem texto algum = escaneado
    let chars = 0; const N = doc.numPages;
    for (let k = 1; k <= Math.min(6, N); k++) {
      const pg = await doc.getPage(Math.max(1, Math.round(k * N / 6)));
      const tc = await pg.getTextContent(); chars += tc.items.reduce((s, it) => s + (it.str || '').length, 0); pg.cleanup();
    }
    return chars < 25;
  }
  async function scanDocToEpub(doc, file, say) {
    const lang = $('oLang').value, N = doc.numPages;
    const rg = /^\s*(\d+)?\s*[-–]\s*(\d+)?\s*$/.exec($('oRange').value);
    const first = Math.min(N, Math.max(1, rg && rg[1] ? +rg[1] : 1)), last = Math.min(N, Math.max(first, rg && rg[2] ? +rg[2] : N));
    const cover = $('oCover').checked ? 1 : 0;
    const worker = await ocrStart(lang, say, $('oQual').value);
    let spell = null;
    if ($('oFix').checked && lang === 'por' && typeof Spell !== 'undefined') { try { spell = await loadSpell(say); } catch (e) { console.warn('dicionário indisponível', e); } }
    const pages = [], total = last - first + 1, t0 = Date.now(); let done = 0;
    const { AnnotationMode } = pdfjsLib;
    for (let i = 1; i <= N; i++) {
      const inRange = i >= first && i <= last;
      if (!inRange && i !== cover) { pages.push({ W: Ocr.PT_W, H: 842, rows: [], ink: 0, img: null }); continue; }
      await tick();
      if (inRange) {
        const eta = done ? Math.round((Date.now() - t0) / done * (total - done) / 1000) : 0;
        say(`OCR: página ${done + 1} de ${total}${eta ? ` · faltam ~${eta >= 90 ? Math.round(eta / 60) + ' min' : eta + ' s'}` : ''}`);
      }
      const page = await doc.getPage(i), v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(3.5, Math.max(1.5, 2000 / v1.width)), vp = page.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: cx, viewport: vp, annotationMode: AnnotationMode.DISABLE }).promise;
      const img = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
      const sm = document.createElement('canvas'); sm.width = 200; sm.height = Math.max(1, Math.round(200 * cv.height / cv.width));
      const sx = sm.getContext('2d', { willReadFrequently: true }); sx.drawImage(cv, 0, 0, sm.width, sm.height);
      const px = sx.getImageData(0, 0, sm.width, sm.height).data; let dark = 0;
      for (let k = 0; k < px.length; k += 4) if (px[k] * .299 + px[k + 1] * .587 + px[k + 2] * .114 < 120) dark++;
      let rows = [];
      if (inRange) {
        const { data } = await worker.recognize(img, {}, { blocks: true });
        rows = Ocr.rowsFromLines((data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines)), cv.width);
        done++;
      }
      pages.push({ W: Ocr.PT_W, H: cv.height * Ocr.PT_W / cv.width, rows, ink: dark / (px.length / 4), img });
      cv.width = cv.height = sm.width = sm.height = 0; page.cleanup();
    }
    const title = $('oTitle').value.trim() || file.name.replace(/\.pdf$/i, '');
    const author = $('oAuthor').value.trim();
    const r = await Ocr.buildEpub(JSZip, pages, { title, author, lang: lang.startsWith('eng') ? 'en' : 'pt-BR', cover, first, last, spell }, async m => { say(m); await tick(); });
    return { bytes: r.bytes, pages: N, chapters: r.chapters, title, authors: author ? [author] : [], uncertain: Ocr.countLow(pages), fixed: r.fixed };
  }
  async function scanToPdf(file, say) {
    say('Lendo o arquivo…'); await tick(); initPdfjs();
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) { throw new Error(e && e.name === 'PasswordException' ? 'PDF protegido por senha.' : 'Não parece um PDF válido.'); }
    try {
      const ep = await scanDocToEpub(doc, file, say);
      say('Gerando o PDF…'); await tick();
      const r = await epubToPdf(new File([ep.bytes], 'livro.epub', { type: 'application/epub+zip' }), say);
      return { ...r, title: ep.title, authors: ep.authors, uncertain: ep.uncertain, fixed: ep.fixed };
    } finally { doc.destroy(); spellDict = null; await ocrStop(); }
  }
