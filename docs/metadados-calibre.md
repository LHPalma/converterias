# Baixar metadados: como o Calibre faz e o que dá para fazer no navegador

Pesquisa feita no código do Calibre (`src/calibre/ebooks/metadata/sources/`: `identify.py`, `base.py`, `covers.py`, `google.py`, `amazon.py`, `openlibrary.py`, `edelweiss.py`, `google_images.py`, `prefs.py`; `customize/builtins.py` e `customize/ui.py`).

## Fontes do Calibre

| Fonte | Padrão | Faz | Campos |
|---|---|---|---|
| Google (`google.py`) | ligada | identificar | título, autores, assuntos, data, descrição, editora, ISBN, id Google, idioma; capa pela URL `books.google.com/books?id=X&printsec=frontcover&img=1` |
| Amazon.com (`amazon.py`) | ligada | identificar + capa | título, autores, nota, descrição, editora, data, idioma, **série**, assuntos (raspagem de HTML, com navegador automatizado contra bloqueio) |
| Open Library (`openlibrary.py`) | ligada | **só capa** | `https://covers.openlibrary.org/b/isbn/<ISBN>-L.jpg?default=false` |
| Edelweiss, Google Images, Overdrive, Douban, OZON | desligadas | | raspagem |

O plugin Google do Calibre usa o feed antigo (`books.google.com/books/feeds/volumes`), não a API v1; sem resultado, cai numa busca web em `site:books.google.com`.

## Como o `identify()` funciona

- **Consulta:** com ISBN válido, só `isbn:`; sem ele, `intitle:` + `inauthor:` com tokens limpos.
  - **Título** (`get_title_tokens`): tira `(2010)`, `(Paperback)`, `(… edition …)`, vírgula de milhar e pontuação; descarta `a`, `and`, `the`, `&`; pode cortar o subtítulo depois de `:` ou `/`.
  - **Autor** (`get_author_tokens`): só o primeiro; "Sobrenome, Nome" vira "Nome Sobrenome"; descarta tokens de 2 letras ou menos, `von`, `van` e "Unknown".
- **Paralelo:** uma thread por fonte, 30 s por requisição; depois do **primeiro resultado**, espera no máximo 30 s (`wait_after_first_identify_result`) e corta as que ficarem para trás.
- **Ordem dentro de cada fonte** (`InternalMetadataCompareKeyGen`):
  1. identificador igual ao da consulta;
  2. tem capa;
  3. todos os campos preenchidos;
  4. idioma igual;
  5. título exato (depois de `cleanup_title`);
  6. descrição mais longa (diferença acima de cerca de 10%);
  7. ordem da própria fonte.
- **Mescla entre fontes** (`merge_identify_results`):
  - agrupa por ISBN; resultados sem ISBN só entram se a fonte não trouxe nenhum com ISBN;
  - depois junta os grupos com o mesmo título e autores (em minúsculas) e ordena pela relevância média.
  - **Regras por campo:**

| Campo | Regra |
|---|---|
| título | o mais **curto** |
| autores | a lista mais **longa** |
| editora | a mais curta |
| assuntos | a lista mais curta, no máximo 20 |
| série | a mais longa, com o número dela |
| nota | média |
| idioma | o mais curto |
| descrição | a mais **longa** |
| data | a mais **antiga** |
| identificadores | união |
| resto | o primeiro não vazio |

## Capas (`covers.py`)

- Uma thread por fonte de capa.
- Descarta imagens com menos de 50×50 e as inválidas.
- Vence a de **maior resolução**, mas o Google tem prioridade 2: só entra se não houver outra, porque as capas dele costumam ser ruins.
- O Google tenta `&zoom=0` e depois `&zoom=1`, e descarta a imagem "image not available" comparando o MD5.
- O Open Library usa `-L.jpg?default=false`; o 404 quer dizer que não há capa.

## O que funciona direto do navegador (sem servidor)

