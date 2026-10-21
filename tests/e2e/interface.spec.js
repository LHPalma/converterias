// Interface: abas e endereços (#), painéis de opções, estados dos botões, cancelamento, PWA (offline) e build.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { test, expect, open, run } = require('../apoio/app');
const base = require('@playwright/test');
const A = require('../apoio/arquivos');

const MODES = { e2p: '', p2e: '#pdf-epub', merge: '#juntar', i2p: '#imagens-pdf', p2i: '#pdf-imagens', org: '#organizar', kindle: '#kindle', manga: '#manga', ocr: '#escaneado' };
// painel de opções visível em cada aba
const PANELS = { e2p: ['optE2P'], p2e: ['optP2E'], merge: ['optMerge'], i2p: ['optI2P'], p2i: ['optP2I'], org: ['optOrg'], kindle: ['optKindle', 'optP2E'], manga: ['optManga'], ocr: ['optE2P', 'optOCR'] };
const ALL = ['optE2P', 'optP2E', 'optMerge', 'optI2P', 'optP2I', 'optOrg', 'optKindle', 'optManga', 'optOCR'];

for (const [mode, hash] of Object.entries(MODES)) {
  test(`aba ${mode}: abre pelo endereço${hash ? ` (${hash})` : ''}, mostra só as opções dela e o texto de ajuda`, async ({ page }) => {
    if (hash) { await page.goto('about:blank'); await page.goto((process.env.COVERAGE ? 'cobertura.html' : 'index.html') + hash); }
    await expect(page.locator(`.tabs button[data-mode="${mode}"]`)).toHaveClass(/on/);
    await expect(page.locator('.tabs button.on')).toHaveCount(1);
    for (const id of ALL) await expect(page.locator('#' + id), id).toBeVisible({ visible: PANELS[mode].includes(id) });
    await expect(page.locator('#note')).not.toBeEmpty();
    await expect(page.locator('#fname')).toHaveText(/^Toque para escolher/);
    await expect(page.locator('#go')).toBeDisabled();
  });
}

test('trocar de aba atualiza o endereço, o "accept" do seletor e limpa a escolha', async ({ page }) => {
  await page.setInputFiles('#file', [A.file('a.epub', await A.makeEpub())]);
  await expect(page.locator('#fname')).toHaveText('a.epub');
  await expect(page.locator('#fmeta')).toHaveText(/^0\.\d MB no total$/);
  await expect(page.locator('#go')).toBeEnabled();
  for (const [mode, hash] of [...Object.entries(MODES).slice(1), Object.entries(MODES)[0]]) {
    await page.click(`.tabs button[data-mode="${mode}"]`);
    expect(new URL(page.url()).hash).toBe(hash);
    await expect(page.locator('#go')).toBeDisabled();
    await expect(page.locator('#fname')).toHaveText(/^Toque para escolher/);
  }
  await page.click('.tabs button[data-mode="e2p"]');
  expect(await page.locator('#file').getAttribute('accept')).toBe('.epub,application/epub+zip');
  await page.click('.tabs button[data-mode="i2p"]');
  expect(await page.locator('#file').getAttribute('accept')).toMatch(/^image\/\*/);
  await page.click('.tabs button[data-mode="org"]');
  await expect(page.locator('#go')).toBeHidden();
  await expect(page.locator('#list')).toBeHidden();
  await page.click('.tabs button[data-mode="p2e"]');
  await expect(page.locator('#go')).toBeVisible();
  await expect(page.locator('#optOCR')).toBeHidden();
  await page.check('#pOcr');
  await expect(page.locator('#optOCR')).toBeVisible();
});

test('durante a conversão as abas não trocam; cancelar interrompe e libera', async ({ page }) => {
  const book = await A.makeEpub({ chapters: [A.LOREM.join(' ').repeat(400)] });
  await open(page, 'e2p');
  await page.setInputFiles('#file', [A.file('a.epub', book), A.file('b.epub', book)]);
  // no instante em que o 1º livro começa: tenta trocar de aba (não deixa) e cancela
  await page.evaluate(() => {
    const st = document.getElementById('status');
    new MutationObserver((_, o) => {
      if (!/^Convertendo 1 de 2/.test(st.textContent)) return;
      o.disconnect();
      window.__state = { go: document.getElementById('go').disabled, file: document.getElementById('file').disabled };
      document.querySelector('.tabs button[data-mode="p2e"]').click();
      window.__state.tab = document.querySelector('.tabs button.on').dataset.mode;
      document.getElementById('cancel').click();
    }).observe(st, { childList: true, characterData: true, subtree: true });
  });
  await page.click('#go');
  await expect(page.locator('#status')).toHaveText('Conversão cancelada.');
  expect(await page.evaluate(() => window.__state)).toEqual({ go: true, file: true, tab: 'e2p' });
  await expect(page.locator('#list .s.err')).toHaveText(['Cancelado', 'Cancelado']);
  await expect(page.locator('#outBtns')).toBeHidden();
  await expect(page.locator('#cancel')).toBeHidden();
  await expect(page.locator('#go')).toBeEnabled();
  await page.click('.tabs button[data-mode="p2e"]');
  await expect(page.locator('.tabs button[data-mode="p2e"]')).toHaveClass(/on/);
});

