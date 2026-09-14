"""Generate real test files in every format the demo claims to read.
All content is original. Run: python3 make_test_files.py"""
import struct, time, zipfile, pathlib, io
out = pathlib.Path(__file__).parent

# ---------- TXT (UTF-8 with "Chapter N" headings) ----------
en_chapters = []
for n in range(1, 7):
    paras = [f"This is paragraph {p} of chapter {n} in a plain-text test file. It exists to check that the chapter detector finds English headings and that pagination copes with paragraphs of varying length. " * (1 + (p*n) % 3) for p in range(1, 9)]
    en_chapters.append(f"Chapter {n}: Test heading {n}\n\n" + "\n\n".join(paras))
(out/'plain-english.txt').write_text("A Plain Text Test Book\n\n" + "\n\n".join(en_chapters), encoding='utf-8')

# ---------- TXT (GBK with 第X章 headings) ----------
zh = ["测试文本"]
for n, cn in enumerate("一二三四五", 1):
    body = "。".join([f"这是第{cn}章的第{p}段测试文字，用来检查中文编码识别与章节切分是否正常工作" for p in range(1, 7)]) + "。"
    zh.append(f"第{cn}章 测试章节{n}\n" + "\n".join([body]*2))
(out/'gbk-chinese.txt').write_bytes("\n\n".join(zh).encode('gbk'))

# ---------- DOCX ----------
def docx(path):
    ct = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>'''
    rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''
    drels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'''
    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
</w:styles>'''
    def p(text, style=None):
        ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
        return f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
    body = []
    for n in range(1, 4):
        body.append(p(f"Section {n}: Meeting notes", "Heading1"))
        body.append(p(f"Discussion", "Heading2"))
        for k in range(1, 5):
            body.append(p(f"Note {k} from section {n}. This paragraph comes from a Word document and should keep its position under the heading above. " * 2))
    doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{"".join(body)}<w:sectPr/></w:body></w:document>'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', rels)
        z.writestr('word/_rels/document.xml.rels', drels); z.writestr('word/document.xml', doc); z.writestr('word/styles.xml', styles)
docx(out/'meeting-notes.docx')

# ---------- EPUB ----------
def epub(path):
    chapters = [(f"Chapter {n}: An EPUB heading", "".join(f"<p>Paragraph {k} of EPUB chapter {n}. Spine order should be preserved and the heading should become the chapter title. </p>" for k in range(1, 7))) for n in range(1, 5)]
    opf_items = "".join(f'<item id="c{n}" href="c{n}.xhtml" media-type="application/xhtml+xml"/>' for n in range(1, 5))
    spine = "".join(f'<itemref idref="c{n}"/>' for n in range(1, 5))
    opf = f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>An EPUB Test Book</dc:title><dc:creator>Test Author</dc:creator><dc:identifier id="id">urn:uuid:1234</dc:identifier><dc:language>en</dc:language></metadata>
<manifest>{opf_items}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
<spine toc="ncx">{spine}</spine></package>'''
    ncx = '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>' + "".join(f'<navPoint id="n{n}" playOrder="{n}"><navLabel><text>Chapter {n}</text></navLabel><content src="c{n}.xhtml"/></navPoint>' for n in range(1, 5)) + '</navMap></ncx>'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', zipfile.ZIP_DEFLATED)
        z.writestr('OEBPS/content.opf', opf, zipfile.ZIP_DEFLATED); z.writestr('OEBPS/toc.ncx', ncx, zipfile.ZIP_DEFLATED)
        for n, (t, b) in enumerate(chapters, 1):
            z.writestr(f'OEBPS/c{n}.xhtml', f'<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>{t}</title></head><body><h1>{t}</h1>{b}</body></html>', zipfile.ZIP_DEFLATED)
epub(out/'epub-test.epub')

# ---------- MOBI (PalmDOC-compressed, UTF-8, multibyte trailer flag, EXTH) ----------
def palmdoc_compress(data: bytes) -> bytes:
    out = bytearray(); i = 0; n = len(data); table = {}
    def reg(p):
        if p + 3 <= n: table.setdefault(data[p:p+3], []).append(p)
    while i < n:
        best_len = 0; best_dist = 0
        if i + 3 <= n:
            for j in reversed(table.get(data[i:i+3], [])):
                if i - j > 2047: break
                l = 3
                while l < 10 and i + l < n and data[j+l] == data[i+l]: l += 1
                if l > best_len: best_len, best_dist = l, i - j
                if l == 10: break
        if best_len >= 3:
            for p in range(i, i + best_len): reg(p)
            out += struct.pack('>H', 0x8000 | (best_dist << 3) | (best_len - 3)); i += best_len; continue
        c = data[i]
        if c == 0x20 and i + 1 < n and 0x40 <= data[i+1] <= 0x7F:
            reg(i); reg(i+1); out.append(data[i+1] ^ 0x80); i += 2
        elif c == 0 or 0x09 <= c <= 0x7F:
            reg(i); out.append(c); i += 1
        else:
            run = bytearray()
            while i < n and len(run) < 8 and ((1 <= data[i] <= 8) or data[i] >= 0x80):
                reg(i); run.append(data[i]); i += 1
            out.append(len(run)); out += run
    return bytes(out)

