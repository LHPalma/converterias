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
| **Mangá** (PDF escaneado ou CBZ → AZW3 de layout fixo, como a Amazon faz com HQ) | disponível |
| **Escaneado → PDF** (OCR no navegador, no padrão do EPUB → PDF) | disponível |
| **Índice do PDF** (marcadores gerados do sumário impresso ou dos títulos, com editor manual) | disponível |
| **Metadados** (ver e editar os do EPUB/PDF; buscar no Open Library, com capa) | disponível |
| **Simular no Kindle** (abre AZW3, KFX, EPUB ou PDF numa tela de Kindle, sem converter) | disponível |
| **PDF escaneado → PDF** pela linha de comando (`tools/scan2pdf.py`, OCR com ocrmypdf no computador) | disponível |

## EPUB → PDF

### Como usar

1. Abra a página (GitHub Pages deste repositório) e, se quiser, instale como app (menu do Chrome → *Adicionar à tela inicial*). Depois da primeira visita ela abre **offline**. Quando sai uma versão nova, aparece **Nova versão do app disponível** no pé da página: toque em *Atualizar*.
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
- **Marcadores (sumário clicável):** saem do sumário do próprio livro (`nav` do EPUB 3 ou `toc.ncx` do EPUB 2), com os mesmos níveis, cada um apontando para a página onde o capítulo ou a seção começa; livro sem sumário ganha marcadores pelos títulos (`h1`/`h2`). O PDF já abre com o painel de marcadores.
- **Números de página** no rodapé, centralizados (a capa não conta); dá para desligar.

### Limitações

- Não há suporte a EPUB com DRM, nem a layout fixo (quadrinhos, livros infantis) ou fórmulas complexas.
- O CSS do próprio livro é ignorado de propósito, para manter o estilo uniforme.
- Sem hifenização e sem letra capitular. Os links dentro do texto (notas, referências) não são clicáveis.
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

## Metadados

Mostra e edita os metadados de um EPUB ou PDF e busca os que faltam no **Open Library**, no estilo do "Baixar metadados" do Calibre (a pesquisa de como o Calibre faz está em [`docs/metadados-calibre.md`](docs/metadados-calibre.md)).

1. Toque em **Metadados** (ou abra com `#metadados`) e escolha um `.epub` ou `.pdf`. Aparecem os dados que o arquivo já tem.
   - No EPUB: título, autores, editora, data, ISBN, idioma, série e número, assuntos, descrição e capa.
   - No PDF: título, autores, descrição e assuntos, que é o que o PDF guarda.
2. **Edite à mão**, no estilo do "Editar metadados" do Calibre:
   - todos os campos são editáveis, e o que mudou fica destacado (com a contagem de alterações ainda não salvas);
   - atalhos: **Title Case** no título, **Trocar título e autor** (quando vieram invertidos) e **Do nome do arquivo** (`Título - Subtítulo (Autor, Autor).epub`);
   - idioma com sugestões e **avaliação** de 1 a 5 estrelas (gravada como a do Calibre);
   - **capa**: trocar por uma imagem do aparelho, **gerar uma capa** simples com o título e o autor, remover, ou voltar à original;
   - a data é conferida (AAAA, AAAA-MM ou AAAA-MM-DD), e o ISBN também;
   - **Desfazer** volta passo a passo; **Restaurar tudo** volta aos metadados do arquivo.
3. **Buscar no Open Library** (seção recolhida, abaixo do editor): a busca vai pelo **ISBN**, se houver um válido; senão, pelo **título e o 1º autor**, limpos como no Calibre (sem subtítulo, parênteses e palavras como "the"). Os resultados vêm ordenados como no Calibre: primeiro o ISBN igual, depois o que tem capa, o título exato e o mesmo idioma.
4. **Usar este** preenche os campos com o que o Open Library tem, incluindo a descrição da obra e a capa grande. O que ele não tem fica como estava, e um idioma `pt-BR` não vira `pt`. Ajuste o que quiser; **Desfazer** volta ao que estava antes.
5. **Salvar com estes metadados** grava um arquivo novo, com o nome no padrão do app.
   - **No EPUB:** o `content.opf` recebe o ISBN como `urn:isbn:` (o identificador único do livro não muda) e a série como `calibre:series` e `belongs-to-collection` do EPUB 3. A capa nova entra no lugar da imagem da antiga, então a página de capa do livro também muda; num livro sem capa, ela é criada. Remover a capa tira só a marcação de capa; a imagem continua no livro, porque alguma página pode usá-la.
   - **No PDF:** grava título, autor, assunto e palavras-chave.

