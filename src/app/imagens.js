  // src/app/imagens.js: Imagens → PDF e PDF → Imagens (e o carregador do pdf.js, initPdfjs).
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/imagens.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- imagens <-> PDF ----------
  // fontes-padrão do PDF embutidas no app: um PDF que cita Times ou Helvetica sem embuti-las sai igual em qualquer
  // aparelho (com as fontes do sistema, num celular sem Times o texto saía com outra largura e outro desenho; no
  // Mangá, página de texto chegava a parecer quadrinho)
  class PdfFonts { constructor() {} async fetch({ filename }) {
    const b = PDFJS_FONTS[filename]; if (!b) throw new Error('fonte-padrão ausente: ' + filename);
    return Uint8Array.from(atob(b), c => c.charCodeAt(0));
  } }
  const initPdfjs = () => {
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc)
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([$('pdfWorker').textContent], { type: 'text/javascript' }));
    if (!pdfjsLib.getDocument.comFontes) {   // todos os getDocument do app (e dos módulos) passam a usar as fontes embutidas
      const orig = pdfjsLib.getDocument;
      pdfjsLib.getDocument = p => orig({ isEvalSupported: false, useSystemFonts: false, useWorkerFetch: false, StandardFontDataFactory: PdfFonts, ...p });
      pdfjsLib.getDocument.comFontes = true;
    }
  };
  const toBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));

  function jpegInfo(b) {   // componentes de cor e orientação EXIF de um JPEG
    let comps = 3, orient = 1;
    for (let i = 2; i + 4 < b.length;) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { comps = b[i + 9]; break; }
      if (m === 0xDA) break;
      if (m === 0xE1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {   // "Exif"
        const t = i + 10, le = b[t] === 0x49, u16 = o => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
        const u32 = o => le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
        const ifd = t + u32(t + 4), n = u16(ifd);
        for (let k = 0; k < n && ifd + 14 + k * 12 < b.length; k++) if (u16(ifd + 2 + k * 12) === 0x0112) orient = u16(ifd + 10 + k * 12);
      }
      i += 2 + len;
    }
    return { comps, orient };
  }

  async function imageForPdf(pdf, file) {   // devolve a imagem já embutida no PDF
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpg = bytes[0] === 0xFF && bytes[1] === 0xD8, png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    if (jpg) { const { comps, orient } = jpegInfo(bytes); if (comps !== 4 && orient <= 1) return pdf.embedJpg(bytes); }
    else if (png) { try { return await pdf.embedPng(bytes); } catch (e) { /* PNG fora do comum: passa pelo canvas */ } }
    let bmp;
    try { bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' }); }
    catch (e) { throw new Error(`${file.name}: formato de imagem que o navegador não abre.`); }
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0); bmp.close();
    let alpha = false;
    if (!jpg) {
      const d = cx.getImageData(0, 0, cv.width, cv.height).data;
      for (let k = 3; k < d.length; k += 4) if (d[k] < 255) { alpha = true; break; }
    }
    if (alpha) return pdf.embedPng(new Uint8Array(await (await toBlob(cv, 'image/png')).arrayBuffer()));
    const flat = document.createElement('canvas'); flat.width = cv.width; flat.height = cv.height;
    const fx = flat.getContext('2d'); fx.fillStyle = '#fff'; fx.fillRect(0, 0, flat.width, flat.height); fx.drawImage(cv, 0, 0);
    return pdf.embedJpg(new Uint8Array(await (await toBlob(flat, 'image/jpeg', 0.92)).arrayBuffer()));
  }

  async function imagesToPdf(list, title, say) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    const size = $('iSize').value, mar = +$('iMargin').value * MM;
    for (let i = 0; i < list.length; i++) {
      say(`Imagem ${i + 1} de ${list.length}…`); setItem(i, 'Lendo…'); await tick();
      const img = await imageForPdf(out, list[i]);
      let [pw, ph] = size === 'fit' ? [img.width * 0.75 + 2 * mar, img.height * 0.75 + 2 * mar] : PAGES[size];
      if (size !== 'fit' && (img.width > img.height) !== (pw > ph)) [pw, ph] = [ph, pw];   // a página acompanha a orientação da imagem
      const k = Math.min((pw - 2 * mar) / img.width, (ph - 2 * mar) / img.height), w = img.width * k, h = img.height * k;
      out.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
      setItem(i, `✓ ${img.width}×${img.height}`, 'ok');
    }
    out.setTitle(pdfTitle(title)); out.setProducer('Converterias'); out.setCreator('Converterias');
    say('Gerando o PDF…'); await tick();
    return { bytes: await out.save(), pages: list.length, title, authors: [] };
  }

  function pageRange(text, n) {   // "1-3, 7, 10-" -> [0, 1, 2, 6, 9, ...]
    text = text.trim();
    if (!text) return Array.from({ length: n }, (_, i) => i);
    const set = new Set();
    for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d*)(?:-(\d*))?$/);
      if (!m || (!m[1] && !m[2])) throw new Error(`Páginas inválidas: "${part}". Use algo como 1-5, 8, 10-12.`);
      const a = m[1] ? +m[1] : 1, b = m[2] === undefined ? a : m[2] ? +m[2] : n;
      if (m[2] === '' && a > n) continue;   // "11-" num PDF de 10 páginas: nada (não a última)
      for (let p = Math.max(1, Math.min(a, b)); p <= Math.min(n, Math.max(a, b)); p++) set.add(p - 1);
    }
    if (!set.size) throw new Error(`Esse PDF tem ${n} página(s); nenhuma cai em "${text}".`);
    return [...set].sort((a, b) => a - b);
  }

  async function runPdfToImages() {
    busy = true; cancelled = false; go.disabled = true; fileEl.disabled = true; outBtns.style.display = 'none'; $('cancel').style.display = '';
    results.forEach(r => URL.revokeObjectURL(r.url)); if (zipUrl) URL.revokeObjectURL(zipUrl);
    results = []; zipUrl = null; renderList();
    const png = $('xFmt').value === 'png', dpi = +$('xDpi').value, ext = png ? 'png' : 'jpg', mime = png ? 'image/png' : 'image/jpeg';
    try {
      initPdfjs();
      const used = new Set();
      for (let i = 0; i < files.length; i++) {
        setItem(i, 'Lendo…'); await tick();
        let doc;
        try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(await files[i].arrayBuffer()), isEvalSupported: false }).promise; }
        catch (e) { throw new Error(`${files[i].name}: ${e.name === 'PasswordException' ? 'PDF protegido por senha.' : 'não consegui ler este PDF.'}`); }
        try {
          const idx = pageRange($('xPages').value, doc.numPages), digits = String(doc.numPages).length;
          let base = stem(files[i]).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'PDF', b = base, c = 1;
          while (used.has(b.toLowerCase())) b = `${base} (${++c})`;
          used.add(b.toLowerCase());
          for (let k = 0; k < idx.length; k++) {
            say(`Arquivo ${i + 1} de ${files.length}: página ${idx[k] + 1} (${k + 1} de ${idx.length})…`); setItem(i, `Página ${idx[k] + 1}…`); await tick();
            const page = await doc.getPage(idx[k] + 1);
            let vp = page.getViewport({ scale: dpi / 72 });
            const px = vp.width * vp.height, cap = 60e6;   // limite de pixels por imagem
            if (px > cap) vp = page.getViewport({ scale: dpi / 72 * Math.sqrt(cap / px) });
            const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
            const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
            await page.render({ canvasContext: cx, viewport: vp }).promise;
            const blob = await toBlob(cv, mime, 0.9);
            cv.width = cv.height = 0; page.cleanup();
            if (!blob) throw new Error(`Página ${idx[k] + 1} grande demais para virar imagem. Use uma resolução menor.`);
            const name = `${b} - ${String(idx[k] + 1).padStart(digits, '0')}.${ext}`;
            results.push({ name, url: URL.createObjectURL(blob), bytes: new Uint8Array(await blob.arrayBuffer()), mime });
          }
          setItem(i, `✓ ${idx.length} ${idx.length > 1 ? 'imagens' : 'imagem'}`, 'ok');
        } finally { doc.destroy(); }
      }
      await showOut({ ext, mime, many: png ? 'PNGs' : 'JPEGs' });
      say(`Pronto: ${results.length} ${results.length > 1 ? 'imagens' : 'imagem'}. Toque em baixar.`);
    } catch (e) {
      console.error(e);
      if (results.length) { await showOut({ ext, mime, many: png ? 'PNGs' : 'JPEGs' }); say((cancelled ? 'Cancelado' : 'Erro: ' + (e.message || e)) + `. ${results.length} imagem(ns) já pronta(s): toque em baixar.`, true); }
      else say(cancelled ? 'Cancelado.' : 'Erro: ' + (e.message || e), true);
    }
    busy = false; go.disabled = !files.length; fileEl.disabled = false; $('cancel').style.display = 'none';
  }

  async function runImagesToPdf() {
    busy = true; cancelled = false; go.disabled = true; fileEl.disabled = true; outBtns.style.display = 'none'; $('cancel').style.display = '';
    results.forEach(r => URL.revokeObjectURL(r.url)); if (zipUrl) URL.revokeObjectURL(zipUrl);
    results = []; zipUrl = null; renderList();
    listEl.querySelectorAll('.mv').forEach(d => d.remove());
    try {
      const title = $('iTitle').value.trim() || (files.length === 1 ? stem(files[0]) : guessTitle(files));
      const r = await imagesToPdf(files, title, say);
      const name = makeName(r.title, []) + '.pdf';
      const url = URL.createObjectURL(new Blob([r.bytes], { type: 'application/pdf' }));
      results.push({ name, url, bytes: r.bytes, mime: 'application/pdf' });
      await showOut({ ext: 'pdf', mime: 'application/pdf', many: 'PDFs' });
      say(`Pronto: ${r.pages} ${r.pages > 1 ? 'imagens' : 'imagem'} em um PDF (${(r.bytes.length / 1048576).toFixed(1)} MB). Toque em baixar.`);
    } catch (e) {
      console.error(e);
      say(cancelled ? 'Cancelado.' : 'Erro: ' + (e.message || e), true);
    }
    busy = false; go.disabled = !files.length; fileEl.disabled = false; $('cancel').style.display = 'none';
  }
