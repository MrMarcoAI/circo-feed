const data = window.CIRCO || { items: [], sources: [], errors: [] };
// más nuevas primero; ts es la hora de publicación (las noticias antiguas solo traen el día)
const when = i => Date.parse(i.ts || i.day + 'T00:00');
data.items.sort((a, b) => when(b) - when(a));
// versión celular: barra de pestañas abajo (Hoy, Feeds, Guardados, Buscar)
const mq = matchMedia('(max-width: 760px)');
const mobile = () => mq.matches;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('circo:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('circo:' + k, JSON.stringify(v)); } catch {} },
};
const read = new Set(store.get('read', []));
// las guardadas se copian enteras, para que sobrevivan cuando salen de data.js (14 días)
let saved = store.get('saved', []);
const isSaved = id => saved.some(i => i.id === id);
// momento del último cambio de cada noticia (r: leída, s: guardada); sync.js lo usa para mezclar dispositivos
const stamps = store.get('stamps', { r: {}, s: {} });
function setRead(id, value) {
  value ? read.add(id) : read.delete(id);
  stamps.r[id] = Date.now();
}
let view = store.get('view', { type: 'today' });
if (view.type === 'all') view = { type: 'today' }; // la vista "Todo" ya no existe
const markRead = document.getElementById('mark-read');
const hideRead = document.getElementById('hide-read');
hideRead.checked = store.get('hideRead', false);

// en celular las categorías parten cerradas y recuerdan su estado aparte
const openKey = matchMedia('(max-width: 800px)').matches ? 'openMobile' : 'open';
const categories = [...new Set(data.sources.map(s => s.category))];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// fecha local (YYYY-MM-DD) calculada cada vez, para que "Hoy" cambie al pasar la medianoche
const todayISO = () => new Date().toLocaleDateString('en-CA');
const pool = (v = view) => (v.type === 'saved' ? saved : data.items);
const inView = (i, v = view) =>
  (v.type === 'saved' && (!v.cat || i.category === v.cat)) || (v.type === 'today' && i.day === todayISO()) || (v.type === 'cat' && i.category === v.name) || (v.type === 'src' && i.source === v.name);
const unread = v => pool(v).filter(i => inView(i, v) && !read.has(i.id)).length;

function dayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const diff = Math.round((today - d) / 864e5);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function persist() {
  // solo guarda ids que siguen existiendo, para que no crezca para siempre
  const ids = new Set([...data.items, ...saved].map(i => i.id));
  for (const id of read) if (!ids.has(id)) read.delete(id);
  for (const id in stamps.r) if (!ids.has(id)) delete stamps.r[id];
  const old = Date.now() - 60 * 864e5;
  for (const id in stamps.s) if (!isSaved(id) && stamps.s[id] < old) delete stamps.s[id];
  store.set('read', [...read]);
  store.set('saved', saved);
  store.set('stamps', stamps);
}
function saveRead() {
  persist();
  if (typeof scheduleSync === 'function') scheduleSync();
}

// íconos de línea para "Hoy" y "Guardadas", al estilo del sidebar de Claude
const ICONS = {
  today: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  saved: '<svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3.8L7 20z"/></svg>',
};

function navButton(v, label, cls) {
  const n = unread(v);
  const on = view.type === v.type && view.name === v.name;
  return `<button class="${cls}${on ? ' on' : ''}" data-type="${v.type}" data-name="${esc(v.name || '')}">
    <span>${ICONS[v.type] || ''}${esc(label)}</span>${n ? `<span class="count">${n}</span>` : ''}</button>`;
}

function renderNav() {
  const openCats = store.get(openKey, openKey === 'open' ? categories : []);
  let html = navButton({ type: 'today' }, 'Hoy', 'all') + navButton({ type: 'saved' }, 'Guardados', 'all');
  for (const cat of categories) {
    html += `<details data-cat="${esc(cat)}"${openCats.includes(cat) ? ' open' : ''}>
      <summary>${navButton({ type: 'cat', name: cat }, cat, 'cat')}</summary>
      ${data.sources.filter(s => s.category === cat).map(s => navButton({ type: 'src', name: s.name }, s.name, 'src')).join('')}
    </details>`;
  }
  document.getElementById('nav').innerHTML = html;
}

