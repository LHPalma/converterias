/* Corretor ortográfico para o texto do OCR, sobre um dicionário Hunspell (aqui, o VERO pt-BR).
   Não expande o dicionário: guarda as palavras-raiz e confere cada palavra tirando prefixos e sufixos
   conforme as regras do arquivo .aff, como o Hunspell faz. Só mexe em palavras que o dicionário não
   conhece e que o OCR leu com pouca certeza (ou que estão coladas), e só quando há uma única correção
   clara. Nomes próprios (palavras com inicial maiúscula) ficam como estão. */
const Spell = (() => {
  const ALPHA = 'abcdefghijklmnopqrstuvwxyzáàâãéêíóôõúüç';
  const STOP = new Set('a e o as os de da do das dos em no na nos nas um uma uns umas ao aos à às se que com por para sob sobre até entre ou'.split(' '));
  // trocas típicas de OCR (custo menor que uma troca qualquer)
  const CONFUSE = [['rn', 'm'], ['m', 'rn'], ['cl', 'd'], ['d', 'cl'], ['vv', 'w'], ['ii', 'u'], ['l', 'i'], ['i', 'l'], ['c', 'e'], ['e', 'c'],
    ['o', 'a'], ['a', 'o'], ['u', 'v'], ['v', 'u'], ['t', 'f'], ['f', 't'], ['h', 'b'], ['b', 'h'], ['n', 'u'], ['u', 'n'], ['s', 'z'], ['z', 's']];
  const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const isCapital = s => /^\p{Lu}\p{Ll}/u.test(s);

  class Dict {
    constructor(aff, dic) {
      this.words = new Map(); this.sfx = new Map(); this.pfx = new Map();
      this.parseAff(aff); this.parseDic(dic);
    }
    parseAff(aff) {
      const seen = new Set();
      for (const raw of aff.split('\n')) {
        const p = raw.replace(/#.*$/, '').trim().split(/\s+/);
        if (p[0] !== 'PFX' && p[0] !== 'SFX') continue;
        const key = p[0] + p[1];
        if (!seen.has(key) && p.length === 4 && (p[2] === 'Y' || p[2] === 'N') && /^\d+$/.test(p[3])) { seen.add(key); this['c' + key] = p[2] === 'Y'; continue; }   // cabeçalho do grupo
        if (p.length < 4) continue;
        const [kind, flag, st, ad, cond = '.'] = p, add = ad.split('/')[0];
        const rule = { flag, strip: st === '0' ? '' : st, cross: !!this['c' + key], re: null };
        const a = add === '0' ? '' : add;
        if (cond !== '.') { try { rule.re = new RegExp(kind === 'SFX' ? `(?:${cond})$` : `^(?:${cond})`, 'u'); } catch (e) { continue; } }
        const m = kind === 'SFX' ? this.sfx : this.pfx;
        if (!m.has(a)) m.set(a, []); m.get(a).push(rule);
      }
    }
    parseDic(dic) {
      const lines = dic.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const l = lines[i].trim(); if (!l) continue;
        const [w, f = ''] = l.split(/\s/)[0].split('/');
        const old = this.words.get(w); this.words.set(w, old === undefined ? f : old + f);
      }
    }
    has(w, flag) { const f = this.words.get(w); return f !== undefined && (flag == null || f.includes(flag)); }
    // (raiz, regra) possíveis tirando um sufixo de w
    *sfxStems(w) {
      const n = w.length;
      for (let i = 0; i <= Math.min(n - 1, 10); i++) {
        const rs = this.sfx.get(w.slice(n - i)); if (!rs) continue;
        const base = w.slice(0, n - i);
        for (const r of rs) { const stem = base + r.strip; if (stem && (!r.re || r.re.test(stem))) yield [stem, r]; }
      }
    }
    affixed(w) {
      for (const [stem, r] of this.sfxStems(w)) if (this.has(stem, r.flag)) return true;
      const n = w.length;
      for (let i = 1; i <= Math.min(n - 1, 8); i++) {
        const rs = this.pfx.get(w.slice(0, i)); if (!rs) continue;
        const rest = w.slice(i);
        for (const r of rs) {
          const stem = r.strip + rest;
          if (r.re && !r.re.test(stem)) continue;
          if (this.has(stem, r.flag)) return true;
          if (r.cross) for (const [s2, sr] of this.sfxStems(stem)) if (sr.cross && this.has(s2, sr.flag) && this.has(s2, r.flag)) return true;
        }
      }
      return false;
    }
    check(w) { return this.words.has(w) || this.affixed(w); }
    /* a palavra existe? (minúscula; com inicial maiúscula tenta também a forma de nome próprio) */
    known(w) {
      if (this.check(w)) return true;
      const lo = w.toLowerCase();
      return lo !== w && (this.check(lo) || (isCapital(w) && this.check(cap(lo))));
    }

    /* candidatos a uma edição de distância, com custo (menor = mais provável) */
    candidates(w) {
      const out = new Map(), add = (c, cost) => { if (c !== w && c.length > 1 && !(out.has(c) && out.get(c) <= cost) && this.check(c)) out.set(c, cost); };
      const sw = strip(w);
      for (let i = 0; i <= w.length; i++) {
        const L = w.slice(0, i), R = w.slice(i);
        if (R) add(L + R.slice(1), 1);                                              // remove letra
        if (R.length > 1) add(L + R[1] + R[0] + R.slice(2), 1);                    // troca de ordem
        for (const ch of ALPHA) {
          add(L + ch + R, 1);                                                       // insere
          if (R) add(L + ch + R.slice(1), strip(ch) === strip(R[0]) ? .5 : 1);     // troca (só o acento: custo menor)
        }
        for (const [a, b] of CONFUSE) if (R.startsWith(a)) add(L + b + R.slice(a.length), .7);   // confusões típicas do OCR
      }
      void sw; return out;
    }
    /* melhor correção única { w, cost }, ou null */
    best(w) {
      const c = [...this.candidates(w)]; if (!c.length) return null;
      c.sort((x, y) => x[1] - y[1]);
      if (c.length > 1 && c[1][1] === c[0][1]) return null;   // empate: ambíguo, não mexe
      return { w: c[0][0], cost: c[0][1] };
    }
    /* palavra colada -> peças válidas (no máximo 3), ou null. Prefere as divisões que têm uma palavra
       funcional (de, que, para, a…), que é o que costuma ficar colado; sem isso, só com allowAny. */
    split(w, allowAny) {
      const n = w.length, ok = s => (s.length >= 4 || STOP.has(s)) && this.known(s);   // peças: palavra funcional ou com 4+ letras
      let best = null, bestFn = false;
      const go = (start, parts) => {
        if (parts.length > 3) return;
        if (start === n) {
          if (parts.length < 2) return;
          const fn = parts.some(x => STOP.has(x));
          if (!allowAny && !(STOP.has(parts[0]) && parts[0].length > 1)) return;   // sem dúvida do OCR: só palavra funcional colada NO COMEÇO ("quevirão")
          if (parts.length > 2 && parts.some(x => x.length === 1)) return;          // nada de peças de 1 letra em divisões de 3
          if (!fn && !allowAny) return;
          const key = x => x.filter(q => !STOP.has(q)).length * 10 + x.length;   // menos palavras "de conteúdo" e menos peças
          const better = !best || (fn && !bestFn) || (fn === bestFn && key(parts) < key(best));
          if (better) { best = parts.slice(); bestFn = fn; }
          return;
        }
        for (let end = n; end > start; end--) { const s = w.slice(start, end); if (ok(s)) { parts.push(s); go(end, parts); parts.pop(); } }
      };
      go(0, []); return best;
    }
  }

  /* texto -> texto corrigido. low = conjunto de palavras que o OCR leu com pouca certeza.
     stats = { fixed: [], } recebe { de, para }. */
  function fixText(text, dict, low, stats) {
    const log = (de, para) => { if (stats) stats.fixed.push({ de, para }); return para; };
    // palavra partida por hifenização que o OCR não juntou: "nave- gar" -> "navegar"
    text = text.replace(/(\p{L}{2,})-\s+(\p{Ll}\p{L}*)/gu, (m, a, b) => dict.known(a + b) && !dict.known(a) && !dict.known(b) ? log(m, a + b) : m);
    return text.replace(/\p{L}+(?:['’-]\p{L}+)*/gu, (tok, off, str) => {
      const pre = str[off - 1] || '', post = str[off + tok.length] || '';
      if (tok.length < 3 || /\d/.test(pre) || /\d/.test(post) || /[\/:@_]/.test(pre + post) || (pre === '.' && /\p{L}/u.test(str[off - 2] || '')) || (post === '.' && /\p{L}/u.test(str[off + tok.length + 1] || ''))) return tok;   // número, endereço ou e-mail
      if (tok === tok.toUpperCase() || /[-'’]/.test(tok) || dict.known(tok)) return tok;       // sigla, composta ou palavra conhecida
      const name = isCapital(tok);
      if (name && !low.has(tok)) return tok;                                                   // provável nome próprio
      if (low.has(tok)) {                                                                       // OCR em dúvida: tenta uma correção clara
        const b = dict.best(tok.toLowerCase());
        // só confusões típicas de OCR/acento (custo < 1); edição qualquer só em palavras longas
        if (b && (b.cost < 1 || tok.length >= 7)) return log(tok, name ? cap(b.w) : b.w);
      }
      if (tok.length >= 8 && !name) { const s = dict.split(tok, low.has(tok)); if (s) return log(tok, s.join(' ')); }   // palavras coladas
      return tok;
    });
  }

  return { Dict, fixText };
})();
if (typeof module !== 'undefined') module.exports = Spell;
