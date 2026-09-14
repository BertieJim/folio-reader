/* ==========================================================
   Folio — app logic (library, import, reader)
   ========================================================== */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TINTS = ['sage', 'sky', 'lilac', 'sand', 'rose', 'mint', 'butter', 'slate'];
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const isCJK = s => { const m = s.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g); return m && m.length > s.replace(/\s/g, '').length * 0.3; };
const chapterChars = c => c.blocks.reduce((n, b) => n + b.length, 0);
const ICON_MORE = '<svg class="i" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/></svg>';
const ICON_CHEV = '<svg class="i" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
const ICON_CHECK = '<svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';

/* ---------- storage ---------- */
const LS_META = 'folio.demo.v1', LS_SET = 'folio.demo.settings';
const DB = (() => {
  let dbp = null; const mem = new Map();
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    try { const r = indexedDB.open('folio-demo', 1); r.onupgradeneeded = () => r.result.createObjectStore('chapters'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); }
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => { const t = db.transaction('chapters', mode); const rq = fn(t.objectStore('chapters')); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); }));
  return {
    async get(k) { if (mem.has(k)) return mem.get(k); try { const v = await tx('readonly', s => s.get(k)); if (v) mem.set(k, v); return v; } catch (e) { return undefined; } },
    async set(k, v) { mem.set(k, v); try { await tx('readwrite', s => s.put(v, k)); } catch (e) {} },
    async del(k) { mem.delete(k); try { await tx('readwrite', s => s.delete(k)); } catch (e) {} },
    async clear() { mem.clear(); try { await tx('readwrite', s => s.clear()); } catch (e) {} },
  };
})();

const state = {
  folders: [], books: [], view: 'library', folderId: null, history: [],
  settings: { theme: 'paper', font: 'serif', size: 18, lh: 1.75, mode: 'flip', bright: 0, seenHint: false },
};
const saveMeta = () => { try { localStorage.setItem(LS_META, JSON.stringify({ folders: state.folders, books: state.books })); } catch (e) {} };
const saveSettings = () => { try { localStorage.setItem(LS_SET, JSON.stringify(state.settings)); } catch (e) {} };

function makeBook(meta, chapters) {
  const chWeights = chapters.map(chapterChars);
  const text = chapters.map(c => c.blocks.join('')).join('');
  return { lastRead: 0, progress: { ch: 0, ratio: 0 }, bookmarks: [], curTitle: '', ...meta, chWeights, nChapters: chapters.length, chars: chWeights.reduce((a, b) => a + b, 0), cjk: !!isCJK(text.slice(0, 4000)) };
}
async function seed() {
  state.folders = SAMPLE_FOLDERS.map(f => ({ ...f, createdAt: now() }));
  state.books = [];
  let t = now() - 1000 * 60 * 60 * 24 * 6;
  for (const b of SAMPLE_BOOKS) {
    const { chapters, ...meta } = b;
    const book = makeBook({ ...meta, addedAt: t }, chapters); t += 1000 * 60 * 60 * 20;
    state.books.push(book); await DB.set(book.id, chapters);
  }
  const g = state.books.find(b => b.id === 'b-guide'); g.lastRead = now(); g.progress = { ch: 1, ratio: 0.3 }; g.curTitle = 'Bringing in your materials';
  const l = state.books.find(b => b.id === 'b-lantern'); l.lastRead = now() - 1000 * 60 * 60 * 30; l.progress = { ch: 2, ratio: 0.5 }; l.curTitle = 'What the ledger said';
  saveMeta();
}
async function load() {
  let meta = null;
  try { meta = JSON.parse(localStorage.getItem(LS_META)); } catch (e) {}
  try { Object.assign(state.settings, JSON.parse(localStorage.getItem(LS_SET)) || {}); } catch (e) {}
  if (meta && Array.isArray(meta.books) && meta.books.length) { state.folders = meta.folders || []; state.books = meta.books; }
  else await seed();
}
async function getChapters(book) {
  let ch = await DB.get(book.id);
  if (!ch) { const s = SAMPLE_BOOKS.find(x => x.id === book.id); if (s) { ch = s.chapters; DB.set(book.id, ch); } }
  return ch;
}