A busca manda para o Open Library só o título, o autor ou o ISBN; o arquivo não sai do aparelho. Precisa de internet. Os dados e as capas do Open Library são de licença aberta.

## Índice do PDF

O índice do PDF são os **marcadores**: o sumário clicável que o leitor de PDF mostra ao lado das páginas. Esta aba monta esse índice e grava no próprio PDF, como o painel de Marcadores do Acrobat.

1. Toque em **Índice do PDF** (ou abra com `#indice`) e escolha um `.pdf`.
2. Se o PDF já tem marcadores, eles aparecem para editar. Se não tem, o app **gera um sozinho**:
   - **do sumário impresso** (páginas de "Título ..... 12"), casando cada entrada com o título no texto, o que acerta a página mesmo quando a numeração impressa não bate com a do PDF; entradas que não existem no livro ficam de fora;
   - ou, sem sumário impresso, **dos títulos do texto** (letra maior que a do corpo), sem contar cabeçalhos e rodapés que se repetem.

   Dá para escolher a fonte e gerar de novo com **Gerar índice**.
3. **Edite à mão**:
   - renomeie e mude a página direto na lista;
   - **↑ ↓** muda a ordem (o marcador vai com os que estão dentro dele);
   - **← →** muda o nível;
   - **✕** remove; **Limpar tudo** apaga a lista inteira;
   - **+ Marcador** cria um na página mostrada.

   Ao tocar num marcador, a página dele aparece embaixo. Navegue com ◀ ▶ e use **Usar esta página** para apontar o marcador para outra página. **Desfazer** volta passo a passo.
4. **Salvar PDF com este índice**: sai o mesmo PDF, com o índice novo no lugar do antigo e o resto intacto. O PDF abre com o painel de marcadores.

## Para Kindle (AZW3 ou KFX)

O Kindle não abre EPUB copiado por cabo USB: ele lê AZW3 (KF8) e KFX. Esta aba gera os dois direto no navegador, sem Calibre.

1. Toque em **Para Kindle** (ou abra com `#kindle`), escolha o **formato** e os `.epub` e/ou `.pdf`. PDF vira EPUB primeiro (com as opções de **PDF → EPUB**) e depois AZW3/KFX.
2. **Converter** e baixe os arquivos (ou o ZIP).
3. Ligue o Kindle ao computador e copie os `.azw3`/`.kfx` para a pasta `documents`. (Kindles mais novos usam MTP e aparecem como dispositivo, não como pen drive.)

**Qual escolher:** AZW3 abre em qualquer Kindle e preserva mais do EPUB (fontes embutidas, estilos, notas em pop-up). KFX é o formato atual da Amazon, com tipografia melhor (hifenização e justificação da Amazon), e funciona nos aparelhos de 2015 para cá; aqui ele sai com o texto estruturado e as imagens, sem o CSS do EPUB. Na dúvida, AZW3.

### Simulador de Kindle

Para ver um arquivo que você já tem, use a aba **Simular no Kindle** (ou `#simular` no fim do endereço): escolha um AZW3, KFX, EPUB ou PDF e ele abre direto no simulador. Livros comprados na Amazon (com DRM) não abrem.

Depois de converter, cada AZW3, KFX, EPUB ou PDF gerado também ganha **Simular no Kindle** (na lista ou, quando sai um arquivo só, como no Juntar, ao lado do botão de baixar): o arquivo é aberto no próprio navegador e mostrado numa tela do aparelho, sem sair do seu aparelho.

