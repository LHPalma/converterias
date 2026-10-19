# Converterias

> Conversor de coisas - 100% vibecodado

Um **conversor de coisas** que roda **100% no navegador**: os arquivos nunca saem do seu aparelho.
Funciona no Chrome do Android e no PC. Novos conversores vão sendo adicionados com o tempo.

## Conversores

| Conversor | Status |
|---|---|
| **EPUB → PDF** (em lote, ZIP ou PDFs soltos) | disponível |
| **PDF → EPUB** (em lote, ZIP ou EPUBs soltos) | disponível |

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
2. Escolha um ou mais `.pdf` e toque em **Converter**.
3. Baixe os EPUBs (um a um, todos de uma vez ou em ZIP) ou compartilhe.

### O que ele faz

- Lê o PDF com o **pdf.js** e **remonta o texto em parágrafos**: junta as linhas, desfaz a hifenização de fim de linha e reconhece recuo de parágrafo, espaçamento, citações recuadas e texto centralizado.
- Títulos detectados pelo tamanho da fonte (e linhas isoladas em negrito); itálico, negrito e números de nota em sobrescrito são mantidos.
- **Capítulos e sumário** a partir dos marcadores do PDF; sem marcadores, a partir dos títulos encontrados.
- Remove **cabeçalhos, rodapés e números de página** repetidos; notas de rodapé vão para depois do parágrafo, sem cortá-lo.
- **Imagens**: figuras são recortadas da página; páginas escaneadas ou só de ilustração entram como imagem de página inteira.
- **Capa**: a primeira página vira a capa (se ela tiver pouco texto, não é repetida no conteúdo).
- EPUB 3 válido (com `toc.ncx` para leitores antigos), metadados de título, autor e idioma, e o mesmo padrão de nome de arquivo do EPUB → PDF.

### Limitações

- PDF não guarda "parágrafos", só letras posicionadas: o resultado é uma reconstrução e pode errar em diagramações complicadas (várias colunas, tabelas, revistas, fórmulas).
- PDFs escaneados sem camada de texto (sem OCR) viram só imagens.
- PDFs com senha não são suportados.

## Desenvolvimento

```bash
python3 build.py   # gera index.html a partir de src/template.html + vendor/
```

- `src/template.html`: interface e todo o código dos conversores.
- `vendor/`: bibliotecas e fontes embutidas (ver [THIRD_PARTY.md](THIRD_PARTY.md)).
- `sw.js` e `manifest.webmanifest`: PWA (cache offline).

Para publicar: *Settings → Pages → Deploy from a branch → `main` / root*.

## Aviso

Use apenas com livros que você tem direito de converter. O projeto não inclui nem distribui livros.

## Licença

MIT (ver [LICENSE](LICENSE)). Bibliotecas e fontes de terceiros mantêm as próprias licenças.