/* ---------- helpers ---------- */
const bookPercent = b => { if (!b.chWeights || !b.chars) return 0; let before = 0; for (let i = 0; i < b.progress.ch; i++) before += b.chWeights[i] || 0; return Math.min(1, (before + (b.progress.ratio || 0) * (b.chWeights[b.progress.ch] || 0)) / b.chars); };
const pct = b => Math.round(bookPercent(b) * 100);
const minutesFor = (chars, cjk) => Math.max(1, Math.round(chars / (cjk ? 380 : 1100)));
const folderOf = id => state.folders.find(f => f.id === id);
const booksIn = id => id === 'all' ? state.books : id === 'unfiled' ? state.books.filter(b => !b.folderId || !folderOf(b.folderId)) : state.books.filter(b => b.folderId === id);

let toastTimer = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('is-on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200); }

/* ---------- rendering ---------- */
const coverHTML = (b, cls = 'cover') => `<div class="${cls}" style="--tint:var(--tint-${b.tint});--tint-ink:var(--tint-${b.tint}-ink)"><div class="ct">${esc(b.title)}</div><div class="ca">${esc(b.author)}</div><span class="fmt">${esc(b.format)}</span></div>`;
function bookCard(b) {
  const p = pct(b);
  return `<div class="book" data-id="${b.id}">
    <button class="open" data-open="${b.id}" aria-label="Open ${esc(b.title)}">${coverHTML(b)}
      <div class="bt">${esc(b.title)}</div>
      <div class="bp">${p > 0 ? p + '% read' : b.nChapters + (b.nChapters === 1 ? ' chapter' : ' chapters')}</div>
      ${p > 0 ? `<div class="bar"><i style="width:${p}%"></i></div>` : ''}
    </button>
    <button class="more" data-more="${b.id}" aria-label="Options for ${esc(b.title)}">${ICON_MORE}</button>
  </div>`;
}
function folderCard(f) {
  const n = booksIn(f.id).length; const spines = Math.min(3, Math.max(1, n));
  const hs = [70, 100, 85];
  return `<button class="folder" data-folder="${f.id}" style="--tint:var(--tint-${f.tint});--tint-ink:var(--tint-${f.tint}-ink)">
    <div class="tab"><div class="spines">${Array.from({ length: spines }, (_, i) => `<i style="height:${hs[i]}%"></i>`).join('')}</div></div>
    <div class="name">${esc(f.name)}</div><div class="count">${n} ${n === 1 ? 'book' : 'books'}</div></button>`;
}
function renderLibrary() {
  $('#lib-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const cont = state.books.filter(b => b.lastRead).sort((a, b) => b.lastRead - a.lastRead)[0];
  $('#continue').innerHTML = cont ? `<button class="continue" data-open="${cont.id}">${coverHTML(cont)}<div style="min-width:0"><div class="label">Continue reading</div><div class="title">${esc(cont.title)}</div><div class="meta">${esc(cont.curTitle || '')}</div><div class="bar"><i style="width:${pct(cont)}%"></i></div></div><span class="chev">${ICON_CHEV}</span></button>` : '';
  const lastTouch = f => Math.max(0, ...booksIn(f.id).map(b => b.lastRead || 0));
  const folders = [...state.folders].sort((a, b) => lastTouch(b) - lastTouch(a) || b.createdAt - a.createdAt);
  $('#folder-grid').innerHTML = folders.map(folderCard).join('') + (folders.length ? '' : `<button class="folder is-all" data-act="new-folder"><div class="tab"></div><div class="name">Create a folder</div><div class="count">Keep materials together</div></button>`);
  const recent = [...state.books].sort((a, b) => b.addedAt - a.addedAt).slice(0, 6);
  $('#recent-grid').innerHTML = recent.map(bookCard).join('');
}
function renderFolder() {
  const id = state.folderId; const f = folderOf(id);
  const books = [...booksIn(id)].sort((a, b) => (b.lastRead || b.addedAt) - (a.lastRead || a.addedAt));
  $('#folder-title').textContent = id === 'all' ? 'All books' : id === 'unfiled' ? 'Unfiled' : (f ? f.name : '');
  $('#folder-sub').textContent = books.length + (books.length === 1 ? ' book' : ' books');
  $('#folder-menu-btn').classList.toggle('hidden', !f);
  $('#folder-books').innerHTML = books.map(bookCard).join('');
  $('#folder-empty').classList.toggle('hidden', books.length > 0);
}
function renderSearch() {
  const q = $('#search-input').value.trim().toLowerCase();
  const hits = q ? state.books.filter(b => (b.title + ' ' + b.author).toLowerCase().includes(q)) : [];
  $('#search-results').innerHTML = hits.map(bookCard).join('');
  $('#search-empty').classList.toggle('hidden', !q || hits.length > 0);
}
function renderAll() { renderLibrary(); if (state.view === 'folder') renderFolder(); if (state.view === 'search') renderSearch(); }

function show(view) {
  state.view = view;
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + view));
  $('#fab').classList.toggle('hidden-fab', view === 'search');
  if (view === 'search') setTimeout(() => $('#search-input').focus(), 250);
}
function showFolder(id) { state.folderId = id; renderFolder(); show('folder'); $('#view-folder').scrollTop = 0; }

