# Folio — material reader (H5 prototype)

Working title **Folio**. A phone-first reader for files you already own: TXT, DOCX, MOBI/AZW, EPUB.

## Layout

```
demo/
  src/            source: index.html (skeleton), style.css, samples.js, parsers.js, app.js
  build.sh        inlines src/* into a single file
  dist/
    folio-demo.html            standalone page — open in any browser / host anywhere
    folio-demo.artifact.html   same page without the document wrapper (claude.ai artifact)
design/
  presentation.src.html   design review source (screenshots referenced by file)
  build.sh                inlines screenshots → presentation.html
  screenshots/            captured from the prototype with Playwright at 390×844
test-files/
  make_test_files.py      generates real TXT (UTF-8 + GBK), DOCX, EPUB and MOBI test files
```

## Run locally

```
cd demo && ./build.sh
python3 -m http.server 8765          # from the repo root
open http://127.0.0.1:8765/demo/dist/folio-demo.html
```

Everything runs in the browser: parsing (mammoth for DOCX, JSZip for EPUB, a small PalmDOC
decoder for MOBI), storage (localStorage for metadata, IndexedDB for chapter text).
Wi-Fi transfer and link download are simulated in the prototype — a web page cannot run a
local server or fetch arbitrary URLs; both are straightforward in a native shell.

## Content model

Every format is normalised to the same shape, which is also the hook for an AI assistant:

```js
{ title, author, format, chapters: [ { title, blocks: ["paragraph", "## sub-heading", "> quote", "- item"] } ] }
```
