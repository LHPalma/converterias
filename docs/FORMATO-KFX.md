# O formato KFX, como o Converterias grava e lê

O KFX é o formato atual dos livros da Amazon. Não há especificação pública. Este documento junta o que foi descoberto para escrever o gravador (`src/kfx.js`) e o leitor (`src/kindle.js`, usado pelo simulador), para que ninguém precise refazer a engenharia reversa.

**De onde vem o que está aqui:**
- **O nosso código**: tudo o que este documento descreve é o que `src/kfx.js` grava e `src/kindle.js` lê. O código é a referência final: se divergir daqui, vale o código, e o documento deve ser corrigido.
- **O plugin [KFX Input](https://www.mobileread.com/forums/showthread.php?t=291290) do Calibre**: o `kfxlib`, de John Howell, é a melhor referência pública do formato. Os nomes dos símbolos (`$145` = `content` etc.) vêm da tabela `YJ_symbols` dele (arquivo `yj_symbol_catalog.py`).
- **A validação:** 246 EPUBs convertidos pelo app e lidos de volta com o `kfxlib`, sem erro e sem perder nem inventar palavras (ver o README, seção KFX).
  - 220 gerados por um fuzzer: palavras aleatórias em sete alfabetos, estrutura, sumário e imagens aleatórios;
  - 24 casos extremos: livro de 50 MB com 300 capítulos, parágrafo de 30 mil palavras, japonês com emoji, HTML malformado, EPUB 2, EPUB ofuscado etc.;
  - 2 livros reais.

> **Atenção:** os nomes dos símbolos na tabela abaixo servem para cruzar com o `kfxlib`; confira lá antes de confiar num nome. O **significado** de cada um, na coluna "Para que serve aqui", é o que o nosso gravador faz e o leitor confirma.

## 1. Visão geral

Um `.kfx` "monolítico", o que vai para a pasta `documents` do Kindle, é:

```
CONT (cabeçalho do contêiner)
  ├─ tabela de índice: uma entrada por fragmento (id, tipo, deslocamento, tamanho)
  ├─ tabela de símbolos local (Ion) — os nomes que o livro inventa (c0, l0, content_1, st0, e0…)
  ├─ capacidades de formato (Ion)
  ├─ informações do contêiner (Ion) — onde está cada pedaço acima
  ├─ JSON de metadados do kfxgen (texto)
  └─ payload: os fragmentos, um atrás do outro
       cada fragmento = ENTY (cabeçalho) + um documento Ion (ou bytes crus, no caso de imagens)
```

O livro em si é um grafo de **fragmentos** que se referem uns aos outros por **símbolos**:
- a **ordem de leitura** lista as **seções**;
- cada seção aponta para uma **história** (*storyline*), com a árvore de elementos: parágrafos, títulos, listas, tabelas, imagens;
- o texto dos parágrafos fica em **pools de texto**, referidos por (pool, índice);
- os **estilos** e os **recursos** (imagens) são fragmentos à parte;
- o **mapa de posições** dá a cada elemento uma posição contínua no livro, que o Kindle usa para a localização, os marcadores e o "% lido".

## 2. Amazon Ion binário (o que o gravador usa)

Ion 1.0 binário ([especificação](https://amzn.github.io/ion-docs/docs/binary.html)). Cada documento começa com o **BVM** `E0 01 00 EA`.

Cada valor começa com um byte `TL`: os 4 bits altos dizem o **tipo** e os 4 baixos o **tamanho**.
- Tamanho 0–13: é o próprio tamanho, em bytes.
- Tamanho 14: o tamanho real vem a seguir, num **VarUInt**.
- Tamanho 15: o valor é *null*.

| T | Tipo | Como o gravador escreve |
|---|---|---|
| 0 | null | `0F` |
| 1 | bool | `10` (falso) / `11` (verdadeiro) |
| 2 / 3 | inteiro positivo / negativo | magnitude em big-endian, sem zeros à esquerda; o zero é `20` |
| 4 | float | sempre 8 bytes (float64 big-endian) |
| 7 | símbolo | o **id** do símbolo, como inteiro sem sinal |
| 8 | string | UTF-8 |
| 10 | blob | bytes crus |
| 11 | lista | os valores em sequência |
| 13 | struct | pares (id do campo em VarUInt, valor); **os nomes dos campos também são símbolos** |
| 14 | anotação | VarUInt do tamanho das anotações, os ids das anotações (VarUInt), depois o valor |

O **VarUInt** usa 7 bits por byte, em big-endian. O **último** byte tem o bit 0x80 ligado (é o inverso do VLQ comum).

**Símbolos:**
- **0 a 9**: os símbolos do sistema Ion.
- **10 a 787**: a tabela compartilhada `YJ_symbols` da Amazon, versão 10, com 778 símbolos. É ela que dá sentido a `$145`, `$259` etc.
- **788 em diante** (`LOCAL_BASE`): os nomes que o próprio livro cria. O gravador os declara na tabela de símbolos local do contêiner, na ordem dos ids (ver `SymTab`).

O leitor (`ion()` em `src/kindle.js`) faz o caminho inverso, inclusive dos tipos 12 (s-expressão), 14 (descarta a anotação) e 3 (inteiro negativo).

## 3. Contêiner `CONT`

Todos os inteiros do contêiner são **little-endian** (ao contrário do Ion). Deslocamentos em bytes:

| Deslocamento | Tamanho | Conteúdo |
|---|---|---|
| 0 | 4 | `CONT` |
| 4 | 2 | versão do contêiner: **2** |
| 6 | 4 | tamanho do cabeçalho inteiro (`hdrLen`); o payload começa aqui |
| 10 | 4 | deslocamento das informações do contêiner (`infoOff`) |
| 14 | 4 | tamanho das informações do contêiner |
| 18 | … | tabela de índice; depois tabela de símbolos; capacidades; informações; JSON |

**Informações do contêiner**: um struct Ion.

| Campo | Valor |
|---|---|
| `$409` | id do contêiner: `CR!` + 28 caracteres `[A-Z0-9]` aleatórios (o mesmo vai no `asset_id`) |
| `$410`, `$411` | 0: sem compressão, sem DRM |
| `$412` | 4096: tamanho de bloco |
| `$413`, `$414` | deslocamento (18) e tamanho da tabela de índice |
| `$415`, `$416` | deslocamento e tamanho da tabela de símbolos |
| `$594`, `$595` | deslocamento e tamanho das capacidades de formato |

**Tabela de índice**: 24 bytes por fragmento, todos little-endian.
- `u32` **id** do fragmento: o símbolo; `348` para os fragmentos únicos;
- `u32` **tipo** (`$145`, `$259`…);
- `u64` **deslocamento**, relativo ao início do payload (`hdrLen`);
- `u64` **tamanho**.

**Tabela de símbolos local**: um documento Ion anotado com `$3` (`$ion_symbol_table`).
- `$6` (*imports*) = `[{ $4: "YJ_symbols", $5: 10, $8: 787 }]`;
- `$7` = a lista de nomes locais, na ordem dos ids a partir de 788;
- `$8` = o maior id usado.

**Capacidades de formato**: um documento Ion anotado com `$593`, contendo `[{ $492: "kfxgen.textBlock", $5: 1 }]`.

**JSON do kfxgen**: texto sem aspas nas chaves, como o kfxgen da Amazon grava:
```
[{key:"kfxgen_package_version",value:""},{key:"kfxgen_application_version",value:"Converterias"},
 {key:"kfxgen_payload_sha1",value:"<sha1 do payload inteiro, em hexa>"},{key:"kfxgen_acr",value:"<id do contêiner>"}]
```

**Cabeçalho de cada fragmento (`ENTY`)**: `ENTY`, `u16` versão **1**, `u32` tamanho do cabeçalho (10 + o Ion seguinte), um Ion `{ $410: 0, $411: 0 }`. Depois vem o valor: um documento Ion, ou os **bytes crus** da imagem no tipo `$417`.

## 4. Fragmentos que o gravador escreve

Para cada capítulo `i` do *spine*, o gravador cria os símbolos `c<i>` (seção), `c<i>-ad` (dados auxiliares) e `l<i>` (história). Os pools de texto se chamam `content_1`, `content_2`…; os estilos, `st0`, `st1`…; as imagens, `e<n>` (recurso) e `resource/rsrc<n>` (bytes).

| Tipo | Id | Nome (kfxlib) | Para que serve aqui |
|---|---|---|---|
| `$259` | `l<i>` | storyline | `{ $176: l<i>, $146: [elementos] }`: a árvore do capítulo |
| `$260` | `c<i>` | section | `{ $174: c<i>, $141: [{ $155: eid raiz, $176: l<i>, $159: $269 }] }`: a seção aponta para a história |
| `$597` | `c<i>-ad` | auxiliary_data | `{ $598: c<i>-ad, $258: [{ $492: "IS_TARGET_SECTION", $307: true }] }` |
| `$145` | `content_N` | content | pool de texto `{ $4: content_N, $146: [strings] }` |
| `$157` | `stN` | style | `{ $173: stN, …propriedades }` |
| `$164` | `e<n>` | external_resource | `{ $175: e<n>, $165: "resource/rsrc<n>", $161: formato, $162: mime, $422: largura, $423: altura }` |
| `$417` | `resource/rsrc<n>` | bcRawMedia | os bytes da imagem (JPEG, PNG ou GIF), sem Ion |
| `$264` | 348 | position_map | `[{ $174: c<i>, $181: [eids da seção, em ordem] }]` |
| `$265` | 348 | position_id_map | `[{ $184: posição, $185: eid }]`, terminando com `{ $184: total, $185: 0 }` |
| `$550` | 348 | location_map | `[{ $182: [{ $155: 1º eid, $143: 0 }] }]` |
| `$389` | 348 | book_navigation | o sumário (abaixo) |
| `$395` | 348 | (navegação extra) | `{ $247: [] }` |
| `$258` | 348 | reading_orders | `{ $169: [{ $178: $351, $170: [c0, c1, …] }] }`: a ordem de leitura; `$351` é "default" |
| `$538` | 348 | document_data | direção, escrita, tamanho da letra, colunas, seleção, a mesma ordem de leitura e `$8` = quantidade de eids |
| `$490` | 348 | book_metadata | os metadados (abaixo) |
| `$585` | 348 | content_features | as *features* (abaixo) |
| `$419` | 348 | container_entity_map | `{ $252: [{ $155: id do contêiner, $181: [ids de todos os fragmentos exceto os 348] }] }` |

### Elementos da história

Cada elemento é um struct com `$155` (**eid**, um inteiro único no livro, a partir de 1000) e `$159` (**tipo**):

| `$159` | Elemento | Campos |
|---|---|---|
| `$269` | texto (parágrafo, título, célula) | `$145: { $4: pool, $403: índice }` e `$157: estilo` |
| `$271` | imagem | `$175: recurso`, `$584: texto alternativo` |
| `$276` | lista | `$100: $340` (com marcadores) ou `$342` (numerada); filhos em `$146` |
| `$277` | item de lista | texto como o `$269`, ou filhos em `$146` |
| `$278` / `$454` / `$279` | tabela / corpo / linha | filhos em `$146` (as células são `$269`) |
| `$596` | linha horizontal | — |

### Estilos

O KFX **não leva o CSS do EPUB**: o Kindle usa os estilos dele. O gravador cria só quatro, sob demanda:

| Estilo | `$16` (tamanho da letra) | Outras propriedades |
|---|---|---|
| parágrafo | 1 rem | `$47` (margem de cima) 0,83 lh |
| títulos h1–h6 | 2 / 1,5 / 1,17 / 1 / 0,83 / 0,67 rem | `$761: [$760]` (marca de título), margens de cima e de baixo 0,6 lh |
| `pre` | 0,9 rem | — |
| `blockquote` | 1 rem | margens laterais `$48`/`$50` de 2% |

Todos levam `$10` (idioma). Unidades: `$505` = rem, `$310` = lh (altura da linha), `$314` = %, `$308` = em. Valores com unidade são `{ $307: número, $306: unidade }`.

O leitor (`src/kindle.js`) usa o `$761` e o `$16` para decidir o nível do título (`h1` quando o tamanho é ≥ 2 rem, `h2` quando é ≥ 1,5…). Ele reconhece o `pre` pelo tamanho 0,9.

### Sumário (`$389`)

```
[{ $178: $351, $392: [ $391::{ $235: $212, $239: nav_0, $247: [ entradas ] } ] }]
entrada = $393::{ $241: { $244: "Título" }, $246: { $155: eid de destino, $143: 0 } }
```

O destino é o eid do elemento que tinha o `id` apontado pelo `nav`/`ncx` do EPUB, ou a raiz da seção. Sem sumário no EPUB, o gravador cria "Capítulo N" para cada seção.

### Metadados (`$490`)

`$491` traz uma lista de categorias `{ $495: nome, $258: [{ $492: chave, $307: valor }] }`:
- **`kindle_title_metadata`**:
  - `title`, `author` (autores separados por vírgula), `language`;
  - `asset_id`: o id do contêiner;
  - `cde_content_type`: `EBOK`;
  - `is_sample`: falso;
  - `override_kindle_font`: falso;
  - `cover_image`: o **nome do recurso** da capa (`e<n>`), se houver.
- **`kindle_ebook_metadata`**: `nested_span` e `selection` = `enabled`.
- **`kindle_audit_metadata`**: `file_creator` = `KPR`, `creator_version` = `3.48.0` (os valores do Kindle Previewer).
- **`kindle_capability_metadata`**: vazia.

### *Features* (`$585`)

`$590` traz uma lista de `{ $586: espaço de nomes, $492: nome, $589: { $5: { $587: maior, $588: menor } } }`:
- `com.amazon.yjconversion` / `reflow-style` (1.0);
- `com.amazon.yjconversion` / `reflow-section-size`: **só quando** alguma seção passa de 65.536 posições, com a versão `min(floor((maior − 65536) / 16384) + 2, 256)`;
- `SDK.Marker` / `CanonicalFormat` (1.0).

## 5. Posições

O mapa de posições é a parte que mais exige cuidado.
- **Cálculo:** cada elemento ganha uma posição; texto avança tantas posições quantos **pontos de código** tiver (`[...texto].length`, não bytes nem unidades UTF-16); cada elemento sem texto (raiz da seção, imagem, lista, linha) avança 1.
- **`$265` (position_id_map):** liga cada posição de início ao eid dela e **termina com uma entrada extra** `{ posição total, eid 0 }`.
- **`$264` (position_map):** lista, por seção, os eids em ordem crescente.
- **Seções longas:** acima de 65.536 posições, a *feature* `reflow-section-size` precisa ser declarada (seção 4).

## 6. Limites e armadilhas

- **Texto de no máximo ~8 KB por string**: o gravador parte parágrafos longos em vários elementos `$269` (`splitText`) e abre um pool novo quando o atual passaria de 8.000 bytes. Um parágrafo de 30 mil palavras vira vários elementos seguidos.
- **Imagens**: só JPEG, PNG e GIF (`$285`, `$284`, `$286`). WebP, BMP, SVG e JPEG exótico (progressivo, CMYK) são refeitos antes, por `Azw3._prepareImage`. Largura e altura vão em `$422`/`$423`, lidas do próprio arquivo (`imgDims`).
- **O que fica de fora:** o CSS e as fontes embutidas do EPUB, áudio, vídeo, MathML e elementos com `hidden`.
- **Símbolos locais**: o id 788 é o primeiro depois dos 9 do sistema e dos 778 da `YJ_symbols`. Errar essa conta desloca todos os nomes.
- **Inteiros do contêiner são little-endian**, os do Ion, big-endian. O VarUInt do Ion marca o **último** byte com 0x80.
- **O `$419`** lista todos os fragmentos que não são `348`, como o kfxgen da Amazon faz. Ao criar um tipo de fragmento novo, ele precisa entrar ali (o gravador monta a lista a partir de todos os fragmentos, então isso já acontece sozinho).
- **O SHA-1** no JSON é do **payload** (todos os fragmentos concatenados), não do arquivo.
- **Não serve para o Send to Kindle (e-mail)**: o serviço não aceita KFX. Vai por cabo USB para a pasta `documents`.
- **Ainda não foi testado num Kindle de verdade.** A estrutura foi conferida com o `kfxlib`, que é o que o Calibre usa para ler KFX.

## 7. Como conferir uma mudança

1. `npx playwright test tests/e2e/kindle.spec.js tests/unidade/kfx.spec.js`. Os testes leem o KFX gerado com o leitor independente de `tests/apoio/leitores.js` (`readKfx`: contêiner + Ion) e conferem texto, sumário, imagens, metadados e o limite de 8 KB.
2. Para validar fora do app, abra o `.kfx` no Calibre com o plugin KFX Input (ou rode o `kfxlib` direto), que aponta erros de estrutura. Foi assim que os 246 livros da validação foram conferidos.
3. O simulador (aba **Simular no Kindle**) usa `src/kindle.js`, um terceiro leitor, e mostra rápido se texto, listas, títulos e sumário saíram.