function renderHead() {
  renderNav();
  const n = unread(view);
  markRead.checked = pool().some(i => inView(i)) && n === 0;
  const c = document.querySelector('.m-count');
  if (c) c.textContent = n || '';
}

// marca como leída la noticia que sale por arriba de la pantalla al hacer scroll, como Feedly.
// No vuelve a dibujar el feed (saltaría la página): solo atenúa la tarjeta y actualiza contadores.
let ticking = false;
function checkScrolled() {
  ticking = false;
  // el encabezado fijo (o en tablet, la barra de arriba) tapa el borde superior
  const top = !mobile() && matchMedia('(max-width: 1024px)').matches ? menu.offsetHeight : viewHead.getBoundingClientRect().bottom;
  let changed = false;
  for (const a of document.querySelectorAll('#feed article:not(.read)')) {
    if (a.getBoundingClientRect().bottom > top) continue;
    setRead(a.dataset.id, true);
    a.classList.add('read');
    changed = true;
  }
  if (changed) { saveRead(); renderHead(); }
}
window.addEventListener('scroll', () => {
  if (!ticking) { ticking = true; requestAnimationFrame(checkScrolled); }
}, { passive: true });

const ENDINGS = [
  'Ya leíste todo. Ahora ponte un disco de Fito.',
  'Ya leíste todo. Ahora ponle play a "Mariposa Tecknicolor".',
  'Ya leíste todo. Ahora ponle play a "Circo Beat".',
  'Ya leíste todo. Ahora ponle play a "11 y 6".',
  'Ya leíste todo. Ahora ponle play a "Al lado del camino".',
  'Ya leíste todo. Ahora ponle play a "El amor después del amor".',
  'Ya leíste todo. Ahora ponle play a "Ciudad de pobres corazones".',
  'Ya leíste todo. Ahora ponle play a "Dar es dar".',
  'Ya leíste todo. Ahora ponle play a "Brillante sobre el mic".',
  'Ya leíste todo. Ahora ponle play a "Tumbas de la gloria".',
  'Ya leíste todo. Ahora ponle play a "Yo vengo a ofrecer mi corazón".',
  'Ya leíste todo. Ahora ponle play a "A rodar mi vida".',
  'Ya leíste todo. Ahora ponle play a "Un vestido y un amor".',
];

function render() {
  document.getElementById('updated').textContent = data.updated
    ? 'Actualizado ' + new Date(data.updated).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Sin datos todavía';
  document.getElementById('errors').textContent = data.errors.length
    ? 'No se pudo leer: ' + data.errors.map(e => e.url).join(', ')
    : '';
  if (!mobile()) {
    document.body.classList.remove('m-settings');
    if (view.type === 'search') view = { type: 'today' };
  }
  renderMobile();
}

// Transiciones: View Transitions API. El tipo (swap, open, close) elige la animación en style.css
const canVT = () => document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
function withVT(kind, fn) {
  if (!canVT()) { fn(); return null; }
  document.documentElement.dataset.vt = kind;
  const t = document.startViewTransition(fn);
  t.finished.finally(() => { if (document.documentElement.dataset.vt === kind) delete document.documentElement.dataset.vt; });
  return t;
}

function setView(v, animate = true) {
  view = v;
  store.set('view', view);
  if (v.type === 'cat' || v.type === 'src') store.set('feedView', v);
  setMenu(false);
  const draw = () => {
    window.scrollTo(0, 0); // antes de dibujar, para que el scroll no marque como leído lo de arriba
    render();
  };
  return animate ? withVT('swap', draw) : draw();
}