- **Mangá (layout fixo):** as páginas e o Panel View saem do arquivo de verdade, lidos dele e não recalculados: as áreas de toque (numeradas na ordem de leitura com **Áreas de toque**), o quadro ampliado e a máscara em volta dele. Um toque amplia, **▶** caminha para o próximo quadro e, depois do último, para a próxima página; **Esc** ou um toque fora volta à página inteira. O tamanho da tela é o do aparelho escolhido na conversão.
- **Tela e-ink:** a tela do simulador mostra só os 16 tons de cinza do Kindle (o Colorsoft, colorido, não é simulado).
- **Livro de texto (AZW3, KFX e EPUB):** o capítulo é paginado numa tela com a resolução do aparelho escolhido, com o CSS e as imagens do livro (o KFX não leva o CSS do EPUB), sumário (que leva à tela da âncora, mesmo com vários capítulos no mesmo arquivo), letra maior/menor e toque nas bordas para virar a página. O EPUB é o que vai pelo **Enviar para Kindle**.
- **Opções de leitura do Kindle:** fonte (*Fonte do editor*, que respeita o CSS do livro e é a inicial quando ele traz fontes embutidas; *Serifada*, no lugar da Bookerly, usando a serifada do próprio app para não depender das fontes do sistema; *Sem serifa*, no lugar da Amazon Ember), margens e espaçamento entre linhas (estreito/pequeno, normal/médio, largo/grande). O rodapé mostra o capítulo e a porcentagem lida, como no aparelho. É uma **aproximação**: o Kindle diagrama com o motor e as fontes dele.
- **PDF:** como o Kindle mostra um PDF copiado por cabo: a página inteira, reduzida para caber na tela do aparelho escolhido, sem ajustar a letra; o sumário vem dos marcadores do PDF (o Juntar grava um por arquivo). Serve para ver se a letra fica legível antes de copiar; para letra ajustável, use **Para Kindle**.
- **Como funciona:** `src/kindle.js` remonta o AZW3 como o Kindle faz (texto PalmDOC, esqueleto + fragmentos, fluxos de CSS e SVG, recursos e fontes), decodifica o KFX do Amazon Ion, lê o EPUB (OPF, sumário do `nav` ou do `toc.ncx`, CSS, imagens e fontes pelos caminhos relativos) e desenha as páginas do PDF com o pdf.js.

### AZW3

- **O que entra:** texto com parágrafos, títulos, listas, tabelas, notas de rodapé (pop-up), links internos, imagens (JPEG, PNG, GIF; WebP, BMP e SVG viram PNG/JPEG; JPEG progressivo ou CMYK é refeito), capa com miniatura, sumário em árvore (com os mesmos níveis do EPUB) e fontes TTF/OTF embutidas (inclusive as ofuscadas).
- **O que sai:** `@media`, `@import`, seletores com namespace e fontes WOFF são descartados (o Kindle não os usa); áudio, vídeo e MathML também.
- **Formato:** escrito a partir do formato do arquivo (PalmDB + MOBI 8, com os índices de esqueleto/fragmento/sumário e os bytes finais dos registros). A estrutura foi conferida com o Calibre e o KindleUnpack em mais de 300 arquivos (livros reais, EPUBs aleatórios e casos extremos, até um livro de 47 MB de texto): leitura de volta sem perder palavras nem imagens, fragmentos de texto bem formados e sem avisos do Calibre sobre o índice.
- **Limites:** não foi testado em um Kindle de verdade. Se um livro não abrir ou ficar sem capa na biblioteca, reinicie o Kindle e me diga o modelo. O AZW3 não serve para o Send to Kindle (e-mail): para isso envie o EPUB.

### KFX