// cancelar depois de dois ou mais prontos: o app monta o ZIP com os prontos e volta a responder
for (const [mode, files, done] of [
  ['e2p', async () => { const b = await A.makeEpub({ chapters: [A.LOREM.join(' ').repeat(300)] }); return ['a', 'b', 'c'].map(n => A.file(n + '.epub', b)); }, /Cancelado\. 2 já convertido\(s\): toque em baixar\./],
  ['p2i', async () => [A.file('d.pdf', await A.makeNumberedPdf(40))], /^Cancelado\. \d+ imagem\(ns\) já pronta\(s\): toque em baixar\.$/],
]) {
  test(`cancelar com dois ou mais já prontos não trava o app (${mode})`, async ({ page }) => {
    await open(page, mode);
    if (mode === 'p2i') await page.selectOption('#xDpi', '300');
    await page.setInputFiles('#file', await files());
    // segura o "Cancelar" até haver dois prontos
    await page.evaluate(() => {
      const st = document.getElementById('status'), go = () => document.getElementById('cancel').click();
      new MutationObserver((_, o) => { if (/(Convertendo 3 de|página 3 \()/.test(st.textContent)) { o.disconnect(); go(); } }).observe(st, { childList: true, characterData: true, subtree: true });
    });
    await page.click('#go');
    await expect(page.locator('#status')).toHaveText(done);
    await expect(page.locator('#go')).toBeEnabled();
    await expect(page.locator('#zipBtn')).toBeVisible();
  });
}

test('compartilhar só aparece quando o navegador sabe compartilhar arquivos', async ({ page }) => {
  await page.evaluate(() => { navigator.canShare = () => true; navigator.share = async d => { window.__shared = d.files.map(f => f.name); }; });
  await run(page, 'e2p', [A.file('a.epub', await A.makeEpub({ title: 'Para Compartilhar' }))]);
  await expect(page.locator('#shareBtn')).toBeVisible();
  await expect(page.locator('#shareBtn')).toHaveText('Compartilhar PDFs…');
  await page.click('#shareBtn');
  await expect.poll(() => page.evaluate(() => window.__shared)).toEqual(['Para Compartilhar (Patrick Rothfuss).pdf']);
  await page.evaluate(() => { navigator.share = async () => { throw new Error('negado'); }; });
  await page.click('#shareBtn');
  await expect(page.locator('#status')).toHaveText('Não foi possível compartilhar: negado');
});

test('manifesto do PWA e ícones', async ({ request }) => {
  const m = await (await request.get('manifest.webmanifest')).json();
  expect(m.name).toBeTruthy();
  expect(m.start_url).toBeTruthy();
  expect(m.display).toBe('standalone');
  for (const icon of m.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
});

test('index.html está em dia com src/ (python3 build.py --check)', () => {
  const root = path.join(__dirname, '..', '..');
  expect(() => execFileSync('python3', ['build.py', '--check'], { cwd: root, stdio: 'pipe' })).not.toThrow();
  // e todo marcador do template foi substituído
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  expect(html).not.toMatch(/<script>\/\*[A-Z]+\*\/<\/script>|\/\*FONTS\*\/\{\}/);
});

base.test.describe('offline', () => {
  base.test.use({ serviceWorkers: 'allow' });
  base.test('depois da primeira visita, o app abre e converte sem rede', async ({ page, context }) => {
    test.skip(!!process.env.COVERAGE, 'o service worker guarda o index.html, não a página de cobertura');
    await page.goto('index.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();   // agora controlada pelo service worker
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['converterias-v18'.replace(/\d+$/, m => m)].map(() => expect.stringMatching(/^converterias-v\d+$/)));
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    await page.setInputFiles('#file', [A.file('a.epub', await A.makeEpub())]);
    await page.click('#go');
    await expect(page.locator('#status')).toHaveText(/^Pronto: 1 convertido/);
    await context.setOffline(false);
  });
});
