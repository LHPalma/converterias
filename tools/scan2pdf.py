#!/usr/bin/env python3
"""PDF escaneado -> PDF no padrão do Converterias.

Faz OCR (ocrmypdf/Tesseract), reconstrói parágrafos, capítulos e ilustrações, monta um EPUB e
roda o conversor EPUB -> PDF do próprio index.html num Chromium sem interface (Playwright).
O PDF sai com a mesma diagramação de qualquer EPUB convertido pelo app.

Uso:  python3 tools/scan2pdf.py livro.pdf --title "Título - Subtítulo" --author "Autor" [opções]
Requisitos: ocrmypdf, tesseract (+ idioma), poppler-utils, Pillow, playwright (+ chromium).
"""
import argparse, asyncio, difflib, glob, html, io, json, os, re, shutil, statistics as st
import subprocess, sys, tempfile, unicodedata, zipfile
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
X = '<?xml version="1.0" encoding="utf-8"?>\n'
esc = lambda s: html.escape(s, quote=False)
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', unicodedata.normalize('NFD', s.lower()).encode('ascii', 'ignore').decode())


# ---------- 1. OCR e leitura do layout ----------
def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)

def has_text_layer(pdf, pages=5):
    out = subprocess.run(['pdftotext', '-l', str(pages), str(pdf), '-'], capture_output=True, text=True).stdout
    return len(out.split()) > 40

def read_layout(pdf):
    """Devolve, por página, as linhas com coordenadas (pdftotext -bbox-layout)."""
    s = subprocess.run(['pdftotext', '-bbox-layout', str(pdf), '-'], capture_output=True, text=True, check=True).stdout
    pages = []
    for pm in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', s, re.S):
        lines = []
        for lm in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', pm[3], re.S):
            t = html.unescape(' '.join(re.findall(r'<word[^>]*>(.*?)</word>', lm[5], re.S)))
            lines.append(dict(x0=float(lm[1]), y0=float(lm[2]), x1=float(lm[3]), y1=float(lm[4]), t=t))
        pages.append(dict(W=float(pm[1]), H=float(pm[2]), lines=lines))
    return pages

def rows_of(p):
    """Junta fragmentos da mesma linha visual e ordena de cima para baixo."""
    ls = [l for l in p['lines'] if (l['y1'] - l['y0']) <= 30 and re.search(r'\w', l['t'])]
    ls.sort(key=lambda l: (l['y0'] + l['y1']) / 2)
    rows = []
    for l in ls:
        c = (l['y0'] + l['y1']) / 2
        if rows and abs(c - rows[-1]['c']) < 7:
            rows[-1]['f'].append(l); rows[-1]['c'] = (rows[-1]['c'] + c) / 2
        else:
            rows.append(dict(c=c, f=[l]))
    out = []
    for r in rows:
        f = sorted(r['f'], key=lambda l: l['x0'])
        out.append(dict(x0=f[0]['x0'], x1=max(l['x1'] for l in f), y=r['c'], t=' '.join(l['t'] for l in f).strip()))
    return out


# ---------- 2. Páginas -> estrutura ----------
def sentence(t):
    """Cabeçalho em CAIXA ALTA -> só a primeira letra maiúscula."""
    return t[:1] + t[1:].lower() if t.isupper() else t