- **O que entra:** parágrafos, títulos (h1–h6), listas, tabelas, `<pre>`, citações, quebras de linha, imagens (JPEG, PNG, GIF; WebP, BMP e SVG viram PNG/JPEG), capa para a biblioteca, links internos e sumário em árvore.
- **O que sai:** o CSS do EPUB e as fontes embutidas (o KFX usa os estilos e as fontes do próprio Kindle); áudio, vídeo e MathML também.
- **Formato:** escrito do zero (descrito em [`docs/FORMATO-KFX.md`](docs/FORMATO-KFX.md)) — contêiner `CONT`, fragmentos em [Amazon Ion](https://amzn.github.io/ion-docs/) binário com a tabela de símbolos `YJ_symbols`, mapa de posições, índice de seções e metadados do livro. Nada de SQLite/KDF no meio: sai o `.kfx` monolítico, como o que a Amazon entrega ao aparelho.
- **Como foi conferido:** 246 EPUBs convertidos e lidos de volta com o `kfxlib` do plugin **KFX Input** do Calibre, sem erro nem aviso de estrutura e **sem perder nem inventar uma palavra** em nenhum deles — 220 gerados por um fuzzer (palavras aleatórias em sete alfabetos, estrutura, sumário e imagens aleatórios), 24 casos extremos também gerados (livro de 50 MB com 300 capítulos, parágrafo de 30 mil palavras, 400 capítulos, japonês com emoji, HTML malformado, EPUB 2, EPUB ofuscado, imagens em PNG/JPEG/GIF/WebP/BMP/SVG) e 2 livros reais. A cobertura é ampla em estrutura e rasa em livros de verdade.
- **Limites:** não foi testado em um Kindle de verdade, e o KFX é formato fechado da Amazon: se um livro não abrir, use AZW3. O KFX também não serve para o Send to Kindle (e-mail).

## Mangá

Mangá e HQ no Kindle não são texto que reflui: são **uma imagem por página**, num AZW3 de **layout fixo** — é assim que a Amazon entrega quadrinhos. Esta aba faz isso a partir de um PDF escaneado ou de um **CBZ** (o ZIP de imagens em que muito mangá circula).

1. Toque em **Mangá** (ou abra com `#manga`) e escolha um ou mais `.pdf` ou `.cbz`.
2. Escolha o **aparelho** (define o tamanho exato das páginas), o **sentido de leitura** e o que fazer com as páginas duplas.
3. **Converter** e copie os `.azw3` para a pasta `documents` do Kindle.

- **CBZ:** as imagens entram na ordem dos nomes (com números em ordem natural: `2.jpg` antes de `10.jpg`, inclusive dentro de pastas), ignorando o lixo do macOS (`__MACOSX`, arquivos ocultos); imagem quebrada é pulada. Título e autor vêm do `ComicInfo.xml` (Series, Number, Title, Writer), se houver; senão, do nome do arquivo. O **CBR** (compactado em RAR) ainda não: extraia e compacte as imagens em ZIP, ou converta para PDF.
- **O que ele faz com cada página:** rasteriza (o PDF) ou reduz (a imagem do CBZ), converte para tons de cinza (o e-ink não mostra cor), apara a moldura branca da digitalização, redimensiona para a tela do aparelho sem distorcer, centraliza o que sobra e reduz aos **16 tons de cinza** que a tela e-ink mostra (0, 17, 34 … 255, como o Kindle Comic Converter; sem pontilhado, que com JPEG vira ruído e borra as retículas — dá para desligar). Páginas duplas (em paisagem) podem ser partidas em duas, já na ordem de leitura — na leitura da direita para a esquerda, a metade direita vem primeiro.
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
- **Limites:** não foi testado num Kindle de verdade. Serve para PDF de página escaneada; PDF de texto corrido fica muito melhor na aba **Para Kindle**. A detecção acha **retângulos**: quadro diagonal ou sangrado não é representável, e o que ela erra, erra para menos (acha quadros a mais raramente; acha de menos com frequência). A ampliação reusa a imagem da página, então amplia sem ganhar detalhe. Não lê CBZ ainda.

## Desenvolvimento

```bash
python3 build.py   # gera index.html a partir de src/template.html + vendor/
```

Como as peças se encaixam está em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md); as regras para quem for mexer no código (pessoa ou IA), em [`CLAUDE.md`](CLAUDE.md).

