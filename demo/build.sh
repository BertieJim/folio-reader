#!/bin/sh
# Inline src/* into a single-file H5 page.
#   dist/folio-demo.html          — standalone (open directly / host anywhere)
#   dist/folio-demo.artifact.html — same page without the document wrapper (for claude.ai artifacts)
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import pathlib
src = pathlib.Path('src'); dist = pathlib.Path('dist'); dist.mkdir(exist_ok=True)
html = (src/'index.html').read_text()
for key, f in [('CSS','style.css'),('SAMPLES','samples.js'),('PARSERS','parsers.js'),('APP','app.js')]:
    html = html.replace('/*__%s__*/' % key, (src/f).read_text())
(dist/'folio-demo.artifact.html').write_text(html)
full = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#F4F6F2">\n<meta name="mobile-web-app-capable" content="yes">\n'
        '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
        '<style>html,body{margin:0}</style>\n' + html + '\n</html>\n')
(dist/'folio-demo.html').write_text(full)
print('built', len(full)//1024, 'KB')
PY
