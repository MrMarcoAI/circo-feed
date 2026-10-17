const data = window.CIRCO || { items: [], sources: [], errors: [] };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('circo:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('circo:' + k, JSON.stringify(v)); } catch {} },
};
const read = new Set(store.get('read', []));
// las guardadas se copian enteras, para que sobrevivan cuando salen de data.js (14 días)
let saved = store.get('saved', []);
const isSaved = id => saved.some(i => i.id === id);
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

function saveRead() {
  // solo guarda ids que siguen existiendo, para que no crezca para siempre
  const ids = new Set([...data.items, ...saved].map(i => i.id));
  store.set('read', [...read].filter(id => ids.has(id)));
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

function render() {
  document.getElementById('updated').textContent = data.updated
    ? 'Actualizado ' + new Date(data.updated).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Sin datos todavía';
  renderNav();

  const all = pool().filter(i => inView(i));
  const n = unread(view);
  markRead.checked = all.length > 0 && n === 0;
  const title = view.type === 'saved' ? 'Guardadas' : view.type === 'today' ? 'Hoy' : view.name;
  const kicker = view.type === 'src' ? (data.sources.find(s => s.name === view.name) || {}).category : 'CIRCO FEED';
  document.getElementById('view-head').innerHTML =
    `<small>${esc(kicker || '')} · ${n ? `${n} por leer` : 'todo leído'}</small><h1>${esc(title)}</h1>`;

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

  document.getElementById('errors').textContent = data.errors.length
    ? 'No se pudo leer: ' + data.errors.map(e => e.url).join(', ')
    : '';
}

function setView(v) {
  view = v;
  store.set('view', view);
  setMenu(false);
  render();
  window.scrollTo(0, 0);
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
    store.set('saved', saved);
    render();
    return;
  }
  const a = e.target.closest('a');
  if (!a) return;
  read.add(a.closest('article').dataset.id);
  saveRead();
  setTimeout(render, 300);
});
markRead.onchange = () => {
  pool().filter(i => inView(i)).forEach(i => markRead.checked ? read.add(i.id) : read.delete(i.id));
  saveRead();
  render();
};
hideRead.onchange = () => { store.set('hideRead', hideRead.checked); render(); };

render();