/* ---------- sheets ---------- */
function openSheet(id) { $$('.sheet').forEach(s => s.classList.toggle('is-open', s.id === id)); $('#scrim').classList.add('is-open'); }
function closeSheets() { $$('.sheet').forEach(s => s.classList.remove('is-open')); $('#scrim').classList.remove('is-open'); }

let folderEditing = null;
function openFolderSheet(f) {
  folderEditing = f || null;
  $('#folder-sheet-title').textContent = f ? 'Edit folder' : 'New folder';
  $('#folder-save').textContent = f ? 'Save' : 'Create';
  $('#folder-name').value = f ? f.name : '';
  const tint = f ? f.tint : TINTS[state.folders.length % TINTS.length];
  $('#folder-swatches').innerHTML = TINTS.map(t => `<button class="swatch${t === tint ? ' is-on' : ''}" data-tint="${t}" style="--tint:var(--tint-${t})" aria-label="${t}"></button>`).join('');
  openSheet('sheet-folder'); setTimeout(() => $('#folder-name').focus(), 300);
}
function saveFolder() {
  const name = $('#folder-name').value.trim(); if (!name) { $('#folder-name').focus(); return; }
  const tint = ($('#folder-swatches .is-on') || {}).dataset?.tint || 'sage';
  if (folderEditing) { folderEditing.name = name; folderEditing.tint = tint; toast('Folder updated'); }
  else { const f = { id: 'f-' + uid(), name, tint, createdAt: now() }; state.folders.push(f); toast('Folder “' + name + '” created'); }
  saveMeta(); closeSheets(); renderAll();
}

let bookSheetId = null, deleteArmed = false;
function openBookSheet(id) {
  const b = state.books.find(x => x.id === id); if (!b) return; bookSheetId = id; deleteArmed = false;
  $('#bs-cover').innerHTML = coverHTML(b);
  $('#bs-title').textContent = b.title;
  $('#bs-sub').textContent = [b.author, b.format, b.nChapters + ' chapters', minutesFor(b.chars, b.cjk) + ' min'].filter(Boolean).join(' · ');
  $('#bs-del-label').textContent = 'Remove from library';
  const row = (fid, name, tint) => `<button class="opt" data-move="${fid}"><span class="ic${tint ? '' : ' neutral'}" style="${tint ? `background:var(--tint-${tint});color:var(--tint-${tint}-ink)` : ''}"><svg class="i" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span><span><span class="t">${esc(name)}</span></span><span class="chev" style="color:var(--accent)">${(b.folderId || '') === fid ? ICON_CHECK : ''}</span></button>`;
  $('#bs-folders').innerHTML = state.folders.map(f => row(f.id, f.name, f.tint)).join('') + row('', 'Unfiled', null);
  openSheet('sheet-book');
}