- `src/template.html`: a página (HTML, CSS) e a casca do script: abas, lista de arquivos, lote e botões de baixar.
- `src/app/*.js`: o resto do script principal, uma parte por assunto (`epub2pdf`, `pdf-linhas`, `pdf2epub`, `escaneado`, `juntar`, `imagens`, `organizar`, `simulador`, `indice`, `metadados`, `comum`), coladas pelo `build.py` dentro do mesmo escopo.
- `src/azw3.js`, `src/kfx.js`: gravadores de AZW3 e de KFX (com o codificador de Amazon Ion binário).
- `src/manga.js`: PDF/CBZ → páginas de mangá e o EPUB de layout fixo que vira AZW3.
- `src/kindle.js`: leitor de AZW3, KFX, EPUB e PDF para o simulador de Kindle.
- `src/meta.js`: metadados de EPUB/PDF e a busca no Open Library.
- `src/ocr.js`, `src/spell.js`: livro a partir do OCR e o corretor com dicionário Hunspell.
- `vendor/`: bibliotecas e fontes embutidas (ver [THIRD_PARTY.md](THIRD_PARTY.md)).
- `sw.js` e `manifest.webmanifest`: PWA (cache offline e aviso de nova versão).
- `tools/scan2pdf.py`: PDF escaneado → PDF pela linha de comando.

Para publicar: *Settings → Pages → Deploy from a branch → `main` / root*.

### Testes

