  // src/app/pdf2epub.js: PDF → EPUB, parte 2: páginas → blocos (títulos, parágrafos, notas, figuras, sumário) → EPUB. A aba Índice também usa (opt.index).
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/pdf2epub.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  async function pdfToEpub(file, say) {
    say('Lendo o arquivo…'); await tick();
    initPdfjs();
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) { throw new Error(e && e.name === 'PasswordException' ? 'PDF protegido por senha.' : 'Não parece um PDF válido.'); }
    try {
      if ($('pOcr').checked && await isScanned(doc)) return await scanDocToEpub(doc, file, say);
      return await pdfDocToEpub(doc, file, say);
    } finally { doc.destroy(); spellDict = null; await ocrStop(); }
  }

  // opt.index: só descobre o sumário (para a aba Índice do PDF) — { skipOutline, prefer: 'auto' | 'printed' | 'headings' }
  async function pdfDocToEpub(doc, file, say, opt = {}) {
    const { OPS, Util, AnnotationMode } = pdfjsLib;
    const IX = opt.index || null;
    const wantCover = !IX && $('pCover').checked, wantImgs = !IX && $('pImgs').checked, dropHf = IX ? true : $('pHf').checked;
    const IMG_OPS = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter(x => x !== undefined));
    const images = [];   // { name, bytes }
    const jpeg = async (cv, x, y, w, h, q = 0.85, maxDim = 0) => {   // recorta (e, se pedido, reduz) e codifica em JPEG
      let c = cv;
      const k = maxDim ? Math.min(1, maxDim / Math.max(w, h)) : 1;
      if (x || y || w !== cv.width || h !== cv.height || k < 1) {
        c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        c.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, c.width, c.height);
      }
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const render = async (page, vp1, top = 2.5) => {
      const scale = Math.min(top, 2600 / Math.max(vp1.width, vp1.height));
      const vp = page.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: cx, viewport: vp, annotationMode: AnnotationMode.DISABLE }).promise;
      return { cv, scale };
    };

    // 1) páginas -> linhas (texto posicionado) e figuras
    const pages = [], N = doc.numPages, glyphs = [], glyphIdx = new Map(), mctx = document.createElement('canvas').getContext('2d');
    const lex = new Set();   // palavras inteiras vistas em trechos sem acento solto (para decidir "livro ´e" x "ent ˜ao")
    const addLex = str => { if (!/[˜ˆˇ˘˙˚˝¸¨¯˛´`]/.test(str)) for (const w of str.toLowerCase().match(/\p{L}{2,}/gu) || []) lex.add(w); };
    let texDoc = false;   // acentos soltos (˜ ˆ ¸…) nas primeiras páginas: documento TeX, onde ´ e ` também são acentos desenhados à parte
    { let hits = 0;
      for (let pn = 1; pn <= Math.min(N, 12); pn++) {
        const tc0 = await (await doc.getPage(pn)).getTextContent();
        tc0.items.forEach(i => addLex(i.str));
        hits += (tc0.items.map(i => i.str).join('\n').match(/[˜ˆˇ˘˙˚˝¨¯˛][A-Za-zıȷ]|[A-Za-z][¸˛]|[˜ˆˇ˘˙˚˝¸¨¯˛]\s*\n/g) || []).length;
      }
      texDoc = hits >= 3; }
    let cover = null;
    for (let pn = 1; pn <= N; pn++) {
      say(`Lendo página ${pn} de ${N}…`); await tick();
      try {
        const page = await doc.getPage(pn);
        const vp = page.getViewport({ scale: 1 }), W = vp.width, H = vp.height;
        const [tc, ol] = await Promise.all([
          page.getTextContent(),
          page.getOperatorList({ annotationMode: AnnotationMode.DISABLE }).catch(() => null),
        ]);
        // estilo de cada fonte (o nome real só aparece depois da lista de operadores)
        const fontStyle = {};
        const styleOf = id => {
          if (!(id in fontStyle)) {
            let name = '', fo = null;
            try { if (page.commonObjs.has(id)) { fo = page.commonObjs.get(id); name = fo.name || ''; } } catch (e) {}
            fontStyle[id] = {
              n: name || id,
              b: !!(fo && (fo.bold || fo.black)) || /bold|black|heavy|semibold|demi/i.test(name),
              i: !!(fo && fo.italic) || /italic|oblique|-it$|kursiv/i.test(name),
              x: /CMMI|CMSY|CMEX|CMBSY|MSAM|MSBM|MTMI|MTSY|MTEX|MTSYN|MTEXTRA|MathematicalPi|^(?:[A-Z]{6}\+)?Symbol|STIX.{0,12}Math|Cambria.?Math|LMMath|LMMI|LMSY|LMEX|EUFM|EUSM|EURM|RSFS|MnSymbol|Latin ?Modern ?Math|Asana.?Math|XITS.?Math|TeXGyre.{0,16}Math|(?:^|\+)(?:txmi|txsy|pxmi|pxsy|zmmi|zmsy)/i.test(name),
              m: !!(fo && (fo.isMonospace || fo.fallbackName === 'monospace')) || /mono|courier|consol|menlo|monaco|typewriter|cmtt|lucida console|inconsolata|source ?code|fira ?code|\bcode\b/i.test(name),
            };
          }
          return fontStyle[id];
        };

        const { shapes, hasImg, bigImg } = ol ? drawnShapes(ol, vp, W, H, IMG_OPS, OPS, Util) : { shapes: [], hasImg: false, bigImg: false };

        // itens de texto em coordenadas da página (y para baixo)
        const raw = [], pageGl = [];
        for (const it of tc.items) {
          if (!it.str || !it.str.trim()) continue;
          const m = Util.transform(vp.transform, it.transform);
          const size = Math.hypot(m[2], m[3]);
          if (size < 1) continue;
          const dl = Math.hypot(m[0], m[1]) || 1;   // direção do texto: 0 (normal), 90 (descendo), 180 (de cabeça para baixo), 270 (subindo); outras inclinações são ignoradas
          const ang = Math.abs(m[1]) < 0.05 * dl ? (m[0] > 0 ? 0 : 180) : Math.abs(m[0]) < 0.05 * dl ? (m[1] > 0 ? 90 : 270) : -1;
          if (ang < 0) continue;
          const st0 = styleOf(it.fontName), mono = st0.m;
          let src = it.str;
          if (wantImgs && /[\u0000-\u0008\u000e-\u001f]/.test(src)) {   // glifo sem Unicode (símbolo matemático, marcador): vira uma imagem pequena do próprio glifo
            // posição de cada caractere: larguras medidas numa fonte parecida (glifo desconhecido = 0,62 em), ajustadas à largura real do item
            const isCtl = c => /[\u0000-\u0008\u000e-\u001f]/.test(c);
            mctx.font = `${st0.i ? 'italic ' : ''}${st0.b ? 'bold ' : ''}${size}px ${st0.m ? 'monospace' : 'serif'}`;
            const ws = [...src].map(c => isCtl(c) ? 0.62 * size : mctx.measureText(c).width), tot = ws.reduce((a, b) => a + b, 0) || 1, k = it.width / tot;
            let out = '', acc = 0;
            [...src].forEach((c, n) => {
              const gx = m[4] + acc * k, gw = ws[n] * k; acc += ws[n];
              if (!isCtl(c)) { out += c; return; }
              const key = c === '\u0000' ? 'nul|' + glyphs.length : st0.n + '|' + c.charCodeAt(0), pad = 0.04 * size, exact = src.length === 1;
              const box = [gx - pad, m[5] - size * 0.92, gx + gw + pad, m[5] + size * 0.36];
              let g = glyphIdx.get(key);
              if (!g) { g = { id: glyphs.length, box, exact, list: pageGl, size, it: st0.i, bd: st0.b, nul: c === '\u0000' }; glyphs.push(g); glyphIdx.set(key, g); pageGl.push(g); }
              else if (exact && !g.exact) { const at = g.list.indexOf(g); if (at >= 0) g.list.splice(at, 1); g.box = box; g.exact = true; g.list = pageGl; pageGl.push(g); }   // ocorrência isolada: caixa exata
              out += '\uFFFC' + g.id + '\uFFFC';
            });
            src = out;
          }
          let nAcc = 0;
        if (!mono) [src, nAcc] = composeAcc(src, texDoc);
        raw.push({ ang, x: m[4], y: m[5], w: Math.max(0, it.width - nAcc * 0.33 * size), size, mono, st: st0, str: (mono ? src.replace(/\t/g, '    ') : src).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f­​﻿]/g, '').replace(/[\u21a9\u21b5\ufe0e]/g, '').replace(mono ? /[^\S ]+/g : /\s+/g, ' '), font: it.fontName });
        }
        // página inteira girada (tabela em paisagem, digitalização de lado): usa a orientação dominante e endireita as coordenadas
      let pageRot = 0, WW = W, HH = H;
      { const by = { 0: 0, 90: 0, 180: 0, 270: 0 }; for (const r of raw) by[r.ang] += r.str.length;
        pageRot = +Object.entries(by).sort((a, b) => b[1] - a[1])[0][0];
        for (let i = raw.length - 1; i >= 0; i--) if (raw[i].ang !== pageRot) raw.splice(i, 1);
        if (pageRot) {
          for (const r of raw) {
            const px = r.x, py = r.y;
            if (pageRot === 90) { r.x = py; r.y = W - px; } else if (pageRot === 270) { r.x = H - py; r.y = px; } else { r.x = W - px; r.y = H - py; }
          }
          if (pageRot !== 180) { WW = H; HH = W; }
        } }
      if (texDoc) raw.forEach(r => addLex(r.str));
      // cedilha/ogonek soltos no começo de um trecho ("¸ ˜"): vão para a última letra do trecho anterior
      for (let i = 1; i < raw.length; i++) {
        const r = raw[i], pv = raw[i - 1], m = !r.mono && !pv.mono && r.str.match(/^\s*([¸˛])\s*(.*)$/);
        if (!m || Math.abs(pv.y - r.y) > 0.4 * r.size || Math.abs(r.x - (pv.x + pv.w)) > 0.9 * r.size || !/[cCsStT]\s*$/.test(pv.str)) continue;
        const t = pv.str.replace(/\s+$/, ''); pv.str = t.slice(0, -1) + (t.slice(-1) + ACC[m[1]]).normalize('NFC'); r.str = m[2]; r.w = Math.max(0, r.w - (pv.x + pv.w - r.x) - 0.33 * r.size); r.x = pv.x + pv.w;   // o resto do trecho continua colado à palavra
      }
      // acento no fim de um trecho e a letra no começo do próximo ("ent ˜" + "ao"): junta no próximo
      for (let i = 0; i + 1 < raw.length; i++) {
        const r = raw[i], nx = raw[i + 1], m = !r.mono && !nx.mono && r.str.match(/^(.*?)(\s*)([˜ˆˇ˘˙˚˝¸¨¯˛´`])$/);
        if (!m || Math.abs(nx.y - r.y) > 0.4 * r.size || nx.x - (r.x + r.w) > 0.6 * r.size || !/^[A-Za-zıȷ]/.test(nx.str)) continue;
        if (ACC_TEX_ONLY.has(m[3]) && !(texDoc && /^[aeiouyıAEIOUY]/.test(nx.str))) continue;
        if ((m[3] === '¸' || m[3] === '˛') && !CEDILLA_OK.test(nx.str[0])) continue;
        // o espaço antes do acento é de palavra ("O livro ´e") ou só do avanço do acento ("ent ˜ao")? sem diferença na geometria:
        // vale se o que vem antes é uma palavra inteira que o próprio texto usa em outros lugares ("livro"), não um pedaço ("ent")
        let space = '';
        if (m[2]) {
          const last = (m[1].match(/(\p{L}+)$/u) || [''])[0].toLowerCase();
          if (last.length >= 2 ? lex.has(last) : /^[aeo]$/.test(last)) space = ' ';
        }
        const composed = (dotless(nx.str[0]) + ACC[m[3]]).normalize('NFC');
        if (!space && m[2] && /^[éàáóòè]$/.test(composed) && !/^\p{L}/u.test(nx.str.slice(1))) space = ' ';   // palavra de uma letra: "é", "à"
        r.str = m[1] + space; nx.str = composed + nx.str.slice(1);
        r.w = Math.max(0, nx.x - r.x - (space ? 0.3 * r.size : 0));   // o trecho termina onde o próximo começa (o acento não ocupa espaço)
      }
      for (let i = raw.length - 1; i >= 0; i--) if (!raw[i].str.trim()) raw.splice(i, 1);   // trechos que ficaram vazios depois de mover os acentos
      const chars = raw.reduce((n, r) => n + r.str.trim().length, 0);

        const figs = [];
        let full = false;
        if (pn === 1 && wantCover) {
          cover = { pn: 1 };
          if (chars < 400 && bigImg) full = true;   // capa ilustrada: o texto já está na imagem (se for só texto, ele continua no livro)
        }
        if (!full && wantImgs) {
          if (chars < 30 && (hasImg || shapes.length > 30)) { figs.push({ t: 'img', page: true, top: 0, box: [0, 0, W, H], pn }); full = true; }   // página escaneada ou só ilustração
          else if (!pageRot) for (const f of figureRegions(shapes, raw, W, H, chars)) figs.push({ t: 'img', top: f.box[1], box: f.box, alt: f.alt, pn });
        if (figs.length) { const gs = findGutters(raw, modeOf(raw.map(r => [r.size, r.str.length]), 0.5) || 10); for (const f of figs) f.col = (f.box[2] - f.box[0]) > 0.6 * (W - 20) ? 0 : gs.filter(g => (f.box[0] + f.box[2]) / 2 > g).length; }
        }

        // escrita da direita para a esquerda: formas de apresentação árabes vêm em ordem visual; a geometria é espelhada
        let rtlN = 0, ltrN = 0;
        for (const r of raw) {
          if (/[\ufb50-\ufdff\ufe70-\ufeff]/.test(r.str)) r.str = [...r.str].reverse().join('').normalize('NFKC');
          for (const ch of r.str) if (/\p{L}/u.test(ch)) { if (RTL_CH.test(ch)) rtlN++; else ltrN++; }
        }
        const rtlPage = rtlN > 20 && rtlN > ltrN;
        let lines = [];
        if (!full) {
          const inFig = r => figs.some(f => r.x + r.w / 2 > f.box[0] - 2 && r.x + r.w / 2 < f.box[2] + 2 && r.y - r.size / 3 > f.box[1] - 2 && r.y - r.size / 3 < f.box[3] + 2);
          const keep = raw.filter(r => !inFig(r));   // texto dentro da figura já está na imagem
          lines = pageLines(rtlPage ? keep.map(r => ({ ...r, x: WW - (r.x + r.w) })) : keep, pn, rtlPage);
        }
        lines.forEach((L, i) => { if (L.mono && !((lines[i - 1] && lines[i - 1].mono) || (lines[i + 1] && lines[i + 1].mono) || L.text.length >= 30)) L.mono = false; });
        if (!rtlPage) {   // marcadores de lista desenhados como formas pequenas à esquerda do começo da linha
          const dots = shapes.filter(q => q.k !== 'rule' && q.k !== 'img' && q.b[2] - q.b[0] >= 1.5 && q.b[2] - q.b[0] <= 16 && q.b[3] - q.b[1] >= 1.5 && q.b[3] - q.b[1] <= 16);
          for (const L of lines) {
            if (L.span || LIST_START.test(L.text)) continue;
            if (dots.some(q => { const cx = (q.b[0] + q.b[2]) / 2, cy = (q.b[1] + q.b[3]) / 2; return cx < L.x0 - 0.3 * L.size && L.x0 - cx < 3.2 * L.size && cy > L.top - 0.1 * L.size && cy < L.y + 0.3 * L.size; })) {
              L.runs.unshift({ t: '• ', b: false, i: false, m: false, sup: 0, pn }); L.text = '• ' + L.text;
            }
          }
        }
        pages.push({ pn, vp, W: WW, H: HH, lines, figs, glyphs: pageGl, rtl: rtlPage, cols: Math.max(1, ...lines.map(L => L.col + 1)) });
        page.cleanup();
      } catch (e) {   // página com defeito: segue sem ela
        if (/cancelad/i.test(e && e.message)) throw e;
        console.warn('página ignorada', pn, e);
        pages.push({ pn, vp: { convertToViewportPoint: (x, y) => [x, y] }, W: 612, H: 792, lines: [], figs: [], glyphs: [], cols: 1 });
      }
    }

    // texto ilegível (fonte sem mapa Unicode: "QPTTVFN" no lugar de "possuem"): a página vira imagem em vez de lixo
    let garbledPages = 0;
    if (wantImgs) {
      const STOPALL = new Set(Object.values(STOPW).flat());
      for (const P of pages) {
        if (P.figs.some(f => f.page)) continue;
        const toks = (P.lines.filter(L => !L.mono).map(L => L.text).join(' ').toLowerCase().match(/\p{L}+/gu) || []).filter(t => /^[a-zà-ÿ]+$/.test(t));
        if (toks.length < 80) continue;
        const rate = toks.filter(t => STOPALL.has(t)).length / toks.length, noVowel = toks.filter(t => t.length >= 3 && !/[aeiouyàáâãäèéêëìíîïòóôõöùúûü]/.test(t)).length / toks.length;
        if (rate < 0.04 && noVowel >= 0.12) { P.lines = []; P.figs = [{ t: 'img', page: true, top: 0, box: [0, 0, P.W, P.H], pn: P.pn, col: 0 }]; P.glyphs = []; garbledPages++; }
      }
    }

    // 2) estatísticas do texto principal
    const flat = () => pages.flatMap(P => P.lines);
    if (!flat().length && !pages.some(P => P.figs.length) && !cover) throw new Error('Não encontrei texto nem imagens neste PDF.');
    const sizeChars = new Map();
    for (const L of flat()) { const k = Math.round(L.size * 2) / 2; sizeChars.set(k, (sizeChars.get(k) || 0) + L.text.length); }
    const body = sizeChars.size ? [...sizeChars.entries()].sort((a, b) => b[1] - a[1])[0][0] : 10;
    const cls = L => L.mono ? 'k' : L.hd || L.size >= body * 1.12 ? 'h' : L.size < body * 0.88 ? 's' : 'b';

    // 3) cabeçalhos, rodapés e números de página repetidos
    if (dropHf && N > 1) {
      const key = L => L.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
      // cabeçalho/rodapé: perto da borda da página ou as primeiras/últimas linhas do texto (páginas com margem grande)
      const edge = (P, L) => { const i = P.lines.indexOf(L), n = P.lines.length; return i >= 0 && n > 4 && cls(L) !== 'h' ? (i < 2 ? 't' : i >= n - 2 ? 'b' : null) : null; };
      const zone = (P, L) => L.y < P.H * 0.1 ? 't' : L.top > P.H * 0.9 ? 'b' : edge(P, L);
      const seen = new Map();   // zona+texto -> posições verticais onde apareceu
      for (const P of pages) for (const L of P.lines) { const z = zone(P, L); if (z) { const k = z + key(L); (seen.get(k) || seen.set(k, []).get(k)).push([P.pn, z === 't' ? L.y : P.H - L.y]); } }
      const running = new Set();
      for (const [k, v] of seen) {
        const ys = v.map(q => q[1]), pn = new Set(v.map(q => q[0]));
        if (pn.size >= (k.includes('#') ? 2 : 3) && Math.max(...ys) - Math.min(...ys) < 4 + 0.01 * pages[0].H) running.add(k);   // com número de página no texto, 2 páginas bastam
      }
      for (const P of pages) P.lines = P.lines.filter(L => {
        const z = zone(P, L);
        if (!z) return true;
        if (/^[\W\d_]*$|^\W*[ivxlcdm]+\W*$/i.test(L.text) && L.text.length < 12) return false;   // só número de página
        return !(N >= 3 && running.has(z + key(L)));
      });
    }

    // sumário impresso: páginas cheias de "título .... número" saem do texto e servem de pista para o sumário
    const printedToc = [], tocRe = /^(sum[áa]rio|[ií]ndice|contents|table of contents)$/i;
    const isTocPage = P => {
      const ls = P.lines;
      if (ls.length < 4) return false;
      const endsNum = L => TOC_NUM.test(L.text) && L.text.length <= 130 || /^\d{1,4}$/.test(L.text);
      const lead = ls.filter(L => TOC_LEAD.test(L.text)).length, num = ls.filter(L => !TOC_LEAD.test(L.text) && endsNum(L)).length;
      if (lead >= 4 && lead >= 0.5 * ls.length) return true;
      const rest = ls.filter(L => !TOC_LEAD.test(L.text) && !endsNum(L));   // linhas de título que continuam na seguinte
      return lead + num >= 8 && lead + num >= 0.35 * ls.length && rest.filter(L => TERMINAL.test(L.text)).length <= 0.12 * ls.length;
    };
    const tocFlags = pages.map(isTocPage);
    for (let i = 1; i < pages.length - 1; i++) if (!tocFlags[i] && tocFlags[i - 1] && tocFlags[i + 1] && pages[i].lines.length < 60) tocFlags[i] = true;   // página de sumário no meio de outras
    pages.forEach((P, i) => {
      if (!tocFlags[i]) { if (tocFlags[i + 1] && P.lines.length && tocRe.test(P.lines[P.lines.length - 1].text.trim())) P.lines.pop(); return; }
      const minX = Math.min(...P.lines.map(L => L.x0)); let buf = [];
      for (const L of P.lines) {
        if (tocRe.test(L.text.trim())) continue;
        buf.push(L);
        if (TOC_LEAD.test(L.text) || TOC_NUM.test(L.text) || /^\d{1,4}$/.test(L.text)) {
          const title = buf.map(q => q.text).join(' ').replace(TOC_LEAD, '').replace(/\s*\b\d{1,4}$/, '').replace(/[\s.…]+$/, '').trim();
          if (title) printedToc.push({ title, indent: buf[0].x0 - minX, size: buf[0].size });
          buf = [];
        }
      }
      P.lines = [];
    });

    // margens, justificação e espaçamento por página/coluna (com a média do livro quando a página tem pouco texto)
    const stat = (ls, fallback) => {
      const bl = ls.filter(L => cls(L) === 'b' && L.text.length >= 20);
      if (bl.length < 8) return fallback || null;
      const Lm = modeOf(bl.map(L => [L.x0, L.text.length]), 2);
      const x1s = bl.map(L => L.x1).sort((a, b) => a - b), Rm = x1s[Math.floor(0.9 * (x1s.length - 1))];
      const just = bl.filter(L => L.x1 >= Rm - 0.6 * L.size).length >= 0.45 * bl.length;
      const dys = [];
      for (let i = 1; i < ls.length; i++) { const dy = ls[i].y - ls[i - 1].y, s = ls[i].size; if (cls(ls[i]) === 'b' && cls(ls[i - 1]) === 'b' && dy > 0.8 * s && dy < 1.9 * s) dys.push([dy, 1]); }
      return { Lm, Rm, just, pitch: dys.length >= 4 ? modeOf(dys, 0.5) : body * 1.2 };
    };
    const glob = new Map();
    for (const par of [0, 1]) for (let c = 0; c < 4; c++) glob.set(par + '|' + c, stat(pages.filter(P => P.pn % 2 === par).flatMap(P => P.lines.filter(L => L.col === c && !L.span))));
    const globAll = stat(flat().filter(L => !L.span)) || { Lm: 0, Rm: 1e4, just: false, pitch: body * 1.2 };
    for (const P of pages) {
      P.st = [];
      for (let c = 0; c < Math.max(1, P.cols); c++) P.st[c] = stat(P.lines.filter(L => L.col === c && !L.span), glob.get(P.pn % 2 + '|' + c) || globAll) || globAll;
    }
    // títulos do tamanho do texto: maiúsculas/versaletes centralizados, negrito isolado ou "Capítulo …"
    const centeredL = L => { const s = pages[L.pn - 1].st[L.col] || globAll, lg = L.x0 - s.Lm, rg = s.Rm - L.x1; return lg > 0.6 * L.size && Math.abs(lg - rg) < 1.2 * L.size; };
    for (const P of pages) P.lines.forEach((L, i) => {
      if (cls(L) !== 'b' || L.span) return;
      const t = L.text.trim(), words = t.split(/\s+/).length;
      const numN = /^\d+(?:\.\d+){1,4}\.?\s+\S/.test(t), num1 = /^\d{1,2}[.)]\s+\p{Lu}/u.test(t);
      if (t.length > 120 || (LIST_START.test(t) && !numN && !(num1 && L.bold && words <= 14))) return;
      const prev = P.lines[i - 1], s = P.st[L.col] || globAll;
      const isolated = !prev || prev.col !== L.col || prev.hd || L.y - prev.y > s.pitch * 1.15;
      const chap = CHAP_RE.test(t) && words <= 14;
      if (TERMINAL.test(t) && !chap) return;
      const cen = centeredL(L);
      if ((L.upper && t.length > 2 && words <= 20 && (cen || L.bold)) || (L.bold && words <= 12 && !/[,;:]$/.test(t) && isolated) || (chap && (cen || L.bold || L.upper)) || (numN && words <= 14 && (L.bold || isolated)) || (num1 && L.bold && words <= 14)) L.hd = true;
    });
    const words = new Set();
    for (const L of flat()) for (const w of L.text.toLowerCase().split(/[^\p{L}\p{N}-]+/u)) if (w) words.add(w);


    // equações em destaque: linhas de fonte matemática sozinhas na linha viram imagem (com limites e índices vizinhos)
    if (wantImgs) for (const P of pages) {
      if (P.rtl) continue;
      const ls = P.lines, st = c => P.st[c] || globAll;
      const cen = L => { const s = st(L.col), lg = L.x0 - s.Lm, rg = s.Rm - L.x1; return lg > 3 * L.size && Math.abs(lg - rg) < 2 * L.size; };
      const numbered = L => /\([A-Za-z]?\d+(?:\.\d+)+\)\s*$/.test(L.text) && L.text.length <= 110 && L.x0 - st(L.col).Lm > 1.2 * L.size;   // "... (3.6.11)"
      const isEq = L => !L.span && !L.hd && L.text.length >= 2 && (numbered(L) || (L.mathShare >= 0.5 && (L.x0 - st(L.col).Lm > 1.2 * L.size || st(L.col).Rm - L.x1 > 4 * L.size)) || (L.mathShare >= 0.25 && L.text.length <= 90 && cen(L)));
      // limites de somatório/integral colados numa linha de texto são matemática "em linha", não equação em destaque
      const beside = L => ls.some(Q => Q !== L && Q.col === L.col && !Q.span && Q.text.length >= 30 && Q.mathShare < 0.3 && Math.abs(Q.y - L.y) < 0.75 * st(L.col).pitch && Q.x0 < L.x1 && Q.x1 > L.x0);
      const eq = ls.map((L, i) => isEq(L) && !beside(L) ? i : -1).filter(i => i >= 0);
      if (!eq.length) continue;
      const take = new Set(eq);
      ls.forEach((L, i) => {
        if (take.has(i) || L.hd || L.text.length > 16) return;
        if (eq.some(j => { const E = ls[j]; return L.col === E.col && Math.abs(L.y - E.y) <= 2.2 * body && L.x1 > E.x0 - 2 && L.x0 < E.x1 + 2 && (L.size < 0.92 * body || L.mathShare >= 0.3 || (L.text.length <= 8 && Math.abs(L.y - E.y) <= 1.6 * body)); })) take.add(i);
      });
      const groups = []; let g = null;
      for (const i of [...take].sort((a, b) => a - b)) {
        const L = ls[i];
        if (g && L.col === g.col && L.y - g.lastY < 2.4 * body) { g.idx.push(i); g.lastY = Math.max(g.lastY, L.y); } else { g = { idx: [i], lastY: L.y, col: L.col }; groups.push(g); }
      }
      for (const gr of groups) {
        const Ls = gr.idx.map(i => ls[i]), its = Ls.flatMap(L => L.items);
        const box = [Math.min(...its.map(r => r.x)) - 2, Math.min(...its.map(r => r.y - r.size * 0.95)) - 2, Math.max(...its.map(r => r.x + r.w)) + 2, Math.max(...its.map(r => r.y + r.size * 0.32)) + 2];
        P.figs.push({ t: 'img', eq: true, top: box[1], box, alt: Ls.map(L => L.text).join(' ').replace(/\uFFFC\d+\uFFFC/g, '').slice(0, 200), pn: P.pn });
      }
      const gone = new Set(groups.flatMap(g => g.idx)); P.lines = ls.filter((_, i) => !gone.has(i));
    }

    // tabelas: linhas seguidas com células separadas por vãos largos e colunas alinhadas viram <table>
    for (const P of pages) {
      P.tabs = [];
      if (P.cols > 1 || P.lines.length < 3) continue;
      const ls = P.lines, st = P.st[0] || globAll;
      const cellsOf = L => {
        const cells = []; let c = null;
        for (const r of L.items) {
          if (c && r.x - c.x1 <= 1.3 * L.size) { c.items.push(r); c.x1 = Math.max(c.x1, r.x + r.w); } else { c = { items: [r], x0: r.x, x1: r.x + r.w }; cells.push(c); }
        }
        return cells;
      };
      const raw1 = ls.map(L => !L.span && !L.hd && !L.mono && cls(L) !== 'h' && L.items.length >= 1 ? cellsOf(L) : null);
      const tab = raw1.map((c, i) => c && c.length >= 2 ? c : (c && i > 0 && i < raw1.length - 1 && raw1[i - 1] && raw1[i - 1].length >= 2 && raw1[i + 1] && raw1[i + 1].length >= 2 && ls[i].y - ls[i - 1].y < st.pitch * 1.8 && ls[i + 1].y - ls[i].y < st.pitch * 1.8 ? c : null));
      const used = new Set();
      for (let i = 0; i < ls.length;) {
        if (!tab[i]) { i++; continue; }
        let j = i + 1;
        while (j < ls.length && tab[j] && ls[j].y - ls[j - 1].y < st.pitch * 2.6 && ls[j].y > ls[j - 1].y) j++;
        const R = ls.slice(i, j), C = tab.slice(i, j), Rused = [...R];
        i = j;
        if (R.length < 3) continue;
        const size = median(R.map(L => L.size));
        const iv = C.flat().map(c => [c.x0, c.x1]).sort((a, b) => a[0] - b[0]), bands = [];
        for (const v of iv) { const b = bands[bands.length - 1]; if (b && v[0] <= b[1] + 0.6 * size) b[1] = Math.max(b[1], v[1]); else bands.push([v[0], v[1]]); }
        if (bands.length < 2) continue;
        const bandOf = c => { const idx = bands.map((b, k) => (c.x0 < b[1] + 0.3 && c.x1 > b[0] - 0.3) ? k : -1).filter(k => k >= 0); return [idx[0], idx[idx.length - 1]]; };
        if (C.filter(cs => new Set(cs.map(c => bandOf(c)[0])).size >= 2).length < 0.7 * R.length) continue;
        const lens = C.flat().map(c => c.items.reduce((n, r) => n + r.str.length, 0));
        if (lens.reduce((a, b) => a + b, 0) / lens.length > 45 || median(lens) > 30) continue;   // texto corrido com vãos largos, não tabela
        if (bands.length === 2 && C.filter(cs => /^(\(?[a-z0-9]{1,3}[.)]|[•▪◦●■–—-])$/i.test(cs[0].items.map(r => r.str).join('').trim())).length >= 0.7 * R.length) continue;   // lista com marcador
        const colCells = bands.map(() => []);
        const rows = R.map((L, k) => {
          const row = bands.map(() => null);
          for (const c of C[k]) {
            const [bi, bj] = bandOf(c), cell = { runs: buildRuns(c.items, L.size, L.y, P.pn), span: bj - bi + 1, x0: c.x0, x1: c.x1 };
            if (!cell.runs.length) continue;
            if (!row[bi]) { row[bi] = cell; if (cell.span === 1) colCells[bi].push(cell); }
          }
          return row;
        });
        for (let k = 1; k < Math.min(rows.length, 4); k++) {   // cabeçalho de várias linhas: células de colunas diferentes, quase na mesma altura, formam uma só linha
          const A = rows[k - 1], B = rows[k];
          if (R[k].y - R[k - 1].y < 1.15 * size && A.every((c, ci) => !(c && B[ci]))) {
            B.forEach((c, ci) => { if (c && !A[ci]) A[ci] = c; }); rows.splice(k, 1); R.splice(k, 1); k--;
          }
        }
        const sd = a => { if (a.length < 2) return 1e9; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
        const align = colCells.map(cc => {
          const l = sd(cc.map(c => c.x0)), r = sd(cc.map(c => c.x1)), m = sd(cc.map(c => (c.x0 + c.x1) / 2));
          return cc.length >= 2 && r < 0.6 * l && r <= m ? 'right' : cc.length >= 2 && m < 0.6 * l && m < r ? 'center' : 'left';
        });
        const head = R[0].bold;
        P.tabs.push({ t: 'table', rows, align, head, top: R[0].top, pageNo: P.pn });
        Rused.forEach(L => used.add(L));
      }
      if (used.size) P.lines = ls.filter(L => !used.has(L));
    }

    // renderiza capa, figuras e equações (uma vez por página)
    const nulClusters = [];
    for (const P of pages) {
      if (!P.figs.length && !P.glyphs.length && !(cover && P.pn === 1)) continue;
      say(`Gerando imagens… página ${P.pn} de ${N}`); await tick();
      const scanned = P.figs.some(f => f.page);   // página inteira em imagem: resolução menor, para o arquivo não crescer demais
      const page = await doc.getPage(P.pn), { cv, scale } = await render(page, P.vp, scanned ? 1.7 : P.figs.some(f => f.eq) || P.glyphs.length ? 3.6 : 2.5);
      for (const g of P.glyphs) {
        const x = Math.max(0, Math.floor(g.box[0] * scale)), y = Math.max(0, Math.floor(g.box[1] * scale));
        const w = Math.min(cv.width - x, Math.ceil((g.box[2] - g.box[0]) * scale)), h = Math.min(cv.height - y, Math.ceil((g.box[3] - g.box[1]) * scale));
        if (w < 2 || h < 2) continue;
        const d = cv.getContext('2d').getImageData(x, y, w, h).data; let ink = false;
        for (let k = 0; k < d.length; k += 4) if (d[k] + d[k + 1] + d[k + 2] < 600) { ink = true; break; }
        if (!ink) continue;
        if (g.nul) {   // código 0 não identifica o glifo: agrupa as ocorrências pela forma (são ligaduras fi/fl/ff… sem Unicode)
          const vec = shapeVec(cv, x, y, w, h), wpt = w / scale;
          let cl = nulClusters.find(c => Math.abs(c.wpt - wpt) < 0.1 * c.wpt && shapeCorr(c.vec, vec) > 0.9);
          if (!cl) { cl = { vec, wpt, id: g.id, size: g.size, bytes: await jpeg(cv, x, y, w, h), members: [] }; nulClusters.push(cl); }
          cl.members.push(g); g.cl = cl; continue;
        }
        g.ok = true; images.push({ name: `img/g${g.id}.jpg`, bytes: await jpeg(cv, x, y, w, h) });
      }
      if (cover && P.pn === 1) cover = { name: 'img/capa.jpg', bytes: await jpeg(cv, 0, 0, cv.width, cv.height, 0.82, 1600), w: cv.width, h: cv.height };
      for (const [i, f] of P.figs.entries()) {
        const x = Math.max(0, Math.floor(f.box[0] * scale)), y = Math.max(0, Math.floor(f.box[1] * scale));
        const w = Math.min(cv.width - x, Math.ceil((f.box[2] - f.box[0]) * scale)), h = Math.min(cv.height - y, Math.ceil((f.box[3] - f.box[1]) * scale));
        if (w < 8 || h < 8) { f.skip = true; continue; }
        f.src = f.page ? `img/p${P.pn}.jpg` : `img/p${P.pn}-${i + 1}.jpg`; f.w = w; f.h = h;
        const t = document.createElement('canvas'); t.width = t.height = 8; t.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, 8, 8);   // impressão digital 8x8 do desenho
        const px = t.getContext('2d').getImageData(0, 0, 8, 8).data, gray = []; for (let k = 0; k < 256; k += 4) gray.push(px[k] + px[k + 1] + px[k + 2]);
        const mean = gray.reduce((a, b) => a + b, 0) / 64; f.hash = gray.map(v => v > mean ? 1 : 0);
        images.push({ name: f.src, bytes: await jpeg(cv, x, y, w, h, f.page ? 0.75 : 0.85) });
      }
      P.figs = P.figs.filter(f => !f.skip); page.cleanup();
    }
    // ligaduras sem Unicode (fi, fl, ff, ffi, ffl): o contexto das ocorrências decide o texto; o que sobrar fica como imagem
    if (nulClusters.length) {
      const lang0 = guessLang(' ' + pages.flatMap(P => P.lines).slice(0, 3000).map(L => L.text.replace(/\uFFFC\d+\uFFFC/g, ' ')).join(' ') + ' ');
      const ctx = new Map(nulClusters.map(c => [c, { n: 0, cons: 0, letters: 0, pre: 0 }]));
      for (const P of pages) for (const L of P.lines) {
        if (!L.text.includes('\uFFFC')) continue;
        for (const m of L.text.matchAll(/(\p{L}*)\uFFFC(\d+)\uFFFC(\p{L}*)/gu)) {
          const g = glyphs[+m[2]], c = g && g.cl && ctx.get(g.cl);
          if (!c) continue;
          c.n++; if (m[1] || m[3]) c.letters++; if (m[1]) c.pre++;
          if (m[3] && /^[b-df-hj-kmnp-tv-zçñ]/i.test(m[3])) c.cons++;
        }
      }
      for (const cl of nulClusters) {
        const c = ctx.get(cl), em = cl.wpt / (cl.size || 10);
        let txt = null;
        if (c.n >= 3 && c.letters >= 0.7 * c.n && em > 0.3 && em < 1.15) {
          const consRate = c.cons / c.n;
          if (em > 0.74) txt = consRate >= 0.15 ? 'ffi' : 'ffl';
          else if (consRate >= 0.1) txt = 'fi';
          else if (c.n >= 8 && ['pt', 'es', 'fr', 'it'].includes(lang0)) txt = 'fl';
        }
        if (txt) cl.members.forEach(g => { g.text = txt; });
        else { images.push({ name: `img/g${cl.id}.jpg`, bytes: cl.bytes }); cl.members.forEach(g => { g.ok = true; g.imgId = cl.id; }); }
      }
    }
    // o mesmo desenho, na mesma posição, em várias páginas é decoração (logotipo, faixa): sai
    {
      const sig = f => [f.box[0], f.box[1], f.box[2] - f.box[0], f.box[3] - f.box[1]].map(v => Math.round(v / 6)).join('|'), by = new Map();
      for (const P of pages) for (const f of P.figs) if (!f.page && !f.eq) (by.get(sig(f)) || by.set(sig(f), []).get(by.get(sig(f)) ? sig(f) : sig(f))).push(f);
      const drop = new Set();
      for (const list of by.values()) {
        if (list.length < 3) continue;
        for (const f of list) if (list.filter(g => g.hash.reduce((n, v, k) => n + (v !== f.hash[k] ? 1 : 0), 0) <= 4).length >= 3 && list.length >= Math.min(3, 0.1 * N)) drop.add(f);
      }
      if (drop.size) {
        const names = new Set([...drop].map(f => f.src));
        for (let k = images.length - 1; k >= 0; k--) if (names.has(images[k].name)) images.splice(k, 1);
        for (const P of pages) P.figs = P.figs.filter(f => !drop.has(f));
      }
    }

    // 4) linhas -> blocos (parágrafos, títulos, figuras, notas)
    const blocks = [];
    let cur = null, last = null;
    const close = () => { if (cur) blocks.push(cur); cur = null; last = null; };
    const append = (B, L) => {
      const lastRun = B.runs[B.runs.length - 1];
      if (lastRun) {
        const m = lastRun.t.match(/(\p{L}+)-$/u), first = (L.text.match(/^\p{L}+/u) || [''])[0];
        const joined = m && words.has((m[1] + first).toLowerCase()), isCl = CLITIC.has(first.toLowerCase());
        // hifenização de fim de linha: junta, exceto "dá-lo" (prefixo é palavra) e compostos que só existem com hífen
        if (m && /^\p{Ll}/u.test(first) && (isCl ? joined || !words.has(m[1].toLowerCase()) : joined || !words.has((m[1] + '-' + first).toLowerCase())))
          lastRun.t = lastRun.t.slice(0, -1);
        else if (CJK.test(lastRun.t.slice(-1)) && CJK.test(L.text[0])) { /* ideogramas: sem espaço */ }
        else if (!/[\s/–—-]$/.test(lastRun.t) || /\s-$/.test(lastRun.t)) { if (!plainRun(lastRun) && plainRun(L.runs[0])) L.runs[0] = { ...L.runs[0], t: ' ' + L.runs[0].t }; else lastRun.t += ' '; }
      }
      for (const r of L.runs) {
        const l = B.runs[B.runs.length - 1];
        if (l && l.b === r.b && l.i === r.i && l.m === r.m && l.sup === r.sup) l.t += r.t; else B.runs.push({ ...r });
      }
      B.lines.push(L);
    };
    // a linha B começa um bloco novo depois da linha A?
    const breaks = (blk, A, B) => {
      const ca = cls(A), cb = cls(B);
      if (ca !== cb) return true;
      const samePage = A.pn === B.pn && A.col === B.col;
      if (cb === 'k') return !(samePage && B.y > A.y && B.y - A.y < 3.6 * Math.max(A.size, B.size) && Math.abs(A.cw - B.cw) < 0.25 * A.cw);   // listagem: lacunas viram linhas em branco
      if (cb === 'h') return !(samePage && B.y > A.y && B.y - A.y < 2.6 * B.size && Math.abs(A.size - B.size) < 0.1 * B.size && !!A.hd === !!B.hd);
      const sa = pages[A.pn - 1].st[A.col] || globAll, sb = pages[B.pn - 1].st[B.col] || globAll, s = B.size;
      const pc = sb.pitch * Math.min(1, s / body);
      if (samePage && B.y > A.y && B.y - A.y > pc * 1.25 + 0.6) return true;            // espaço vertical maior que o normal
      if (LIST_START.test(B.text)) return true;
      const shortA = A.x1 < sa.Rm - (sa.just ? 1.0 * s : 0.22 * (sa.Rm - sa.Lm)), endA = TERMINAL.test(A.text);
      const lower = /^\p{Ll}/u.test(B.text);
      if (blk.list) return shortA && endA && !lower;   // item de lista: as linhas seguintes (pendentes ou alinhadas) continuam nele
      if (lower && !endA) return false;
      const indent = B.x0 - sb.Lm, AI = A.x0 - sa.Lm;
      if (indent > 0.8 * s && !(AI > 0.8 * s && Math.abs(B.x0 - A.x0) < 0.5 * s)) return true;   // recuo de 1ª linha
      if (indent < -0.6 * s && !(A.x0 - B.x0 < 0.6 * s && AI < -0.6 * s)) return true;          // 1ª linha pendurada
      if (shortA && endA && !lower) return true;                                                // linha curta que fecha a frase
      if (!sa.just && !lower && A.x1 < sa.Rm - 0.28 * (sa.Rm - sa.Lm)) return true;            // texto não justificado: linha bem curta também fecha o parágrafo (itens, versos)
      return false;
    };
    let noteSeq = 0;
    const attachNotes = (P, pageBlocks, noteLines) => {
      // agrupa as linhas pequenas do pé da página em notas numeradas
      const notes = []; let expect = null;
      for (const L of noteLines) {
        const m = L.text.match(NOTE_LABEL), n = m && /^\d/.test(m[1]) ? +m[1] : null;
        if (m && (!notes.length || (n !== null && (expect === null || n === expect)) || (n === null))) {
          notes.push({ label: m[1], runs: [], lines: [], pn: P.pn }); expect = n !== null ? n + 1 : null;
        }
        if (!notes.length) notes.push({ label: '', runs: [], lines: [], pn: P.pn });
        append(notes[notes.length - 1], L);
      }
      for (const nt of notes) {
        if (nt.label && nt.runs.length) {   // tira o número do começo (o link de volta já o mostra)
          const r0 = nt.runs[0]; r0.t = r0.t.replace(nt.label, '').replace(/^[\s.)]+/, '');
          if (!r0.t) nt.runs.shift();
        }
        const mark = pageBlocks.flatMap(B => (B.runs || []).filter(r => r.sup > 0 && r.pn === P.pn && !r.noteId).map(r => ({ B, r })))
          .find(x => x.r.t.trim() === nt.label);
        if (mark) { nt.id = `nt${++noteSeq}`; mark.r.noteId = nt.id; mark.r.t = mark.r.t.trim(); (mark.B.notes = mark.B.notes || []).push(nt); nt.linked = true; }
        else {
          // número da nota colado no fim de um título (sem sobrescrito): vira marcador
          const txt = B => B.runs.map(r => r.t).join(''), hB = /^\d+$/.test(nt.label) && pageBlocks.find(B => B.t === 'h' && B.runs.length && new RegExp('\\D\\s?' + nt.label + '\\s*$').test(txt(B)));
          if (hB) {
            const lr = hB.runs[hB.runs.length - 1], run = { t: nt.label, b: false, i: false, sup: 1, pn: P.pn };
            lr.t = lr.t.replace(new RegExp('\\s?' + nt.label + '\\s*$'), ''); hB.runs.push(run);
            nt.id = `nt${++noteSeq}`; run.noteId = nt.id; nt.linked = true; (hB.notes = hB.notes || []).push(nt);
          } else { const B = pageBlocks[pageBlocks.length - 1]; if (B) (B.notes = B.notes || []).push(nt); }
        }
      }
    };
    for (const P of pages) {
      let ls = P.lines, noteLines = [];
      if (P.cols === 1) {   // notas de rodapé: bloco final de linhas pequenas na metade de baixo, começando por um número ou símbolo
        let k = ls.length;
        while (k > 0 && cls(ls[k - 1]) === 's' && ls[k - 1].y > P.H * 0.5) k--;
        if (k < ls.length && NOTE_LABEL.test(ls[k].text) && ls.length - k < 0.5 * ls.length + 3) { noteLines = ls.slice(k); ls = ls.slice(0, k); }
      }
      const seq = [...ls];
      for (const f of P.figs.filter(f => f.eq)) {   // equação interrompe a frase; figura e tabela entram entre parágrafos (abaixo)
        const at = seq.findIndex(x => !x.t && x.top >= f.top - 1);
        seq.splice(at < 0 ? seq.length : at, 0, f);
      }
      const startIdx = blocks.length;
      for (let i = 0; i < seq.length; i++) {
        const L = seq[i];
        if (L.t === 'img' || L.t === 'table') { close(); blocks.push({ ...L, pageNo: P.pn, top: L.top }); continue; }
        if (!cur || breaks(cur, last, L)) {
          close();
          const c = cls(L);
          cur = { t: c === 'h' ? 'h' : c === 'k' ? 'code' : 'p', small: c === 's', runs: [], lines: [], pageNo: P.pn, top: L.top, col: L.col, list: c === 'b' && LIST_START.test(L.text) };
        }
        if (cur.t === 'code') cur.lines.push(L); else append(cur, L);
        last = L;
      }
      if (noteLines.length) attachNotes(P, [...blocks.slice(startIdx), ...(cur ? [cur] : [])].filter(B => B.t !== 'img'), noteLines);
    }
    close();
    // figuras e tabelas: antes do primeiro bloco da página (na mesma coluna) que começa abaixo do topo delas
    {
      const items = pages.flatMap(P => [...P.figs.filter(f => !f.eq), ...P.tabs].map(f => ({ ...f, pageNo: P.pn, col: f.col || 0 })));
      items.sort((a, b) => a.pageNo - b.pageNo || a.top - b.top);
      for (const it of items) {
        let k = blocks.findIndex(B => B.pageNo > it.pageNo || (B.pageNo === it.pageNo && (B.col || 0) === it.col && B.top >= it.top - 2) || (B.pageNo === it.pageNo && (B.col || 0) > it.col));
        if (k < 0) k = blocks.length;
        blocks.splice(k, 0, it);
      }
    }
    // capitulares (letra grande isolada) voltam para o parágrafo seguinte
    for (let i = blocks.length - 2; i >= 0; i--) {
      const B = blocks[i], C = blocks[i + 1];
      if (B.t === 'h' && C.t === 'p' && B.runs.length && /^\p{L}{1,2}$/u.test(B.runs.map(r => r.t).join('').trim())) {
        C.runs.unshift({ t: B.runs.map(r => r.t).join('').trim(), b: false, i: false, sup: 0, pn: B.pageNo });
        if (B.notes) C.notes = [...B.notes, ...(C.notes || [])];
        blocks.splice(i, 1);
      }
    }
    // níveis de título pelo tamanho; título longo demais vira parágrafo
    const textOf = B => B.runs ? B.runs.map(r => r.t).join('').replace(/\uFFFC\d+\uFFFC/g, '') : '';
    const hsize = B => Math.round(Math.max(...B.lines.map(q => q.size)));
    const hs = [...new Set(blocks.filter(B => B.t === 'h').map(hsize))].sort((a, b) => b - a);
    for (const B of blocks) {
      if (B.t === 'h') {
        if (textOf(B).split(' ').length > 30) { B.t = 'p'; B.lines.forEach(L => { L.hd = false; }); continue; }
        B.lvl = Math.min(4, hs.indexOf(hsize(B)) + 1);
      }
      if (B.t === 'p' && B.lines.length) {
        const L0 = B.lines[0], s = pages[L0.pn - 1].st[L0.col] || globAll;
        B.center = B.lines.every(L => L.x0 - s.Lm > Math.max(2 * L.size, 0.06 * (s.Rm - s.Lm)) && Math.abs((L.x0 - s.Lm) - (s.Rm - L.x1)) < Math.max(2 * L.size, 0.05 * (s.Rm - s.Lm)));
        B.quote = !B.center && !B.list && B.lines.length > 1 && B.lines.every(L => L.x0 - s.Lm > 1.5 * L.size);
      }
    }
    // títulos de várias linhas com o mesmo nível seguidos (ex.: "CAPÍTULO II" + "Do governo…") viram um só
    for (let i = blocks.length - 2; i >= 0; i--) {
      const B = blocks[i], C = blocks[i + 1];
      if (B.t === 'h' && C.t === 'h' && B.pageNo === C.pageNo && CHAP_RE.test(textOf(B).trim()) && B.runs.length && C.runs.length && textOf(B).trim().split(' ').length <= 3) {
        B.lvl = Math.min(B.lvl, C.lvl); B.runs.push({ t: ' — ', b: false, i: false, sup: 0, pn: B.pageNo }, ...C.runs); B.lines.push(...C.lines); if (C.notes) B.notes = [...(B.notes || []), ...C.notes]; blocks.splice(i + 1, 1);
      }
    }

    // 5) capítulos e sumário: marcadores do PDF; senão o sumário impresso; senão os títulos
    const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const heading = B => B.t === 'h' || (B.t === 'p' && B.lines.length <= 2 && textOf(B).length < 90);
    let entries = [], source = '';
    const toc = [];
    if (!(IX && IX.skipOutline)) try {
      const outline = await doc.getOutline();
      const walkOut = async (list, level) => {
        for (const it of list || []) {
          let dest = it.dest, pageIdx = null, top = null;
          try {
            if (typeof dest === 'string') dest = await doc.getDestination(dest);
            if (Array.isArray(dest) && dest[0] != null) {
              pageIdx = typeof dest[0] === 'object' ? await doc.getPageIndex(dest[0]) : dest[0];
              const kind = dest[1] && dest[1].name, t = kind === 'XYZ' ? dest[3] : /^FitB?H$/.test(kind) ? dest[2] : kind === 'FitR' ? dest[5] : null;
              if (typeof t === 'number' && pages[pageIdx]) top = pages[pageIdx].vp.convertToViewportPoint(0, t)[1];
            }
          } catch (e) {}
          const title = (it.title || '').replace(/\s+/g, ' ').trim();
          if (title && !/^(untitled|sem t[íi]tulo)$/i.test(title) && pageIdx != null && pageIdx >= 0 && pageIdx < N) toc.push({ title, level, pageNo: pageIdx + 1, top });
          await walkOut(it.items, level + 1);
        }
      };
      await walkOut(outline, 0);
    } catch (e) { console.warn('sem marcadores', e); }

    const posOf = e => {   // título com o mesmo texto na página; senão, o primeiro bloco abaixo do ponto marcado
      const t = norm(e.title);
      const h = blocks.findIndex(B => B.pageNo === e.pageNo && heading(B) && t && (norm(textOf(B)) === t || (norm(textOf(B)).length > 3 && (norm(textOf(B)).includes(t) || t.includes(norm(textOf(B)))))));
      if (h >= 0) return h;
      return blocks.findIndex(B => B.pageNo > e.pageNo || (B.pageNo === e.pageNo && (e.top == null || B.top >= e.top - 2 * body)));
    };
    if (toc.length) {
      let t = toc;
      const minL = Math.min(...t.map(e => e.level));
      if (t.filter(e => e.level === minL).length === 1 && t.some(e => e.level > minL)) t = t.filter(e => e.level > minL);   // capa-título envolvendo tudo
      const base = Math.min(...t.map(e => e.level));
      entries = t.map(e => ({ ...e, level: Math.min(3, e.level - base), at: posOf(e) })).filter(e => e.at >= 0); source = 'marcadores';
    } else if (printedToc.length >= 4 && !(IX && IX.prefer === 'headings')) {   // casa cada entrada do sumário impresso com o título no texto, na ordem
      const minI = Math.min(...printedToc.map(e => e.indent)); let from = 0, hit = [];
      for (const e of printedToc) {
        const t = norm(e.title); if (!t) continue;
        const k = blocks.findIndex((B, i) => i >= from && heading(B) && B.t !== 'img' && (norm(textOf(B)) === t || (t.length > 6 && norm(textOf(B)).startsWith(t))));
        if (k >= 0) { hit.push({ title: e.title, level: Math.min(3, Math.round((e.indent - minI) / (1.5 * body))), at: k }); from = k + 1; }
      }
      if (hit.length >= 3 && hit.length >= 0.6 * printedToc.length) { entries = hit; source = 'sumario'; }
    }
    if (!entries.length && !(IX && IX.prefer === 'printed')) {
      let lvl = 0;
      for (let l = 1; l <= 4 && !lvl; l++) if (blocks.filter(B => B.t === 'h' && B.lvl === l).length >= 2) lvl = l;
      if (lvl) blocks.forEach((B, i) => { if (B.t === 'h' && B.lvl <= lvl + 1) entries.push({ title: textOf(B).trim(), level: B.lvl <= lvl ? 0 : 1, at: i }); });
      if (entries.length) source = 'titulos';
    }
    entries = entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i).map(x => x.e);
    entries = entries.filter((e, i) => !(i && entries[i - 1].at === e.at && norm(entries[i - 1].title) === norm(e.title)));
    if (IX) return { source, entries: entries.map(e => ({ title: e.title.replace(/\s+/g, ' ').trim(), level: e.level, page: (blocks[e.at] || { pageNo: 1 }).pageNo - 1 })) };

    // quais entradas abrem um arquivo novo: o nível mais raso que dê capítulos de tamanho razoável; "Parte/Livro" sempre abre
    const total = blocks.reduce((n, B) => n + textOf(B).length, 0);
    let splitLvl = 0;
    for (let l = 0; l <= 3; l++) { const c = entries.filter(e => e.level <= l).length; splitLvl = l; if (c >= 2 && total / c <= 60000) break; }
    const breaks_ = new Set(entries.filter(e => e.level <= splitLvl || PART_RE.test(e.title)).map(e => e.at));

    // 6) metadados
    let info = {};
    try { info = (await doc.getMetadata()).info || {}; } catch (e) {}
    const clean = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
    let title = clean(info.Title);
    if (!title || title.length < 2 || /^(microsoft (word|powerpoint) - |untitled|sem t[ií]tulo)|\.(docx?|pdf|indd|tex|dvi|qxd|odt|rtf)$/i.test(title)) {
      // sem título nos metadados: a maior fonte das primeiras páginas, senão o nome do arquivo
      let best = null;
      for (const P of pages.slice(0, 3)) for (const L of P.lines) if (L.size >= 1.3 * body && (!best || L.size > best.size + 0.5)) best = L;
      let cand = '';
      if (best) {
        const P = pages[best.pn - 1], at = P.lines.indexOf(best), grp = [best];
        for (let k = at + 1; k < P.lines.length && grp.length < 3 && Math.abs(P.lines[k].size - best.size) < 0.6 && P.lines[k].y - P.lines[k - 1].y < 2.2 * best.size; k++) grp.push(P.lines[k]);
        cand = grp.map(L => L.text).join(' ').replace(/\uFFFC\d+\uFFFC/g, '').replace(/\s+/g, ' ').trim();
      }
      const wc = cand.split(' ').length;
      const fname = file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
      const junkName = fname.length < 4 || !/\p{L}{3}/u.test(fname) || /^(scan(ned)?|img|image|doc(ument)?|untitled|new|output|file|download|print|pdf|capture|digitaliza\S*)[\s\-\d()]*$/i.test(fname);   // o nome que a pessoa escolheu vale mais que um palpite
      title = junkName && cand && wc <= 14 && /\p{L}{3}/u.test(cand) && !/^(sum[áa]rio|[ií]ndice|contents|cap[íi]tulo|chapter|resumo|abstract|\d+|dados de copyright|copyright|direitos|sobre a obra)/i.test(cand) ? cand : fname;
    }
    const authors = clean(info.Author) ? cleanAuthors(clean(info.Author)) : [];
    const lang = guessLang(' ' + flat().slice(0, 3000).map(L => L.text).join(' ') + ' ');

    // 7) XHTML
    say('Montando o EPUB…'); await tick();
    const glyphHtml = (_, id) => glyphs[+id] && glyphs[+id].text ? xesc(glyphs[+id].text) : glyphs[+id] && glyphs[+id].ok ? `<img class="g" src="img/g${glyphs[+id].imgId ?? id}.jpg" alt=""/>` : '';
    const runsHtml = runs => runs.map(r => {
      let h = xesc(r.t).replace(/\uFFFC(\d+)\uFFFC/g, glyphHtml);
      if (r.sup > 0) h = `<sup>${h}</sup>`; else if (r.sup < 0) h = `<sub>${h}</sub>`;
      if (r.m) h = `<code>${h}</code>`;
      if (r.i) h = `<i>${h}</i>`;
      if (r.b) h = `<b>${h}</b>`;
      if (r.noteId) h = `<a epub:type="noteref" class="noteref" id="r-${r.noteId}" href="#${r.noteId}">${h}</a>`;
      return h;
    }).join('').replace(/<\/(b|i|sup|sub)><\1>/g, '');
    const files = [];   // { name, title, html, notes }
    let curFile = null, afterBreak = true;
    const fileOf = new Array(blocks.length), fileStart = new Set();
    const newFile = () => { curFile = { name: `c${String(files.length + 1).padStart(3, '0')}.xhtml`, html: [], notes: [], size: 0 }; files.push(curFile); afterBreak = true; };
    const ids = new Map(entries.map((e, k) => [e.at, 'p' + k]));
    blocks.forEach((B, i) => {
      if (!curFile || (breaks_.has(i) && curFile.html.length && (curFile.size > 6000 || PART_RE.test((entries.find(e => e.at === i) || {}).title || ''))) || (curFile.size > 150000 && B.t === 'p' && !B.list)) newFile();
      if (!curFile.html.length) fileStart.add(i);
      fileOf[i] = curFile.name;
      const id = (ids.has(i) ? ` id="${ids.get(i)}"` : '') + (B.lines && B.lines.length && B.lines.every(L => L.rtl) ? ' dir="rtl"' : '');
      let h;
      if (B.t === 'img') {
        const sz = B.page ? '' : ` style="width:${((B.box[2] - B.box[0]) / body).toFixed(2)}em;max-width:100%"`, alt = xesc(B.alt || '');
        h = B.eq ? `<p class="eq"${id}><img src="${B.src}" alt="${alt}"${sz}/></p>` : `<div class="${B.page ? 'pg' : 'fig'}"${id}><img src="${B.src}" alt="${alt}"${sz}/></div>`;
      }
      else if (B.t === 'table') {
        const tr = (row, k) => `<tr>${row.map((c, ci) => c ? `<t${k && B.head ? 'h' : 'd'}${c.span > 1 ? ` colspan="${c.span}"` : ''}${B.align[ci] !== 'left' ? ` style="text-align:${B.align[ci]}"` : ''}>${runsHtml(c.runs)}</t${k && B.head ? 'h' : 'd'}>` : '<td></td>').join('')}</tr>`;
        h = `<table${id}>${B.head ? `<thead>${tr(B.rows[0], 1)}</thead>` : ''}<tbody>${B.rows.slice(B.head ? 1 : 0).map(r => tr(r, 0)).join('')}</tbody></table>`;
      }
      else if (B.t === 'code') {
        const minX = Math.min(...B.lines.map(L => L.x0)), out = []; let prev = null;
        for (const L of B.lines) {
          if (prev) for (let k = Math.round((L.y - prev.y) / (prev.size * 1.25)) - 1; k > 0; k--) out.push('');
          out.push(' '.repeat(Math.min(60, Math.round((L.x0 - minX) / L.cw))) + L.code); prev = L;
        }
        h = `<pre${id}><code>${xesc(out.join('\n'))}</code></pre>`;
      }
      else if (B.t === 'h') h = `<h${B.lvl}${id}>${runsHtml(B.runs.map(r => ({ ...r, b: false })))}</h${B.lvl}>`;
      else {
        const c = [B.small && 's', B.center && 'c', B.quote && 'q', B.list && 'l', afterBreak && 'f'].filter(Boolean).join(' ');
        h = `<p${id}${c ? ` class="${c}"` : ''}>${runsHtml(B.runs)}</p>`;
      }
      afterBreak = B.t !== 'p';
      curFile.html.push(h); curFile.size += (B.t === 'table' ? B.rows.length * 40 : B.t === 'code' ? B.lines.reduce((n, L) => n + L.code.length, 0) : textOf(B).length) + 20;
      for (const nt of B.notes || []) {
        if (nt.linked) curFile.notes.push(`<aside epub:type="footnote" id="${nt.id}"><p><a href="#r-${nt.id}">${xesc(nt.label)}</a> ${runsHtml(nt.runs)}</p></aside>`);
        else curFile.html.push(`<p class="s">${runsHtml(nt.runs)}</p>`);
      }
      if (!curFile.title && B.t === 'h') curFile.title = textOf(B).trim();
    });
    if (!files.length) newFile();
    const page = (t, bodyHtml, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${xesc(t)}</title><link rel="stylesheet" type="text/css" href="style.css"/>${extra}</head>
<body>
${bodyHtml}
</body>
</html>`;

    // sumário (em árvore, pelos níveis)
    const nav = entries.length ? entries : [{ title, level: 0, at: 0 }];
    const href = e => (fileOf[e.at] || files[0].name) + (fileStart.has(e.at) || !ids.has(e.at) ? '' : '#' + ids.get(e.at));
    const tree = [], stack = [];
    for (const e of nav) {
      const node = { e, kids: [] };
      while (stack.length && stack[stack.length - 1].e.level >= e.level) stack.pop();
      (stack.length ? stack[stack.length - 1].kids : tree).push(node); stack.push(node);
    }
    const navOl = list => `<ol>${list.map(n => `<li><a href="${href(n.e)}">${xesc(n.e.title)}</a>${n.kids.length ? navOl(n.kids) : ''}</li>`).join('')}</ol>`;
    let order = 0, pid = 0; const played = new Map();
    const ncx = list => list.map(n => { const h = href(n.e), o = played.get(h) || played.set(h, ++order).get(h); return `<navPoint id="n${++pid}" playOrder="${o}"><navLabel><text>${xesc(n.e.title)}</text></navLabel><content src="${h}"/>${ncx(n.kids)}</navPoint>`; }).join('');
    const tocName = { pt: 'Sumário', en: 'Contents', es: 'Índice', fr: 'Sommaire', de: 'Inhalt', it: 'Indice', ru: 'Содержание', zh: '目录', ja: '目次', ko: '목차', ar: 'المحتويات', he: 'תוכן עניינים', el: 'Περιεχόμενα', th: 'สารบัญ', hi: 'विषय-सूची' }[lang] || 'Contents';

    // 8) pacote
    const id = 'urn:uuid:' + uuid();
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    zip.file('OEBPS/style.css', `body { margin: 0 4%; line-height: 1.45; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p.f, p.c, p.s, p.l { text-indent: 0; }
p.c { text-align: center; }
p.q { margin: .4em 2em; text-indent: 0; }
p.l { margin: .25em 0 .25em 1em; text-align: left; }
p.s { font-size: .85em; margin-top: .3em; text-align: left; }
h1, h2, h3, h4 { text-align: center; line-height: 1.25; margin: 1.6em 0 .8em; page-break-after: avoid; }
h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; } h4 { font-size: 1em; }
sup, sub { font-size: .7em; line-height: 0; }
a { color: inherit; text-decoration: none; }
a[epub|type~="noteref"] { vertical-align: super; font-size: .75em; }
a.noteref { vertical-align: super; font-size: .75em; }
pre { font: .8em/1.3 monospace; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; margin: .8em 0; padding: .5em; background: rgba(128,128,128,.12); }
code { font-family: monospace; font-size: .9em; }
pre code { font-size: 1em; }
aside { font-size: .85em; margin: .3em 0; }
aside p { text-indent: 0; text-align: left; }
.fig { text-align: center; margin: 1em 0; }
.fig img, .eq img { max-width: 100%; height: auto; }
img.g { height: 1.28em; vertical-align: -0.36em; }
p.eq { text-align: center; text-indent: 0; margin: .6em 0; }
table { border-collapse: collapse; margin: .9em auto; max-width: 100%; font-size: .9em; }
th, td { padding: .2em .55em; border: 1px solid rgba(128,128,128,.5); vertical-align: top; }
th { font-weight: bold; }
.pg { text-align: center; margin: 0; page-break-before: always; page-break-after: always; }
.pg img, .cover img { max-width: 100%; max-height: 100%; }
.cover { text-align: center; margin: 0; padding: 0; }
`);
    const man = [], spine = [];
    if (cover) {
      zip.file('OEBPS/' + cover.name, cover.bytes);
      man.push(`<item id="cover-img" href="${cover.name}" media-type="image/jpeg" properties="cover-image"/>`);
      zip.file('OEBPS/capa.xhtml', page(title, `<div class="cover"><img src="${cover.name}" alt="${xesc(title)}"/></div>`, '<style>body{margin:0}</style>'));
      man.push('<item id="capa" href="capa.xhtml" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="capa"/>');
    }
    const allHtml = files.map(f => f.html.join('\n') + '\n' + f.notes.join('\n')).join('\n');
    images.filter(im => allHtml.includes(`"${im.name}"`)).forEach((im, i) => { zip.file('OEBPS/' + im.name, im.bytes); man.push(`<item id="i${i + 1}" href="${im.name}" media-type="image/jpeg"/>`); });   // só as imagens que o texto usa
    files.forEach((f, i) => {
      zip.file('OEBPS/' + f.name, page(f.title || title, f.html.join('\n') + (f.notes.length ? '\n' + f.notes.join('\n') : '')));
      man.push(`<item id="x${i + 1}" href="${f.name}" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="x${i + 1}"/>`);
    });
    const landmarks = `<nav epub:type="landmarks" hidden="hidden"><ol>${cover ? '<li><a epub:type="cover" href="capa.xhtml">Capa</a></li>' : ''}<li><a epub:type="bodymatter" href="${files[0].name}">${title.replace(/[<>&"]/g, ' ')}</a></li></ol></nav>`;
    zip.file('OEBPS/nav.xhtml', page(tocName, `<nav epub:type="toc" id="toc"><h1>${tocName}</h1>${navOl(tree)}</nav>\n${landmarks}`));
    zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${xesc(title)}</text></docTitle><navMap>${ncx(tree)}</navMap></ncx>`);
    zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${id}</dc:identifier>
<dc:title>${xesc(title)}</dc:title>
${authors.map(a => `<dc:creator>${xesc(a)}</dc:creator>`).join('\n')}
<dc:language>${lang}</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
${cover ? '<meta name="cover" content="cover-img"/>' : ''}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${man.join('\n')}
</manifest>
<spine toc="ncx"${['ar', 'he'].includes(lang) ? ' page-progression-direction="rtl"' : ''}>
${spine.join('\n')}
</spine>
</package>`);
    say('Gerando o EPUB…'); await tick();
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
    return { bytes, pages: N, chapters: files.length, title, authors, garbledPages };
  }