/* ---------- import ---------- */
function currentFolderTarget() { return state.view === 'folder' && folderOf(state.folderId) ? state.folderId : null; }
async function addBook(parsed, folderId) {
  const chars = parsed.chapters.reduce((n, c) => n + chapterChars(c), 0);
  const dup = state.books.find(b => b.title === parsed.title && b.format === parsed.format && b.chars === chars);
  if (dup) { const e = new Error('Already in your library'); e.duplicate = dup; throw e; }
  const id = 'u-' + uid();
  const book = makeBook({ id, title: parsed.title, author: parsed.author || '', format: parsed.format, tint: TINTS[hash(parsed.title) % TINTS.length], folderId: folderId || null, addedAt: now() }, parsed.chapters);
  await DB.set(id, parsed.chapters); state.books.push(book); saveMeta(); return book;
}
async function importFiles(files) {
  const list = $('#progress-list');
  list.innerHTML = files.map((f, i) => `<div class="progress-item" id="pi-${i}"><span>${esc(f.name)}</span><span class="st">Waiting</span><div class="bar"><i style="width:0%"></i></div></div>`).join('');
  $('#progress-done').classList.add('hidden'); openSheet('sheet-progress');
  const target = currentFolderTarget(); let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const el = $('#pi-' + i), st = $('.st', el), bar = $('.bar i', el);
    st.textContent = 'Reading…'; bar.style.width = '35%';
    await new Promise(r => setTimeout(r, 120));
    try {
      const parsed = await Parsers.parseFile(files[i]);
      st.textContent = 'Building chapters…'; bar.style.width = '80%';
      await addBook(parsed, target); ok++;
      st.textContent = 'Added · ' + parsed.chapters.length + (parsed.chapters.length === 1 ? ' chapter' : ' chapters'); bar.style.width = '100%'; el.classList.add('is-ok');
    } catch (err) { if (!err.duplicate) console.error(err); el.classList.add(err.duplicate ? 'is-ok' : 'is-err'); st.textContent = err.message || 'Could not read this file'; bar.style.width = '100%'; }
  }
  renderAll();
  $('#progress-done').classList.remove('hidden');
  if (ok) toast(ok === 1 ? 'Added 1 book' + (target ? ' to ' + folderOf(target).name : '') : 'Added ' + ok + ' books');
}
function fakeBook(title, format, note) {
  return { title, author: '', format, chapters: [{ title: 'About this file', blocks: [note, 'In the finished app this entry would be the real file, parsed exactly like a file picked from the device.'] }] };
}

