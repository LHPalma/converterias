# Converterias

> Conversor de coisas - 100% vibecodado

Um **conversor de coisas** que roda **100% no navegador**: os arquivos nunca saem do seu aparelho.
Funciona no Chrome do Android e no PC. Novos conversores vão sendo adicionados com o tempo.

## Conversores

| Conversor | Status |
|---|---|
| **EPUB → PDF** (em lote, ZIP ou PDFs soltos) | disponível |
| **PDF → EPUB** (em lote, ZIP ou EPUBs soltos) | disponível |
| **Juntar** vários PDFs em um PDF, ou vários EPUBs em um EPUB | disponível |
| **Imagens → PDF** (uma imagem por página) | disponível |
| **PDF → Imagens** (PNG ou JPEG, uma por página) | disponível |
| **Organizar PDF** (reordenar, girar, duplicar e remover páginas) | disponível |
| **Para Kindle (AZW3)** (de EPUB ou de PDF, para copiar por cabo USB) | disponível |

## EPUB → PDF

### Como usar

1. Abra a página (GitHub Pages deste repositório) e, se quiser, instale como app (menu do Chrome → *Adicionar à tela inicial*). Depois da primeira visita ela abre **offline**.
2. Toque na área pontilhada e escolha um ou mais `.epub`.
3. Ajuste tamanho da página, fonte e margens (os padrões reproduzem um PDF de referência: Carta, 15 pt, margens 25,5 / 27,2 / 31 mm).
4. **Converter** → **Baixar tudo em um ZIP**, **Baixar todos os PDFs (sem ZIP)** ou **Compartilhar PDFs…** (quando o navegador permite).

Também dá para usar o arquivo `index.html` sozinho (ele é autossuficiente): baixe e abra no navegador.

### O que ele faz

- Lê o EPUB (capítulos na ordem do livro) e **diagrama o texto por conta própria**: não usa a tela de impressão do navegador, então margens e tamanho de página saem exatamente como configurados.
- Fonte **IBM Plex Serif** embutida (regular, itálico, negrito; Noto Serif para o grego). Texto justificado, recuo de parágrafo, títulos centralizados, notas em sobrescrito, listas, citações e imagens.
- **Capa em página cheia**: a página da capa tem a proporção da imagem (sem faixas brancas e sem cortar ou distorcer).
- **Nome do arquivo** automático: `Título em Title Case - Subtítulo (Autor, Autor).pdf`
  - artigos, preposições e conjunções em minúsculo (pt e en); subtítulo separado por ` - `;
  - autores separados por vírgula (aceita `;`, `/`, `&`, `+` e "Sobrenome, Nome").
- Metadados do PDF (título e autor) preenchidos.

### Limitações

- Não há suporte a EPUB com DRM, nem a layout fixo (quadrinhos, livros infantis) ou fórmulas complexas.
- O CSS do próprio livro é ignorado de propósito, para manter o estilo uniforme.
- Sem hifenização, sem sumário clicável, sem letra capitular e sem numeração de páginas.
- Livros muito grandes consomem memória do aparelho (a conversão é feita um livro por vez).

## PDF → EPUB

### Como usar

1. Na página, toque em **PDF → EPUB** (ou abra direto com `#pdf-epub` no fim do endereço).
2. Escolha um ou mais `.pdf` e toque em **Converter** (dá para **Cancelar** no meio).
3. Baixe os EPUBs (um a um, todos de uma vez ou em ZIP) ou compartilhe.

### O que ele faz

PDF não guarda "parágrafos", só letras posicionadas. O conversor lê cada página com o **pdf.js** e reconstrói o livro:

- **Texto corrido**: junta linhas em parágrafos usando a margem, o recuo e o espaçamento da página (e não só a linha anterior), desfaz hifenização de fim de linha e reconhece citações recuadas, listas (inclusive bolinhas desenhadas) e texto centralizado.
- **Títulos** pelo tamanho da fonte, maiúsculas centralizadas, negrito isolado e "Capítulo …"; **itálico, negrito, sobrescrito/subscrito e código** são mantidos.
- **Capítulos e sumário** (em árvore) a partir dos marcadores do PDF; sem marcadores, a partir do sumário impresso ou dos títulos. Páginas de sumário impresso saem do texto.
- **Cabeçalhos, rodapés e números de página** repetidos são removidos.
- **Notas de rodapé** viram notas do EPUB (com link), sem cortar o parágrafo.
- **Várias colunas** são lidas na ordem certa; **tabelas** viram `<table>`; **código** (fonte monoespaçada) vira `<pre>`.
- **Figuras** (imagens e desenhos vetoriais) viram imagens no ponto certo; **equações em destaque** e símbolos sem Unicode viram imagens que acompanham o tamanho do texto; logotipos repetidos em toda página são descartados.
- **Capa** a partir da primeira página; **páginas escaneadas** (sem texto) entram como imagem.
- Acentos soltos de **TeX/LaTeX** ("ent˜ao") viram letras acentuadas; escritas **da direita para a esquerda** (hebraico, árabe), chinês/japonês/coreano e cirílico funcionam; o idioma é detectado. Páginas giradas (tabelas em paisagem) são endireitadas.
- EPUB 3 válido (conferido com o EPUBCheck), com `toc.ncx` para leitores antigos e o mesmo padrão de nome de arquivo do EPUB → PDF.

### Limitações

- É uma reconstrução: diagramações muito complicadas (revistas, quadros dentro de quadros) podem sair com parágrafos errados.
- **Sem OCR**: PDF escaneado vira só imagens. Páginas cujo texto no PDF é ilegível (fonte sem mapa Unicode, letras trocadas) também entram como imagem, com um aviso.
- Texto que o PDF já traz errado (erros de OCR embutido, letras gregas ausentes) continua errado.
- PDFs com senha não são suportados; livros muito grandes consomem bastante memória do aparelho.

## Juntar PDFs ou EPUBs

1. Toque em **Juntar** (ou abra com `#juntar` no fim do endereço) e escolha os arquivos; dá para escolher mais de uma vez, de pastas diferentes.
2. Ajuste a ordem com **↑** e **↓** (ou **Remover**), dê um título se quiser e toque em **Juntar**.
3. Só PDFs com PDFs, ou só EPUBs com EPUBs.

- **PDF**: as páginas são copiadas como estão (texto, imagens e links internos continuam iguais); o resultado ganha um marcador por arquivo, com os marcadores originais dentro.
- **EPUB**: cada livro vai para a sua pasta dentro do novo EPUB, então capítulos, imagens, estilos e links ficam intactos; o sumário novo tem um item por livro com o sumário original dentro, e a capa é a do primeiro livro. Fontes ofuscadas são desfeitas (o identificador do livro muda) e EPUB com DRM é recusado.
- PDFs com senha não são suportados. Título do arquivo final: o que você digitar ou a parte comum dos nomes.

## Imagens → PDF

1. Toque em **Imagens → PDF** (ou abra com `#imagens-pdf`) e escolha as imagens; dá para escolher em várias vezes. As miniaturas ajudam a ordenar com **↑** e **↓**.
2. Escolha o tamanho da página (A4, Carta ou do tamanho da imagem) e a margem; a página acompanha a orientação de cada imagem.
3. **Criar PDF**.

- JPEG e PNG entram **sem recompressão** (PNG com transparência mantém a transparência). Fotos giradas pelo celular (EXIF) saem na posição certa; JPEG em CMYK passa pelo navegador.
- WebP, GIF, BMP e AVIF dependem do que o navegador abre (GIF animado vira o primeiro quadro). HEIC só funciona se o navegador abrir.

## PDF → Imagens

1. Toque em **PDF → Imagens** (ou abra com `#pdf-imagens`) e escolha um ou mais PDFs.
2. Escolha PNG ou JPEG, a resolução (72 a 300 dpi) e, se quiser, as páginas (`1-5, 8, 10-12`).
3. Baixe tudo em um ZIP (ou uma a uma). Nomes: `Arquivo - 001.png`.

