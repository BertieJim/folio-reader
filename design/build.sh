#!/bin/sh
# Inline screenshots and the demo URL into design/presentation.html
set -e
cd "$(dirname "$0")"
DEMO_URL="${1:-https://claude.ai/code/artifact/21fca200-80e9-4690-9c3f-ce767e7cfdf5}"
python3 - "$DEMO_URL" <<'PY'
import base64, pathlib, re, sys
src = pathlib.Path('presentation.src.html').read_text()
def img(m):
    p = pathlib.Path('screenshots') / m.group(1)
    return 'data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode()
out = re.sub(r'__IMG:([^_]+?\.png)__', img, src).replace('__DEMO_URL__', sys.argv[1])
pathlib.Path('presentation.html').write_text(out)
print('built presentation.html', len(out)//1024, 'KB')
PY