/* ---------- reader ---------- */
const R = { el: $('#reader'), vp: $('#rvp'), content: $('#rcontent'), book: null, chapters: null, ch: 0, page: 0, pages: 1, step: 0, lock: null };
const S = state.settings;
const mode = () => S.mode;
function applySettings() {
  R.el.dataset.rt = S.theme; R.el.classList.toggle('font-sans', S.font === 'sans'); R.el.classList.toggle('mode-scroll', S.mode === 'scroll');
  R.el.style.fontSize = S.size + 'px'; R.el.style.setProperty('--rlh', S.lh); $('#brightness').style.opacity = S.bright / 100;
  $$('#theme-row .tsw').forEach(b => b.classList.toggle('is-on', b.dataset.theme === S.theme));
  $$('#font-seg button').forEach(b => b.classList.toggle('is-on', b.dataset.font === S.font));
  $$('#lh-seg button').forEach(b => b.classList.toggle('is-on', +b.dataset.lh === +S.lh));
  $$('#mode-seg button').forEach(b => b.classList.toggle('is-on', b.dataset.mode === S.mode));
  $('#size-val').textContent = S.size; $('#bright').value = S.bright;
  $('#btn-night').classList.toggle('is-on', S.theme === 'night');
  $('#btn-full').classList.toggle('hidden', !document.fullscreenEnabled);
  saveSettings();
}
function chapterHTML(i) {
  const c = R.chapters[i]; const out = [`<h2 class="ch"><small>Chapter ${i + 1} of ${R.chapters.length}</small>${esc(c.title)}</h2>`]; let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const b of c.blocks) {
    if (b.startsWith('## ')) { closeList(); out.push(`<h3>${esc(b.slice(3))}</h3>`); }
    else if (b.startsWith('> ')) { closeList(); out.push(`<blockquote>${esc(b.slice(2))}</blockquote>`); }
    else if (b.startsWith('- ')) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${esc(b.slice(2))}</li>`); }
    else { closeList(); out.push(`<p>${esc(b)}</p>`); }
  }
  closeList();
  if (i === R.chapters.length - 1) out.push('<p class="end">The end</p>');
  else if (mode() === 'scroll') out.push(`<button class="next-ch" data-act="next-ch"><small>Next chapter</small>${esc(R.chapters[i + 1].title)} →</button>`);
  return out.join('');
}
function layout() {
  if (mode() === 'scroll') { R.content.style.columnWidth = ''; R.pages = 1; R.step = 0; return; }
  const cs = getComputedStyle(R.vp);
  const inner = R.vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  R.content.style.columnWidth = inner + 'px';
  R.step = R.vp.clientWidth;
  const gap = R.step - inner;
  R.pages = Math.max(1, Math.round((R.content.scrollWidth + gap) / R.step));
}
const ratioNow = () => mode() === 'scroll' ? (R.vp.scrollHeight > R.vp.clientHeight ? R.vp.scrollTop / (R.vp.scrollHeight - R.vp.clientHeight) : 0) : (R.pages > 1 ? R.page / (R.pages - 1) : 0);
function applyPage(anim = true) {
  if (!anim) R.el.classList.add('no-anim');
  R.content.style.transform = `translateX(${-R.page * R.step}px)`;
  if (!anim) { void R.content.offsetWidth; R.el.classList.remove('no-anim'); }
  updateStatus(); scheduleSave();
}
function goTo(ch, ratio = 0, instant = false) {
  ch = Math.max(0, Math.min(R.chapters.length - 1, ch)); R.ch = ch;
  const c = R.chapters[ch];
  R.content.className = 'reader-content' + (isCJK(c.blocks.join('').slice(0, 2000)) ? ' cjk' : '');
  R.content.innerHTML = chapterHTML(ch);
  R.el.classList.add('no-anim'); R.content.style.transform = 'none'; void R.content.offsetWidth;
  if (mode() === 'scroll') { R.vp.scrollTop = 0; layout(); R.vp.scrollTop = ratio * (R.vp.scrollHeight - R.vp.clientHeight); R.el.classList.remove('no-anim'); updateStatus(); scheduleSave(); }
  else { layout(); R.page = Math.min(R.pages - 1, Math.round(ratio * (R.pages - 1))); applyPage(false); }
  if (!instant && !matchMedia('(prefers-reduced-motion: reduce)').matches) R.content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  renderTOC();
}
function next() { if (mode() === 'scroll') return; if (R.page < R.pages - 1) { R.page++; applyPage(); } else if (R.ch < R.chapters.length - 1) goTo(R.ch + 1, 0); else toast('You’ve reached the end'); }
function prev() { if (mode() === 'scroll') return; if (R.page > 0) { R.page--; applyPage(); } else if (R.ch > 0) goTo(R.ch - 1, 1); }
function overallPercent() { const b = R.book; let before = 0; for (let i = 0; i < R.ch; i++) before += b.chWeights[i]; return Math.min(1, (before + ratioNow() * b.chWeights[R.ch]) / b.chars); }
function updateStatus() {
  const c = R.chapters[R.ch]; const p = overallPercent();
  $('#rs-ch').textContent = c.title;
  $('#rs-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const left = minutesFor(R.book.chars * (1 - p), R.book.cjk);
  $('#rs-page').textContent = mode() === 'scroll' ? Math.round(ratioNow() * 100) + '% of chapter' : `${R.page + 1} / ${R.pages}`;
  $('#rs-pct').textContent = `${Math.round(p * 100)}% · ${left} min left`;
  $('#rb-title').textContent = R.book.title; $('#rb-ch').textContent = c.title;
  $('#rprog').value = Math.round(p * 1000); $('#rprog-pct').textContent = Math.round(p * 100) + '%';
  const bm = (R.book.bookmarks || []).some(m => m.ch === R.ch && Math.abs(m.ratio - ratioNow()) < 0.02);
  $('#btn-bookmark').classList.toggle('is-on', bm); $('#btn-bookmark svg').style.fill = bm ? 'currentColor' : 'none';
}
let saveTimer = 0;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { const b = R.book; if (!b) return; b.progress = { ch: R.ch, ratio: ratioNow() }; b.lastRead = now(); b.curTitle = R.chapters[R.ch].title; saveMeta(); }, 300); }
function renderTOC() {
  const b = R.book; $('#toc-title').textContent = b.title; $('#toc-sub').textContent = `${R.chapters.length} chapters · ${minutesFor(b.chars, b.cjk)} min`;
  $('#toc-list').innerHTML = R.chapters.map((c, i) => `<li><button data-ch="${i}" class="${i === R.ch ? 'is-cur' : ''}"><span style="color:inherit;font-size:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title)}</span><span>${minutesFor(b.chWeights[i], b.cjk)} min</span></button></li>`).join('');
}
const panelsOpen = () => $('#panel-toc').classList.contains('is-open') || $('#panel-settings').classList.contains('is-open');
function closePanels() { $('#panel-toc').classList.remove('is-open'); $('#panel-settings').classList.remove('is-open'); }
function setChrome(on) { R.el.classList.toggle('chrome-on', on); if (!on) closePanels(); }
function showHint(msg) { const h = $('#hint'); h.textContent = msg; h.classList.add('is-on'); setTimeout(() => h.classList.remove('is-on'), 2800); }
async function wakeLock(on) { try { if (on) R.lock = await navigator.wakeLock.request('screen'); else if (R.lock) { await R.lock.release(); R.lock = null; } } catch (e) {} }

