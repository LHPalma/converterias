  // src/app/pdf-linhas.js: PDF → EPUB, parte 1: do texto posicionado do pdf.js às linhas (agrupamento, colunas, itálico/negrito, desenhos).
  // Parte do script principal: o build.py cola este arquivo dentro do (() => { ... })() de src/template.html, no lugar
  // do marcador /*@app/pdf-linhas.js*/. Por isso usa direto o que está lá ($, say, tick, results, busy, files, mode...) e as outras
  // partes; a ordem dos marcadores no template importa (const/let só existem depois da linha em que são declarados).
  // ---------- conversão PDF -> EPUB ----------
  const xesc = s => esc(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])/g, '').replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, '$1');   // sem controles nem metades de par substituto (XML inválido)
  const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  const modeOf = (pairs, bin) => {   // moda ponderada de [valor, peso]; devolve a média dos valores da faixa vencedora
    const h = new Map();
    for (const [v, w] of pairs) { const k = Math.round(v / bin); const e = h.get(k) || [0, 0, 0]; e[0] += w; e[1] += v * w; e[2] += w; h.set(k, e); }
    let best = null;
    for (const e of h.values()) if (!best || e[0] > best[0]) best = e;
    return best ? best[1] / best[2] : 0;
  };
  const uuid = () => {
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/;   // sem espaços entre palavras
  const RTL_CH = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/, LTR_ONLY = /^[^\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]*[A-Za-z0-9][^\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]*$/;
  // acentos soltos (TeX desenha o acento e depois a letra): "ent˜ao" -> "então"
  const ACC = { '˜': '\u0303', 'ˆ': '\u0302', 'ˇ': '\u030c', '˘': '\u0306', '˙': '\u0307', '˚': '\u030a', '˝': '\u030b', '¸': '\u0327', '¨': '\u0308', '¯': '\u0304', '˛': '\u0328', '´': '\u0301', '`': '\u0300' };
  const ACC_RE = /([˜ˆˇ˘˙˚˝¸¨¯˛´`])([A-Za-zıȷ])/g, ACC_TEX_ONLY = new Set(['´', '`']), CEDILLA_OK = /[cCsStT]/;
  const dotless = l => l === 'ı' ? 'i' : l === 'ȷ' ? 'j' : l;
  // tex = documento TeX (acentos soltos são acentos de verdade): então ´ e ` antes de vogal também são acentos
  const composeAcc = (str, tex) => {
    let n = 0;
    const out = str.replace(ACC_RE, (m, a, l) => {
      if (ACC_TEX_ONLY.has(a) && !(tex && /[aeiouyıAEIOUY]/.test(l))) return m;
      if ((a === '¸' || a === '˛') && !CEDILLA_OK.test(l)) return m;
      n++; return (dotless(l) + ACC[a]).normalize('NFC');
    });
    return [out, n];
  };
  const CLITIC = new Set('me te se lhe lhes nos vos o a os as lo la los las no na nas mo ma to ta'.split(' '));
  const TERMINAL = /[.!?…]["”’»)\]*]*$/;
  const LIST_START = /^(?:[•▪◦●■‣◆▸►–—-]\s|\(?\d{1,2}[.)]\s|\(?[a-h][.)]\s|\([ivx]+\)\s)/;
  const NOTE_LABEL = /^(\d{1,3}|[*†‡§]+)(?=[\s.) ]|$)/;
  const PART_RE = /^(?:livro|parte|part|book|volume|vol\.|t[íi]tulo)\b/i;
  const CHAP_RE = /^(?:cap[íi]tulo|chapter|ap[êe]ndice|appendix|pref[áa]cio|preface|pr[óo]logo|prologue|introdu[cç][ãa]o|introduction|conclus[ãa]o|conclusion|posf[áa]cio|afterword|ep[íi]logo|epilogue|agradecimentos|acknowledg\w+|sum[áa]rio|contents|[ií]ndice|bibliografia|refer[êe]ncias|notas)(?:\s|$|[:.\-–—])/i;
  const TOC_LEAD = /(?:\.{4,}|(?:\.\s){4,}|…{2,}|(?:\s\.){4,})\s*(\d{1,4}|[ivxlc]{1,6})\s*$/i;
  const TOC_NUM = /^\D.{6,}?[^,\d\s]\s+(\d{1,4})$/;   // "Título 44" (sem ser lista de páginas de um índice remissivo: "Nome, 12, 45")
  const STOPW = {
    pt: 'de que e o a do da em um para com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas esse eles estão você tinha foram essa num nem suas meu às minha têm numa'.split(' '),
    en: 'the of and to in is that it for was on with as are be by this at from or an have not but they which you were his had her she we their has been one would there all can more when who will if no out what so up said about them into than its then my other some could only these may any like him now also over such'.split(' '),
    es: 'de la que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo'.split(' '),
    fr: 'de la le et les des en un du une que est pour qui dans a par plus pas au sur ne se ce il sont aux avec son ses mais ou comme cette ont été leur tout nous être elle même deux ces aussi fait ainsi entre dont sans peut sous avant encore très'.split(' '),
    de: 'der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei'.split(' '),
    it: 'di e il la che in a per un del è con non una le si da dei i al lo come più ma gli della sono ha nel anche o se alla questo tra suo loro cui dalla nella era dopo essere stato molto'.split(' '),
  };
  function guessLang(text) {
    const letters = text.match(/\p{L}/gu) || [], share = re => letters.filter(c => re.test(c)).length / Math.max(1, letters.length);
    if (letters.length > 20) {   // escritas que não usam o alfabeto latino
      if (share(/[\u3040-\u30ff]/) > 0.1) return 'ja';
      if (share(/[\uac00-\ud7af]/) > 0.3) return 'ko';
      if (share(/[\u3400-\u9fff\uf900-\ufaff]/) > 0.3) return 'zh';
      if (share(/[\u0400-\u04ff]/) > 0.4) return 'ru';
      if (share(/[\u0590-\u05ff]/) > 0.4) return 'he';
      if (share(/[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]/) > 0.4) return 'ar';
      if (share(/[\u0370-\u03ff\u1f00-\u1fff]/) > 0.4) return 'el';
      if (share(/[\u0e00-\u0e7f]/) > 0.4) return 'th';
      if (share(/[\u0900-\u097f]/) > 0.4) return 'hi';
    }
    const sample = (text.toLowerCase().match(/\p{L}+/gu) || []).slice(0, 8000);
    let best = ['pt', 0];
    for (const [l, list] of Object.entries(STOPW)) {
      const set = new Set(list), n = sample.reduce((c, w) => c + (set.has(w) ? 1 : 0), 0);
      if (n > best[1]) best = [l, n];
    }
    return best[1] > 20 ? best[0] : 'pt';
  }

  // vãos verticais entre colunas de texto (lista de posições x; vazia = coluna única)
  function findGutters(items, ps) {
    const n = items.length;
    if (n < 24) return [];
    const x0 = Math.min(...items.map(r => r.x)), x1 = Math.max(...items.map(r => r.x + r.w)), span = x1 - x0;
    if (span < 12 * ps) return [];
    const cov = new Uint16Array(Math.ceil(x1) + 2);
    for (const r of items) { const a = Math.max(0, Math.floor(r.x)), b = Math.min(cov.length - 1, Math.ceil(r.x + r.w)); for (let x = a; x <= b; x++) cov[x]++; }
    const lo = Math.floor(x0 + 0.2 * span), hi = Math.ceil(x1 - 0.2 * span), thr = Math.max(1, Math.floor(0.025 * n));
    let best = null;
    for (let x = lo; x <= hi;) {
      if (cov[x] > thr) { x++; continue; }
      let e = x; while (e <= hi && cov[e] <= thr) e++;
      const w = e - x; if (w >= Math.max(7, 0.8 * ps) && (!best || w > best.w)) best = { a: x, w };
      x = e;
    }
    if (!best) return [];
    const g = best.a + best.w / 2, left = items.filter(r => r.x + r.w / 2 < g), right = items.filter(r => r.x + r.w / 2 >= g);
    if (left.length < 0.2 * n || right.length < 0.2 * n) return [];
    return [...findGutters(left, ps), g, ...findGutters(right, ps)];
  }

  // agrupa itens de texto em linhas (baseline comum); sobrescritos e subscritos entram na linha do texto principal
  function clusterLines(items) {
    const bySize = [...items].sort((a, b) => b.size - a.size || a.y - b.y);
    const lines = [];
    for (const r of bySize) {
      let best = null, bd = 1e9;
      for (const L of lines) {
        const dy = r.y - L.y, ad = Math.abs(dy);
        let ok;
        if (r.size >= 0.9 * L.size) ok = ad < 0.4 * L.size;
        else {
          const short = r.str.trim().length <= 8, ratio = r.size / L.size;
          ok = ad < 0.25 * L.size || (short && ratio > 0.45 && ((dy < -0.12 * L.size && dy > -0.75 * L.size) || (dy > 0.12 * L.size && dy < 0.45 * L.size)));
        }
        if (ok && ad < bd) { best = L; bd = ad; }
      }
      if (best) best.items.push(r); else lines.push({ y: r.y, size: r.size, items: [r] });
    }
    return lines;
  }

  const plainRun = r => !r.sup && !r.i && !r.b && !r.m;   // o espaço entre trechos fica fora de itálico, negrito e sobrescrito
  // trechos (itálico, negrito, código, sobrescrito) a partir de itens de texto ordenados por x
  function buildRuns(items, size, y, pn) {
    const runs = []; let prevEnd = null;
    for (const r of items) {
      const st = r.st, small = r.size < 0.9 * size;
      const run = { t: r.str, b: st.b, i: st.i, m: st.m, sup: small && y - r.y > 0.1 * size ? 1 : small && r.y - y > 0.12 * size ? -1 : 0, pn };
      const last = runs[runs.length - 1];
      const gap = prevEnd === null ? 0 : r.x - prevEnd;
      const sp = last && gap > 0.15 * Math.min(r.size, size) && !/\s$/.test(last.t) && !/^\s/.test(run.t) && !/^[,.;:!?)\]}%»”’]/.test(run.t) && !/[(\[{«“‘]$/.test(last.t) && !(CJK.test(last.t.slice(-1)) || CJK.test(run.t[0]));
      if (last && last.b === run.b && last.i === run.i && last.m === run.m && last.sup === run.sup) last.t += (sp ? ' ' : '') + run.t;
      else { if (sp) { if (!plainRun(run) || plainRun(last)) last.t += ' '; else run.t = ' ' + run.t; } runs.push(run); }
      prevEnd = r.x + r.w;
    }
    runs.forEach(r => { if (!r.m) r.t = r.t.replace(/\s+/g, ' '); r.t = r.t.normalize('NFC'); });
    if (runs.length) { runs[0].t = runs[0].t.replace(/^\s+/, ''); const lr = runs[runs.length - 1]; lr.t = lr.t.replace(/\s+$/, ''); }
    return runs.filter(r => r.t);
  }
  function finalizeLines(groups, pn, col, rtl) {
    const out = [];
    // capitular que desce até a 2ª linha: o agrupamento a junta à linha de baixo; ela vai para o começo da linha de cima
    if (!rtl) for (const g of groups) {
      if (g.items.length < 2) continue;
      const it = [...g.items].sort((a, b) => a.x - b.x), cap = it[0], rest = it.slice(1), s = median(rest.map(r => r.size));
      if (!/^\p{L}{1,2}$/u.test(cap.str.trim()) || cap.size < 1.8 * s || cap.x + cap.w > rest[0].x + 0.5 * s) continue;
      const ry = median(rest.map(r => r.y)), rx = Math.min(...rest.map(r => r.x));
      // a linha de cima que a letra alcança (a mais alta, se ela descer 3 ou mais linhas), alinhada ao texto ao lado dela
      const capTop = cap.y - 0.72 * cap.size, yOf = h => median(h.items.map(r => r.y));
      const up = groups.filter(h => h !== g && h.items.every(r => r.size < 1.5 * s) && yOf(h) > capTop + 0.4 * s && yOf(h) < ry - 0.6 * s
        && Math.abs(Math.min(...h.items.map(r => r.x)) - rx) < 1.5 * s).sort((a, b) => yOf(a) - yOf(b))[0];
      if (!up) continue;
      const ux = Math.min(...up.items.map(r => r.x)), uy = median(up.items.map(r => r.y));
      g.items = rest; g.y = ry; g.size = s;
      up.items.push({ ...cap, w: Math.max(0.01, ux - cap.x - 0.01), y: uy, size: s });   // no lugar dela, colada na 1ª palavra ("E" + "ra" = "Era")
    }
    for (const g of groups) {
      let items = g.items.sort((a, b) => a.x - b.x);
      if (rtl) {   // coordenadas espelhadas: trechos em escrita latina/números voltam à ordem da esquerda para a direita
        const o = []; let run = [];
        const flush = () => { o.push(...run.reverse()); run = []; };
        for (const r of items) { if (LTR_ONLY.test(r.str.trim())) run.push(r); else { flush(); o.push(r); } }
        flush(); items = o;
      }
      const bySize = new Map();
      for (const r of items) { const k = Math.round(r.size * 2) / 2; bySize.set(k, (bySize.get(k) || 0) + r.str.length); }
      const size = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const base = items.filter(r => Math.abs(r.size - size) < 0.6);
      const y = base.length ? median(base.map(r => r.y)) : g.y;
      const L = { pn, items, size, y, top: y - size, x0: Math.min(...items.map(r => r.x)), x1: Math.max(...items.map(r => r.x + r.w)), col, runs: [], rtl: !!rtl };
      L.runs = buildRuns(items, size, y, pn);
      L.text = L.runs.map(r => r.t).join('');
      if (!L.text) continue;
      L.bold = L.runs.every(r => r.b || !r.t.trim());
      L.mathShare = items.reduce((n, r) => n + (r.st.x ? r.str.trim().length : 0), 0) / Math.max(1, items.reduce((n, r) => n + r.str.trim().length, 0));
      const monoChars = L.runs.reduce((n, r) => n + (r.m ? r.t.length : 0), 0);
      if (monoChars >= 0.85 * L.text.length) {   // linha de código: guarda o texto posicionado em colunas de caracteres
        const mi = items.filter(r => r.mono && r.str.length), cw = median(mi.map(r => r.w / r.str.length)) || size * 0.6;
        let code = '';
        for (const r of items) { const c = Math.round((r.x - L.x0) / cw); if (code.length < c) code = code.padEnd(c); code += r.str; }
        L.mono = true; L.cw = cw; L.code = code.replace(/\s+$/, '');
      }
      L.upper = /\p{Lu}/u.test(L.text) && !/\p{Ll}/u.test(L.text);
      out.push(L);
    }
    return out.sort((a, b) => a.y - b.y);
  }

  // linhas da página na ordem de leitura (colunas da esquerda para a direita; títulos que cruzam colunas separam faixas)
  function pageLines(raw, pn, rtl) {
    const ps = modeOf(raw.map(r => [r.size, r.str.length]), 0.5) || 10;
    const gutters = findGutters(raw, ps);
    if (!gutters.length) return finalizeLines(clusterLines(raw), pn, 0, rtl);
    const span = [], cols = gutters.map(() => []).concat([[]]);
    for (const r of raw) {
      if (gutters.some(g => r.x < g - 0.5 && r.x + r.w > g + 0.5)) span.push(r);
      else cols[gutters.filter(g => r.x + r.w / 2 > g).length].push(r);
    }
    const spanLines = finalizeLines(clusterLines(span), pn, 0, rtl).map(L => (L.span = true, L));
    const colLines = cols.map((items, c) => finalizeLines(clusterLines(items), pn, c, rtl));
    const out = []; let prev = -Infinity;
    for (const S of [...spanLines, null]) {
      const bound = S ? S.y : Infinity;
      for (const cl of colLines) out.push(...cl.filter(L => L.y > prev && L.y <= bound));
      if (S) out.push(S);
      prev = bound;
    }
    return out;
  }


  // formas desenhadas numa página (imagens e vetores), em coordenadas da página
  function drawnShapes(ol, vp, W, H, IMG_OPS, OPS, Util) {
    const PAINT = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const shapes = []; let hasImg = false, bigImg = false, ctm = [1, 0, 0, 1, 0, 0], pending = null;
    const stack = [];
    const toPage = (pts) => {
      const q = pts.map(([x, y]) => vp.convertToViewportPoint(...Util.applyTransform([x, y], ctm))), xs = q.map(a => a[0]), ys = q.map(a => a[1]);
      return [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(W, Math.max(...xs)), Math.min(H, Math.max(...ys))];
    };
    for (let k = 0; k < ol.fnArray.length; k++) {
      const fn = ol.fnArray[k], a = ol.argsArray[k];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = Util.transform(ctm, a);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(a[0]) && a[0].length === 6) ctm = Util.transform(ctm, a[0]); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === OPS.beginGroup) { stack.push(ctm); if (a[0] && a[0].matrix) ctm = Util.transform(ctm, a[0].matrix); }
      else if (fn === OPS.endGroup) ctm = stack.pop() || ctm;
      else if (fn === OPS.constructPath) {
        const mm = a[2];   // [minX, minY, maxX, maxY] no espaço do usuário (pdf.js 4; o 3 usava [minX, maxX, minY, maxY])
        if (mm && mm.length === 4 && isFinite(mm[0] + mm[1] + mm[2] + mm[3])) pending = pending ? [Math.min(pending[0], mm[0]), Math.min(pending[1], mm[1]), Math.max(pending[2], mm[2]), Math.max(pending[3], mm[3])] : mm;
      }
      else if (PAINT.has(fn)) {
        if (pending) {
          const b = toPage([[pending[0], pending[1]], [pending[2], pending[1]], [pending[0], pending[3]], [pending[2], pending[3]]]), w = b[2] - b[0], h = b[3] - b[1];
          if ((w > 0 || h > 0) && w * h < 0.55 * W * H) shapes.push({ b, k: Math.max(w, h) < 2.5 ? 'dot' : Math.min(w, h) < 2.2 && Math.max(w, h) > 8 ? 'rule' : 'vec' });   // formas do tamanho da página são fundo
        }
        pending = null;
      }
      else if (fn === OPS.endPath || fn === OPS.clip || fn === OPS.eoClip) pending = null;
      else if (IMG_OPS.has(fn)) {
        hasImg = true;
        const b = toPage([[0, 0], [1, 0], [0, 1], [1, 1]]);
        if ((b[2] - b[0]) * (b[3] - b[1]) >= 0.4 * W * H) bigImg = true;
        if (b[2] - b[0] > 1 && b[3] - b[1] > 1 && (b[2] - b[0]) * (b[3] - b[1]) < 0.9 * W * H) shapes.push({ b, k: 'img' });
      }
    }
    return { shapes, hasImg, bigImg };
  }

  // figuras: agrupa imagens e desenhos vizinhos; descarta ícones, fundos, tabelas (só linhas) e caixas de texto
  function figureRegions(shapes, raw, W, H, chars) {
    const sh = shapes.filter(s => s.k !== 'dot');
    if (!sh.length) return [];
    const idx = sh.map((_, i) => i).sort((a, b) => sh[a].b[0] - sh[b].b[0]);
    const par = sh.map((_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; }, GAP = 6;
    for (let a = 0; a < idx.length; a++) {
      const A = sh[idx[a]].b;
      for (let c = a + 1; c < idx.length; c++) { const B = sh[idx[c]].b; if (B[0] > A[2] + GAP) break; if (B[1] <= A[3] + GAP && A[1] <= B[3] + GAP) par[find(idx[c])] = find(idx[a]); }
    }
    const groups = new Map();
    sh.forEach((s, i) => {
      const r = find(i), g = groups.get(r) || { b: [1e9, 1e9, -1e9, -1e9], img: 0, vec: 0, rule: 0 };
      g.b = [Math.min(g.b[0], s.b[0]), Math.min(g.b[1], s.b[1]), Math.max(g.b[2], s.b[2]), Math.max(g.b[3], s.b[3])]; g[s.k]++; groups.set(r, g);
    });
    const G = [...groups.values()];
    const sig = g => g.img > 0 || g.vec >= 3;
    for (let merged = true; merged;) {
      merged = false;
      for (let i = 0; i < G.length && !merged; i++) for (let j = i + 1; j < G.length && !merged; j++) {
        const A = G[i], B = G[j];
        if (!sig(A) && !sig(B)) continue;
        const area = g => (g.b[2] - g.b[0]) * (g.b[3] - g.b[1]);
        if (area(A) > 0.3 * W * H || area(B) > 0.3 * W * H) continue;
        const vo = Math.min(A.b[3], B.b[3]) - Math.max(A.b[1], B.b[1]), ho = Math.min(A.b[2], B.b[2]) - Math.max(A.b[0], B.b[0]);
        const hgap = Math.max(A.b[0], B.b[0]) - Math.min(A.b[2], B.b[2]), vgap = Math.max(A.b[1], B.b[1]) - Math.min(A.b[3], B.b[3]);
        if ((vo >= 0.4 * Math.min(A.b[3] - A.b[1], B.b[3] - B.b[1]) && hgap < 48) || (ho >= 0.4 * Math.min(A.b[2] - A.b[0], B.b[2] - B.b[0]) && vgap < 14)) {
          A.b = [Math.min(A.b[0], B.b[0]), Math.min(A.b[1], B.b[1]), Math.max(A.b[2], B.b[2]), Math.max(A.b[3], B.b[3])];
          A.img += B.img; A.vec += B.vec; A.rule += B.rule; G.splice(j, 1); merged = true;
        }
      }
    }
    const rowMap = new Map();
    for (const r of raw) { const k = Math.round(r.y / 2); (rowMap.get(k) || rowMap.set(k, []).get(k)).push(r); }
    const rows = [...rowMap.values()];
    const inside = (r, b, m) => r.x + r.w / 2 > b[0] - m && r.x + r.w / 2 < b[2] + m && r.y - r.size / 3 > b[1] - m && r.y - r.size / 3 < b[3] + m;
    const out = [];
    for (const g of G) {
      let [x0, y0, x1, y1] = g.b; const w = x1 - x0, h = y1 - y0;
      if (g.img === 0 && g.vec < 4 && !(g.vec >= 1 && w >= 60 && h >= 60)) continue;   // só vetores: precisam de peças suficientes (linhas soltas são tabelas/sublinhados)
      if (w < 24 || h < 14) continue;
      if (g.img > 0 && g.vec === 0 && (w < 0.08 * W || h < 0.04 * H)) continue;       // ícone ou logotipo
      if (w * h > 0.5 * W * H && chars > 100) continue;                               // fundo de página
      const ins = raw.filter(r => inside(r, g.b, 3)), tc = ins.reduce((n, r) => n + r.str.trim().length, 0);
      if (g.img === 0 && (tc > 160 || ins.filter(r => r.str.trim().length >= 28).length >= 2)) continue;   // caixa com texto, não figura
      // rótulos de eixos e nós: linhas curtinhas (até 24 caracteres) coladas na figura
      const ring = [g.b[0] - 14, g.b[1] - 14, g.b[2] + 14, g.b[3] + 14];
      for (const row of rows) {
        if (row.every(r => ins.includes(r)) || row.reduce((n, r) => n + r.str.trim().length, 0) > 24) continue;
        if (!row.every(r => r.x >= ring[0] && r.x + r.w <= ring[2] && r.y - r.size <= ring[3] && r.y >= ring[1])) continue;
        for (const r of row) { ins.push(r); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y - r.size); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.size * 0.3); }
      }
      out.push({ box: [Math.max(0, x0 - 2), Math.max(0, y0 - 2), Math.min(W, x1 + 2), Math.min(H, y1 + 2)], alt: ins.map(r => r.str.trim()).join(' ').replace(/\uFFFC\d+\uFFFC/g, '').slice(0, 160) });
    }
    return out;
  }

  // vetor 16x16 (tinta = valor alto, normalizado) de um recorte, para comparar formas de glifos
  function shapeVec(cv, x, y, w, h) {
    const N = 16, t = document.createElement('canvas'); t.width = N; t.height = N;
    const c = t.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, N, N); c.drawImage(cv, x, y, w, h, 0, 0, N, N);
    const d = c.getImageData(0, 0, N, N).data, v = []; for (let k = 0; k < d.length; k += 4) v.push(255 - (d[k] + d[k + 1] + d[k + 2]) / 3);
    const m = v.reduce((p, q) => p + q, 0) / v.length, e = Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0)) || 1;
    return v.map(q => (q - m) / e);
  }
  const shapeCorr = (A, B) => A.reduce((p, q, k) => p + q * B[k], 0);