class Book:
    def __init__(self, pages, imgdir):
        self.pages, self.imgdir = pages, imgdir
        self.rows = [rows_of(p) for p in pages]
        self.head = [self._header(i) for i in range(len(pages))]
        cnt = {}
        for h in self.head:
            if h: cnt[h] = cnt.get(h, 0) + 1
        self.head = [h if h and cnt[h] >= 2 else None for h in self.head]   # cabeçalho corrente aparece várias vezes

    def img(self, p):
        return glob.glob(f'{self.imgdir}/i-{p:03d}-*.jpg')[0]

    def _header(self, i):
        r = self.rows[i]
        if r and r[0]['y'] < 0.09 * self.pages[i]['H'] and r[0]['t'].isupper() and 3 < len(r[0]['t']) <= 70:
            return r[0]['t']

    def ink(self, p):
        """Fração de tinta da página (ilustração = muita tinta)."""
        im = Image.open(self.img(p)).convert('L'); im.thumbnail((200, 280))
        h = im.histogram(); return sum(h[:120]) / max(1, sum(h))

    def body_rows(self, i, opener=False):
        H = self.pages[i]['H']; out = []
        for x in self.rows[i]:
            t = x['t']
            if x['y'] > 0.915 * H and re.fullmatch(r'[\d\s|]+', t): continue                  # nº de página
            if x['y'] < 0.09 * H and t.isupper() and len(t) > 3 and not opener: continue      # cabeçalho corrente
            if len(re.findall(r'\w', t)) < 2: continue
            out.append(x)
        return out

    def kind(self, i, rows, opener=False):
        if opener and len(rows) >= 8: return 'text'
        if len(rows) <= 11: return 'img'
        L = st.median([x['x0'] for x in rows])
        return 'text' if sum(1 for x in rows if abs(x['x0'] - L) < 30) / len(rows) >= .6 else 'img'

    def auto_chapters(self, first, last):
        """Capítulos pelos cabeçalhos correntes. Páginas sem cabeçalho entre dois capítulos diferentes:
        a de abertura (a última com texto cheio) e a ilustração logo antes dela vão para o capítulo seguinte."""
        n = len(self.pages); idx = [i for i in range(first - 1, last) if self.head[i]]
        if not idx: return [dict(title='Texto', start=first, end=last, opener=None)]
        chs = []; start_of = {}
        for k, i in enumerate(idx):
            if k == 0 or self.head[i] != self.head[idx[k - 1]]:
                chs.append(dict(title=sentence(self.head[i]), hdr=i, start=i + 1, end=last, opener=None))
        for k, c in enumerate(chs):
            if k == 0: prev_hdr = None
            else: prev_hdr = chs[k - 1]['hdr']
            # varre para trás a partir da página do cabeçalho
            j = c['hdr'] - 1; run = []
            while j >= (first - 1 if prev_hdr is None else prev_hdr + 1) and not self.head[j]:
                run.append(j); j -= 1
            chain = []                                  # abertura = início da sequência de páginas "cheias" colada no cabeçalho
            for j in run:
                if len(self.body_rows(j, True)) >= 14: chain.append(j)
                else: break
            if not chain:
                if prev_hdr is not None: c['start'] = c['hdr'] + 1
                continue
            op = chain[-1]; c['opener'] = op + 1; c['start'] = op + 1
            j = op - 1                                    # ilustração colada na abertura
            while j in run and .18 < self.ink(j + 1) < .5:   # >.5 = página escura/vazia, não ilustração
                c['start'] = j + 1; j -= 1
        for k, c in enumerate(chs):
            c['end'] = chs[k + 1]['start'] - 1 if k + 1 < len(chs) else last
        return chs

    def crop(self, p, maxw=1400, edge=0.06, q=82, drop_pageno=True):
        im = Image.open(self.img(p)).convert('RGB'); W, H = im.size
        ex, ey = int(W * edge), int(H * 0.03)
        g = im.convert('L').crop((ex, ey, W - ex, H - ey)).point(lambda v: 255 if v > 170 else 0)
        bb = ImageOps.invert(g).getbbox()
        im = im.crop((ex + bb[0], ey + bb[1], ex + bb[2], ey + bb[3])) if bb else im.crop((ex, ey, W - ex, H - ey))
        if drop_pageno: im = im.crop((0, 0, im.width, int(im.height * 0.955)))
        if im.width > maxw: im = im.resize((maxw, int(im.height * maxw / im.width)), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, 'JPEG', quality=q); return b.getvalue()


def paragraphs(book, sect, opener_pages):
    """sect: lista de (índice, linhas). Devolve [('p', texto) | ('img', índice)]."""
    blocks, cur, last_short = [], None, False
    def flush():
        nonlocal cur
        if cur: blocks.append(('p', cur)); cur = None
    for i, r in sect:
        if book.kind(i, r, i + 1 in opener_pages) == 'img':
            flush(); blocks.append(('img', i)); continue
        L = st.median([x['x0'] for x in r]); R = sorted(x['x1'] for x in r)[int(len(r) * .75)]
        prev = None
        for x in r:
            t = x['t']
            if cur is None: newp = True
            elif prev is None: newp = x['x0'] > L + 10 or last_short          # começo de página
            else: newp = x['x0'] > L + 10 or prev['x1'] < R - 35
            if newp: flush(); cur = t
            elif cur.endswith('-') and t[:1].islower(): cur = cur[:-1] + t   # hifenização de fim de linha
            else: cur = cur + ' ' + t
            prev = x
        last_short = prev['x1'] < R - 35
    flush(); return blocks