document.getElementById('nav').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  e.preventDefault(); // en el summary, el botón cambia la vista sin abrir/cerrar la categoría
  setView(['today', 'saved'].includes(b.dataset.type) ? { type: b.dataset.type } : { type: b.dataset.type, name: b.dataset.name });
});
document.getElementById('nav').addEventListener('toggle', e => {
  const open = [...document.querySelectorAll('#nav details[open]')].map(d => d.dataset.cat);
  store.set(openKey, open);
}, true);
document.querySelector('.logo').onclick = e => { e.preventDefault(); setView({ type: 'today' }); };

const menu = document.getElementById('menu');
const burger = document.getElementById('burger');
function setMenu(open) {
  menu.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', open);
  burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
}
burger.onclick = () => setMenu(!menu.classList.contains('open'));

// al volver a la pestaña: si pasaron más de 30 minutos se recarga para traer data.js nuevo;
// si no, se vuelve a dibujar por si cambió el día
const loadedAt = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - loadedAt > 30 * 60e3) location.reload();
  else render();
});

document.getElementById('feed').addEventListener('click', e => {
  const group = e.target.closest('[data-src]');
  if (group) return setView({ type: 'src', name: group.dataset.src });
  const add = e.target.closest('[data-add]');
  if (add) return addFeed(sites[+add.dataset.add], add.previousElementSibling.value, add.parentNode);
  const a = e.target.closest('a');
  if (!a) return;
  const id = a.closest('article').dataset.id;
  if (e.metaKey || e.ctrlKey || e.shiftKey) { // cmd/ctrl-clic sigue abriendo la nota original
    setRead(id, true);
    saveRead();
    setTimeout(render, 300);
    return;
  }
  e.preventDefault();
  openReader(findItem(id));
});

