// Unitários de src/spell.js: leitor Hunspell (afixos, condições, produto cruzado) e correção do texto do OCR.
const { test, expect } = require('../apoio/app');

// dicionário mínimo para exercitar as regras do .aff
const AFF = `SET UTF-8
# comentário
PFX R Y 1
PFX R 0 re .
SFX S Y 2
SFX S 0 s [^s]
SFX S 0 es s
SFX D N 1
SFX D ar ado ar
SFX X Y 1
SFX X 0 x [
`;
const DIC = `5
gato/S
fazer/R
falar/DR
lápis
gás/S
`;

test('Dict: palavras-raiz, sufixos e prefixos com condição e produto cruzado', async ({ page }) => {
  const r = await page.evaluate(({ aff, dic }) => {
    const d = new Spell.Dict(aff, dic);
    return ['gato', 'gatos', 'gatoes', 'gáses', 'gáss', 'refazer', 'falado', 'refalado', 'refalar', 'lápis', 'lápiss', 'Gato', 'GATO', 'xyz'].map(w => [w, d.known(w)]);
  }, { aff: AFF, dic: DIC });
  expect(Object.fromEntries(r)).toEqual({ gato: true, gatos: true, gatoes: false, gáses: true, gáss: false, refazer: true, falado: true, refalado: false, refalar: true, lápis: true, lápiss: false, Gato: true, GATO: true, xyz: false });
});

test('Dict: candidatos, melhor correção e empate', async ({ page }) => {
  const r = await page.evaluate(({ aff, dic }) => {
    const d = new Spell.Dict(aff, dic);
    return { best: ['gatu', 'gatoss', 'lapis', 'gtao', 'zzzz'].map(w => d.best(w)), cands: [...d.candidates('gatu').keys()] };
  }, { aff: AFF, dic: DIC + 'gata\n' });
  expect(r.best[0]).toBeNull();                          // gato x gata: empate, não mexe
  expect(r.best[1]).toEqual({ w: 'gatos', cost: 1 });
  expect(r.best[2]).toEqual({ w: 'lápis', cost: 0.5 });  // só o acento: custo menor
  expect(r.best[3]).toEqual({ w: 'gato', cost: 1 });     // letras trocadas de lugar
  expect(r.best[4]).toBeNull();
  expect(r.cands.sort()).toEqual(['gata', 'gato']);
});

test.describe('com o dicionário pt-BR (VERO)', () => {
  // cada teste usa a página do fixture (é ela que mede a cobertura); o dicionário é montado uma vez por página
  const load = page => page.evaluate(async () => { window.__d = window.__d || new Spell.Dict(await (await fetch('vendor/ocr/pt.aff')).text(), await (await fetch('vendor/ocr/pt.dic')).text()); });
  const fixer = page => async (text, low = []) => { await load(page); return page.evaluate(({ text, low }) => { const st = { fixed: [] }; return [Spell.fixText(text, window.__d, new Set(low), st), st.fixed]; }, { text, low }); };

  test('reconhece flexões', async ({ page }) => {
    await load(page);
    const r = await page.evaluate(() => ['casa', 'casas', 'navegar', 'navegação', 'construção', 'refazer', 'desfazendo', 'Brasil', 'xptoqwe'].map(w => window.__d.known(w)));
    expect(r).toEqual([true, true, true, true, true, true, true, true, false]);
  });

  test('corrige palavra duvidosa com uma correção clara (preservando a maiúscula)', async ({ page }) => {
    const fix = fixer(page);
    expect(await fix('o paralelepipedo caiu', ['paralelepipedo'])).toEqual(['o paralelepípedo caiu', [{ de: 'paralelepipedo', para: 'paralelepípedo' }]]);
    expect((await fix('Paralelepipedo no chão', ['Paralelepipedo']))[0]).toBe('Paralelepípedo no chão');
    expect((await fix('a casa arnarela', ['arnarela']))[0]).toBe('a casa amarela');   // rn → m (confusão típica do OCR)
  });

  test('separa palavras coladas e junta hifenização', async ({ page }) => {
    const fix = fixer(page);
    expect((await fix('quevirão amanhã', ['quevirão']))[0]).toBe('que virão amanhã');
    expect((await fix('a constru- ção acabou'))[0]).toBe('a construção acabou');
    expect((await fix('a construçãoacabou ontem'))[0]).toBe('a construçãoacabou ontem');   // sem dúvida do OCR e sem palavra funcional no começo: fica
    expect((await fix('a casaamarela caiu', ['casaamarela']))[0]).toBe('a casa amarela caiu');   // OCR em dúvida: vale qualquer divisão em palavras de 4+ letras
  });

  test('não mexe no que não deve', async ({ page }) => {
    const fix = fixer(page);
    for (const t of ['O computa- dor ligou', 'Joaozinho chegou', 'O PARALELEPIPEDO', 'Ligue 2023 ou veja www.exemplo.com/abcdefghij', 'e-mail fulano@exemplo.com', 'a b c', 'p.ex. abc', 'Ele viu a casa amarela', 'guarda-chuva quebrado'])
      expect((await fix(t))[0], t).toBe(t);
  });
});