Testes automáticos com [Playwright](https://playwright.dev): o app continua sem Node, isso é só para desenvolver.

```bash
npm install
npx playwright install chromium   # uma vez
npm test                          # confere o index.html e roda todos os testes (~3 min)
npx playwright test -g "Kindle"   # só os testes cujo nome tem "Kindle"
npx playwright test tests/unidade # só os unitários (~20 s)
npm run coverage                  # os mesmos testes, medindo a cobertura: relatório em coverage/index.html
```

Tudo roda no Chromium de verdade, com o app servido por HTTP (como no GitHub Pages). Os arquivos de entrada são gerados na hora pelos próprios testes (nada de binário no repositório), e as saídas são abertas e conferidas por leitores escritos à parte, a partir dos formatos: o AZW3 é remontado como o Kindle faz (texto PalmDOC, esqueleto + fragmentos, sumário, recursos), o KFX é decodificado do Amazon Ion. Qualquer erro de JavaScript na página faz o teste falhar.

- `tests/e2e/`: ponta a ponta, um arquivo por aba (`epub-pdf`, `pdf-epub`, `pdf-epub-detalhes`, `juntar`, `imagens`, `organizar`, `kindle`, `manga`, `ocr`, `indice`, `metadados`), `simulador` (que também salva capturas de cada aparelho em `simulador/`; no CI, artefato **simulador**) e `interface` (abas e endereços `#`, cancelamento, compartilhar, PWA offline, `build.py --check`).
- `tests/unidade/`: unitários das funções internas, no navegador: `app` (as de `src/template.html`, expostas em `window.__converterias`), `azw3`, `kfx`, `manga`, `ocr` e `spell`.
- `tests/apoio/`: `arquivos.js` (geradores: EPUB 2/3, PDFs de livro, escaneados, com senha, quadrinhos, imagens), `leitores.js` (PDF, EPUB, AZW3, KFX) e `app.js` (abrir aba, converter, baixar).
- `tests/cobertura/`: a medição de cobertura, que carrega os scripts de `src/` como arquivos (`cobertura.html`, gerado e ignorado pelo git); o script principal leva um source map, então o relatório mostra cada parte de `src/app/` no próprio arquivo.
- Testes marcados com `test.fixme` descrevem falhas conhecidas que ainda não foram corrigidas: quando alguém corrigir, é só trocar por `test`.

O GitHub Actions (`.github/workflows/testes.yml`) roda tudo em cada push na `main` e em cada pull request, e num segundo job mede a cobertura (resumo na própria execução, relatório completo nos artefatos). Ao corrigir um bug, vale acrescentar um teste que o reproduz.

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
- **"Capítulo N"**: se o livro tem Sumário impresso com "Capítulo 1, 2…", o rótulo vira um título acima do nome do capítulo (pelo título ou, se o OCR errou o título, pela ordem). Prefácio, Posfácio e afins ficam sem número.
- **Notas e Referências** (também *Referências* e *Bibliografia*) no topo de uma página viram um capítulo próprio. Cada nota começa no número; endereços partidos em várias linhas são remontados (sem espaços, com o hífen certo) e `hrtps://` volta a ser `https://`.
- **Qualidade do OCR**: *Rápida* usa o modelo que já vem no app. *Alta qualidade* usa os modelos `best` do Tesseract (8 a 15 MB por idioma, bem mais lentos e mais precisos), baixados do jsDelivr só na primeira vez e guardados no navegador; só os dados do idioma são baixados, o seu arquivo nunca sai do aparelho. Sem internet na primeira vez, o app volta para o modelo rápido.
- **Ilustrações, gráficos e páginas com pouco texto** entram como imagem, sem as bordas do scan; a primeira página vira a capa.
- **Confiança por palavra**: linhas-lixo do OCR (borda do scan, manchas) são descartadas e o resultado avisa quantas palavras foram lidas com pouca certeza.
- **Correção por dicionário** (opção *Corrigir palavras com o dicionário*, só português): usa o dicionário Hunspell pt-BR (VERO, ~5 MB, baixado na primeira vez e guardado no cache). Só mexe em palavras que o dicionário não conhece **e** que o OCR leu com pouca certeza, e só quando há uma única correção clara (acento perdido, confusões típicas como rn/m e l/i); junta palavras partidas pela hifenização e separa palavras coladas ("quevirão" → "que virão"). Nomes próprios, siglas, números e endereços ficam como estão.
- No **PDF → EPUB** (e no Para Kindle) a opção *Fazer OCR se o PDF for escaneado* usa o mesmo caminho e gera o EPUB.

### Limitações

- O motor de OCR (cerca de 6 MB: núcleo WebAssembly e dados de idioma) vem da pasta `vendor/ocr/` na primeira vez e fica no cache para uso offline. Por isso o OCR não funciona abrindo o `index.html` direto do arquivo: use o endereço do site (GitHub Pages) ou um servidor local (`python3 -m http.server`).
- É lento: alguns segundos por página no computador, bem mais no celular, e consome memória. Prefira um livro por vez e use o intervalo de páginas para testar.
- Erros de reconhecimento continuam no texto; tabelas e gráficos viram imagem; livros de várias colunas ou com layout livre podem sair com parágrafos errados.
## PDF escaneado → PDF (ferramenta local)

Além do OCR no navegador (aba Escaneado → PDF), para um livro **escaneado** a ferramenta `tools/scan2pdf.py` faz o OCR no seu computador, reconstrói o livro e converte com o **mesmo motor do EPUB → PDF** (o próprio `index.html`, aberto num Chromium sem interface), então o PDF sai com a diagramação de qualquer EPUB convertido pelo app.

```bash
python3 tools/scan2pdf.py livro-escaneado.pdf --title "Título - Subtítulo" --author "Autor" -o saida/
```

Requisitos: `ocrmypdf`, `tesseract` com o idioma do livro (`por` para português), `poppler-utils`, `Pillow` e `playwright` (com Chromium). Se o Playwright não achar o navegador, aponte-o com `CHROMIUM_PATH=/caminho/do/chromium`.

O que ele faz:

- **OCR** com `ocrmypdf` (`--lang`, padrão `por+eng`); com `--no-ocr` usa o texto que o PDF já tem.
- **Parágrafos** reconstruídos pela margem e pelo recuo, com hifenização de fim de linha desfeita; cabeçalhos correntes, números de página e ruídos do OCR são descartados.
- **Capítulos** detectados pelos cabeçalhos correntes (o título vira o do cabeçalho). Para controlar à mão, use `--chapters capitulos.json` com `[{"title": "...", "start": 6, "end": 13, "opener": 6}]` (páginas contando de 1; `opener` é a página de abertura, cujo título decorado o OCR costuma ler errado).
- **Ilustrações, gráficos e páginas com pouco texto** entram como imagem, aparadas das bordas do scan; a **capa** é a página 1 (`--cover-page`, `0` para não usar).
- Nome do arquivo e metadados seguem o padrão do app (`--title` separa o subtítulo com ` - `). Opções úteis: `--first`/`--last` (páginas de conteúdo), `--keep-epub` (guarda também o EPUB montado).

Limitações: erros de reconhecimento do OCR continuam no texto (revise o resultado); tabelas e gráficos viram imagem; livros de várias colunas ou com layout muito livre podem sair com parágrafos errados.