**Google Books API v1.** O CORS foi confirmado: a resposta traz `access-control-allow-origin`.
- Busca: `GET https://www.googleapis.com/books/v1/volumes?q=isbn:<ISBN>&maxResults=10&printType=books&projection=full[&key=<CHAVE>]`. Também aceita `q=intitle:x+inauthor:y`.
- Detalhe: `GET https://www.googleapis.com/books/v1/volumes/<id>`. Só ele traz `imageLinks.large`/`extraLarge`.
- Campos de `items[].volumeInfo`: `title`, `subtitle`, `authors[]`, `publisher`, `publishedDate`, `description` (HTML), `industryIdentifiers[]`, `categories[]`, `language`, `pageCount`, `averageRating`, `imageLinks`.
- **Sem chave**, a cota anônima compartilhada costuma dar **HTTP 429**. Para usar de verdade, é preciso uma chave de API restrita por referrer (`https://<usuário>.github.io/*`).
- Não está confirmado se as imagens de `books.google.com/books/content` mandam CORS. Sem CORS elas aparecem num `<img>`, mas não dá para embutir no arquivo: teste antes.

**Open Library.** A API JSON costuma mandar `Access-Control-Allow-Origin: *`; confirmar no navegador.
- Busca: `GET https://openlibrary.org/search.json?title=…&author=…&limit=5&fields=key,title,author_name,first_publish_year,publisher,isbn,language,subject,cover_i`, ou `?isbn=…`.
- Descrição: `/isbn/<ISBN>.json` (a edição) e depois `/works/<id>.json`.
- Capas:
  - `https://covers.openlibrary.org/b/id/<cover_i>-L.jpg`, sem limite;
  - `https://covers.openlibrary.org/b/isbn/<ISBN>-L.jpg?default=false`, limitado a 100 por IP a cada 5 min.
- Os dados são abertos (CC0). O Open Library pede moderação, por volta de 1 requisição por segundo.

**Não dá sem um proxy:** Amazon, Edelweiss e Google Images, porque são raspagem de HTML sem CORS.

## Plano para o app

1. **Entrada:** título, autores e ISBN do EPUB (OPF) ou do PDF (Info/XMP). Valide o ISBN (dígito verificador) e converta o ISBN-10 para 13.
2. **Consultas:**
   - Com ISBN: Google `isbn:` e Open Library `?isbn=` / `/isbn/<x>.json`.
   - Sem ISBN: tokens de título e de autor como no Calibre (só o primeiro autor), em `intitle:/inauthor:` e em `title=/author=`.
3. **Em paralelo:** `Promise.allSettled` com `AbortController`, de 10 a 15 s por requisição. Depois do primeiro resultado, espere no máximo uns 5 s.
4. **Plano B:** se a busca por ISBN não trouxer nada, repita por título e autor.
5. **Normalizar** cada resultado em `{ title, authors[], publisher, pubdate, isbns[], lang, description, tags[], series?, rating?, covers[], source, rank }`.
6. **Ordenar dentro de cada fonte** com a ordem do Calibre (acima) e ficar com os 3 primeiros.
7. **Agrupar** por ISBN em comum ou, sem ISBN, por título e primeiro autor normalizados (minúsculas, sem acento). Ordenar os grupos pela média dos ranks.
8. **Mesclar** cada grupo com as regras do Calibre (tabela acima).
9. **Capas:**
   - candidatas, nesta ordem: Open Library por `cover_i`, Open Library por ISBN (`?default=false`) e Google (`large`/`extraLarge` do detalhe, ou `thumbnail` com `zoom=0`);
   - baixar com `fetch`; descartar as menores que 50×50, a imagem "sem capa" do Google e as de proporção absurda;
   - a maior vence, e o Google só entra se não houver outra.
10. **Revisão:** uma tabela de candidatos como a do Calibre, com o resultado mesclado no topo e escolha campo a campo. Guardar as respostas no IndexedDB por ISBN.

**Termos de uso:** mostrar a atribuição ao Google Books quando usar os dados dele e não montar base própria com eles (só cache temporário). Os dados do Open Library são livres.
