const data = window.CIRCO || { items: [], sources: [], errors: [] };
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
// extracto de máximo 140 caracteres, siempre terminado en "..."
const short = s => (s.length > 137 ? s.slice(0, 137).replace(/\s+\S*$/, '') : s).replace(/[\s.,;:…!?-]+$/, '') + '...';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// fecha local (YYYY-MM-DD) calculada cada vez, para que "Hoy" cambie al pasar la medianoche
const todayISO = () => new Date().toLocaleDateString('en-CA');
const pool = (v = view) => (v.type === 'saved' ? saved : data.items);
const inView = (i, v = view) =>
  v.type === 'saved' || (v.type === 'today' && i.day === todayISO()) || (v.type === 'cat' && i.category === v.name) || (v.type === 'src' && i.source === v.name);
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

function navButton(v, label, cls) {
  const n = unread(v);
  const on = view.type === v.type && view.name === v.name;
  return `<button class="${cls}${on ? ' on' : ''}" data-type="${v.type}" data-name="${esc(v.name || '')}">
    <span>${esc(label)}</span>${n ? `<span class="count">${n}</span>` : ''}</button>`;
}

function renderNav() {
  const openCats = store.get(openKey, openKey === 'open' ? categories : []);
  let html = navButton({ type: 'today' }, 'Hoy', 'all') + navButton({ type: 'saved' }, 'Guardadas', 'all');
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
  const title = view.type === 'saved' ? 'Guardadas' : view.type === 'today' ? 'Hoy' : view.name;
  document.getElementById('view-head').innerHTML = `<h1>${esc(title)}</h1>`;
}

// marca como leída la noticia que sale por arriba de la pantalla al hacer scroll, como Feedly.
// No vuelve a dibujar el feed (saltaría la página): solo atenúa la tarjeta y actualiza contadores.
let ticking = false;
function checkScrolled() {
  ticking = false;
  const top = matchMedia('(max-width: 1024px)').matches ? menu.offsetHeight : 0; // la barra fija tapa el borde
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
  renderHead();

  const all = pool().filter(i => inView(i));

  const items = all.filter(i => !(hideRead.checked && read.has(i.id)));
  const feed = document.getElementById('feed');
  if (!items.length) {
    feed.innerHTML = view.type === 'saved' && !saved.length
      ? '<p class="empty">Aún no guardas nada. Toca el marcador de una noticia para guardarla.</p>'
      : view.type === 'today' && !all.length
        ? '<p class="empty">Todavía no hay noticias de hoy. Pon un disco de Fito.</p>'
        : '<p class="empty">Nada por leer. Pon un disco de Fito.</p>';
  } else {
    let html = '', day = null;
    for (const i of items) {
      if (!['saved', 'today'].includes(view.type) && i.day !== day) { day = i.day; html += `<h2>${dayLabel(day)}</h2>`; }
      html += `<article class="${read.has(i.id) ? 'read' : ''}${i.image ? '' : ' no-img'}" data-id="${esc(i.id)}">
        <div>
          <div class="meta"><span><b>${esc(i.source)}</b> · ${esc(i.category)}</span>
            <button class="save${isSaved(i.id) ? ' on' : ''}" title="${isSaved(i.id) ? 'Quitar de guardadas' : 'Guardar'}" aria-label="Guardar">
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg></button></div>
          <h3><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
          ${i.excerpt ? `<p>${esc(short(i.excerpt))}</p>` : ''}
        </div>
        ${i.image ? `<a class="thumb" href="${esc(i.link)}" target="_blank" rel="noopener" tabindex="-1">
          <img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('article').classList.add('no-img');this.parentNode.remove()"></a>` : ''}
      </article>`;
    }
    feed.innerHTML = html;
  }

  // espacio final de una pantalla de alto, para que la última fila también pueda salir por arriba
  document.getElementById('end').innerHTML = items.length
    ? `<p>${ENDINGS[Math.floor(Math.random() * ENDINGS.length)]}</p>` : '';

  document.getElementById('errors').textContent = data.errors.length
    ? 'No se pudo leer: ' + data.errors.map(e => e.url).join(', ')
    : '';
}

function setView(v) {
  view = v;
  store.set('view', view);
  setMenu(false);
  window.scrollTo(0, 0); // antes de dibujar, para que el scroll no marque como leído lo de arriba
  render();
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
  const save = e.target.closest('.save');
  if (save) {
    const id = save.closest('article').dataset.id;
    const item = pool().find(i => i.id === id);
    saved = isSaved(id) ? saved.filter(i => i.id !== id) : [item, ...saved];
    stamps.s[id] = Date.now();
    saveRead();
    render();
    return;
  }
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
  openReader(pool().find(i => i.id === id));
});

// Lightbox de lectura: muestra el texto completo guardado en articles/<clave>.json (o el video de YouTube)
const reader = document.getElementById('reader');
const readerBody = document.getElementById('reader-body');
let readingId = null;
async function openReader(i) {
  readingId = i.id;
  setRead(i.id, true);
  saveRead();
  const card = document.querySelector(`#feed article[data-id="${CSS.escape(i.id)}"]`);
  if (card) card.classList.add('read');
  renderHead();

  const yt = i.link.match(/youtube\.com\/watch\?v=([\w-]{11})/);
  const media = yt
    ? `<div class="reader-video"><iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
    : i.image ? `<img class="reader-img" src="${esc(i.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  const fallback = i.excerpt ? `<p>${esc(i.excerpt)}</p>` : '';
  readerBody.innerHTML = `<p class="reader-meta"><b>${esc(i.source)}</b> · ${esc(i.category)}</p>
    <h1>${esc(i.title)}</h1>${media}
    <div class="reader-text">${i.article ? '<p class="reader-loading">Cargando…</p>' : fallback}</div>
    <a class="reader-link" href="${esc(i.link)}" target="_blank" rel="noopener">${yt ? 'Ver en YouTube' : 'Leer en ' + esc(i.source)} →</a>`;
  if (reader.hidden) history.pushState({ reader: true }, '');
  reader.hidden = false;
  reader.scrollTop = 0;
  document.body.classList.add('reading');

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
  reader.hidden = true;
  readerBody.innerHTML = ''; // corta el video si estaba sonando
  readingId = null;
  document.body.classList.remove('reading');
  if (hideRead.checked) render();
}
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

render();
