# Arquitetura do Converterias

O app é **um arquivo só**, o `index.html`, que roda 100% no navegador, offline, sem servidor. Este documento explica como ele é montado e por onde passa cada conversão, para quem for mexer no código.

## Como o `index.html` é montado

`python3 build.py` lê `src/template.html` e troca cada marcador pelo conteúdo do arquivo correspondente:

| Marcador no template | Vira |
|---|---|
| `/*PDFLIB*/`, `/*FONTKIT*/`, `/*JSZIP*/`, `/*PDFJS*/`, `/*PDFJSWORKER*/`, `/*TESSERACT*/` | as bibliotecas de `vendor/` |
| `/*AZW3*/`, `/*KFX*/`, `/*MANGA*/`, `/*KINDLE*/`, `/*META*/`, `/*OCR*/`, `/*SPELL*/` | os módulos de `src/*.js`, cada um num `<script>` próprio |
| `/*FONTS*/{}` | as fontes de `vendor/fonts/` em base64 (IBM Plex Serif e Noto Serif para o grego) |
| `/*@app/x.js*/` | as partes do script principal, de `src/app/x.js` (ver abaixo) |

`python3 build.py --check` falha se o `index.html` do repositório não for exatamente o que o build geraria. O CI roda essa checagem, então **todo commit que mexe em `src/` leva o `index.html` regenerado junto**.

## Dois tipos de código em `src/`

**Módulos independentes** (`src/*.js`): cada um é um `const Nome = (() => { …; return { … } })()`, sem acesso à interface.

| Módulo | Entrada → saída |
|---|---|
| `azw3.js` → `Azw3` | `convert(epub, { say, tick, fixed? })` → AZW3 (KF8): PalmDOC, esqueleto + fragmentos, índices, fontes, layout fixo |
| `kfx.js` → `Kfx` | `convert(epub, { say, tick })` → KFX: contêiner `CONT` + Amazon Ion; lê o EPUB com `Azw3._readEpub`. O formato está documentado em [`FORMATO-KFX.md`](FORMATO-KFX.md) |
| `manga.js` → `Manga` | `convert(arquivo PDF ou CBZ, opções)` → AZW3 de layout fixo: páginas em cinza com 16 tons, aparo, páginas duplas, Panel View |
| `kindle.js` → `Kindle` | `open(bytes)` → livro para o simulador: AZW3, KFX, EPUB ou PDF, em páginas ou capítulos |
| `meta.js` → `Meta` | `open`/`save` dos metadados de EPUB/PDF; `search`/`details`/`cover` no Open Library |
| `ocr.js` → `Ocr` | linhas do Tesseract → livro (parágrafos, capítulos, figuras) → EPUB |
| `spell.js` → `Spell` | dicionário Hunspell e correção do texto do OCR |

**O script principal**: a casca fica em `src/template.html` e o resto em `src/app/*.js`.
- **Um escopo só.** O build cola cada parte de `src/app/` **dentro do mesmo** `(() => { … })()` do template. Todas as partes enxergam as mesmas variáveis; não há import nem export.
- **A ordem importa.** Os marcadores ficam na ordem em que o código estava. `const`/`let` só existem a partir da linha em que são declarados (TDZ). Funções declaradas com `function` são içadas, mas o que elas usam ao rodar precisa já ter sido declarado.
- **Erro comum:** um handler que roda no carregamento (por exemplo, o `setMode` inicial) chamar algo de uma parte que vem depois.

O que a casca (`src/template.html`) define e todas as partes usam:
- `$`: atalho de `getElementById`;
- `say(msg, erro?)`: a linha de status;
- `tick()`: cede a vez ao navegador e para se o usuário cancelou;
- `files`, `results`, `busy`, `mode`, `MODES`;
- `setItem(i, texto, classe, download)`: o status de cada arquivo na lista;
- `showOut(M)`: os botões de baixar, compartilhar e simular;
- `runBatch()`: converte a lista, um arquivo por vez;
- `setMode()`, as abas, o service worker e `window.__converterias` (as funções internas que os testes chamam).