// Lightbox de lectura: muestra el texto completo guardado en articles/<clave>.json (o el video de YouTube)
const reader = document.getElementById('reader');
const readerBody = document.getElementById('reader-body');
const readerBar = document.getElementById('reader-bar');
let readingId = null, readingItem = null, readerDirty = false, pendingView = null;
async function openReader(i) {
  readingId = i.id;
  readingItem = i;
  const card = document.querySelector(`#feed article[data-id="${CSS.escape(i.id)}"]`);

  const yt = i.link.match(/youtube\.com\/watch\?v=([\w-]{11})/);
  const media = yt
    ? `<div class="reader-video"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
    : i.image ? `<img class="reader-img" src="${esc(i.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  const fallback = i.excerpt ? `<p>${esc(i.excerpt)}</p>` : '';
  const show = () => {
  setRead(i.id, true);
  saveRead();
  if (card) card.classList.add('read');
  renderHead();
  // la foto va arriba a todo el ancho (style.css la pone primero) y el origen se muestra en chips
  readerBody.innerHTML = `<h1><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></h1>${media}
    <div class="reader-chips">
      <button class="chip" data-go="${esc(JSON.stringify({ type: 'src', name: i.source }))}">${fav(i)}<span>${esc(i.source)}</span>${CHEV_R}</button>
      <button class="chip" data-go="${esc(JSON.stringify({ type: 'cat', name: i.category }))}">${catIcon(i.category)}<span>${esc(i.category)}</span>${CHEV_R}</button>
    </div>
    <p class="reader-date">${new Date(i.ts || i.day + 'T12:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <div class="reader-text">${i.article ? '<p class="reader-loading">Cargando…</p>' : fallback}</div>`;
  readerBar.innerHTML = `<button class="r-save glass${isSaved(i.id) ? ' on' : ''}" aria-label="Guardar">${ICONS.saved}</button>
    <a class="r-open glass" href="${esc(i.link)}" target="_blank" rel="noopener">${yt ? 'Ver en YouTube' : 'Leer en ' + esc(i.source)}${ICON_OUT}</a>`;
  if (reader.hidden) history.pushState({ reader: true }, '');
  reader.hidden = false;
  reader.scrollTop = 0;
  document.body.classList.add('reading');
  };
  // la foto de la tarjeta se transforma en la foto del lector
  const thumb = reader.hidden && card?.querySelector('a > img');
  if (thumb) thumb.style.viewTransitionName = 'reader-img';
  const t = withVT('open', () => {
    if (thumb) thumb.style.viewTransitionName = '';
    show();
    const big = readerBody.querySelector('.reader-img');
    if (big && thumb) big.style.viewTransitionName = 'reader-img';
  });
  if (t) {
    t.finished.finally(() => { const big = readerBody.querySelector('.reader-img'); if (big) big.style.viewTransitionName = ''; });
    await t.updateCallbackDone.catch(() => {});
  } else if (thumb) thumb.style.viewTransitionName = '';

  if (!i.article) return;
  let text;
  try {
    const res = await fetch('articles/' + i.article + '.json');
    if (!res.ok) throw new Error(res.status);
    text = (await res.json()).html;
  } catch { text = fallback; }
  if (readingId !== i.id) return;
  const box = readerBody.querySelector('.reader-text');
  box.innerHTML = text;
  // la foto principal ya va arriba
  box.querySelectorAll('img').forEach(img => { if (img.src === i.image) (img.closest('figure') || img).remove(); });
  box.querySelectorAll('img').forEach(img => { img.referrerPolicy = 'no-referrer'; img.onerror = () => img.remove(); });
}
function closeReader() {
  if (reader.hidden) return;
  const id = readingId;
  const big = readerBody.querySelector('.reader-img');
  const morph = big && big.getBoundingClientRect().bottom > 0 && !pendingView;
  if (morph) big.style.viewTransitionName = 'reader-img';
  let thumb = null;
  const t = withVT('close', () => {
    reader.hidden = true;
    readerBody.innerHTML = ''; // corta el video si estaba sonando
    readingId = readingItem = null;
    document.body.classList.remove('reading');
    if (pendingView) { const v = pendingView; pendingView = null; dropOpen = false; setView(v, false); return; }
    if (hideRead.checked || readerDirty) render();
    readerDirty = false;
    thumb = morph && document.querySelector(`#feed article[data-id="${CSS.escape(id)}"] a > img`);
    if (thumb) thumb.style.viewTransitionName = 'reader-img';
  });
  t?.finished.finally(() => { if (thumb) thumb.style.viewTransitionName = ''; });
}
readerBody.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (!go) return;
  pendingView = JSON.parse(go.dataset.go);
  history.back();
});
readerBar.addEventListener('click', e => {
  const b = e.target.closest('.r-save');
  if (!b || !readingItem) return;
  const id = readingItem.id;
  saved = isSaved(id) ? saved.filter(i => i.id !== id) : [readingItem, ...saved];
  stamps.s[id] = Date.now();
  saveRead();
  b.classList.toggle('on', isSaved(id));
  readerDirty = true;
});
// cerrar con la X, tocando fuera del recuadro, con Esc o con el botón "atrás"
document.getElementById('reader-close').onclick = () => history.back();
reader.addEventListener('click', e => { if (e.target === reader) history.back(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !reader.hidden) history.back(); });
window.addEventListener('popstate', closeReader);
markRead.onchange = () => {
  pool().filter(i => inView(i)).forEach(i => setRead(i.id, markRead.checked));
  saveRead();
  render();
};
hideRead.onchange = () => { store.set('hideRead', hideRead.checked); render(); };