def palmdoc_decompress(data: bytes) -> bytes:  # reference decoder, used to self-check the compressor
    out = bytearray(); i = 0
    while i < len(data):
        c = data[i]; i += 1
        if 1 <= c <= 8: out += data[i:i+c]; i += c
        elif c < 128: out.append(c)
        elif c >= 192: out += b' ' + bytes([c ^ 128])
        else:
            c = (c << 8) | data[i]; i += 1
            dist = (c >> 3) & 0x7FF; ln = (c & 7) + 3
            for _ in range(ln): out.append(out[-dist])
    return bytes(out)

def mobi(path, title, author, html):
    text = html.encode('utf-8')
    # split into <=4096-byte records without cutting a UTF-8 character
    recs = []; i = 0
    while i < len(text):
        j = min(i + 4096, len(text))
        while j < len(text) and (text[j] & 0xC0) == 0x80: j -= 1
        recs.append(text[i:j]); i = j
    comp = []
    for r in recs:
        c = palmdoc_compress(r); assert palmdoc_decompress(c) == r
        comp.append(c + b'\x00')            # multibyte trailer: 0 overlapping bytes
    # EXTH
    exth_recs = b''
    for t, v in [(100, author.encode('utf-8')), (503, title.encode('utf-8')), (524, b'en')]:
        exth_recs += struct.pack('>II', t, 8 + len(v)) + v
    exth = b'EXTH' + struct.pack('>II', 12 + len(exth_recs), 3) + exth_recs
    exth += b'\x00' * ((4 - len(exth) % 4) % 4)
    hlen = 0xE8
    full_name = title.encode('utf-8')
    fn_off = 16 + hlen + len(exth)
    r0 = bytearray(16 + hlen)
    struct.pack_into('>HHIHHHH', r0, 0, 2, 0, len(text), len(recs), 4096, 0, 0)
    r0[16:20] = b'MOBI'
    struct.pack_into('>IIIII', r0, 20, hlen, 2, 65001, 0x2A2B2C2D, 6)
    for k in range(10): struct.pack_into('>I', r0, 40 + 4*k, 0xFFFFFFFF)
    struct.pack_into('>IIII', r0, 80, len(recs) + 1, fn_off, len(full_name), 9)
    struct.pack_into('>II', r0, 104, 6, 0xFFFFFFFF)          # min version, first image index
    struct.pack_into('>I', r0, 128, 0x40)                     # EXTH flags
    struct.pack_into('>I', r0, 164, 0xFFFFFFFF)
    struct.pack_into('>IIII', r0, 168, 0xFFFFFFFF, 0, 0, 0)  # DRM
    struct.pack_into('>HHI', r0, 192, 1, len(recs), 1)
    struct.pack_into('>IIII', r0, 200, 0xFFFFFFFF, 1, 0xFFFFFFFF, 1)
    struct.pack_into('>III', r0, 224, 0xFFFFFFFF, 0, 0xFFFFFFFF)
    struct.pack_into('>I', r0, 236, 0xFFFFFFFF)
    struct.pack_into('>H', r0, 0xF2, 1)                       # extra data flags: multibyte
    struct.pack_into('>I', r0, 0xF4, 0xFFFFFFFF)
    r0 = bytes(r0) + exth + full_name + b'\x00\x00'
    r0 += b'\x00' * ((4 - len(r0) % 4) % 4)
    records = [r0] + comp + [b'\xe9\x8e\r\n']
    n = len(records)
    hdr = bytearray(78 + 8*n + 2)
    name = title.encode('utf-8')[:31]
    hdr[0:len(name)] = name
    t = int(time.time()) + 2082844800
    struct.pack_into('>HHIIIIII', hdr, 32, 0, 0, t, t, 0, 0, 0, 0)
    hdr[60:68] = b'BOOKMOBI'
    struct.pack_into('>IIH', hdr, 68, 2*n + 1, 0, n)
    off = len(hdr)
    for k, r in enumerate(records):
        struct.pack_into('>I', hdr, 78 + 8*k, off); hdr[78 + 8*k + 4] = 0
        hdr[78 + 8*k + 5: 78 + 8*k + 8] = (2*k).to_bytes(3, 'big'); off += len(r)
    path.write_bytes(bytes(hdr) + b''.join(records))

parts = []
for n in range(1, 6):
    body = "".join(f"<p>Paragraph {k} of MOBI chapter {n}. The text is PalmDOC-compressed and UTF-8 encoded — including a few non-ASCII characters: café, naïve, 中文测试, 「引号」. </p>" for k in range(1, 10))
    parts.append(f"<h1>Chapter {n}: A MOBI heading</h1>{body}")
html = '<html><head><guide></guide></head><body>' + '<mbp:pagebreak/>'.join(parts) + '</body></html>'
mobi(out/'mobi-test.mobi', 'A MOBI Test Book', 'Test Author', html)
print("wrote:", sorted(p.name for p in out.iterdir() if p.suffix != '.py'))
