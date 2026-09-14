/* ==========================================================
   Folio parsers — everything runs on the device, in the browser.
   Output shape for every format:
   { title, author, format, chapters: [{ title, blocks: [string] }] }
   Block prefixes: "## " sub-heading, "> " quote, "- " list item.
   ========================================================== */
const Parsers = (() => {
  const CH_RE = /^\s*(第\s*[0-9零〇一二三四五六七八九十百千两]+\s*[章节回卷部集篇话]|chapter\s+[\divxlc]+|part\s+[\divxlc]+|book\s+[\divxlc]+|prologue|epilogue|序章|序言|楔子|尾声|番外|后记|引子|自序)/i;
  const INLINE = new Set(['a','b','i','em','strong','span','font','u','s','small','sup','sub','code','abbr','cite','q','mark','ruby','rt','rp','big','tt','kbd','var','dfn','time','wbr']);
  const SKIP = new Set(['script','style','head','title','meta','link','svg','img','image','video','audio','iframe','object','noscript','template','guide','reference','nav']);

  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) {}
    const u8 = new Uint8Array(buf);
    if (u8.length > 1 && ((u8[0] === 0xFF && u8[1] === 0xFE) || (u8[0] === 0xFE && u8[1] === 0xFF))) {
      try { return new TextDecoder(u8[0] === 0xFF ? 'utf-16le' : 'utf-16be').decode(buf); } catch (e) {}
    }
    for (const enc of ['gb18030', 'big5', 'shift_jis', 'windows-1252']) {
      try { return new TextDecoder(enc).decode(buf); } catch (e) {}
    }
    return new TextDecoder().decode(buf);
  }

  function titleFromName(name) {
    let base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    let author = '';
    const m = base.match(/^(.+?)\s+-\s+(.+)$/);
    if (m) { author = m[1]; base = m[2]; }
    return { title: base || name, author };
  }

  function formatFromName(name) {
    const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    return ({ txt: 'TXT', text: 'TXT', md: 'TXT', docx: 'DOCX', mobi: 'MOBI', prc: 'MOBI', azw: 'AZW', azw3: 'AZW3', epub: 'EPUB', pdf: 'PDF', doc: 'DOC' })[ext] || ext.toUpperCase();
  }

  /* ---------- plain text ---------- */
  function chaptersFromLines(lines) {
    const chapters = []; let cur = null;
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '').replace(/^﻿/, '');
      if (!line.trim()) continue;
      const t = line.trim();
      if (t.length <= 40 && CH_RE.test(t)) { cur = { title: t, blocks: [] }; chapters.push(cur); continue; }
      if (!cur) { cur = { title: '', blocks: [] }; chapters.push(cur); }
      cur.blocks.push(t);
    }
    return chapters;
  }

  async function parseTxt(file) {
    const text = decodeText(await file.arrayBuffer());
    const { title, author } = titleFromName(file.name);
    const chapters = chaptersFromLines(text.split(/\r\n|\r|\n/));
    return { title, author, format: formatFromName(file.name), chapters: finalize(chapters, title) };
  }

  /* ---------- HTML → chapters (shared by DOCX, EPUB, MOBI) ---------- */
  function chaptersFromHtml(html, opts = {}) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const chapters = []; let cur = null; let buf = '';
    const count = t => doc.querySelectorAll(t).length;
    const n1 = count('h1'), n2 = count('h2'), n3 = count('h3');
    const level = n1 >= 2 ? 'h1' : n2 >= 2 ? 'h2' : n1 === 1 ? 'h1' : n3 >= 2 ? 'h3' : (n2 === 1 ? 'h2' : 'h3');
    const headTags = new Set([level]);
    const push = (b) => { if (!cur) { cur = { title: '', blocks: [] }; chapters.push(cur); } cur.blocks.push(b); };
    const flush = (prefix = '') => { const t = buf.replace(/\s+/g, ' ').trim(); buf = ''; if (t) push(prefix + t); };
    const newChapter = (title) => { cur = { title, blocks: [] }; chapters.push(cur); };
    const walk = (node, prefix) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { buf += n.nodeValue; continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        if (SKIP.has(tag)) continue;
        if (tag === 'br') { flush(prefix); continue; }
        if (INLINE.has(tag)) { buf += n.textContent; continue; }
        if (tag === 'mbp:pagebreak' || (tag === 'hr' && (opts.hrBreaks || n.classList.contains('pb')))) { flush(prefix); cur = null; continue; }
        flush(prefix);
        const text = n.textContent.replace(/\s+/g, ' ').trim();
        if (headTags.has(tag)) { if (text) newChapter(text); continue; }
        if (/^h[1-6]$/.test(tag)) { if (text) push('## ' + text); continue; }
        if (tag === 'li') { walk(n, ''); flush('- '); continue; }
        if (tag === 'blockquote') { walk(n, ''); flush('> '); continue; }
        if (tag === 'tr') { const cells = [...n.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean); if (cells.length) push(cells.join(' · ')); continue; }
        walk(n, prefix); flush(prefix);
      }
    };
    walk(doc.body || doc, '');
    flush('');
    return chapters;
  }

  /* ---------- DOCX (mammoth) ---------- */
  async function parseDocx(file) {
    if (typeof mammoth === 'undefined') throw new Error('DOCX engine did not load');
    const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const { title, author } = titleFromName(file.name);
    return { title, author, format: 'DOCX', chapters: finalize(chaptersFromHtml(res.value), title) };
  }

  /* ---------- EPUB (JSZip) ---------- */
  function resolvePath(base, href) {
    const parts = (base + href).split('/'); const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
    return out.join('/');
  }
  async function parseEpub(file) {
    if (typeof JSZip === 'undefined') throw new Error('EPUB engine did not load');
    const zip = await JSZip.loadAsync(file);
    const cf = zip.file('META-INF/container.xml'); if (!cf) throw new Error('Not a valid EPUB (no container.xml)');
    const cx = new DOMParser().parseFromString(await cf.async('string'), 'application/xml');
    const rootPath = cx.querySelector('rootfile').getAttribute('full-path');
    const opf = new DOMParser().parseFromString(await zip.file(rootPath).async('string'), 'application/xml');
    const base = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';
    const DC = 'http://purl.org/dc/elements/1.1/';
    const dc = (n) => (opf.getElementsByTagNameNS(DC, n)[0] || {}).textContent || '';
    const manifest = {};
    opf.querySelectorAll('manifest item').forEach(it => { manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') || '' }; });
    const spine = [...opf.querySelectorAll('spine itemref')].map(r => manifest[r.getAttribute('idref')]).filter(Boolean);
    // NCX labels, used when a spine document has no heading
    const labels = {};
    const ncx = Object.values(manifest).find(m => m.type.includes('dtbncx'));
    if (ncx) {
      const nf = zip.file(decodeURIComponent(resolvePath(base, ncx.href)));
      if (nf) {
        const nx = new DOMParser().parseFromString(await nf.async('string'), 'application/xml');
        nx.querySelectorAll('navPoint').forEach(np => {
          const src = (np.querySelector('content') || {}).getAttribute?.('src') || '';
          const lab = (np.querySelector('text') || {}).textContent || '';
          const key = decodeURIComponent(resolvePath(base, src.split('#')[0]));
          if (key && lab && !labels[key]) labels[key] = lab.trim();
        });
      }
    }
    const chapters = [];
    for (const item of spine) {
      if (!/html|xml/.test(item.type) && !/\.x?html?$/i.test(item.href)) continue;
      const path = decodeURIComponent(resolvePath(base, item.href));
      const f = zip.file(path); if (!f) continue;
      const parts = chaptersFromHtml(await f.async('string'));
      if (parts.length && !parts[0].title && labels[path]) parts[0].title = labels[path];
      chapters.push(...parts);
    }
    const fallback = titleFromName(file.name);
    const title = dc('title').trim() || fallback.title;
    return { title, author: dc('creator').trim() || fallback.author, format: 'EPUB', chapters: finalize(chapters, title) };
  }

  /* ---------- MOBI / AZW (PalmDOC) ---------- */
  function palmdocDecompress(inp) {
    const out = new Uint8Array(inp.length * 8 + 16); let o = 0, i = 0;
    while (i < inp.length) {
      let c = inp[i++];
      if (c >= 1 && c <= 8) { for (let k = 0; k < c && i < inp.length; k++) out[o++] = inp[i++]; }
      else if (c < 128) { out[o++] = c; }
      else if (c >= 192) { out[o++] = 32; out[o++] = c ^ 128; }
      else if (i < inp.length) {
        c = (c << 8) | inp[i++];
        const dist = (c >> 3) & 0x7FF, len = (c & 7) + 3;
        for (let k = 0; k < len; k++) { out[o] = out[o - dist]; o++; }
      }
    }
    return out.subarray(0, o);
  }
  function trailingSize(rec, flags) {
    const sizeOf = (size) => { let bitpos = 0, result = 0; if (size <= 0) return 0; for (;;) { const v = rec[size - 1]; result |= (v & 0x7F) << bitpos; bitpos += 7; size--; if (v & 0x80 || bitpos >= 28 || size === 0) return result; } };
    let num = 0, test = flags >> 1;
    while (test) { if (test & 1) num += sizeOf(rec.length - num); test >>= 1; }
    if (flags & 1) num += (rec[rec.length - num - 1] & 3) + 1;
    return num;
  }
  function parseMobiBuffer(buf, name) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    if (u8.length < 80) throw new Error('File is too small to be a MOBI');
    const type = String.fromCharCode(...u8.subarray(60, 68));
    if (type !== 'BOOKMOBI' && type !== 'TEXtREAd') throw new Error('Not a MOBI/AZW file (' + type.trim() + ')');
    const nRec = dv.getUint16(76);
    const offs = []; for (let i = 0; i < nRec; i++) offs.push(dv.getUint32(78 + i * 8));
    const rec = (i) => u8.subarray(offs[i], i + 1 < nRec ? offs[i + 1] : u8.length);
    const r0 = rec(0); const d0 = new DataView(r0.buffer, r0.byteOffset, r0.byteLength);
    const compression = d0.getUint16(0), recordCount = d0.getUint16(8), encryption = d0.getUint16(12);
    let encoding = 1252, flags = 0, author = '', title = '', pdbName = new TextDecoder('windows-1252').decode(u8.subarray(0, 32)).replace(/\0.*$/, '');
    if (r0.length >= 24 && String.fromCharCode(...r0.subarray(16, 20)) === 'MOBI') {
      const hlen = d0.getUint32(20); encoding = d0.getUint32(28); const version = d0.getUint32(36);
      const dec = new TextDecoder(encoding === 65001 ? 'utf-8' : 'windows-1252');
      if (hlen >= 0xE4 && version >= 5 && r0.length >= 0xF4) flags = d0.getUint16(0xF2);
      const fnOff = d0.getUint32(84), fnLen = d0.getUint32(88);
      if (fnOff + fnLen <= r0.length) title = dec.decode(r0.subarray(fnOff, fnOff + fnLen)).replace(/\0+$/, '');
      const exthFlags = d0.getUint32(128);
      if (exthFlags & 0x40) {
        let p = 16 + hlen;
        if (String.fromCharCode(...r0.subarray(p, p + 4)) === 'EXTH') {
          const count = d0.getUint32(p + 8); p += 12;
          for (let k = 0; k < count && p + 8 <= r0.length; k++) {
            const t = d0.getUint32(p), l = d0.getUint32(p + 4); const data = r0.subarray(p + 8, p + l);
            if (t === 100 && !author) author = dec.decode(data);
            if (t === 503) title = dec.decode(data);
            p += l;
          }
        }
      }
    }
    if (encryption !== 0) throw new Error('This file is DRM-protected and cannot be opened');
    if (compression === 17480) throw new Error('HUFF/CDIC compression is not supported in the demo yet');
    if (compression !== 1 && compression !== 2) throw new Error('Unknown MOBI compression (' + compression + ')');
    const chunks = []; let total = 0;
    for (let i = 1; i <= recordCount && i < nRec; i++) {
      let r = rec(i); const t = trailingSize(r, flags); r = r.subarray(0, Math.max(0, r.length - t));
      const d = compression === 2 ? palmdocDecompress(r) : r; chunks.push(d); total += d.length;
    }
    const all = new Uint8Array(total); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const html = new TextDecoder(encoding === 65001 ? 'utf-8' : 'windows-1252').decode(all);
    const fb = titleFromName(name);
    return { title: (title || pdbName || fb.title).trim(), author: (author || fb.author).trim(), html };
  }
  async function parseMobi(file) {
    const { title, author, html } = parseMobiBuffer(await file.arrayBuffer(), file.name);
    let chapters = chaptersFromHtml(html.replace(/<\/?mbp:pagebreak[^>]*>/gi, '<hr class="pb">'));
    // Drop a leading link-only table of contents page if the book has real chapters after it
    if (chapters.length > 2 && chapters[0].blocks.length && chapters[0].blocks.every(b => b.length < 60)) chapters = chapters.slice(1);
    return { title, author, format: formatFromName(file.name), chapters: finalize(chapters, title) };
  }

  /* ---------- shared clean-up ---------- */
  function finalize(chapters, fallbackTitle) {
    chapters = chapters.filter(c => c.blocks.length || c.title);
    // merge a heading-only chapter into the next one
    for (let i = chapters.length - 2; i >= 0; i--) if (!chapters[i].blocks.length && !chapters[i + 1].title) { chapters[i + 1].title = chapters[i].title; chapters.splice(i, 1); }
    chapters = chapters.filter(c => c.blocks.length);
    if (chapters.length > 1 && !chapters[0].title && chapters[0].blocks.length <= 2 && chapters[0].blocks.join('').length <= 80) chapters.shift();
    chapters.forEach((c, i) => {
      if (!c.title) {
        const f = c.blocks[0].replace(/^##\s*/, '');
        if (c.blocks.length > 1 && f.length <= 40 && !/[。.!?！？,，]$/.test(f)) { c.title = f; c.blocks.shift(); }
        else c.title = chapters.length === 1 ? fallbackTitle : 'Part ' + (i + 1);
      }
      c.title = c.title.replace(/^##\s*/, '').slice(0, 80);
    });
    // split very long chapters so page layout stays quick
    const out = [];
    for (const c of chapters) {
      let size = 0, part = 1, cur = { title: c.title, blocks: [] };
      for (const b of c.blocks) {
        if (size > 9000) { out.push(cur); part++; cur = { title: c.title + ' (' + part + ')', blocks: [] }; size = 0; }
        cur.blocks.push(b); size += b.length;
      }
      out.push(cur);
    }
    if (!out.length) throw new Error('No readable text found in this file');
    return out;
  }

  async function parseFile(file) {
    const ext = (file.name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    if (['txt', 'text', 'md', 'log', 'csv'].includes(ext) || (!ext && file.type.startsWith('text/'))) return parseTxt(file);
    if (ext === 'docx') return parseDocx(file);
    if (ext === 'epub') return parseEpub(file);
    if (['mobi', 'prc', 'azw', 'azw3'].includes(ext)) return parseMobi(file);
    if (ext === 'pdf') throw new Error('PDF is on the roadmap — not in this demo');
    if (ext === 'doc') throw new Error('Legacy .doc needs conversion to .docx first');
    if (file.type.startsWith('text/')) return parseTxt(file);
    throw new Error('Unsupported format (.' + ext + ')');
  }

  return { parseFile, parseTxt, parseDocx, parseEpub, parseMobi, parseMobiBuffer, decodeText, chaptersFromHtml };
})();