- Resoluções altas em PDFs grandes consomem bastante memória; páginas enormes têm o tamanho reduzido para caber no limite do navegador.

## Organizar PDF

1. Toque em **Organizar PDF** (ou abra com `#organizar`) e escolha um PDF: as páginas aparecem em miniaturas.
2. Toque nas páginas para selecioná-las (ou use **Todas**, **Ímpares**, **Pares**, **Inverter seleção**) e use a barra de baixo: **⇤ ◀ ▶ ⇥** (mover), **↺ ↻** (girar), **⧉** (duplicar) e **✕** (remover). No computador também dá para arrastar uma página para outro lugar; **Levar selecionadas à posição** resolve movimentos longos no celular.
3. **Desfazer** volta passo a passo; **Inverter ordem** vira o PDF de trás para a frente.
4. **Salvar PDF** (todas as páginas na nova ordem) ou **Salvar só as selecionadas** (serve para extrair um trecho).

- As páginas são copiadas como estão (texto, imagens e links ficam iguais); a rotação soma-se à que a página já tinha. Os marcadores das páginas que ficam são mantidos, e os das páginas removidas somem.
- Páginas duplicadas repetem seus recursos (fontes e imagens) no arquivo, então o PDF cresce um pouco. PDFs com senha não são suportados.

## Para Kindle (AZW3)

O Kindle não abre EPUB copiado por cabo USB: ele lê AZW3 (KF8). Esta aba gera o AZW3 direto no navegador, sem Calibre.

1. Toque em **Para Kindle (AZW3)** (ou abra com `#kindle`) e escolha `.epub` e/ou `.pdf`. PDF vira EPUB primeiro (com as opções de **PDF → EPUB**) e depois AZW3.
2. **Converter** e baixe os arquivos (ou o ZIP).
3. Ligue o Kindle ao computador e copie os `.azw3` para a pasta `documents`. (Kindles mais novos usam MTP e aparecem como dispositivo, não como pen drive.)

- **O que entra:** texto com parágrafos, títulos, listas, tabelas, notas de rodapé (pop-up), links internos, imagens (JPEG, PNG, GIF; WebP, BMP e SVG viram PNG/JPEG; JPEG progressivo ou CMYK é refeito), capa com miniatura, sumário em árvore (com os mesmos níveis do EPUB) e fontes TTF/OTF embutidas (inclusive as ofuscadas).
- **O que sai:** `@media`, `@import`, seletores com namespace e fontes WOFF são descartados (o Kindle não os usa); áudio, vídeo e MathML também.
- **Formato:** escrito a partir do formato do arquivo (PalmDB + MOBI 8, com os índices de esqueleto/fragmento/sumário e os bytes finais dos registros). A estrutura foi conferida com o Calibre e o KindleUnpack em mais de 300 arquivos (livros reais, EPUBs aleatórios e casos extremos, até um livro de 47 MB de texto): leitura de volta sem perder palavras nem imagens, fragmentos de texto bem formados e sem avisos do Calibre sobre o índice.
- **Limites:** não foi testado em um Kindle de verdade. Se um livro não abrir ou ficar sem capa na biblioteca, reinicie o Kindle e me diga o modelo. O AZW3 não serve para o Send to Kindle (e-mail): para isso envie o EPUB.

## Desenvolvimento

```bash
python3 build.py   # gera index.html a partir de src/template.html + vendor/
```

- `src/template.html`: interface e o código dos conversores.
- `src/azw3.js`: gravador de AZW3 (embutido no `index.html` pelo `build.py`).
- `vendor/`: bibliotecas e fontes embutidas (ver [THIRD_PARTY.md](THIRD_PARTY.md)).
- `sw.js` e `manifest.webmanifest`: PWA (cache offline).

Para publicar: *Settings → Pages → Deploy from a branch → `main` / root*.

## Aviso

Use apenas com livros que você tem direito de converter. O projeto não inclui nem distribui livros.

## Licença

MIT (ver [LICENSE](LICENSE)). Bibliotecas e fontes de terceiros mantêm as próprias licenças.
