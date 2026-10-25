  // src/app/para-kindle.js: abas Para Kindle (EPUB/PDF → AZW3/KFX, com src/azw3.js e src/kfx.js) e Mangá (PDF/CBZ → AZW3, com src/manga.js).
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/para-kindle.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  async function kindleConvert(file, say) {   // EPUB -> AZW3/KFX; PDF -> EPUB -> AZW3/KFX
    const kind = await kindOf(file);
    if (!kind) throw new Error('não é EPUB nem PDF.');
    let epub, meta = {};
    if (kind === 'pdf') { meta = await pdfToEpub(file, say); epub = meta.bytes; }
    else epub = new Uint8Array(await file.arrayBuffer());
    const a = await (kFmt() === 'kfx' ? Kfx : Azw3).convert(epub, { say, tick });
    return { bytes: a.bytes, title: a.title, authors: a.authors, chapters: a.sections, garbledPages: meta.garbledPages };
  }

  async function mangaConvert(file, say) {   // PDF ou CBZ -> AZW3 de layout fixo (mangá)
    const k = await kindOf(file);
    if (k !== 'pdf' && !(k === 'epub' && /\.cb[zr]$/i.test(file.name))) {   // ZIP: só como CBZ (há .cbr que é ZIP por dentro)
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      if (String.fromCharCode(...head) === 'Rar!') throw new Error('CBR (compactado em RAR) ainda não dá: extraia e compacte as imagens em ZIP (.cbz), ou converta para PDF.');
      throw new Error('a aba Mangá recebe PDF ou CBZ.');
    }
    initPdfjs();
    return Manga.convert(file, {
      say, tick,
      dev: Manga.deviceById($('mDev').value),
      rtl: $('mDir').value === 'rtl',
      cbz: mFmt() === 'cbz',
      panels: $('mPanels').value === 'auto' ? 'auto' : +$('mPanels').value,
      split: $('mSplit').checked,
      crop: $('mCrop').checked,
      level: $('mLevel').checked,
      png: $('mPng').checked,
      eink: $('mEink').checked,
      title: stem(file),
    });
  }
