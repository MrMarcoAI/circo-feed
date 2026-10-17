const data = window.CIRCO || { items: [], sources: [], errors: [] };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('circo:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('circo:' + k, JSON.stringify(v)); } catch {} },
};
const read = new Set(store.get('read', []));
let view = store.get('view', { type: 'all' });
const markRead = document.getElementById('mark-read');
const hideRead = document.getElementById('hide-read');
hideRead.checked = store.get('hideRead', false);

// en celular las categorías parten cerradas y recuerdan su estado aparte
const openKey = matchMedia('(max-width: 800px)').matches ? 'openMobile' : 'open';
const categories = [...new Set(data.sources.map(s => s.category))];
// extracto de máximo 140 caracteres, siempre terminado en "..."
const short = s => (s.length > 137 ? s.slice(0, 137).replace(/\s+\S*$/, '') : s).replace(/[\s.,;:…!?-]+$/, '') + '...';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const inView = (i, v = view) =>
  v.type === 'all' || (v.type === 'cat' && i.category === v.name) || (v.type === 'src' && i.source === v.name);
const unread = v => data.items.filter(i => inView(i, v) && !read.has(i.id)).length;

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
  const ids = new Set(data.items.map(i => i.id));
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
  let html = navButton({ type: 'all' }, 'Todo', 'all');
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

  const all = data.items.filter(i => inView(i));
  const n = unread(view);
  markRead.checked = all.length > 0 && n === 0;
  const kicker = view.type === 'src' ? (data.sources.find(s => s.name === view.name) || {}).category : 'CIRCO FEED';
  document.getElementById('view-head').innerHTML =
    `<small>${esc(kicker || '')} · ${n ? `${n} por leer` : 'todo leído'}</small><h1>${esc(view.name || 'Todo')}</h1>`;

  const items = all.filter(i => !(hideRead.checked && read.has(i.id)));
  const feed = document.getElementById('feed');
  if (!items.length) {
    feed.innerHTML = '<p class="empty">Nada por leer. Pon un disco de Fito.</p>';
  } else {
    let html = '', day = null;
    for (const i of items) {
      if (i.day !== day) { day = i.day; html += `<h2>${dayLabel(day)}</h2>`; }
      html += `<article class="${read.has(i.id) ? 'read' : ''}${i.image ? '' : ' no-img'}" data-id="${esc(i.id)}">
        <div>
          <div class="meta"><b>${esc(i.source)}</b> · ${esc(i.category)}</div>
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
  render();
  window.scrollTo(0, 0);
}

document.getElementById('nav').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  e.preventDefault(); // en el summary, el botón cambia la vista sin abrir/cerrar la categoría
  setView(b.dataset.type === 'all' ? { type: 'all' } : { type: b.dataset.type, name: b.dataset.name });
});
document.getElementById('nav').addEventListener('toggle', e => {
  const open = [...document.querySelectorAll('#nav details[open]')].map(d => d.dataset.cat);
  store.set(openKey, open);
}, true);
document.querySelector('.logo').onclick = e => { e.preventDefault(); setView({ type: 'all' }); };

document.getElementById('feed').addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a) return;
  read.add(a.closest('article').dataset.id);
  saveRead();
  setTimeout(render, 300);
});
markRead.onchange = () => {
  data.items.filter(i => inView(i)).forEach(i => markRead.checked ? read.add(i.id) : read.delete(i.id));
  saveRead();
  render();
};
hideRead.onchange = () => { store.set('hideRead', hideRead.checked); render(); };

render();