async function openBook(id) {
  const b = state.books.find(x => x.id === id); if (!b) return;
  const chapters = await getChapters(b);
  if (!chapters) { toast('This book’s content is no longer on this device'); return; }
  R.book = b; R.chapters = chapters; applySettings(); setChrome(false);
  R.el.classList.add('is-active'); $('#fab').classList.add('hidden-fab');
  requestAnimationFrame(() => {
    goTo(b.progress.ch || 0, b.progress.ratio || 0, true);
    if (!S.seenHint) { showHint('Tap the centre for controls · tap the edges to turn'); S.seenHint = true; saveSettings(); }
  });
  wakeLock(true);
}
function closeReader() {
  if (!R.book) return;
  clearTimeout(saveTimer); const b = R.book; b.progress = { ch: R.ch, ratio: ratioNow() }; b.lastRead = now(); b.curTitle = R.chapters[R.ch].title; saveMeta();
  R.el.classList.remove('is-active'); closePanels(); $('#fab').classList.remove('hidden-fab');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  wakeLock(false); R.book = null; renderAll();
}
function relayout() { if (!R.book) return; const r = ratioNow(); if (mode() === 'scroll') { layout(); R.vp.scrollTop = r * (R.vp.scrollHeight - R.vp.clientHeight); } else { layout(); R.page = Math.min(R.pages - 1, Math.round(r * (R.pages - 1))); applyPage(false); } }
function seekTo(p) {
  const b = R.book; let target = p * b.chars, ch = 0;
  while (ch < b.chWeights.length - 1 && target > b.chWeights[ch]) { target -= b.chWeights[ch]; ch++; }
  goTo(ch, b.chWeights[ch] ? Math.max(0, Math.min(1, target / b.chWeights[ch])) : 0, true);
}

