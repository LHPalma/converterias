# Regras para mexer no Converterias

Leia antes [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md): como o `index.html` é montado, o que é cada arquivo e por onde passa cada conversão.

## Sempre

- **Escreva em português**: código (comentários, mensagens ao usuário), commits, PRs e docs. Os comentários explicam o *porquê* do que não é óbvio, como uma heurística ou um limite do formato, não o que a linha faz.
- **Regere o `index.html`**: depois de mexer em `src/` ou `vendor/`, rode `python3 build.py` e faça commit do `index.html` junto. O CI roda `python3 build.py --check`.
- **Suba a versão do cache** a cada mudança no app: `const CACHE = 'converterias-vNN'` em `sw.js`. Sem isso, quem já usa o app não recebe a versão nova.
- **Rode os testes antes de cada push**: `npx playwright test --workers 4` (cerca de 2,5 min). Ao corrigir um bug, acrescente um teste que o reproduza.
- **Comportamento novo leva teste novo**:
  - a aba nova entra em `tests/e2e/<aba>.spec.js` e nos mapas `MODES`/`PANELS`/`ALL` de `tests/e2e/interface.spec.js`;
  - função interna do template que mereça teste unitário vai para `window.__converterias`.
- **Atualize o README** quando mudar o que o usuário vê.

## Como o código está organizado

- **Módulo novo e independente** (um formato, um leitor): vai em `src/nome.js` como `const Nome = (() => { …; return { … } })()`. Para incluí-lo:
  1. crie um marcador `<script>/*NOME*/</script>` no template;
  2. acrescente a troca no `build.py`;
  3. acrescente a entrada no mapa `src` de `tests/cobertura/montar.js`.
- **Código da interface** (uma aba, um editor): vai numa parte nova em `src/app/nome.js`. Para incluí-la, ponha `  /*@app/nome.js*/` no `src/template.html`, na ordem certa.
  - Essas partes **dividem o escopo**: usam direto `$`, `say`, `tick`, `files`, `results`, `busy`, `mode`, `setItem`, `showOut` etc.
  - **`const`/`let` só existem depois da linha em que são declarados.** Se algo roda no carregamento (o `setMode` inicial chama `orgReset`, `idxReset`, `mtReset`), não pode depender de constante de uma parte que vem depois.
  - Variável de estado que precisa existir cedo (como `idx`, `mt`) vai na casca, no topo do script.
- **Aba nova**:
  - um `<button data-mode="x">` em `.tabs`;
  - uma entrada em `MODES` (`pick`, `accept`, `note`…);
  - o endereço `#nome` em dois lugares (a leitura do `location.hash` e o `history.replaceState`);
  - o card de opções `#optX` e o `hidden` dele em `setMode`.
- **Abas com editor próprio** (Organizar, Índice, Metadados) escondem o botão Converter e põem status e botões de baixar dentro do card (`own` em `setMode`).

## Não faça

- Não adicione dependência de servidor nem de rede para converter: tudo roda no aparelho. A única exceção é a busca de metadados no Open Library, que manda só título, autor ou ISBN.
- Ao atualizar uma biblioteca de `vendor/`, atualize a versão no `THIRD_PARTY.md` e rode a suíte inteira. O Dependabot não vê `vendor/`, só as ferramentas de teste (npm) e as GitHub Actions. O pdf.js é módulo ES e passa pelo `esm_global` do `build.py`: numa versão nova, confira também o formato do `getOperatorList()` (o `constructPath` mudou do 3 para o 4).
- Não use biblioteca de fora de `vendor/`, nem CDN no app. O OCR "alta qualidade" baixa dados de idioma do jsDelivr só sob demanda.
- Não ponha arquivo binário de teste no repositório: gere em `tests/apoio/arquivos.js`.
- Não pule nem desligue teste para o CI passar. `test.fixme` é só para bug conhecido, com um comentário dizendo qual é.
- Não mexa nas heurísticas (colunas, títulos, quadros de mangá, parágrafos do OCR) sem rodar a suíte inteira: elas foram calibradas caso a caso e os testes travam o comportamento.

## Comandos

```bash
python3 build.py                                 # gera o index.html
python3 build.py --check                         # confere se está em dia (CI)
npx playwright test --workers 4                  # todos os testes
npx playwright test tests/e2e/manga.spec.js      # um arquivo
npx playwright test -g "capitular"               # pelo nome
npm run coverage                                 # cobertura em coverage/index.html
```

Se o `http.server` da porta 4173 ficar preso depois de uma execução interrompida, rode `pkill -f "http.server 4173"`.
