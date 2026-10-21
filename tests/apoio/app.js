// Manejo da interface nos testes: abrir uma aba, escolher arquivos, converter e baixar o resultado.
const { test: base, expect } = require('../fixtures');
const { APP } = require('../fixtures');

/* `test` com a página do app aberta, os downloads capturados e falha se houver erro de JavaScript */
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // o app baixa criando um <a download> e clicando nele: guarda nome e endereço de cada um
    await page.addInitScript(() => {
      window.__saved = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && this.href.startsWith('blob:')) { window.__saved.push({ name: this.download, href: this.href }); return; }
        return click.call(this);
      };
    });
    await page.goto(APP);
    await use(page);
    expect(errors, 'erros de JavaScript na página').toEqual([]);
  },
});

async function open(page, mode) {
  if (!(await page.locator(`.tabs button[data-mode="${mode}"]`).getAttribute('class') || '').includes('on')) await page.click(`.tabs button[data-mode="${mode}"]`);
  await expect(page.locator(`.tabs button[data-mode="${mode}"]`)).toHaveClass(/on/);
}

/* escolhe os arquivos, toca em Converter e devolve as saídas: [{ name, buf }] */
async function run(page, mode, files, { setup, timeout, expectError } = {}) {
  await open(page, mode);
  if (setup) await setup(page);
  await page.setInputFiles('#file', files);
  await page.click('#go');
  if (expectError) {
    await expect(page.locator('#status')).toHaveText(expectError, { timeout });
    return [];
  }
  await expect(page.locator('#status')).toHaveText(/^Pronto/, { timeout });
  await expect(page.locator('#status')).not.toHaveClass(/err/);
  return download(page, '#sepBtn');
}

/* toca no botão de baixar e devolve os arquivos que o app entregou */
async function download(page, button) {
  await page.evaluate(() => { window.__saved = []; });
  await page.click(button);
  await expect(page.locator(button)).toBeEnabled();   // "Baixar todos" baixa um por vez e só depois se libera
  const saved = await page.evaluate(() => Promise.all(window.__saved.map(async s => {
    const b = new Uint8Array(await (await fetch(s.href)).arrayBuffer());
    let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return { name: s.name, b64: btoa(bin) };
  })));
  return saved.map(s => ({ name: s.name, buf: Buffer.from(s.b64, 'base64') }));
}

/* texto de um PDF, página por página, lido pelo pdf.js do próprio app */
async function pdfText(page, buf) {
  return page.evaluate(async b64 => {
    window.__converterias.initPdfjs();
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data }).promise, out = [];
    for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map(x => x.str).join(' ').replace(/\s+/g, ' '));
    doc.destroy();
    return out;
  }, buf.toString('base64'));
}

/* executa fn(...args) na página; args podem ter Buffer (vira Uint8Array do lado de lá) */
async function inPage(page, fn, ...args) {
  const enc = a => Buffer.isBuffer(a) ? { __b64: a.toString('base64') } : Array.isArray(a) ? a.map(enc) : a && typeof a === 'object' && a.constructor === Object ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, enc(v)])) : a;
  const res = await page.evaluate(async ({ src, args }) => {
    const dec = a => a && a.__b64 !== undefined ? Uint8Array.from(atob(a.__b64), c => c.charCodeAt(0)) : Array.isArray(a) ? a.map(dec) : a && typeof a === 'object' ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, dec(v)])) : a;
    const out = await (0, eval)('(' + src + ')')(...dec(args));
    const encB = v => v instanceof Uint8Array ? { __b64: (() => { let s = ''; for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode(...v.subarray(i, i + 0x8000)); return btoa(s); })() } : Array.isArray(v) ? v.map(encB) : v && typeof v === 'object' && (v.constructor === Object || !v.constructor) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encB(x)])) : v;
    return encB(out);
  }, { src: fn.toString(), args: enc(args) });
  const decN = v => v && v.__b64 !== undefined ? Buffer.from(v.__b64, 'base64') : Array.isArray(v) ? v.map(decN) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decN(x)])) : v;
  return decN(res);
}

module.exports = { test, expect, open, run, download, pdfText, inPage };