# ---------- 3. EPUB ----------
def build_epub(book, chapters, title, author, lang, cover_page, out):
    opener_pages = {c['opener'] for c in chapters if c.get('opener')}
    files, imgs = [], {}
    def addimg(i):
        name = f'img/p{i + 1:03d}.jpg'
        if name not in imgs: imgs[name] = book.crop(i + 1)
        return name
    for n, c in enumerate(chapters, 1):
        sect = []
        for i in range(c['start'] - 1, c['end']):
            r = book.body_rows(i, i + 1 in opener_pages)
            if i + 1 == c.get('opener'):          # tira o título decorado que o OCR leu na abertura
                T = norm(c['title'])
                while r and (difflib.SequenceMatcher(None, norm(r[0]['t']), T).ratio() > .6
                             or (len(norm(r[0]['t'])) > 3 and norm(r[0]['t']) in T)
                             or re.fullmatch(r'(capitulo )?\d{1,2}', norm(r[0]['t']))):
                    r.pop(0)
            sect.append((i, r))
        body = f'<h1>{esc(c["title"])}</h1>'
        for k, v in paragraphs(book, sect, opener_pages):
            if k == 'p': body += f'<p>{esc(re.sub(chr(92) + "s*[|¦]" + chr(92) + "s*", " ", v.replace("--", "-")).strip())}</p>'
            else: body += f'<p class="fig"><img src="{addimg(v)}" alt=""/></p>'
        files.append((f'c{n:02d}.xhtml', c['title'], body))
    page = lambda t, b: X + f'<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="{lang}" lang="{lang}"><head><title>{esc(t)}</title></head><body>{b}</body></html>'
    with zipfile.ZipFile(out, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip', zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', X + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        mani = '<item id="cover-image" href="img/capa.jpg" media-type="image/jpeg" properties="cover-image"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        spine = ''
        for n, (f, t, b) in enumerate(files):
            mani += f'<item id="f{n}" href="{f}" media-type="application/xhtml+xml"/>'; spine += f'<itemref idref="f{n}"/>'
            z.writestr('OEBPS/' + f, page(t, b))
        for n, (k, v) in enumerate(imgs.items()):
            mani += f'<item id="i{n}" href="{k}" media-type="image/jpeg"/>'; z.writestr('OEBPS/' + k, v)
        if cover_page: z.writestr('OEBPS/img/capa.jpg', book.crop(cover_page, 1600, 0.03, 88, False))
        else: mani = mani.replace('<item id="cover-image" href="img/capa.jpg" media-type="image/jpeg" properties="cover-image"/>', '')
        z.writestr('OEBPS/nav.xhtml', X + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head><body><nav epub:type="toc"><ol>'
                   + ''.join(f'<li><a href="{f}">{esc(t)}</a></li>' for f, t, b in files) + '</ol></nav></body></html>')
        z.writestr('OEBPS/content.opf', X + f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:scan2pdf:{abs(hash(title)):x}</dc:identifier><dc:title>{esc(title)}</dc:title><dc:creator>{esc(author)}</dc:creator><dc:language>{lang}</dc:language><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata><manifest>{mani}</manifest><spine>{spine}</spine></package>')


# ---------- 4. EPUB -> PDF com o index.html do app ----------
async def convert(epub, outdir):
    from playwright.async_api import async_playwright
    exe = os.environ.get('CHROMIUM_PATH')
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=exe) if exe else await p.chromium.launch()
        pg = await (await b.new_context(accept_downloads=True)).new_page()
        pg.on('pageerror', lambda e: print('erro na página:', e, file=sys.stderr))
        await pg.goto((ROOT / 'index.html').as_uri())
        await pg.set_input_files('#file', str(epub))
        await pg.wait_for_function("!document.querySelector('#go').disabled")
        await pg.click('#go')
        await pg.wait_for_selector('#sepBtn', state='visible', timeout=900000)
        async with pg.expect_download(timeout=120000) as d: await pg.click('#sepBtn')
        dl = await d.value; dest = Path(outdir) / dl.suggested_filename
        await dl.save_as(str(dest)); await b.close(); return dest


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('pdf'); a.add_argument('--title', required=True, help='use " - " para separar o subtítulo')
    a.add_argument('--author', required=True); a.add_argument('-o', '--outdir', default='.')
    a.add_argument('--lang', default='por+eng', help='idiomas do Tesseract (padrão: por+eng)')
    a.add_argument('--epub-lang', default='pt-BR'); a.add_argument('--no-ocr', action='store_true', help='o PDF já tem texto')
    a.add_argument('--cover-page', type=int, default=1, help='página da capa (0 = sem capa)')
    a.add_argument('--first', type=int, default=1); a.add_argument('--last', type=int, help='última página de conteúdo')
    a.add_argument('--chapters', help='JSON [{"title":..,"start":..,"end":..,"opener":..}] no lugar da detecção automática')
    a.add_argument('--keep-epub', action='store_true'); a.add_argument('--jobs', type=int, default=0)
    a = a.parse_args()
    pdf = Path(a.pdf).resolve(); out = Path(a.outdir).resolve(); out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='scan2pdf-') as tmp:
        tmp = Path(tmp); src = pdf
        if not a.no_ocr and not has_text_layer(pdf):
            print('OCR…', file=sys.stderr); src = tmp / 'ocr.pdf'
            cmd = ['ocrmypdf', '-l', a.lang, '--skip-text', '--rotate-pages', '--optimize', '1', str(pdf), str(src)]
            if a.jobs: cmd[1:1] = ['--jobs', str(a.jobs)]
            run(cmd)
        print('Lendo o layout…', file=sys.stderr)
        (tmp / 'imgs').mkdir(); run(['pdfimages', '-j', '-p', str(src), str(tmp / 'imgs' / 'i')])
        pages = read_layout(src); book = Book(pages, str(tmp / 'imgs')); last = a.last or len(pages)
        chs = json.load(open(a.chapters)) if a.chapters else book.auto_chapters(a.first, last)
        for c in chs: print(f"  {c['title'][:50]:50} p.{c['start']}–{c['end']}", file=sys.stderr)
        epub = tmp / 'livro.epub'
        build_epub(book, chs, a.title, a.author, a.epub_lang, a.cover_page, epub)
        if a.keep_epub: shutil.copy(epub, out / (pdf.stem + '.epub'))
        print('Convertendo com o index.html…', file=sys.stderr)
        print(asyncio.run(convert(epub, out)))

if __name__ == '__main__':
    main()
