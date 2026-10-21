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
| **Para Kindle** (AZW3 ou KFX, de EPUB ou de PDF, para copiar por cabo USB) | disponível |
| **Mangá** (PDF escaneado → AZW3 de layout fixo, como a Amazon faz com HQ) | disponível |
| **Escaneado → PDF** (OCR no navegador, no padrão do EPUB → PDF) | disponível |

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

## Para Kindle (AZW3 ou KFX)

O Kindle não abre EPUB copiado por cabo USB: ele lê AZW3 (KF8) e KFX. Esta aba gera os dois direto no navegador, sem Calibre.

1. Toque em **Para Kindle** (ou abra com `#kindle`), escolha o **formato** e os `.epub` e/ou `.pdf`. PDF vira EPUB primeiro (com as opções de **PDF → EPUB**) e depois AZW3/KFX.
2. **Converter** e baixe os arquivos (ou o ZIP).
3. Ligue o Kindle ao computador e copie os `.azw3`/`.kfx` para a pasta `documents`. (Kindles mais novos usam MTP e aparecem como dispositivo, não como pen drive.)

**Qual escolher:** AZW3 abre em qualquer Kindle e preserva mais do EPUB (fontes embutidas, estilos, notas em pop-up). KFX é o formato atual da Amazon, com tipografia melhor (hifenização e justificação da Amazon), e funciona nos aparelhos de 2015 para cá; aqui ele sai com o texto estruturado e as imagens, sem o CSS do EPUB. Na dúvida, AZW3.

### AZW3

- **O que entra:** texto com parágrafos, títulos, listas, tabelas, notas de rodapé (pop-up), links internos, imagens (JPEG, PNG, GIF; WebP, BMP e SVG viram PNG/JPEG; JPEG progressivo ou CMYK é refeito), capa com miniatura, sumário em árvore (com os mesmos níveis do EPUB) e fontes TTF/OTF embutidas (inclusive as ofuscadas).
- **O que sai:** `@media`, `@import`, seletores com namespace e fontes WOFF são descartados (o Kindle não os usa); áudio, vídeo e MathML também.
- **Formato:** escrito a partir do formato do arquivo (PalmDB + MOBI 8, com os índices de esqueleto/fragmento/sumário e os bytes finais dos registros). A estrutura foi conferida com o Calibre e o KindleUnpack em mais de 300 arquivos (livros reais, EPUBs aleatórios e casos extremos, até um livro de 47 MB de texto): leitura de volta sem perder palavras nem imagens, fragmentos de texto bem formados e sem avisos do Calibre sobre o índice.
- **Limites:** não foi testado em um Kindle de verdade. Se um livro não abrir ou ficar sem capa na biblioteca, reinicie o Kindle e me diga o modelo. O AZW3 não serve para o Send to Kindle (e-mail): para isso envie o EPUB.

### KFX