// pointer handling on the page: taps turn pages or toggle chrome, swipes turn pages
let pd = null;
R.vp.addEventListener('pointerdown', e => { pd = { x: e.clientX, y: e.clientY, t: now() }; });
R.vp.addEventListener('pointercancel', () => { pd = null; });
R.vp.addEventListener('pointerup', e => {
  if (!pd) return; const dx = e.clientX - pd.x, dy = e.clientY - pd.y, dt = now() - pd.t; pd = null;
  if (e.target.closest('button')) return;
  if (panelsOpen()) { closePanels(); return; }
  if (mode() === 'flip' && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { dx < 0 ? next() : prev(); return; }
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 500) {
    if (R.el.classList.contains('chrome-on')) { setChrome(false); return; }
    const rect = R.vp.getBoundingClientRect(); const x = (e.clientX - rect.left) / rect.width;
    if (mode() === 'flip' && x < 0.3) prev(); else if (mode() === 'flip' && x > 0.7) next(); else setChrome(true);
  }
});
let scrollTimer = 0;
R.vp.addEventListener('scroll', () => { if (mode() !== 'scroll' || !R.book) return; clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { updateStatus(); scheduleSave(); }, 80); }, { passive: true });
document.addEventListener('keydown', e => {
  if (!R.book) return;
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
  else if (e.key === 'Escape') { if (panelsOpen()) closePanels(); else if (R.el.classList.contains('chrome-on')) setChrome(false); else closeReader(); }
});
$('#rprog').addEventListener('input', e => { $('#rprog-pct').textContent = Math.round(e.target.value / 10) + '%'; });
$('#rprog').addEventListener('change', e => seekTo(e.target.value / 1000));
$('#bright').addEventListener('input', e => { S.bright = +e.target.value; $('#brightness').style.opacity = S.bright / 100; saveSettings(); });
window.addEventListener('resize', () => relayout());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => relayout());
setInterval(() => { if (R.book) $('#rs-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }, 30000);

/* ---------- wi-fi / link simulations ---------- */
let qrDone = false;
function openWifi() {
  openSheet('sheet-wifi');
  if (!qrDone && typeof QRCode !== 'undefined') { try { new QRCode($('#qr'), { text: location.href.split('#')[0], width: 96, height: 96, correctLevel: QRCode.CorrectLevel.L }); qrDone = true; } catch (e) {} }
}
async function simulateWifi() {
  const btn = $('[data-act="wifi-sim"]'); btn.disabled = true; btn.textContent = 'Receiving “course-syllabus.txt”…';
  await new Promise(r => setTimeout(r, 1400));
  await addBook(fakeBook('Course syllabus', 'TXT', 'This book stands in for a file received over Wi-Fi. The demo cannot run a local server inside a web page, so the transfer is simulated.'), currentFolderTarget());
  btn.disabled = false; btn.textContent = 'Simulate a transfer (demo)';
  closeSheets(); renderAll(); toast('Received course-syllabus.txt');
}
async function linkDownload() {
  const url = $('#link-input').value.trim(); if (!url) { $('#link-input').focus(); return; }
  const name = decodeURIComponent((url.split('?')[0].split('/').pop() || 'download')).replace(/\.[^.]+$/, '') || 'Downloaded file';
  const fmt = ((url.split('?')[0].match(/\.([a-z0-9]+)$/i) || [, 'TXT'])[1]).toUpperCase();
  $('#link-progress').classList.remove('hidden'); $('#link-name').textContent = name; $('#link-go').disabled = true;
  const bar = $('#link-bar'), st = $('#link-st');
  for (const [w, s] of [[20, 'Connecting…'], [55, 'Downloading…'], [85, 'Building chapters…'], [100, 'Added']]) { bar.style.width = w + '%'; st.textContent = s; await new Promise(r => setTimeout(r, 450)); }
  await addBook(fakeBook(name, fmt, 'This book stands in for a file downloaded from ' + url + '. The demo page is not allowed to fetch external links, so the download is simulated.'), currentFolderTarget());
  $('#link-go').disabled = false; $('#link-progress').classList.add('hidden'); bar.style.width = '0%'; $('#link-input').value = '';
  closeSheets(); renderAll(); toast('Added ' + name);
}

/* ---------- actions ---------- */
let resetArmed = false;
const actions = {
  'search': () => { show('search'); renderSearch(); },
  'back': () => { show('library'); renderLibrary(); },
  'import': () => { const f = folderOf(currentFolderTarget()); $('#import-lede').textContent = f ? `New files go into “${f.name}”. Nothing is uploaded.` : 'Files stay on this device. Nothing is uploaded.'; resetArmed = false; $('#reset-btn').textContent = 'Reset demo data'; openSheet('sheet-import'); },
  'pick-files': () => { $('#file-input').click(); },
  'wifi': openWifi, 'wifi-sim': simulateWifi,
  'link': () => { openSheet('sheet-link'); setTimeout(() => $('#link-input').focus(), 300); }, 'link-go': linkDownload,
  'new-folder': () => openFolderSheet(null), 'folder-save': saveFolder,
  'folder-menu': () => { const f = folderOf(state.folderId); if (!f) return; $('#fm-title').textContent = f.name; $('#fm-sub').textContent = booksIn(f.id).length + ' books'; openSheet('sheet-folder-menu'); },
  'folder-edit': () => openFolderSheet(folderOf(state.folderId)),
  'folder-delete': () => { const f = folderOf(state.folderId); if (!f) return; state.books.forEach(b => { if (b.folderId === f.id) b.folderId = null; }); state.folders = state.folders.filter(x => x.id !== f.id); saveMeta(); closeSheets(); toast('Folder deleted · books kept'); show('library'); renderLibrary(); },
  'book-delete': async () => { const b = state.books.find(x => x.id === bookSheetId); if (!b) return; if (!deleteArmed) { deleteArmed = true; $('#bs-del-label').textContent = 'Tap again to remove “' + b.title + '”'; return; } state.books = state.books.filter(x => x.id !== b.id); await DB.del(b.id); saveMeta(); closeSheets(); renderAll(); toast('Removed ' + b.title); },
  'close': closeSheets,
  'reset': async () => { if (!resetArmed) { resetArmed = true; $('#reset-btn').textContent = 'Tap again to reset everything'; return; } try { localStorage.removeItem(LS_META); localStorage.removeItem(LS_SET); } catch (e) {} await DB.clear(); Object.assign(S, { theme: 'paper', font: 'serif', size: 18, lh: 1.75, mode: 'flip', bright: 0, seenHint: false }); await seed(); closeSheets(); show('library'); renderAll(); toast('Demo reset'); },
  // reader
  'close-reader': closeReader,
  'toc': () => { const p = $('#panel-toc'); const open = !p.classList.contains('is-open'); closePanels(); p.classList.toggle('is-open', open); if (open) { const cur = $('#toc-list .is-cur'); if (cur) cur.scrollIntoView({ block: 'center' }); } },
  'settings': () => { const p = $('#panel-settings'); const open = !p.classList.contains('is-open'); closePanels(); p.classList.toggle('is-open', open); },
  'night': () => { S.theme = S.theme === 'night' ? 'paper' : 'night'; applySettings(); },
  'fullscreen': () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen().then(() => setChrome(false)).catch(() => toast('Full screen isn’t available in this browser')); },
  'bookmark': () => { const b = R.book; b.bookmarks = b.bookmarks || []; const r = ratioNow(); const i = b.bookmarks.findIndex(m => m.ch === R.ch && Math.abs(m.ratio - r) < 0.02); if (i >= 0) { b.bookmarks.splice(i, 1); toast('Bookmark removed'); } else { b.bookmarks.push({ ch: R.ch, ratio: r, t: now() }); toast('Bookmarked'); } saveMeta(); updateStatus(); },
  'prev-ch': () => { if (R.ch > 0) goTo(R.ch - 1, 0); },
  'next-ch': () => { if (R.ch < R.chapters.length - 1) goTo(R.ch + 1, 0); else toast('This is the last chapter'); },
  'size-': () => { S.size = Math.max(14, S.size - 1); applySettings(); relayout(); },
  'size+': () => { S.size = Math.min(26, S.size + 1); applySettings(); relayout(); },
};

$('#app').addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-open],[data-more],[data-folder],[data-move],[data-ch],[data-theme],[data-font],[data-lh],[data-mode],[data-tint]');
  if (!t) return;
  const d = t.dataset;
  if (d.act && actions[d.act]) { e.preventDefault(); actions[d.act](t); return; }
  if (d.open) { openBook(d.open); return; }
  if (d.more) { openBookSheet(d.more); return; }
  if (d.folder) { showFolder(d.folder); return; }
  if (d.move !== undefined) { const b = state.books.find(x => x.id === bookSheetId); if (b) { b.folderId = d.move || null; saveMeta(); closeSheets(); renderAll(); toast(d.move ? 'Moved to ' + folderOf(d.move).name : 'Moved to Unfiled'); } return; }
  if (d.ch !== undefined) { goTo(+d.ch, 0); closePanels(); return; }
  if (d.theme) { S.theme = d.theme; applySettings(); return; }
  if (d.font) { S.font = d.font; applySettings(); relayout(); return; }
  if (d.lh) { S.lh = +d.lh; applySettings(); relayout(); return; }
  if (d.mode) { const r = ratioNow(); S.mode = d.mode; applySettings(); goTo(R.ch, r, true); return; }
  if (d.tint) { $$('#folder-swatches .swatch').forEach(s => s.classList.toggle('is-on', s === t)); return; }
});
$('#scrim').addEventListener('click', closeSheets);
// overflow:hidden containers can still be scrolled by focus() / scrollIntoView(); pin them
for (const el of [$('#app'), $('#reader')]) el.addEventListener('scroll', () => { el.scrollTop = 0; el.scrollLeft = 0; });
$('#file-input').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) importFiles(files); });
$('#search-input').addEventListener('input', renderSearch);
$('#folder-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveFolder(); });
$('#link-input').addEventListener('keydown', e => { if (e.key === 'Enter') linkDownload(); });
// drag & drop files anywhere on the library (desktop convenience)
document.addEventListener('dragover', e => { e.preventDefault(); });
document.addEventListener('drop', e => { e.preventDefault(); const files = [...(e.dataTransfer?.files || [])]; if (files.length && !R.book) importFiles(files); });

/* ---------- boot ---------- */
load().then(() => { applySettings(); renderLibrary(); show('library'); });
window.Folio = { state, openBook, importFiles, Parsers, DB };
})();