| Parte (`src/app/`) | O que faz |
|---|---|
| `comum.js` | nome do arquivo (Title Case, autores), caminhos dentro do ZIP, tamanhos de página |
| `epub2pdf.js` | EPUB → PDF: o XHTML vira blocos (`buildBlocks`), que são diagramados com pdf-lib (`epubToPdf`); marcadores e números de página |
| `pdf-linhas.js` | PDF → EPUB, parte 1: texto posicionado do pdf.js → linhas (colunas, itálico/negrito, sobrescrito, desenhos) |
| `escaneado.js` | PDF escaneado: Tesseract, dicionário, `scanToPdf` |
| `pdf2epub.js` | PDF → EPUB, parte 2 (`pdfDocToEpub`): cabeçalhos e rodapés, sumário impresso, títulos, parágrafos, notas, figuras, tabelas → EPUB. Com `opt.index`, só devolve o sumário (para a aba Índice) |
| `juntar.js` | Juntar PDFs/EPUBs; `pdfOutline` e `writeOutline` (ler e gravar marcadores de PDF) |
| `imagens.js` | Imagens → PDF, PDF → Imagens, `initPdfjs` |
| `organizar.js` | aba Organizar PDF |
| `para-kindle.js` | abas Para Kindle e Mangá (chamam `Azw3`/`Kfx`/`Manga`) |
| `simulador.js` | a tela do simulador (o `<dialog id="sim">`) |
| `indice.js` | aba Índice do PDF |
| `metadados.js` | aba Metadados |

## Caminho de cada conversão

```
EPUB → PDF        epubToPdf: OPF + spine → buildBlocks → diagramação (pdf-lib, fontes embutidas) → marcadores (nav/ncx) → PDF
PDF → EPUB        pdfToEpub → pdfDocToEpub: pdf.js → pageLines (linhas) → blocos → capítulos (marcadores, sumário impresso ou títulos) → EPUB (JSZip)
PDF escaneado     pdfToEpub com OCR (ou aba Escaneado): página → Tesseract → Ocr.Book → EPUB → (Escaneado → PDF) epubToPdf
Para Kindle       EPUB → Azw3/Kfx.convert;  PDF → pdfToEpub → EPUB → Azw3/Kfx.convert
Mangá             PDF (pdf.js) ou CBZ (JSZip) → páginas em cinza no tamanho da tela → EPUB de layout fixo → Azw3.convert({ fixed })
Juntar            PDFs: pdf-lib copyPages + um marcador por arquivo;  EPUBs: um EPUB com os capítulos de todos e sumário por livro
Índice do PDF     pdfOutline (o que existe) ou pdfDocToEpub(opt.index) → editor → writeOutline
Metadados         Meta.open → editor (+ Meta.search no Open Library) → Meta.save (OPF reescrito / Info do PDF)
Simulador         Kindle.open(bytes) → páginas (layout fixo, PDF) ou capítulos (texto, num iframe paginado em colunas)
```

## PWA, cache e versão nova

- `sw.js` guarda `index.html`, o manifesto e os ícones no cache `converterias-vNN` e serve dali (*stale-while-revalidate*).
- **A cada mudança no app, suba o `NN`.** É isso que faz o navegador instalar o service worker novo e baixar os arquivos sem pegar o cache HTTP (`cache: 'reload'`).
- Quando o service worker novo assume uma página que já tinha um, aparece o aviso "Nova versão do app disponível" (`#upd`).
- O motor de OCR (`vendor/ocr/`) e o dicionário são baixados sob demanda e guardados à parte.

## Testes

Os testes usam Playwright no Chromium, com o app servido por `python3 -m http.server` (como no GitHub Pages). Os detalhes estão no README (seção Desenvolvimento).
- **Entradas:** geradas na hora por `tests/apoio/arquivos.js`; nada de binário no repositório.
- **Saídas:** conferidas por leitores escritos à parte, em `tests/apoio/leitores.js` (PDF, EPUB, AZW3, KFX), e não pelo próprio app.
- **Rede:** os testes não saem para a internet. O Open Library é simulado com `page.route`.
- **Cobertura:** `npm run coverage` monta `cobertura.html` com os scripts como arquivos separados. O script principal leva um source map, e o relatório mostra cada parte de `src/app/` no próprio arquivo.