- **O que entra:** parágrafos, títulos (h1–h6), listas, tabelas, `<pre>`, citações, quebras de linha, imagens (JPEG, PNG, GIF; WebP, BMP e SVG viram PNG/JPEG), capa para a biblioteca, links internos e sumário em árvore.
- **O que sai:** o CSS do EPUB e as fontes embutidas (o KFX usa os estilos e as fontes do próprio Kindle); áudio, vídeo e MathML também.
- **Formato:** escrito do zero — contêiner `CONT`, fragmentos em [Amazon Ion](https://amzn.github.io/ion-docs/) binário com a tabela de símbolos `YJ_symbols`, mapa de posições, índice de seções e metadados do livro. Nada de SQLite/KDF no meio: sai o `.kfx` monolítico, como o que a Amazon entrega ao aparelho.
- **Como foi conferido:** 246 EPUBs convertidos e lidos de volta com o `kfxlib` do plugin **KFX Input** do Calibre, sem erro nem aviso de estrutura e **sem perder nem inventar uma palavra** em nenhum deles — 220 gerados por um fuzzer (palavras aleatórias em sete alfabetos, estrutura, sumário e imagens aleatórios), 24 casos extremos também gerados (livro de 50 MB com 300 capítulos, parágrafo de 30 mil palavras, 400 capítulos, japonês com emoji, HTML malformado, EPUB 2, EPUB ofuscado, imagens em PNG/JPEG/GIF/WebP/BMP/SVG) e 2 livros reais. A cobertura é ampla em estrutura e rasa em livros de verdade.
- **Limites:** não foi testado em um Kindle de verdade, e o KFX é formato fechado da Amazon: se um livro não abrir, use AZW3. O KFX também não serve para o Send to Kindle (e-mail).

## Mangá

Mangá e HQ no Kindle não são texto que reflui: são **uma imagem por página**, num AZW3 de **layout fixo** — é assim que a Amazon entrega quadrinhos. Esta aba faz isso a partir de um PDF escaneado.

1. Toque em **Mangá** (ou abra com `#manga`) e escolha um ou mais `.pdf`.
2. Escolha o **aparelho** (define o tamanho exato das páginas), o **sentido de leitura** e o que fazer com as páginas duplas.
3. **Converter** e copie os `.azw3` para a pasta `documents` do Kindle.

- **O que ele faz com cada página:** rasteriza, converte para tons de cinza (o e-ink não mostra cor), apara a moldura branca da digitalização, redimensiona para a tela do aparelho sem distorcer e centraliza o que sobra. Páginas duplas (em paisagem) podem ser partidas em duas, já na ordem de leitura — na leitura da direita para a esquerda, a metade direita vem primeiro.
- **Panel View:** cada página sai com as regiões de magnificação da Amazon marcadas — duplo toque amplia um pedaço da página e o toque seguinte caminha para o próximo, na ordem de leitura. A marcação é a que o Kindle reconhece: um `<a class="app-amzn-magnify">` cobrindo cada região, com `targetId` e `ordinal`, e a mesma imagem ampliada e deslocada dentro de um `<div>` escondido — então o arquivo **não cresce**, é a mesma imagem reaproveitada. Quatro opções:
  - **Detectar os quadrinhos da página**: acha os quadros de verdade e faz cada um preencher a tela, com o resto da página **tampado em branco** — é assim que o Guided View da Amazon isola um quadro. A página que não dá para separar com cortes retos sai sem painel nenhum, de propósito: painel de verdade numa página e quadrante arbitrário na outra é pior de usar do que não ter painel ali.
  - **4 painéis** (quadrantes, ampliação maior) ou **2 painéis** (metades de cima e de baixo).
  - **Sem painéis**: só a página inteira.
  
  Quadros que já ocupam quase a tela não viram painel, a menos que sobrem menos de dois na página — aí vale manter, porque a máscara isola o quadro mesmo com ampliação pequena, e página muda no meio do livro é pior. A numeração é sempre contígua na ordem de leitura.
- **Como a detecção funciona:** limiar automático de Otsu separa tinta de papel; corte X-Y recursivo parte a página nos separadores, que podem ser **calha branca** (faixa quase sem tinta) ou **régua preta fina** (dois quadros encostados, sem branco entre eles). Quatro detalhes que decidem o resultado:
  - a medição ignora a margem externa, senão a moldura da página desqualifica toda linha de calha e a página inteira vira um quadro só;
  - calha só vale se tiver **moldura encostada dos dois lados** — sem isso, o balão de fala branco atravessando um quadro parece calha e parte o quadro ao meio;
  - **régua preta só vale onde é exceção**: entre dois quadros encostados ela é uma linha cheia de tinta no meio de linhas bem mais claras, mas dentro de arte escura (uma lousa, um céu noturno) quase toda linha é cheia e as de lá não dividem nada — sem essa condição o quadro era partido por dentro e o zoom pegava um retângulo no meio dele;
  - cada quadro guarda dois retângulos: o **justo** (que define o zoom) e a **fatia** (que define a área de toque). As fatias ladrilham a página inteira, senão o vão entre quadros fica sem dono e o toque perto da borda amplia o vizinho.
  
  Página densa demais para o corte estrito é tentada de novo com a calha mais tolerante, em três passes — só quando a estrita falha, então a página que já passou nunca piora.
  
  Depois descarta lascas e tiras finas, e pontua a página por cobertura, contagem e **moldurice** — quanto da borda do quadro é tinta. A moldurice separa os casos com folga: quadro de verdade fica entre 0,45 e 0,97, coluna de texto corrido entre 0,03 e 0,08, e é assim que página de texto e anúncio são recusados.
- **Sentido de leitura:** `horizontal-rl` para mangá japonês, `horizontal-lr` para o resto. Define a ordem das páginas e também a dos painéis. A ordem sai da própria árvore de cortes, não de uma regra sobre as caixas prontas: mangá comum lê por fileiras (direita→esquerda dentro de cada uma), e **4-koma** lê por tiras verticais, cada uma inteira de cima a baixo antes de passar para a de ao lado. Uma regra geométrica sobre as caixas não separa os dois casos; a árvore separa.
- **Aparelhos** (resoluções dos perfis do [Kindle Comic Converter](https://github.com/ciromattia/kcc)): Paperwhite 3/4, Voyage, Oasis 1 e Kindle 11 (1072 × 1448); Paperwhite 5 e Signature (1236 × 1648); Oasis 2/3 e Libra (1264 × 1680); Paperwhite 12ª geração e Colorsoft (1272 × 1696); Scribe (1860 × 2480); Paperwhite 1/2 (758 × 1024); Kindle básico antigo (600 × 800).
- **Formato:** AZW3 (KF8) de layout fixo. Os metadados que fazem o Kindle tratar o arquivo como quadrinho vão nos registros EXTH: `122 fixed-layout`, `123 book-type=comic`, `124 orientation-lock`, `126 original-resolution`, `127 zero-gutter`, `128 zero-margin`, `132 RegionMagnification`, `525 primary-writing-mode` e `527 page-progression-direction`. Cada página é um XHTML com `<meta name="viewport">` e a imagem posicionada em pixels.
- **Como foi conferido:** o mesmo EPUB de layout fixo foi passado pelo **kindlegen da Amazon** e pelo nosso gravador, e os registros EXTH de layout fixo saem **idênticos**; o HTML e o CSS gerados também batem. A prova de que a marcação de painel é a certa: montei um EPUB com ela, passei pelo kindlegen e ele manteve `RegionMagnification = true` — sem a marcação, ele força `false`. A saída passa limpa pelo `calibre-debug --inspect-mobi`, pelo KindleUnpack e pelos verificadores de índice e de TBS, nos três modos de painel. Testado com PDF de 63 páginas na resolução do Scribe (31 MB, 23 s, 141 MB de memória), com e sem partir páginas duplas, em JPEG e em PNG, nos dois sentidos de leitura, e com página quase vazia.
- **Quanto a detecção acerta:** em quatro mangás de estilos bem diferentes — **30 de 40 páginas** num 4-koma (e as recusas são as páginas de personagem, quase vazias), **10 de 11** no Ubunchu, **48 de 55** num shonen moderno e **31 de 62** num de arte solta, cheio de página inteira e quadro sangrado. Esse último é o piso: quanto mais o autor abandona a grade, menos o corte reto tem o que fazer, e boa parte das recusas ali é ilustração de página inteira, não quadrinho. Num livro de prosa a detecção recusa 59 de 60 páginas, que é o esperado.
- **Quando o PDF não é quadrinho:** se a maioria das páginas não tem quadro emoldurado, a aba avisa que aquilo parece texto corrido e aponta a aba **Para Kindle**. A mediana da moldurice separa os casos com folga: perto de 0,2 num livro de prosa, entre 0,58 e 0,85 nos mangás testados.
- **Limites:** não foi testado num Kindle de verdade. Serve para PDF de página escaneada; PDF de texto corrido fica muito melhor na aba **Para Kindle**. A detecção acha **retângulos**: quadro diagonal ou sangrado não é representável, e o que ela erra, erra para menos (acha quadros a mais raramente; acha de menos com frequência). A ampliação reusa a imagem da página, então amplia sem ganhar detalhe. Não faz a quantização para os 16 tons do e-ink e não lê CBZ ainda.

## Desenvolvimento

```bash
python3 build.py   # gera index.html a partir de src/template.html + vendor/
```

- `src/template.html`: interface e o código dos conversores.
- `src/azw3.js`: gravador de AZW3 (embutido no `index.html` pelo `build.py`).
- `src/kfx.js`: gravador de KFX, com o codificador de Amazon Ion binário (idem).
- `src/manga.js`: PDF → páginas de mangá (cinza, aparo, partição de páginas duplas) e o EPUB de layout fixo que vira AZW3 (idem).
- `vendor/`: bibliotecas e fontes embutidas (ver [THIRD_PARTY.md](THIRD_PARTY.md)).
- `sw.js` e `manifest.webmanifest`: PWA (cache offline).

Para publicar: *Settings → Pages → Deploy from a branch → `main` / root*.

## Aviso

Use apenas com livros que você tem direito de converter. O projeto não inclui nem distribui livros.

## Licença

MIT (ver [LICENSE](LICENSE)). Bibliotecas e fontes de terceiros mantêm as próprias licenças.

## Escaneado → PDF (OCR)

PDF de livro escaneado vira PDF com texto de verdade, na mesma diagramação do EPUB → PDF. O OCR é feito **no próprio aparelho** com o [Tesseract.js](https://github.com/naptha/tesseract.js).

### Como usar

1. Toque em **Escaneado → PDF** (ou abra com `#escaneado` no fim do endereço) e escolha o PDF.
2. Preencha título e autor (opcional; o padrão é o nome do arquivo), escolha o idioma e, se quiser, as páginas de conteúdo (`6-120`). Os ajustes de página e fonte são os mesmos do EPUB → PDF.
3. **Converter** e baixe o PDF.

### O que ele faz

- Desenha cada página com o pdf.js e lê o texto com o Tesseract (português, inglês ou os dois).
- **Parágrafos** reconstruídos pela margem e pelo recuo, com a hifenização de fim de linha desfeita; cabeçalhos correntes e números de página saem.
- **Capítulos** detectados pelos cabeçalhos correntes (o título é o do cabeçalho); a página de abertura e a ilustração colada nela entram no capítulo novo.
- **Ilustrações, gráficos e páginas com pouco texto** entram como imagem, sem as bordas do scan; a primeira página vira a capa.
- No **PDF → EPUB** (e no Para Kindle) a opção *Fazer OCR se o PDF for escaneado* usa o mesmo caminho e gera o EPUB.

### Limitações

- O motor de OCR (cerca de 6 MB: núcleo WebAssembly e dados de idioma) vem da pasta `vendor/ocr/` na primeira vez e fica no cache para uso offline. Por isso o OCR não funciona abrindo o `index.html` direto do arquivo: use o endereço do site (GitHub Pages) ou um servidor local (`python3 -m http.server`).
- É lento: alguns segundos por página no computador, bem mais no celular, e consome memória. Prefira um livro por vez e use o intervalo de páginas para testar.
- Erros de reconhecimento continuam no texto; tabelas e gráficos viram imagem; livros de várias colunas ou com layout livre podem sair com parágrafos errados.