// ───────── Vistas (celular y escritorio) ─────────
const viewHead = document.getElementById('view-head');
const feedEl = document.getElementById('feed');
const findItem = id => data.items.find(i => i.id === id) || saved.find(i => i.id === id);
const host = url => { try { return new URL(url).hostname; } catch { return ''; } };
const favUrl = url => `https://www.google.com/s2/favicons?domain=${host(url)}&sz=64`;
const fav = i => `<img class="fav" src="${favUrl(i.link)}" alt="" loading="lazy" onerror="this.remove()">`;
const srcCat = name => (data.sources.find(s => s.name === name) || {}).category;
const svg = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
const CAT_ICONS = {
  'Mundo Apple': '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  'Tech + la IA': '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  'Publi': '<path d="M4 10v4h3l7 4V6l-7 4z"/><path d="M17.5 9a4 4 0 0 1 0 6"/>',
  'La pelotita': '<circle cx="12" cy="12" r="8"/><path d="M12 8.5l3.3 2.4-1.2 3.9h-4.2l-1.2-3.9z"/>',
  'Notis': '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 12h8M8 15h5"/>',
};
const catIcon = c => svg(CAT_ICONS[c] || '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>');
const CHEV_D = '<svg class="chev" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5"/></svg>';
const CHEV_R = '<svg class="chev" viewBox="0 0 24 24"><path d="M10 7l5 5-5 5"/></svg>';
const ICON_OUT = '<svg class="out" viewBox="0 0 24 24"><path d="M9 6h9v9M18 6L6 18"/></svg>';
const GEAR = svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>');
const CHECK = '<svg class="check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
let dropOpen = false, query = '', sites = null;

