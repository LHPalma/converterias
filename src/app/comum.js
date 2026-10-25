  // src/app/comum.js: Nomes de arquivo (Title Case, autores), caminhos dentro do ZIP e constantes de página.
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/comum.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- nome do arquivo: Title Case - Subtítulo (Autor) ----------
  const STOP = new Set(('a o as os um uns uma umas de do da dos das em no na nos nas num numa por pelo pela pelos pelas ' +
    'para pra com sem sob sobre ao aos à às e ou nem até entre perante após ante desde contra ' +
    'the an of and in on at to for but or nor by with from').split(' '));
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  function titleCase(str) {
    const mixed = /\p{Ll}/u.test(str) && /\p{Lu}/u.test(str);
    const words = str.trim().split(/\s+/);
    return words.map((w, i) => w.split('-').map((part, j, arr) => {
      const core = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!core) return part;
      const low = core.toLowerCase(), hasLower = /\p{Ll}/u.test(core), hasUpper = /\p{Lu}/u.test(core);
      let out;
      if (!(i === 0 && j === 0) && i < words.length - 1 && arr.length === 1 && STOP.has(low)) out = low;
      else if (!hasLower && hasUpper && mixed && core.length > 1 && core.length <= 5) out = core;   // sigla/romano já em maiúsculas
      else {
        const base = (!hasLower && hasUpper) ? low : core;
        const m = base.match(/^([dl]['’])(.+)$/i);                                 // d'Água
        out = m && !(i === 0 && j === 0) ? m[1].toLowerCase() + cap(m[2]) : cap(base);
      }
      return part.replace(core, out);
    }).join('-')).join(' ');
  }
  const isSuffix = p => /^(jr|sr|filho|neto|júnior|junior)\.?$/i.test(p);   // "Silva, Jr." é um nome só, não "Sobrenome, Nome"
  function cleanAuthors(raw) {   // um campo pode trazer vários autores; devolve lista de nomes
    const out = [];
    for (const piece of raw.replace(/\s+/g, ' ').trim().split(/\s*[;&/|+]\s*|\s+(?:and|e)\s+(?=\p{Lu})/u)) {
      if (!piece) continue;
      const parts = piece.split(/\s*,\s*/).filter(Boolean);
      if (parts.length === 2 && parts[0].split(' ').length === 1 && !isSuffix(parts[1])) out.push(parts[1] + ' ' + parts[0]);   // "Sobrenome, Nome"
      else if (parts.length > 1 && !parts.slice(1).some(isSuffix)) out.push(...parts);                                         // lista separada por vírgula
      else out.push(piece);
    }
    return out.map(titleCase);
  }
  const bad = /[\\/:*?"<>|\u0000-\u001f]+/g;
  const titleParts = t => t.split(/\s*:\s+|\s+[-–—]\s+|\s*[–—]\s*/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // título dos metadados do PDF: o mesmo padrão do nome do arquivo (Title Case, subtítulo depois de " - ")
  const pdfTitle = t => { const p = titleParts(t || ''); return p.length ? p.map(titleCase).join(' - ') : (t || '').trim(); };
  function makeName(title, authors) {
    const parts = titleParts(title).map(s => s.replace(bad, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    let name = (parts.length ? parts : ['Livro']).map(titleCase).join(' - ');
    let au = authors.flatMap(cleanAuthors).filter(Boolean);
    if (au.length > 3) au = [au[0] + ' et al.'];
    const suffix = au.length ? ` (${au.join(', ').replace(bad, ' ')})` : '';
    if (name.length + suffix.length > 190) name = name.slice(0, 190 - suffix.length).trim();
    return name + suffix;
  }

  // ---------- caminhos dentro do zip ----------
  const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
  function resolve(base, rel) {
    rel = rel.split('#')[0].split('?')[0];
    try { rel = decodeURIComponent(rel); } catch (e) {}
    const parts = (rel.startsWith('/') ? rel.slice(1) : dirname(base) + rel).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    return out.join('/');
  }

  // ---------- constantes de página ----------
  const MM = 72 / 25.4;
  const PAGES = { letter: [612, 792], A4: [595.276, 841.89], A5: [419.528, 595.276] };
  const BLOCK = new Set(['p','div','h1','h2','h3','h4','h5','h6','li','blockquote','pre','section','article','aside',
    'header','footer','figure','figcaption','ul','ol','table','tr','dd','dt','dl','hr','body','nav','main','caption']);
  const SKIP = new Set(['head','script','style','title','meta','link','audio','video','iframe','object','embed','canvas','map']);
