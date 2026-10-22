# Componentes de terceiros

Embutidos no `index.html` gerado (arquivos em `vendor/`; textos de licença em `vendor/licenses/`). O motor de OCR (Tesseract.js, o núcleo WebAssembly e os dados de idioma) fica em `vendor/ocr/` e só é baixado quando o OCR é usado.

| Componente | Versão | Licença |
|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | 1.17.1 | MIT |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT |
| [pdf.js](https://github.com/mozilla/pdf.js) (pdfjs-dist, build `legacy`, que roda também em navegadores mais antigos) | 4.10.38 | Apache 2.0 |
| Fontes-padrão do pdf.js (`vendor/pdfjs-fonts/`): Foxit (Times, Courier, Symbol, Dingbats), do PDFium | 4.10.38 | BSD 3 cláusulas |
| Fontes-padrão do pdf.js: [Liberation Sans](https://github.com/liberationfonts/liberation-fonts) (Helvetica) | 4.10.38 | SIL Open Font License 1.1 |
| [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | MIT ou GPLv3 (à escolha; usado sob MIT) |
| [IBM Plex Serif](https://github.com/IBM/plex) (via [Fontsource](https://fontsource.org)) | 5.0.8 | SIL Open Font License 1.1 |
| [Noto Serif](https://github.com/notofonts/latin-greek-cyrillic) (subconjunto grego, via Fontsource) | 5.0.8 | SIL Open Font License 1.1 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 5.1.1 | Apache 2.0 |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) (Tesseract compilado para WebAssembly) | 5.1.1 | Apache 2.0 |
| [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) (idiomas `por` e `eng`) | 4.1.0 | Apache 2.0 |
| [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) (modelos de alta qualidade, baixados sob demanda do jsDelivr; não ficam no repositório) | 4.1.0 | Apache 2.0 |
| [VERO](https://github.com/wooorm/dictionaries/tree/main/dictionaries/pt) (dicionário ortográfico pt-BR do Hunspell, via `dictionary-pt`) | 4.0.0 | LGPL 3.0 ou MPL 2.0 |
