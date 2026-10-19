// Sincroniza leídas y guardadas entre dispositivos con un Gist privado de GitHub.
// Cada dispositivo guarda su token (con permiso solo de Gists) en localStorage.
// Al mezclar, gana el cambio más reciente de cada noticia (stamps en app.js).
const GIST_FILE = 'circo-feed.json';
const syncBtn = document.getElementById('sync');
let syncTimer, syncing = false, syncAgain = false;

function syncStatus(text) {
  syncBtn.textContent = text || (store.get('token') ? 'Sincronizar ahora' : 'Sincronizar dispositivos');
}

async function api(path, options = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...options,
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + store.get('token', ''), Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

const snapshot = () => JSON.stringify({ read: [...read], saved, stamps });

function merge(remote) {
  const rStamps = remote.stamps || { r: {}, s: {} };
  const rRead = new Set(remote.read || []);
  for (const id of new Set([...read, ...rRead, ...Object.keys(rStamps.r)])) {
    const local = stamps.r[id] || 0, other = rStamps.r[id] || 0;
    if (other > local) { rRead.has(id) ? read.add(id) : read.delete(id); stamps.r[id] = other; }
    else if (other === local && rRead.has(id)) read.add(id);
  }
  const rSaved = new Map((remote.saved || []).map(i => [i.id, i]));
  const lSaved = new Map(saved.map(i => [i.id, i]));
  for (const id of new Set([...lSaved.keys(), ...rSaved.keys(), ...Object.keys(rStamps.s)])) {
    const local = stamps.s[id] || 0, other = rStamps.s[id] || 0;
    if (other > local) { rSaved.has(id) ? lSaved.set(id, rSaved.get(id)) : lSaved.delete(id); stamps.s[id] = other; }
    else if (other === local && rSaved.has(id)) lSaved.set(id, rSaved.get(id));
  }
  // las guardadas más recientes primero
  saved = [...lSaved.values()].sort((a, b) => (stamps.s[b.id] || 0) - (stamps.s[a.id] || 0));
}

async function sync() {
  if (!store.get('token')) return syncStatus();
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  syncStatus('Sincronizando…');
  try {
    let id = store.get('gist');
    if (!id) {
      const gists = await api('/gists?per_page=100');
      id = (gists.find(g => g.files[GIST_FILE]) || {}).id;
    }
    let remoteText = '';
    if (id) {
      const gist = await api('/gists/' + id);
      remoteText = gist.files[GIST_FILE].content;
      const before = snapshot();
      merge(JSON.parse(remoteText));
      persist();
      if (snapshot() !== before) render();
    }
    const files = { [GIST_FILE]: { content: snapshot() } };
    if (!id) {
      const gist = await api('/gists', {
        method: 'POST',
        body: JSON.stringify({ description: 'CIRCO FEED: leídas y guardadas', public: false, files }),
      });
      id = gist.id;
    } else if (snapshot() !== remoteText) {
      await api('/gists/' + id, { method: 'PATCH', body: JSON.stringify({ files }) });
    }
    store.set('gist', id);
    syncStatus('Sincronizado ' + new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    syncStatus(e.message === '401' || e.message === '403' ? 'Token inválido: toca para cambiarlo' : 'Error al sincronizar');
    if (e.message === '401' || e.message === '403') { localStorage.removeItem('circo:token'); localStorage.removeItem('circo:gist'); }
  }
  syncing = false;
  if (syncAgain) { syncAgain = false; sync(); }
}

// app.js la llama en cada cambio; espera 2 segundos para juntar varios cambios en un solo envío
function scheduleSync() {
  if (!store.get('token')) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 2000);
}

syncBtn.onclick = () => {
  if (store.get('token')) {
    if (confirm('Este dispositivo está sincronizado. ¿Quieres desconectarlo?')) {
      localStorage.removeItem('circo:token');
      localStorage.removeItem('circo:gist');
      syncStatus();
    } else sync();
    return;
  }
  const token = prompt('Pega tu token de GitHub (con permiso de Gists) para sincronizar leídas y guardadas:');
  if (token && token.trim()) { store.set('token', token.trim()); sync(); }
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync();
});
syncStatus();
sync();
