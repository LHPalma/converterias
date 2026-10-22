// Metadados de livro: lê e grava os de um EPUB (OPF) ou PDF (Info) e busca no Open Library.
// A busca segue o "Baixar metadados" do Calibre (ver docs/metadados-calibre.md): ISBN primeiro, senão título + 1º autor
// com os mesmos tokens limpos; candidatos ordenados por ISBN igual, capa, título exato e idioma. Tudo roda no navegador.
const Meta = (() => {
  const OL = 'https://openlibrary.org', COVERS = 'https://covers.openlibrary.org';
  const FIELDS = 'key,title,subtitle,author_name,first_publish_year,publish_date,publisher,isbn,language,subject,cover_i,number_of_pages_median';
  // código MARC do Open Library -> idioma do EPUB
  const LANG = { por: 'pt', eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', jpn: 'ja', rus: 'ru', chi: 'zh', zho: 'zh', dut: 'nl', nld: 'nl', lat: 'la', kor: 'ko', ara: 'ar', heb: 'he', gre: 'el', ell: 'el', pol: 'pl', swe: 'sv', dan: 'da', nor: 'no', fin: 'fi', cat: 'ca', glg: 'gl', tur: 'tr', cze: 'cs', ces: 'cs', hun: 'hu', rum: 'ro', ron: 'ro', ukr: 'uk' };
  const norm = s => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // ---------- ISBN ----------
  function isbn13(raw) {   // ISBN válido (10 ou 13) -> ISBN-13; inválido -> ''
    const s = (raw || '').replace(/^(urn:)?isbn:?/i, '').replace(/[\s-]/g, '').toUpperCase();
    if (/^\d{9}[\dX]$/.test(s)) {
      let sum = 0; for (let i = 0; i < 10; i++) sum += (10 - i) * (s[i] === 'X' ? 10 : +s[i]);
      if (sum % 11) return '';
      const b = '978' + s.slice(0, 9); let t = 0; for (let i = 0; i < 12; i++) t += (i % 2 ? 3 : 1) * +b[i];
      return b + ((10 - t % 10) % 10);
    }
    if (/^97[89]\d{10}$/.test(s)) { let t = 0; for (let i = 0; i < 13; i++) t += (i % 2 ? 3 : 1) * +s[i]; return t % 10 ? '' : s; }
    return '';
  }

  // ---------- tokens da consulta (Source.get_title_tokens / get_author_tokens do Calibre) ----------
  function titleQuery(t) {
    return (t || '').replace(/[(\[][^)\]]*[)\]]/g, ' ').split(/\s*[:/]\s+|\s+-\s+/)[0]   // sem parênteses nem subtítulo
      .replace(/(\d),(\d)/g, '$1$2').replace(/[^\p{L}\p{N}']+/gu, ' ').split(' ')
      .filter(w => w && !/^(a|an|and|the|&)$/i.test(w)).join(' ');
  }
  function authorQuery(authors) {
    let a = (authors || []).find(x => x && !/^(desconhecido|unknown)$/i.test(x.trim())) || '';
    if (a.includes(',')) { const [last, first] = a.split(','); a = `${first} ${last}`; }   // "Sobrenome, Nome"
    return a.replace(/[^\p{L}\p{N}'-]+/gu, ' ').split(' ').filter(w => w.length > 2 && !/^(von|van|unknown)$/i.test(w)).join(' ');
  }

  async function getJson(url, signal) {
    const r = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`o Open Library respondeu ${r.status}`);
    return r.json();
  }
  const withTimeout = (ms, outer) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); if (outer) outer.addEventListener('abort', () => c.abort()); return { signal: c.signal, done: () => clearTimeout(t) }; };

  /* busca: { isbn?, title, authors, lang } -> [candidato] já ordenados */
  async function search(q, { signal, timeout = 15000 } = {}) {
    const isbn = isbn13(q.isbn), url = p => `${OL}/search.json?${new URLSearchParams({ ...p, fields: FIELDS, limit: '10' })}`;
    const tries = [];
    if (isbn) tries.push({ isbn });
    const t = titleQuery(q.title), a = authorQuery(q.authors);
    if (t) tries.push(a ? { title: t, author: a } : { title: t });
    if (t && a) tries.push({ q: `${t} ${a}` });   // último recurso: busca livre
    if (!tries.length) throw new Error('preencha o título ou o ISBN para buscar.');
    let docs = [];
    for (const p of tries) {
      const w = withTimeout(timeout, signal);
      try { docs = (await getJson(url(p), w.signal)).docs || []; }
      catch (e) { if (signal && signal.aborted) throw e; throw new Error(e.name === 'AbortError' ? 'o Open Library demorou demais para responder.' : 'não consegui falar com o Open Library (sem internet?).'); }
      finally { w.done(); }
      if (docs.length) break;
    }
    const want = norm(q.title.split(/\s*[:]\s+|\s+-\s+/)[0]), lang = (q.lang || '').slice(0, 2).toLowerCase();
    const cands = docs.map((d, rank) => {
      const langs = (d.language || []).map(l => LANG[l] || l);
      const isbns = [...new Set((d.isbn || []).map(isbn13).filter(Boolean))];
      return {
        key: d.key, rank, source: 'Open Library',
        title: d.title || '', subtitle: d.subtitle || '',
        authors: d.author_name || [],
        publisher: (d.publisher || [])[0] || '',
        date: d.first_publish_year ? String(d.first_publish_year) : '',
        isbn: isbn && isbns.includes(isbn) ? isbn : isbns[0] || '',
        lang: lang && langs.includes(lang) ? lang : langs[0] || '',
        tags: (d.subject || []).filter(s => s.length < 40).slice(0, 20),
        pages: d.number_of_pages_median || 0,
        cover: d.cover_i ? `${COVERS}/b/id/${d.cover_i}-L.jpg` : isbns[0] ? `${COVERS}/b/isbn/${isbns[0]}-L.jpg?default=false` : '',
        thumb: d.cover_i ? `${COVERS}/b/id/${d.cover_i}-M.jpg` : '',
        _isbnHit: !!isbn && isbns.includes(isbn), _exact: norm(d.title) === want, _lang: !!lang && langs.includes(lang),
      };
    });
    // ordem do Calibre (InternalMetadataCompareKeyGen): identificador igual > tem capa > título exato > idioma > ordem da fonte
    cands.sort((x, y) => (y._isbnHit - x._isbnHit) || (!!y.thumb - !!x.thumb) || (y._exact - x._exact) || (y._lang - x._lang) || (x.rank - y.rank));
    return cands;
  }

  /* detalhes da obra escolhida: descrição e assuntos (works/<id>.json) */
  async function details(c, { signal, timeout = 15000 } = {}) {
    if (!c.key) return c;
    const w = withTimeout(timeout, signal);
    try {
      const j = await getJson(`${OL}${c.key}.json`, w.signal);
      const d = typeof j.description === 'string' ? j.description : j.description && j.description.value || '';
      return { ...c, description: d.replace(/\r/g, '').replace(/\(\[source\]\[\d+\]\)|\[\d+\]: \S+/g, '').trim(), tags: c.tags.length ? c.tags : (j.subjects || []).slice(0, 20) };
    } catch (e) { return c; }   // sem descrição: fica o que a busca trouxe
    finally { w.done(); }
  }

  /* capa: bytes JPEG/PNG; null se não houver (404, placeholder minúsculo, sem CORS) */
  async function cover(url, { signal } = {}) {
    if (!url) return null;
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) return null;
      const blob = await r.blob(), bm = await createImageBitmap(blob);
      const ok = bm.width >= 50 && bm.height >= 50 && bm.height / bm.width < 3 && bm.width / bm.height < 3;   // como o Calibre: menor que 50×50 é lixo
      const out = ok ? { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || 'image/jpeg', w: bm.width, h: bm.height } : null;
      bm.close(); return out;
    } catch (e) { return null; }
  }

  // ---------- EPUB (OPF) ----------
  const DC = 'http://purl.org/dc/elements/1.1/', OPF = 'http://www.idpf.org/2007/opf';
  const dir = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
  const join = (base, rel) => { try { return decodeURIComponent(new URL(rel, 'http://x/' + base).pathname.slice(1)); } catch (e) { return dir(base) + rel; } };
  async function openEpub(bytes) {
    let zip;
    try { zip = await JSZip.loadAsync(bytes); } catch (e) { throw new Error('não consegui abrir este EPUB.'); }
    const cont = zip.file('META-INF/container.xml'), opfPath = cont && (/full-path="([^"]+)"/.exec(await cont.async('string')) || [])[1];
    const opfFile = opfPath && zip.file(opfPath);
    if (!opfFile) throw new Error('não parece um EPUB válido (sem content.opf).');
    const doc = new DOMParser().parseFromString(await opfFile.async('string'), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('o content.opf deste EPUB está quebrado.');
    return { kind: 'epub', zip, opfPath, doc };
  }
  const dcs = (doc, n) => [...doc.getElementsByTagNameNS(DC, n)];
  const metaEl = doc => doc.getElementsByTagNameNS(OPF, 'metadata')[0] || doc.getElementsByTagName('metadata')[0];
  function epubCoverItem(b) {
    const items = [...b.doc.getElementsByTagNameNS(OPF, 'item')];
    const byProp = items.find(i => /\bcover-image\b/.test(i.getAttribute('properties') || ''));
    const m = [...b.doc.getElementsByTagNameNS(OPF, 'meta')].find(x => x.getAttribute('name') === 'cover');
    return byProp || (m && items.find(i => i.getAttribute('id') === m.getAttribute('content'))) || null;
  }
  async function readEpub(b) {
    const d = b.doc, txt = n => (dcs(d, n)[0] || { textContent: '' }).textContent.trim();
    const creators = dcs(d, 'creator');
    const aut = creators.filter(c => { const r = c.getAttributeNS(OPF, 'role') || c.getAttribute('opf:role'); return !r || r === 'aut'; });
    const metas = [...d.getElementsByTagNameNS(OPF, 'meta')];
    const metaVal = n => { const m = metas.find(x => x.getAttribute('name') === n); return m ? m.getAttribute('content') || '' : ''; };
    const coll = metas.find(x => x.getAttribute('property') === 'belongs-to-collection');
    const collIdx = coll && coll.getAttribute('id') ? metas.find(x => x.getAttribute('property') === 'group-position' && x.getAttribute('refines') === '#' + coll.getAttribute('id')) : null;
    const isbn = dcs(d, 'identifier').map(e => isbn13(e.textContent)).find(Boolean) || '';
    const ci = epubCoverItem(b);
    let cover = null;
    if (ci) { const f = b.zip.file(join(b.opfPath, ci.getAttribute('href'))); if (f) cover = { bytes: await f.async('uint8array'), type: ci.getAttribute('media-type') || 'image/jpeg' }; }
    return {
      title: txt('title'), authors: (aut.length ? aut : creators).map(c => c.textContent.trim()).filter(Boolean),
      publisher: txt('publisher'), date: txt('date'), lang: txt('language'), isbn,
      description: txt('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      tags: dcs(d, 'subject').map(e => e.textContent.trim()).filter(Boolean),
      series: metaVal('calibre:series') || (coll ? coll.textContent.trim() : ''),
      seriesIndex: metaVal('calibre:series_index') || (collIdx ? collIdx.textContent.trim() : ''),
      cover,
    };
  }
  function setDc(d, md, name, values, attrs = {}) {
    for (const e of dcs(d, name)) if (!(name === 'creator' && (e.getAttributeNS(OPF, 'role') || e.getAttribute('opf:role') || 'aut') !== 'aut')) e.remove();
    for (const v of values) {
      if (!v) continue;
      const e = d.createElementNS(DC, 'dc:' + name); e.textContent = v;
      for (const [k, x] of Object.entries(attrs)) e.setAttribute(k, x);
      md.appendChild(e);
    }
  }
  async function toImageType(c, type) {   // a capa nova no formato da antiga (para trocar o arquivo no lugar)
    if (c.type === type || !/^image\/(jpeg|png|webp)$/.test(type)) return c.bytes;
    const bm = await createImageBitmap(new Blob([c.bytes], { type: c.type })), cv = document.createElement('canvas');
    cv.width = bm.width; cv.height = bm.height; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bm, 0, 0); bm.close();
    return new Uint8Array(await (await new Promise(r => cv.toBlob(r, type, 0.92))).arrayBuffer());
  }
  async function writeEpub(b, m) {
    const d = b.doc, md = metaEl(d);
    if (!md) throw new Error('o content.opf não tem <metadata>.');
    const uid = (d.documentElement.getAttribute('unique-identifier') || '');
    setDc(d, md, 'title', [m.title]);
    setDc(d, md, 'creator', m.authors);
    setDc(d, md, 'publisher', [m.publisher]);
    setDc(d, md, 'date', [m.date]);
    setDc(d, md, 'language', [m.lang]);
    setDc(d, md, 'description', [m.description]);
    setDc(d, md, 'subject', m.tags);
    // ISBN: um dc:identifier próprio, sem mexer no identificador único do livro
    for (const e of dcs(d, 'identifier')) if (e.getAttribute('id') !== uid && isbn13(e.textContent)) e.remove();
    const isbn = isbn13(m.isbn);
    if (isbn && !dcs(d, 'identifier').some(e => isbn13(e.textContent) === isbn)) { const e = d.createElementNS(DC, 'dc:identifier'); e.textContent = 'urn:isbn:' + isbn; md.appendChild(e); }
    // série: o meta do Calibre (que o Kindle e o Calibre leem) e o belongs-to-collection do EPUB 3
    for (const x of [...d.getElementsByTagNameNS(OPF, 'meta')]) {
      const n = x.getAttribute('name'), p = x.getAttribute('property');
      if (n === 'calibre:series' || n === 'calibre:series_index' || p === 'belongs-to-collection' || (p === 'group-position' || p === 'collection-type') && /^#col/.test(x.getAttribute('refines') || '')) x.remove();
    }
    if (m.series) {
      const add = (attrs, text) => { const e = d.createElementNS(OPF, 'meta'); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; md.appendChild(e); };
      add({ name: 'calibre:series', content: m.series });
      if (m.seriesIndex) add({ name: 'calibre:series_index', content: m.seriesIndex });
      if (/^3/.test(d.documentElement.getAttribute('version') || '')) {
        add({ property: 'belongs-to-collection', id: 'colserie' }, m.series);
        add({ refines: '#colserie', property: 'collection-type' }, 'series');
        if (m.seriesIndex) add({ refines: '#colserie', property: 'group-position' }, m.seriesIndex);
      }
    }
    // capa nova: troca o arquivo da antiga no lugar (a página de capa do livro também passa a mostrá-la); sem capa, cria
    if (m.newCover) {
      const ci = epubCoverItem(b);
      if (ci) {
        const path = join(b.opfPath, ci.getAttribute('href'));
        b.zip.file(path, await toImageType(m.newCover, ci.getAttribute('media-type') || 'image/jpeg'));
      } else {
        const ext = m.newCover.type === 'image/png' ? 'png' : 'jpg', href = `capa-openlibrary.${ext}`;
        const mani = d.getElementsByTagNameNS(OPF, 'manifest')[0], it = d.createElementNS(OPF, 'item');
        it.setAttribute('id', 'capa-openlibrary'); it.setAttribute('href', href); it.setAttribute('media-type', ext === 'png' ? 'image/png' : 'image/jpeg');
        if (/^3/.test(d.documentElement.getAttribute('version') || '')) it.setAttribute('properties', 'cover-image');
        mani.appendChild(it);
        const mc = d.createElementNS(OPF, 'meta'); mc.setAttribute('name', 'cover'); mc.setAttribute('content', 'capa-openlibrary'); md.appendChild(mc);
        b.zip.file(dir(b.opfPath) + href, m.newCover.bytes);
      }
    }
    b.zip.file(b.opfPath, new XMLSerializer().serializeToString(d).replace(/^(?!<\?xml)/, '<?xml version="1.0" encoding="UTF-8"?>\n'));
    b.zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    return b.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
  }

  // ---------- PDF (dicionário Info) ----------
  async function openPdf(bytes) {
    let pdf;
    try { pdf = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (e) { throw new Error(/encrypt/i.test(e.name + e.message) ? 'PDF protegido por senha.' : 'não consegui ler este PDF.'); }
    return { kind: 'pdf', pdf };
  }
  function readPdf(b) {
    const p = b.pdf, kw = p.getKeywords() || '';
    const authors = (p.getAuthor() || '').split(/\s*[;&]\s*|\s+e\s+|\s+and\s+/).map(s => s.trim()).filter(Boolean);
    return { title: p.getTitle() || '', authors, publisher: '', date: '', lang: '', isbn: '', description: p.getSubject() || '',
      tags: kw.split(/\s*[;,]\s*/).map(s => s.trim()).filter(Boolean), series: '', seriesIndex: '', cover: null };
  }
  async function writePdf(b, m) {
    const p = b.pdf;
    p.setTitle(m.title || ''); p.setAuthor(m.authors.join('; '));
    p.setSubject(m.description || ''); p.setKeywords(m.tags.length ? m.tags : []);
    p.setModificationDate(new Date());
    return p.save();
  }

  async function open(bytes, name) {
    const b = bytes[0] === 0x25 && bytes[1] === 0x50 ? await openPdf(bytes) : bytes[0] === 0x50 && bytes[1] === 0x4b ? await openEpub(bytes) : null;
    if (!b) throw new Error(`${name || 'arquivo'}: a aba Metadados recebe EPUB ou PDF.`);
    b.meta = b.kind === 'epub' ? await readEpub(b) : readPdf(b);
    return b;
  }
  const save = (b, m) => b.kind === 'epub' ? writeEpub(b, m) : writePdf(b, m);

  return { open, save, search, details, cover, isbn13, _titleQuery: titleQuery, _authorQuery: authorQuery };
})();