function ago(i) {
  if (i.ts) {
    const m = Math.round((Date.now() - Date.parse(i.ts)) / 6e4);
    if (m < 1) return 'ahora';
    if (m < 60) return `hace ${m} minuto${m > 1 ? 's' : ''}`;
    const h = Math.floor(m / 60);
    if (h < 24) return `hace ${h} hora${h > 1 ? 's' : ''}`;
  }
  const label = dayLabel(i.day);
  return label.length > 4 ? new Date(i.day + 'T12:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : label;
}

const tabOf = v => (v.type === 'cat' || v.type === 'src' ? 'feeds' : v.type);
const meta = i => `<p class="row-meta">${fav(i)}<span>${esc(i.source)}</span><i></i>${ago(i)}</p>`;
const thumb = i => i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
const row = i => `<article class="row${read.has(i.id) ? ' read' : ''}" data-id="${esc(i.id)}">
  <a href="${esc(i.link)}" target="_blank" rel="noopener"><div><h3>${esc(i.title)}</h3>${meta(i)}</div>${thumb(i)}</a></article>`;
const hero = i => `<article class="hero${read.has(i.id) ? ' read' : ''}${i.image ? '' : ' no-img'}" data-id="${esc(i.id)}">
  <a href="${esc(i.link)}" target="_blank" rel="noopener">${thumb(i)}
  <div class="hero-text"><h3>${esc(i.title)}</h3>${i.excerpt ? `<p>${esc(i.excerpt)}</p>` : ''}${meta(i)}</div></a></article>`;
const chip = (label, attrs, on, icon = '') =>
  `<button class="chip glass${on ? ' on' : ''}" ${attrs}>${icon}<span>${label}</span>${on && attrs.startsWith('data-cat') && tabOf(view) === 'feeds' ? CHEV_D : ''}</button>`;
const viewAttr = v => `data-view="${esc(JSON.stringify(v))}"`;

// menú de portales de la categoría
function dropHTML(cat) {
  const opts = [{ type: 'cat', name: cat, label: 'Todas' }, ...data.sources.filter(s => s.category === cat).map(s => ({ type: 'src', name: s.name, label: s.name }))];
  return '<div class="m-drop glass">' + opts.map(o => {
    const v = { type: o.type, name: o.name }, k = unread(v);
    return `<button ${viewAttr(v)}>${view.type === o.type && view.name === o.name ? CHECK : '<i></i>'}<span>${esc(o.label)}</span>${k ? `<b>${k}</b>` : ''}</button>`;
  }).join('') + '</div>';
}
// los globos (menú de portales, ajustes) salen con animación antes de quitarse
function closeDrop() {
  dropOpen = false;
  viewHead.classList.remove('drop-open');
  const d = viewHead.querySelector('.m-drop:not(.out)');
  if (!d) return;
  d.classList.add('out');
  setTimeout(() => d.remove(), 220);
}
function settings(open) {
  const b = document.body;
  if (open) { b.classList.remove('m-settings-out'); b.classList.add('m-settings'); return; }
  if (!b.classList.contains('m-settings') || b.classList.contains('m-settings-out')) return;
  b.classList.add('m-settings-out');
  setTimeout(() => b.classList.remove('m-settings', 'm-settings-out'), 220);
}
// la cápsula de la pestaña activa se desliza entre pestañas
function placePill() {
  const on = document.querySelector('#tabbar button.on'), pill = document.querySelector('.tab-pill');
  if (!on || !pill || !on.offsetWidth) return;
  const first = !pill.style.width; // al cargar aparece en su lugar, sin deslizarse
  if (first) pill.style.transition = 'none';
  pill.style.width = on.offsetWidth + 'px';
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
  if (first) { pill.offsetWidth; pill.style.transition = ''; }
}
addEventListener('resize', placePill);

function renderMobile() {
  renderHead(); // barra lateral y "Marcar como leído"
  const tab = tabOf(view);
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  placePill();
  // en escritorio la barra lateral elige categoría o portal: el título es su nombre y no hay chips de feeds
  const title = tab === 'feeds' && !mobile() ? esc(view.name) : { today: 'Hoy', feeds: 'Feeds', saved: 'Guardados', search: 'Buscar' }[tab];
  const n = unread(view);
  let head = `<div class="m-top"><h1>${title}</h1>${tab === 'today' || tab === 'feeds' ? `<span class="m-count">${n || ''}</span>` : ''}
    <button class="m-gear glass" aria-label="Ajustes">${GEAR}</button></div>`;
  const cat = view.type === 'cat' ? view.name : srcCat(view.name);
  if (tab === 'feeds' && mobile()) {
    // con un portal elegido, su chip muestra el nombre del portal
    head += '<div class="chips">' + categories.map(c => chip(esc(c === cat && view.type === 'src' ? view.name : c), `data-cat="${esc(c)}"`, c === cat, catIcon(c))).join('') + '</div>';
    if (dropOpen) head += dropHTML(cat);
  }
  if (tab === 'saved') {
    const cats = categories.filter(c => saved.some(i => i.category === c));
    if (cats.length > 1) head += '<div class="chips">' + chip('Todas', 'data-cat=""', !view.cat)
      + cats.map(c => chip(esc(c), `data-cat="${esc(c)}"`, view.cat === c, catIcon(c))).join('') + '</div>';
  }
  if (tab === 'search') head += `<form class="m-search glass"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
    <input type="search" placeholder="Busca noticias o pega el link de un sitio" value="${esc(query)}" enterkeyhint="search" autocapitalize="off" autocorrect="off"></form>`;
  // al redibujar, la fila de chips mantiene su scroll horizontal
  const x = viewHead.querySelector('.chips')?.scrollLeft || 0;
  viewHead.innerHTML = head;
  viewHead.classList.toggle('drop-open', dropOpen && tab === 'feeds');
  const chips = viewHead.querySelector('.chips');
  if (chips) chips.scrollLeft = x || (chips.querySelector('.on')?.offsetLeft || 0) - 16;
  if (tab === 'search') return renderSearch();

  const items = pool().filter(i => inView(i) && !(hideRead.checked && read.has(i.id)));
  let html = '';
  if (!items.length) {
    html = tab === 'saved' && !saved.length
      ? '<p class="empty">Aún no guardas nada. Abre una noticia y toca el marcador para guardarla.</p>'
      : tab === 'today' && !pool().some(i => inView(i))
        ? '<p class="empty">Todavía no hay noticias de hoy. Pon un disco de Fito.</p>'
        : '<p class="empty">Nada por leer. Pon un disco de Fito.</p>';
  } else if (tab === 'today') {
    html = hero(items[0]) + items.slice(1).map(row).join('');
  } else if (view.type === 'cat') {
    // vista "Todas": separada por portal
    const names = [...new Set([...data.sources.filter(s => s.category === view.name).map(s => s.name), ...items.map(i => i.source)])];
    for (const name of names) {
      const list = items.filter(i => i.source === name);
      if (list.length) html += `<h2 class="m-group"><button data-src="${esc(name)}">${esc(name)}${CHEV_R}</button></h2>` + list.map(row).join('');
    }
  } else {
    html = items.map(row).join('');
  }
  feedEl.innerHTML = html;
  document.getElementById('end').innerHTML = items.length
    ? `<p>${ENDINGS[Math.floor(Math.random() * ENDINGS.length)]}</p>` : '';
}

// Buscar: filtra las noticias y, si se escribe un dominio, busca sus feeds para agregarlos
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isSite = s => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s.trim());
const bare = u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
function renderSearch() {
  const q = norm(query.trim());
  document.getElementById('end').innerHTML = '';
  if (!q) {
    feedEl.innerHTML = '<p class="m-hint">Busca entre todas las noticias, o pega el link de un sitio (por ejemplo xataka.com) y toca Buscar en el teclado para agregarlo a tus feeds.</p>';
    return;
  }
  let html = '';
  if (isSite(query)) {
    const known = data.sources.map(s => bare(s.feed));
    html += '<section class="m-sites">' + (sites === null ? '<p class="m-hint">Toca Buscar en el teclado para encontrar los feeds de este sitio.</p>'
      : sites === 'loading' ? '<p class="m-hint">Buscando feeds…</p>'
      : !sites.length ? '<p class="m-hint">No encontré feeds en ese sitio.</p>'
      : '<h2 class="m-group">Feeds del sitio</h2>' + sites.map((s, k) => `<div class="site">
          <img class="fav" src="${esc(s.favicon || favUrl(s.site_url || s.url))}" alt="" onerror="this.remove()">
          <div class="site-name"><b>${esc(s.title || host(s.url))}</b><small>${esc(bare(s.url))}</small></div>
          ${known.includes(bare(s.url)) ? '<span class="site-in">Ya está</span>'
            : `<div class="site-add"><select aria-label="Categoría">${categories.map(c => `<option>${esc(c)}</option>`).join('')}</select><button data-add="${k}">Agregar</button></div>`}
        </div>`).join('')) + '</section>';
  }
  const seen = new Set();
  const hits = [...data.items, ...saved].filter(i => !seen.has(i.id) && seen.add(i.id))
    .filter(i => norm(`${i.title} ${i.excerpt} ${i.source}`).includes(q)).slice(0, 60);
  html += hits.length ? '<h2 class="m-group">Noticias</h2>' + hits.map(row).join('') : '<p class="m-hint">Sin noticias que coincidan.</p>';
  feedEl.innerHTML = html;
}
viewHead.addEventListener('input', e => { query = e.target.value; sites = null; renderSearch(); });
viewHead.addEventListener('submit', async e => {
  e.preventDefault();
  e.target.querySelector('input').blur();
  const q = query.trim();
  if (!isSite(q)) return;
  sites = 'loading';
  renderSearch();
  let found = [];
  try {
    // o= evita que su caché devuelva el permiso CORS de otro sitio
    const res = await fetch('https://feedsearch.dev/api/v1/search?info=true&url=' + encodeURIComponent(q) + '&o=' + location.host);
    const json = res.ok ? await res.json() : [];
    found = Array.isArray(json) ? json.slice(0, 6) : [];
  } catch {}
  if (query.trim() !== q) return;
  sites = found;
  renderSearch();
});

