// PDF -> mangá para Kindle: páginas em imagem num AZW3 (KF8) de layout fixo.
// As resoluções são as dos perfis do Kindle Comic Converter; os metadados de layout
// fixo saem no AZW3 (ver src/azw3.js), conferidos contra o kindlegen da Amazon.
const Manga = (() => {
  const enc = new TextEncoder();

  // tela de cada aparelho, em pixels
  const DEVICES = [
    { id: 'kpw34', label: 'Paperwhite 3/4, Voyage, Oasis 1, Kindle 11 (1072 × 1448)', w: 1072, h: 1448 },
    { id: 'kpw5', label: 'Paperwhite 5 e Signature (1236 × 1648)', w: 1236, h: 1648 },
    { id: 'ko', label: 'Oasis 2/3, Libra (1264 × 1680)', w: 1264, h: 1680 },
    { id: 'kpw6', label: 'Paperwhite 12ª geração e Colorsoft (1272 × 1696)', w: 1272, h: 1696 },
    { id: 'ks', label: 'Scribe (1860 × 2480)', w: 1860, h: 2480 },
    { id: 'kpw12', label: 'Paperwhite 1/2 (758 × 1024)', w: 758, h: 1024 },
    { id: 'k57', label: 'Kindle básico antigo (600 × 800)', w: 600, h: 800 },
  ];
  const deviceById = id => DEVICES.find(d => d.id === id) || DEVICES[0];

  const toBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
  const canvas = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
  const free = cv => { cv.width = cv.height = 0; };

  // tons de cinza no próprio ImageData (o e-ink não mostra cor)
  function toGray(d) {
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
  }

  // estica o contraste: o preto mais claro vira 0 e o branco mais escuro vira 255
  function autoLevel(d) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
    const total = d.length >> 2, cut = Math.max(1, Math.floor(total * 0.004));
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
    if (hi - lo < 40) return;   // página de pouco contraste (arte em cinza): não mexe
    const lut = new Uint8Array(256), k = 255 / (hi - lo);
    for (let v = 0; v < 256; v++) lut[v] = v <= lo ? 0 : v >= hi ? 255 : Math.round((v - lo) * k);
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lut[d[i]];
  }

  // caixa do conteúdo: descarta a moldura branca das digitalizações
  function contentBox(d, w, h) {
    const DARK = 232, MIN = Math.max(2, Math.round(w * 0.002));
    let top = 0, bottom = h - 1, left = 0, right = w - 1;
    const rowHas = y => { let n = 0; for (let x = 0; x < w; x++) if (d[(y * w + x) << 2] < DARK && ++n >= MIN) return true; return false; };
    const colHas = x => { let n = 0; for (let y = 0; y < h; y++) if (d[(y * w + x) << 2] < DARK && ++n >= MIN) return true; return false; };
    while (top < bottom && !rowHas(top)) top++;
    while (bottom > top && !rowHas(bottom)) bottom--;
    while (left < right && !colHas(left)) left++;
    while (right > left && !colHas(right)) right--;
    if (right - left < w * 0.2 || bottom - top < h * 0.2) return { x: 0, y: 0, w, h };   // página quase vazia: deixa como está
    const padX = Math.round(w * 0.004), padY = Math.round(h * 0.004);
    const x = Math.max(0, left - padX), y = Math.max(0, top - padY);
    return { x, y, w: Math.min(w, right + padX + 1) - x, h: Math.min(h, bottom + padY + 1) - y };
  }

  // desenha a imagem dentro da tela do aparelho, centralizada e sem distorcer
  async function place(src, sx, sy, sw, sh, dev, o) {
    const k = Math.min(dev.w / sw, dev.h / sh);
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const cv = canvas(w, h), cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    // a detecção roda na imagem final: as coordenadas já saem no espaço da página
    let det = null;
    if (o.panels === 'auto') {
      const d = cx.getImageData(0, 0, w, h).data;
      const g = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i];
      det = detectBest(g, w, h, { rtl: o.rtl });
    }
    const blob = await toBlob(cv, o.fmt, o.quality);
    free(cv);
    if (!blob) throw new Error('não consegui gerar a imagem da página (memória).');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: o.fmt, w, h, det,
             x: Math.round((dev.w - w) / 2), y: Math.round((dev.h - h) / 2) };
  }

  // uma página do PDF -> uma ou duas páginas de mangá
  async function pageToImages(page, dev, o) {
    const v1 = page.getViewport({ scale: 1 });
    const alvo = o.split ? Math.max(dev.w, dev.h) * 2 : Math.max(dev.w, dev.h);
    let scale = 1.15 * Math.max(dev.w / v1.width, dev.h / v1.height);
    if (o.split && v1.width > v1.height) scale *= 1.6;   // página dupla: cada metade precisa de resolução própria
    scale = Math.min(scale, 6, alvo * 3 / Math.max(v1.width, v1.height));
    let vp = page.getViewport({ scale });
    const cap = 40e6;
    if (vp.width * vp.height > cap) vp = page.getViewport({ scale: scale * Math.sqrt(cap / (vp.width * vp.height)) });
    const W = Math.max(1, Math.ceil(vp.width)), H = Math.max(1, Math.ceil(vp.height));
    const cv = canvas(W, H), cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
    await page.render({ canvasContext: cx, viewport: vp }).promise;

    const img = cx.getImageData(0, 0, W, H);
    toGray(img.data);
    if (o.level) autoLevel(img.data);
    const box = o.crop ? contentBox(img.data, W, H) : { x: 0, y: 0, w: W, h: H };
    cx.putImageData(img, 0, 0);

    const out = [];
    if (o.split && box.w > box.h) {   // página dupla: parte em duas, na ordem de leitura
      const half = Math.floor(box.w / 2);
      const esq = [box.x, box.y, half, box.h], dir = [box.x + half, box.y, box.w - half, box.h];
      for (const [sx, sy, sw, sh] of (o.rtl ? [dir, esq] : [esq, dir]))
        out.push(await place(cv, sx, sy, sw, sh, dev, o));
    } else {
      out.push(await place(cv, box.x, box.y, box.w, box.h, dev, o));
    }
    free(cv);
    return out;
  }

  // ---------- detecção de quadrinhos ----------
  // Corte X-Y recursivo: acha as calhas (faixas de papel que atravessam o bloco
  // inteiro) e parte ali, alternando os eixos. Resolve a diagramação em grade, que
  // é a maioria; o que não se encaixa é recusado pela pontuação e cai no modo de
  // quadrantes. Não trata painel diagonal nem sangrado — retângulo não representa.
  function otsu(hist, total) {   // limiar automático: papel amarelado não aceita valor fixo
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  function detectPanels(gray, w, h, opt = {}) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const thr = Math.max(60, Math.min(otsu(hist, gray.length), 205));

    // integral de tinta: conta pixels escuros de qualquer retângulo em tempo constante
    const iw = w + 1, S = new Uint32Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
      let run = 0;
      for (let x = 0; x < w; x++) {
        if (gray[y * w + x] <= thr) run++;
        S[(y + 1) * iw + (x + 1)] = S[y * iw + (x + 1)] + run;
      }
    }
    const ink = (x0, y0, x1, y1) =>
      S[y1 * iw + x1] - S[y0 * iw + x1] - S[y1 * iw + x0] + S[y0 * iw + x0];

    const MINGUT = Math.max(3, Math.round(Math.min(w, h) * (opt.gutter || 0.012)));
    // tinta tolerada numa linha de calha: calha cruzada só pelo contorno de um balão
    // ainda é calha. Valor escolhido por varredura em três corpora — acima disso,
    // páginas que funcionavam passam a ser recusadas.
    const TOL = opt.tol || 0.025;
    // quanta tinta uma fileira precisa para valer como moldura, e em que janela procurar
    // (digitalização torta espalha a linha da moldura por várias fileiras)
    const RULE = opt.rule || 0.15, RULEWIN = opt.ruleWin || 2;

    // Separadores dentro de um retângulo, ao longo de um eixo. Há dois tipos: a calha
    // branca (faixa quase sem tinta) e a régua preta (faixa fina quase toda tinta),
    // que é como ficam dois quadros encostados, sem branco entre eles.
    const DARKMAX = Math.max(3, Math.round(Math.min(w, h) * 0.02));
    const gutters = (r, horiz) => {
      const n = horiz ? r.y1 - r.y0 : r.x1 - r.x0;
      const span = horiz ? r.x1 - r.x0 : r.y1 - r.y0;
      const runs = [];
      let s = -1, kind = 0;   // 0 nenhum, 1 branco, 2 régua
      const close = i => {
        if (s < 0) return;
        const len = i - s;
        if (kind === 1 && len >= MINGUT) runs.push({ a: s, b: i, dark: false });
        else if (kind === 2 && len >= 2 && len <= DARKMAX) runs.push({ a: s, b: i, dark: true });
        s = -1; kind = 0;
      };
      // mede só o miolo da faixa: a moldura da página (ou a borda do quadro vizinho)
      // põe tinta nas duas pontas de toda linha de calha e a desqualificaria
      const m = Math.min(Math.max(3, Math.round(span * 0.02)), Math.floor(span / 4));
      const a0 = (horiz ? r.x0 : r.y0) + m, a1 = (horiz ? r.x1 : r.y1) - m;
      const inner = Math.max(1, a1 - a0);
      const lim2 = Math.max(1, Math.round(inner * TOL));
      const full2 = inner - Math.max(2, Math.round(inner * 0.06));
      const cnt = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const k = (horiz ? r.y0 : r.x0) + i;
        cnt[i] = horiz ? ink(a0, k, a1, k + 1) : ink(k, a0, k + 1, a1);
      }
      for (let i = 0; i <= n; i++) {
        const k2 = i < n ? (cnt[i] <= lim2 ? 1 : cnt[i] >= full2 ? 2 : 0) : 0;
        if (k2 !== kind) { close(i); if (k2) { s = i; kind = k2; } }
      }
      close(n);

      // Calha de verdade tem a moldura dos quadros encostada nos dois lados. Faixa
      // branca sem isso é balão de fala atravessando o quadro, não divisão — era o
      // que partia um quadro ao meio e fazia o zoom pegar só metade dele.
      const nearRule = i => {
        for (let k = Math.max(0, i - RULEWIN); k <= Math.min(n - 1, i + RULEWIN); k++)
          if (cnt[k] >= inner * RULE) return true;
        return false;
      };
      return runs
        .filter(g => g.a > 0 && g.b < n)   // encostado na borda é margem, não divisão
        .filter(g => g.dark || (nearRule(g.a - 1) && nearRule(g.b)))
        .sort((p, q) => p.a - q.a);
    };

    // encolhe o retângulo até a tinta que ele contém
    const shrink = r => {
      let { x0, y0, x1, y1 } = r;
      while (y0 < y1 - 1 && ink(x0, y0, x1, y0 + 1) === 0) y0++;
      while (y1 > y0 + 1 && ink(x0, y1 - 1, x1, y1) === 0) y1--;
      while (x0 < x1 - 1 && ink(x0, y0, x0 + 1, y1) === 0) x0++;
      while (x1 > x0 + 1 && ink(x1 - 1, y0, x1, y1) === 0) x1--;
      return { x0, y0, x1, y1 };
    };

    const MINSIDE = Math.round(Math.min(w, h) * 0.07);
    const leaves = [];
    const cut = (r, depth) => {
      const rr = shrink(r);
      rr.slot = { x0: r.sx0 ?? r.x0, y0: r.sy0 ?? r.y0, x1: r.sx1 ?? r.x1, y1: r.sy1 ?? r.y1 };
      if (rr.x1 - rr.x0 < MINSIDE || rr.y1 - rr.y0 < MINSIDE) return;
      if (depth > 6) { leaves.push(rr); return; }
      for (const horiz of [true, false]) {
        const runs = gutters(rr, horiz);
        if (!runs.length) continue;
        // Dois recortes por pedaço: o do conteúdo (sem a calha, que é o que define a
        // caixa do quadro) e o da fatia, que corta no meio do separador e portanto
        // ladrilha o bloco sem vão — é dele que sai a área de toque.
        const base = horiz ? rr.y0 : rr.x0, end = horiz ? rr.y1 : rr.x1;
        const sBase = horiz ? r.y0 : r.x0, sEnd = horiz ? r.y1 : r.x1;
        let prev = base, sPrev = sBase;
        const parts = [];
        for (const g of runs) {
          const mid = base + ((g.a + g.b) >> 1);
          parts.push([prev, g.dark ? mid : base + g.a, sPrev, mid]);
          prev = g.dark ? mid : base + g.b;
          sPrev = mid;
        }
        parts.push([prev, end, sPrev, sEnd]);
        for (const [p0, p1, s0, s1] of parts) {
          if (p1 - p0 <= 0) continue;
          const kx0 = r.sx0 ?? r.x0, kx1 = r.sx1 ?? r.x1;   // a fatia do pai no outro eixo
          const ky0 = r.sy0 ?? r.y0, ky1 = r.sy1 ?? r.y1;
          cut(horiz
            ? { x0: rr.x0, y0: p0, x1: rr.x1, y1: p1, sx0: kx0, sy0: s0, sx1: kx1, sy1: s1 }
            : { x0: p0, y0: rr.y0, x1: p1, y1: rr.y1, sx0: s0, sy0: ky0, sx1: s1, sy1: ky1 }, depth + 1);
        }
        return;
      }
      leaves.push(rr);
    };
    const page = shrink({ x0: 0, y0: 0, x1: w, y1: h });
    cut(page, 0);

    const pageArea = Math.max(1, (page.x1 - page.x0) * (page.y1 - page.y0));
    const pw = page.x1 - page.x0, ph = page.y1 - page.y0;
    const panels = leaves
      .map(r => ({ ...r, area: (r.x1 - r.x0) * (r.y1 - r.y0) }))
      .filter(r => {
        if (r.area < pageArea * 0.02) return false;
        const rw = r.x1 - r.x0, rh = r.y1 - r.y0;
        if (rw < pw * 0.06 || rh < ph * 0.06) return false;          // lasca
        if (Math.max(rw / rh, rh / rw) > 9) return false;            // tira fina: legenda, crédito
        return true;
      });

    // ordem de leitura: agrupa em faixas pela sobreposição vertical, faixas de cima
    // para baixo; dentro da faixa, direita→esquerda em mangá
    const rtl = opt.rtl !== false;
    panels.sort((a, b) => a.y0 - b.y0);
    const bands = [];
    for (const p of panels) {
      const b = bands.find(bd => Math.min(bd.y1, p.y1) - Math.max(bd.y0, p.y0) > (p.y1 - p.y0) * 0.45);
      if (b) { b.items.push(p); b.y0 = Math.min(b.y0, p.y0); b.y1 = Math.max(b.y1, p.y1); }
      else bands.push({ y0: p.y0, y1: p.y1, items: [p] });
    }
    bands.sort((a, b) => a.y0 - b.y0);
    const ordered = [];
    for (const b of bands) {
      b.items.sort((p, q) => rtl ? q.x0 - p.x0 : p.x0 - q.x0);
      ordered.push(...b.items);
    }

    // moldura: quanto da borda do retângulo é tinta. Quadro de história em quadrinhos
    // costuma ser emoldurado; coluna de texto corrido não é — é assim que a página de
    // texto em duas colunas deixa de passar por diagramação de quadros.
    const edgeInk = p => {
      const t = Math.max(2, Math.round(Math.min(w, h) * 0.004));
      const rw = p.x1 - p.x0, rh = p.y1 - p.y0;
      if (rw <= 2 * t || rh <= 2 * t) return 0;
      const top = ink(p.x0, p.y0, p.x1, p.y0 + t), bot = ink(p.x0, p.y1 - t, p.x1, p.y1);
      const lef = ink(p.x0, p.y0 + t, p.x0 + t, p.y1 - t), rig = ink(p.x1 - t, p.y0 + t, p.x1, p.y1 - t);
      const cells = 2 * rw * t + 2 * (rh - 2 * t) * t;
      return cells ? (top + bot + lef + rig) / cells : 0;
    };
    for (const p of ordered) p.edge = edgeInk(p);
    // basta um quadro claramente emoldurado: numa página com splash sangrado a maioria
    // não tem moldura, e exigir maioria derrubaria a página inteira
    const framed = ordered.length ? Math.max(...ordered.map(p => p.edge)) : 0;

    // pontuação: quanto da página os quadros cobrem, e se a contagem faz sentido
    const covered = ordered.reduce((s, p) => s + p.area, 0) / pageArea;
    const biggest = ordered.length ? Math.max(...ordered.map(p => p.area)) / pageArea : 0;
    const reasons = [];
    if (ordered.length < 2) reasons.push('menos de dois quadros');
    if (ordered.length > 16) reasons.push('quadros demais');
    if (covered < 0.5) reasons.push('cobertura baixa');
    if (ordered.length > 1 && biggest > 0.92) reasons.push('um quadro ocupa a página');
    if (framed < 0.35) reasons.push('nenhum quadro emoldurado (texto ou anúncio?)');
    return { panels: ordered, page, thr, covered, framed, ok: reasons.length === 0, reasons };
  }

  // Páginas densas (balão e arte cruzando a calha) não passam no corte estrito. Tenta
  // de novo, mais tolerante, só quando a estrita falha: a página que já passou fica com
  // o resultado melhor, e a que nunca passa continua sem painel.
  const PASSES = [{ tol: 0.025 }, { tol: 0.05 }, { tol: 0.09 }];
  function detectBest(gray, w, h, opt) {
    let last = null;
    for (const p of PASSES) {
      last = detectPanels(gray, w, h, Object.assign({}, opt, p));
      if (last.ok) return last;
    }
    return last;
  }

  // ---------- Panel View (magnificação de região) ----------
  // A área tocada é um <a class="app-amzn-magnify">; o "painel" ampliado é a mesma
  // imagem, maior, ancorada num canto dentro de um <div> escondido. O mecanismo é o
  // que o kindlegen reconhece — com esta marcação ele mantém RegionMagnification=true.
  const BOX_POS = {
    'PV-TL': 'left:0;top:0;', 'PV-TR': 'right:0;top:0;',
    'PV-BL': 'left:0;bottom:0;', 'PV-BR': 'right:0;bottom:0;',
    'PV-T': 'top:0;', 'PV-B': 'bottom:0;', 'PV-L': 'left:0;', 'PV-R': 'right:0;',
  };
  const PV_CSS =
    '#PV { position: absolute; width: 100%; height: 100%; top: 0; left: 0; }\n' +
    '#PV-T { top: 0; width: 100%; height: 50%; }\n' +
    '#PV-B { bottom: 0; width: 100%; height: 50%; }\n' +
    '#PV-L { left: 0; width: 49.5%; height: 100%; float: left; }\n' +
    '#PV-R { right: 0; width: 49.5%; height: 100%; float: right; }\n' +
    '#PV-TL { top: 0; left: 0; width: 49.5%; height: 50%; float: left; }\n' +
    '#PV-TR { top: 0; right: 0; width: 49.5%; height: 50%; float: right; }\n' +
    '#PV-BL { bottom: 0; left: 0; width: 49.5%; height: 50%; float: left; }\n' +
    '#PV-BR { bottom: 0; right: 0; width: 49.5%; height: 50%; float: right; }\n' +
    '.PV-P { width: 100%; height: 100%; top: 0; position: absolute; display: none; }\n';

  // quantas regiões a página precisa, e de que tamanho fica a imagem ampliada
  function panelPlan(p, dev, panels, rtl) {
    if (!panels) return null;
    const mw = panels === 2 ? dev.w : Math.round(p.w * 1.6);
    const mh = panels === 2 ? Math.round(p.h * dev.w / p.w) : Math.round(p.h * 1.6);
    const hSplit = mw - dev.w >= dev.w * 0.01, vSplit = mh - dev.h >= dev.h * 0.01;
    let boxes, order;
    if (hSplit && vSplit) { boxes = ['PV-TL', 'PV-TR', 'PV-BL', 'PV-BR']; order = rtl ? [2, 1, 4, 3] : [1, 2, 3, 4]; }
    else if (vSplit) { boxes = ['PV-T', 'PV-B']; order = [1, 2]; }
    else if (hSplit) { boxes = ['PV-L', 'PV-R']; order = rtl ? [2, 1] : [1, 2]; }
    else return null;   // a página já cabe na tela: não há o que ampliar
    return { mw, mh, boxes, order,
             x: Math.round((dev.w / 2 - mw / 2) / dev.w * 100),
             y: Math.round((dev.h / 2 - mh / 2) / dev.h * 100) };
  }

  // quadros detectados: cada um vira uma área de toque do seu tamanho e um div com a
  // página ampliada e deslocada, de modo que aquele quadro preencha a tela
  function detectedHtml(p, dev, det, file) {
    const MAXMAG = 4, MINMAG = 1.15;
    const areas = [], views = [];
    // descarta antes de numerar: o ordinal precisa ser a sequência de leitura, sem buraco
    const useful = det.panels.map(q => {
      const qw = q.x1 - q.x0, qh = q.y1 - q.y0;
      return { q, qw, qh, s: Math.min(dev.w / qw, dev.h / qh, MAXMAG) };
    }).filter(u => u.s >= MINMAG);   // quadro que já ocupa a tela não ganha nada em ampliar
    useful.forEach(({ q, qw, qh, s }, i) => {
      const mw = Math.round(p.w * s), mh = Math.round(p.h * s);
      const L = Math.round((dev.w - qw * s) / 2), T = Math.round((dev.h - qh * s) / 2);
      const W = Math.round(qw * s), H = Math.round(qh * s);
      const ox = Math.round(q.x0 * s) - L, oy = Math.round(q.y0 * s) - T;
      const id = `PV${i + 1}`;
      const pc = (v, t) => (v / t * 100).toFixed(2);

      // área de toque: a fatia inteira, não a caixa justa, senão o vão entre quadros
      // fica sem dono e o toque perto da borda cai no vizinho
      const sl = q.slot || q;
      const ax = Math.max(0, p.x + sl.x0), ay = Math.max(0, p.y + sl.y0);
      const aw = Math.min(dev.w - ax, sl.x1 - sl.x0), ah = Math.min(dev.h - ay, sl.y1 - sl.y0);
      areas.push(`<div id="${id}" style="position:absolute;left:${pc(ax, dev.w)}%;top:${pc(ay, dev.h)}%;` +
                 `width:${pc(aw, dev.w)}%;height:${pc(ah, dev.h)}%">` +
                 `<a style="display:inline-block;width:100%;height:100%;" class="app-amzn-magnify" ` +
                 `data-app-amzn-magnify='{"targetId":"${id}-P", "ordinal":${i + 1}}'></a></div>`);

      // máscara: tampa tudo fora do quadro, que é como o Guided View da Amazon isola um
      // quadro — sem isso aparece pedaço do vizinho em volta
      // a folga evita decepar balão que transborda a moldura do quadro
      const pad = Math.round(Math.min(W, H) * 0.04);
      const mL = Math.max(0, L - pad), mT = Math.max(0, T - pad);
      const mR = Math.min(dev.w, L + W + pad), mB = Math.min(dev.h, T + H + pad);
      const band = (x, y, bw, bh) => bw > 0 && bh > 0
        ? `<div style="position:absolute;left:${x}px;top:${y}px;width:${bw}px;height:${bh}px;background:#ffffff"></div>` : '';
      const mask = band(0, 0, dev.w, mT) + band(0, mB, dev.w, dev.h - mB) +
                   band(0, mT, mL, mB - mT) + band(mR, mT, dev.w - mR, mB - mT);
      views.push(`<div class="PV-P" id="${id}-P"><img style="position:absolute;left:${-ox}px;top:${-oy}px" ` +
                 `src="${file}" width="${mw}" height="${mh}"/>${mask}</div>`);
    });
    if (!areas.length) return null;
    return `\n<div id="PV">\n${areas.join('\n')}\n</div>\n${views.join('\n')}`;
  }

  function panelHtml(plan, file) {
    const areas = plan.boxes.map((b, i) =>
      `<div id="${b}"><a style="display:inline-block;width:100%;height:100%;" class="app-amzn-magnify" ` +
      `data-app-amzn-magnify='{"targetId":"${b}-P", "ordinal":${plan.order[i]}}'></a></div>`).join('\n');
    const views = plan.boxes.map(b => {
      let pos = BOX_POS[b];
      if (b === 'PV-T' || b === 'PV-B') pos += `left:${plan.x}%;`;
      if (b === 'PV-L' || b === 'PV-R') pos += `top:${plan.y}%;`;
      return `<div class="PV-P" id="${b}-P"><img style="position:absolute;${pos}" src="${file}" ` +
             `width="${plan.mw}" height="${plan.mh}"/></div>`;
    }).join('\n');
    return `\n<div id="PV">\n${areas}\n</div>\n${views}`;
  }

  // EPUB de layout fixo: uma página por XHTML, a imagem posicionada em pixels
  function buildEpub(pages, dev, meta) {
    const zip = new JSZip();
    const xml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const ext = p => p.mime === 'image/png' ? 'png' : 'jpg';
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml',
      '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    // 'auto' usa os quadros detectados; quando a página é recusada, cai nos quadrantes
    let anyPanel = false, detOk = 0;
    const html = pages.map((p, i) => {
      const file = `img/p${i + 1}.${ext(p)}`;
      if (meta.panels === 'auto') {
        // página recusada fica sem painel de propósito: quadrante arbitrário numa página
        // e quadro de verdade na outra é pior de usar do que não ter painel ali
        if (!(p.det && p.det.ok)) return '';
        const s = detectedHtml(p, dev, p.det, file);
        if (s) { anyPanel = true; detOk++; return s; }
        return '';
      }
      const plan = panelPlan(p, dev, meta.panels, meta.rtl);
      if (!plan) return '';
      anyPanel = true;
      return panelHtml(plan, file);
    });
    meta.detected = detOk;

    zip.file('OEBPS/style.css',
      `@page { margin: 0; }\n` +
      `html, body { margin: 0; padding: 0; width: ${dev.w}px; height: ${dev.h}px; }\n` +
      `div.fs { margin: 0; padding: 0; width: ${dev.w}px; height: ${dev.h}px; position: relative; background: #ffffff; }\n` +
      `img.pg { position: absolute; }\n` + (anyPanel ? PV_CSS : ''));

    pages.forEach((p, i) => {
      const n = i + 1, f = `p${n}.${ext(p)}`;
      zip.file('OEBPS/img/' + f, p.bytes, { compression: 'STORE' });
      zip.file(`OEBPS/p${n}.xhtml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n` +
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${n}</title>\n` +
        `<meta name="viewport" content="width=${dev.w}, height=${dev.h}"/>\n` +
        `<link rel="stylesheet" type="text/css" href="style.css"/></head>\n` +
        `<body><div class="fs"><img src="img/${f}" alt="" class="pg" ` +
        `style="top:${p.y}px; left:${p.x}px; width:${p.w}px; height:${p.h}px"/></div>` +
        html[i] + `</body></html>`);
    });
    meta.regionMag = anyPanel;

    const mani = pages.map((p, i) => `<item id="x${i + 1}" href="p${i + 1}.xhtml" media-type="application/xhtml+xml"/>` +
      `<item id="i${i + 1}" href="img/p${i + 1}.${ext(p)}" media-type="${p.mime}"${i ? '' : ' properties="cover-image"'}/>`).join('');
    const spine = pages.map((p, i) => `<itemref idref="x${i + 1}" linear="yes"/>`).join('');
    const dir = meta.rtl ? 'rtl' : 'ltr';
    zip.file('OEBPS/content.opf',
      `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bid">\n` +
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">` +
      `<dc:identifier id="bid">urn:uuid:${meta.uuid}</dc:identifier>` +
      `<dc:title>${xml(meta.title)}</dc:title><dc:language>${xml(meta.lang)}</dc:language>` +
      (meta.author ? `<dc:creator>${xml(meta.author)}</dc:creator>` : '') +
      `<meta name="cover" content="i1"/>` +
      `<meta name="fixed-layout" content="true"/><meta name="book-type" content="comic"/>` +
      `<meta name="orientation-lock" content="portrait"/><meta name="original-resolution" content="${dev.w}x${dev.h}"/>` +
      `<meta name="primary-writing-mode" content="horizontal-${meta.rtl ? 'rl' : 'lr'}"/>` +
      `<meta name="RegionMagnification" content="${meta.regionMag ? 'true' : 'false'}"/>` +
      `<meta name="zero-gutter" content="true"/><meta name="zero-margin" content="true"/>` +
      `</metadata>\n<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>` +
      `<item id="css" href="style.css" media-type="text/css"/>${mani}</manifest>\n` +
      `<spine toc="ncx" page-progression-direction="${dir}">${spine}</spine>\n</package>`);
    zip.file('OEBPS/toc.ncx',
      `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">` +
      `<head><meta name="dtb:uid" content="urn:uuid:${meta.uuid}"/></head>` +
      `<docTitle><text>${xml(meta.title)}</text></docTitle><navMap>` +
      `<navPoint id="n1" playOrder="1"><navLabel><text>Início</text></navLabel><content src="p1.xhtml"/></navPoint>` +
      `</navMap></ncx>`);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } });
  }

  async function convert(file, opt = {}) {
    const say = opt.say || (() => {}), tick = opt.tick || (() => Promise.resolve());
    const dev = opt.dev || DEVICES[0];
    const o = { rtl: opt.rtl !== false, split: !!opt.split, crop: opt.crop !== false, level: !!opt.level,
                fmt: opt.png ? 'image/png' : 'image/jpeg', quality: 0.9,
                panels: opt.panels === 'auto' || opt.panels === 2 || opt.panels === 4 ? opt.panels : 0 };

    say('Lendo o PDF…'); await tick();
    let doc;
    try { doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) { throw new Error(e.name === 'PasswordException' ? 'PDF protegido por senha.' : 'não consegui ler este PDF.'); }

    const pages = [];
    try {
      let title = '', author = '';
      try {   // o título de dentro do PDF vale mais que o nome do arquivo
        const md = (await doc.getMetadata()).info || {};
        if (md.Title) title = String(md.Title).trim();
        if (md.Author) author = String(md.Author).trim();
      } catch (e) { /* PDF sem metadados */ }
      if (!title) title = (opt.title || '').trim() || 'Mangá';
      if (!author) author = (opt.author || '').trim();

      for (let i = 0; i < doc.numPages; i++) {
        say(`Página ${i + 1} de ${doc.numPages}…`); await tick();
        const page = await doc.getPage(i + 1);
        try { pages.push(...await pageToImages(page, dev, o)); } finally { page.cleanup(); }
      }
      if (!pages.length) throw new Error('o PDF não tem páginas.');

      say('Montando o livro…'); await tick();
      const uuid = (() => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
        const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; })();
      const meta = { title, author, lang: opt.lang || 'pt', rtl: o.rtl, uuid, panels: o.panels };
      const epub = await buildEpub(pages, dev, meta);

      const a = await Azw3.convert(epub, { say, tick,
        fixed: { w: dev.w, h: dev.h, rtl: o.rtl, bookType: 'comic', regionMag: meta.regionMag } });
      const r = { bytes: a.bytes, title: a.title, authors: a.authors, pages: pages.length,
                  device: dev, panels: meta.regionMag ? o.panels : 0, detected: meta.detected || 0 };
      if (opt._epub) r.epub = epub;   // para conferir o layout fixo num navegador
      return r;
    } finally { doc.destroy(); }
  }

  return { convert, DEVICES, deviceById,
           _contentBox: contentBox, _autoLevel: autoLevel, _panelPlan: panelPlan, _panelHtml: panelHtml,
           _detectPanels: detectPanels, _detectBest: detectBest, _otsu: otsu };
})();