// Agregar un feed escribe la línea en feeds.txt del repo (con el token del dispositivo) y lanza la actualización
const REPO = 'https://api.github.com/repos/MrMarcoAI/circo-feed';
const fromB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));
const toB64 = s => btoa(Array.from(new TextEncoder().encode(s), c => String.fromCharCode(c)).join(''));
async function gh(path, options = {}) {
  const res = await fetch(REPO + path, {
    ...options, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + store.get('token', ''), Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(res.status);
  return res.status === 204 ? null : res.json();
}
async function addFeed(s, cat, box) {
  const name = (s.title || host(s.url)).replace(/[|\n]/g, ' ').trim();
  const line = `${s.url} | ${name}`;
  box.innerHTML = '<span class="site-in">Agregando…</span>';
  try {
    if (!store.get('token')) throw new Error('token');
    const file = await gh('/contents/feeds.txt');
    const lines = fromB64(file.content).split('\n');
    if (lines.some(l => bare(l.split('|')[0].trim()) === bare(s.url))) { box.innerHTML = '<span class="site-in">Ya está</span>'; return; }
    const at = lines.findIndex(l => l.trim() === `[${cat}]`);
    let j = at + 1;
    while (j < lines.length && !lines[j].trim().startsWith('[')) j++;
    while (j > at + 1 && !lines[j - 1].trim()) j--;
    lines.splice(j, 0, line);
    await gh('/contents/feeds.txt', { method: 'PUT', body: JSON.stringify({ message: `CIRCO FEED: agrega ${name}`, content: toB64(lines.join('\n')), sha: file.sha }) });
    let now = true;
    try { await gh('/actions/workflows/circo-feed.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) }); } catch { now = false; }
    box.innerHTML = `<span class="site-in">Agregado a ${esc(cat)}. ${now ? 'Sus noticias llegan en unos minutos.' : 'Sus noticias llegan en la próxima actualización.'}</span>`;
  } catch {
    box.innerHTML = `<p class="site-manual">Para agregarlo desde aquí, el token de GitHub de este dispositivo necesita permiso para editar el repo. Mientras, agrega esta línea bajo <b>[${esc(cat)}]</b>:
      <code>${esc(line)}</code><a href="https://github.com/MrMarcoAI/circo-feed/edit/main/feeds.txt" target="_blank" rel="noopener">Abrir feeds.txt en GitHub</a></p>`;
  }
}

viewHead.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.classList.contains('m-gear')) return settings(!document.body.classList.contains('m-settings') || document.body.classList.contains('m-settings-out'));
  if (b.dataset.view) { dropOpen = false; return setView(JSON.parse(b.dataset.view)); }
  if (b.dataset.cat === undefined) return;
  if (tabOf(view) === 'saved') return setView({ type: 'saved', cat: b.dataset.cat || undefined });
  // tocar una categoría la abre y despliega sus portales; tocarla de nuevo cierra o abre el menú
  if (b.classList.contains('on')) {
    if (dropOpen) return closeDrop();
    dropOpen = true;
    viewHead.classList.add('drop-open');
    viewHead.querySelector('.m-drop')?.remove();
    return viewHead.insertAdjacentHTML('beforeend', dropHTML(b.dataset.cat));
  }
  dropOpen = true;
  setView({ type: 'cat', name: b.dataset.cat });
});
// tocar fuera cierra el menú de portales y los ajustes
document.addEventListener('click', e => {
  if (dropOpen && !e.target.closest('.m-drop, .chip')) closeDrop();
  if (!e.target.closest('#menu, .m-gear')) settings(false);
});
document.getElementById('tabbar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  dropOpen = false;
  const tab = b.dataset.tab;
  if (tab === tabOf(view)) return window.scrollTo({ top: 0, behavior: 'smooth' });
  let fv = store.get('feedView', null);
  if (!fv || !categories.includes(fv.type === 'cat' ? fv.name : srcCat(fv.name))) fv = { type: 'cat', name: categories[0] };
  const t = setView(tab === 'feeds' ? fv : { type: tab });
  if (tab === 'search') (t ? t.updateCallbackDone : Promise.resolve()).then(() => viewHead.querySelector('input')?.focus());
});
mq.addEventListener('change', render);

render();
