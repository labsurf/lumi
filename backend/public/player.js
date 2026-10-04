// ─── Detección de entorno ─────────────────────────────
const API = (() => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return '/api';
  }
  return 'https://lumi-backend-5w78.onrender.com/api';
})();

console.log(`🌐 Frontend: ${window.location.origin}`);
console.log(`🔗 Backend: ${API}`);

// ─── Estado de autenticación ─────────────────────────
const TOKEN_KEY = 'lumi_token';
let currentUser = null;

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(token) { localStorage.setItem(TOKEN_KEY, token); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) {
    console.warn('Sesión expirada');
    clearToken();
    showAuthScreen();
    throw new Error('Sesión expirada');
  }
  return res;
}

function resolveUrl(url) {
  if (!url) return url;
  if (!url.startsWith('/api')) return url;
  const base = API.replace(/\/api$/, '');
  return base + url;
}

// ═══════════════════════════════════════════════════════
//  DOM
// ═══════════════════════════════════════════════════════
const audio = document.getElementById('audio');
const playlistEl = document.getElementById('playlist');
const nowPlaying = document.getElementById('nowPlaying');
const trackMeta = document.getElementById('trackMeta');
const searchInput = document.getElementById('search');
const newTrackInput = document.getElementById('newTrack');
const downloadBtn = document.getElementById('downloadBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const statusEl = document.getElementById('status');
const sourceFilterSel = document.getElementById('sourceFilter');
const playlistFilterSel = document.getElementById('playlistFilter');

const chartSourceSel = document.getElementById('chartSource');
const chartLimitSel = document.getElementById('chartLimit');
const loadChartBtn = document.getElementById('loadChartBtn');
const downloadChartBtn = document.getElementById('downloadChartBtn');
const chartStatus = document.getElementById('chartStatus');
const chartList = document.getElementById('chartList');

const playlistModal = document.getElementById('playlistModal');
const modalTrackName = document.getElementById('modalTrackName');
const playlistModalList = document.getElementById('playlistModalList');
const newPlaylistInput = document.getElementById('newPlaylistInput');
const createPlaylistBtn = document.getElementById('createPlaylistBtn');
const closeModalBtn = document.getElementById('closeModalBtn');

const authScreen = document.getElementById('authScreen');
const appEl = document.getElementById('app');
const authForm = document.getElementById('authForm');
const authUsername = document.getElementById('authUsername');
const authPassword = document.getElementById('authPassword');
const authError = document.getElementById('authError');
const authSubmit = document.getElementById('authSubmit');
const userNameEl = document.getElementById('userName');
const userQuotaEl = document.getElementById('userQuota');
const logoutBtn = document.getElementById('logoutBtn');

let authMode = 'login';

// ═══════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════
function showAuthScreen() {
  authScreen.classList.remove('hidden');
  appEl.classList.add('hidden');
}

function showApp() {
  authScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
}

document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    authMode = tab.dataset.auth;
    authSubmit.innerHTML = authMode === 'login'
      ? '<i class="fa-solid fa-right-to-bracket"></i><span>Entrar</span>'
      : '<i class="fa-solid fa-user-plus"></i><span>Crear cuenta</span>';
    authError.textContent = '';
  };
});

authForm.onsubmit = async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authSubmit.disabled = true;

  const username = authUsername.value.trim();
  const password = authPassword.value;

  try {
    const res = await fetch(`${API}/auth/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al autenticar');

    setToken(data.token);
    currentUser = data.user;
    console.log(`✅ ${authMode === 'login' ? 'Login' : 'Registro'} OK: ${currentUser.username}`);

    authUsername.value = '';
    authPassword.value = '';
    await bootApp();
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
};

logoutBtn.onclick = () => {
  if (!confirm('¿Cerrar sesión?')) return;
  clearToken();
  currentUser = null;
  location.reload();
};

function updateUserHeader() {
  if (!currentUser) return;
  userNameEl.innerHTML = `<i class="fa-solid fa-circle-user"></i><span>${currentUser.username}</span>`;
  const remaining = currentUser.downloadQuota - currentUser.downloadCount;
  const exhausted = remaining <= 0;
  userQuotaEl.className = 'user-quota' + (exhausted ? ' exhausted' : '');
  userQuotaEl.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i><span>${remaining}/${currentUser.downloadQuota}</span>`;
}

async function refreshUser() {
  try {
    const res = await apiFetch('/auth/me');
    currentUser = await res.json();
    updateUserHeader();
  } catch (err) {
    console.warn('No se pudo refrescar el usuario:', err.message);
  }
}

// ═══════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════
let tracks = [];
let filtered = [];
let currentIndex = -1;
let currentChart = [];
let libraryNames = new Set();
let playlists = [];
let modalTrackId = null;
let pollTimer = null;

// ═══════════════════════════════════════════════════════
//  ETIQUETAS E ICONOS
// ═══════════════════════════════════════════════════════
const SOURCE_LABELS = {
  'billboard-hot-100': '<i class="fa-solid fa-trophy"></i> billboard',
  'itunes-us': '<i class="fa-brands fa-apple"></i> itunes us',
  'itunes-mx': '<i class="fa-brands fa-apple"></i> itunes mx',
  'itunes-es': '<i class="fa-brands fa-apple"></i> itunes es',
  'itunes-ar': '<i class="fa-brands fa-apple"></i> itunes ar',
  'itunes-co': '<i class="fa-brands fa-apple"></i> itunes co',
  'spotify-global': '<i class="fa-brands fa-spotify"></i> spotify',
};

function sourceLabel(track) {
  const id = typeof track === 'string' ? track : track.source;
  if (id === 'manual') {
    const name = currentUser?.username || 'tuya';
    return `<i class="fa-solid fa-user"></i> ${name}`;
  }
  return SOURCE_LABELS[id] || `<i class="fa-solid fa-circle-question"></i> ${id}`;
}

const ICONS = {
  loading: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
  search: '<i class="fa-solid fa-magnifying-glass"></i>',
  ok: '<i class="fa-solid fa-circle-check"></i>',
  warn: '<i class="fa-solid fa-triangle-exclamation"></i>',
  error: '<i class="fa-solid fa-circle-xmark"></i>',
  download: '<i class="fa-solid fa-download"></i>',
  play: '<i class="fa-solid fa-circle-play"></i>',
  clock: '<i class="fa-regular fa-clock"></i>',
  flag: '<i class="fa-solid fa-flag-checkered"></i>',
};

// ═══════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════
document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
  };
});

// ═══════════════════════════════════════════════════════
//  CARGAR TRACKS
// ═══════════════════════════════════════════════════════
async function loadTracks() {
  try {
    const params = new URLSearchParams();
    const src = sourceFilterSel.value;
    const pl = playlistFilterSel.value;
    if (src !== 'all') params.set('source', src);
    if (pl !== 'all') params.set('playlist', pl);

    const url = params.toString() ? `/tracks?${params}` : '/tracks';
    const res = await apiFetch(url);
    tracks = await res.json();
    filtered = tracks;
    libraryNames = new Set(tracks.map((t) => t.name.toLowerCase()));
    render();
  } catch (err) {
    console.error('Error cargando tracks:', err);
  }
}

// ═══════════════════════════════════════════════════════
//  CARGAR PLAYLISTS
// ═══════════════════════════════════════════════════════
async function loadPlaylists() {
  try {
    const res = await apiFetch('/playlists');
    playlists = await res.json();

    const current = playlistFilterSel.value;
    playlistFilterSel.innerHTML =
      '<option value="all">Todas las listas</option>' +
      playlists.map((p) => `<option value="${p.id}">${p.name} (${p.count})</option>`).join('');
    if ([...playlistFilterSel.options].some((o) => o.value === current)) {
      playlistFilterSel.value = current;
    }
  } catch (err) {
    console.error('Error cargando playlists:', err);
  }
}

// ═══════════════════════════════════════════════════════
//  CREAR TARJETA (helper reutilizable)
// ═══════════════════════════════════════════════════════
function createCard(t, globalIndex) {
  const isActive = currentIndex >= 0 && filtered[currentIndex]?.id === t.id;
  const card = document.createElement('div');
  card.className = 'card' + (isActive ? ' active' : '');
  card.dataset.id = t.id;

  const coverHtml = t.coverUrl
    ? `<img class="cover" src="${resolveUrl(t.coverUrl)}" alt="${t.name}" loading="lazy"
            onerror="this.parentNode.innerHTML='<div class=&quot;cover-placeholder&quot;><i class=&quot;fa-solid fa-music&quot;></i></div>'">`
    : `<div class="cover-placeholder"><i class="fa-solid fa-music"></i></div>`;

  const plChips = (t.playlists || [])
    .map((pid) => {
      const p = playlists.find((x) => x.id === pid);
      return p ? `<span class="pl-chip"><i class="fa-solid fa-list"></i> ${p.name}</span>` : '';
    })
    .join('');

  card.innerHTML = `
    ${coverHtml}
    <div class="info">
      <div class="title" title="${t.name}">${t.name}</div>
      <div class="meta">
        <span>${(t.size / 1024 / 1024).toFixed(1)} MB</span>
        <span class="meta-actions">
          <button class="add-btn" data-id="${t.id}" title="Añadir a lista">
            <i class="fa-solid fa-plus"></i>
          </button>
          <button class="delete-btn" data-id="${t.id}" title="Eliminar">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </span>
      </div>
      <div class="source-badge" data-source="${t.source}">${sourceLabel(t)}</div>
      ${plChips ? `<div class="pl-chips">${plChips}</div>` : ''}
    </div>
  `;

  card.onclick = (e) => {
    if (e.target.closest('.delete-btn')) return;
    if (e.target.closest('.add-btn')) return;
    playTrack(globalIndex);
  };

  return card;
}

// ═══════════════════════════════════════════════════════
//  RENDER CON SECCIONES AGRUPADAS
// ═══════════════════════════════════════════════════════
function render() {
  playlistEl.innerHTML = '';

  if (filtered.length === 0) {
    playlistEl.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-inbox"></i>
        <p>Sin resultados para este filtro</p>
      </div>`;
    return;
  }

  // ─── Agrupar canciones ─────────────────────────────
  const charts = filtered.filter((t) => t.source !== 'manual');
  const manual = filtered.filter((t) => t.source === 'manual');

  const sections = [];
  if (charts.length > 0) {
    sections.push({
      title: 'Top Descargas',
      icon: 'fa-chart-line',
      items: charts,
    });
  }
  if (manual.length > 0) {
    sections.push({
      title: 'Mis descargas',
      icon: 'fa-user',
      items: manual,
    });
  }

  // ─── Renderizar cada sección ───────────────────────
  sections.forEach((section) => {
    // Encabezado
    const header = document.createElement('div');
    header.className = 'section-header';
    header.innerHTML = `
      <div class="section-title">
        <i class="fa-solid ${section.icon}"></i>
        <span>${section.title}</span>
        <span class="section-count">${section.items.length}</span>
      </div>
      <div class="section-line"></div>
    `;
    playlistEl.appendChild(header);

    // Grid de la sección
    const grid = document.createElement('div');
    grid.className = 'section-grid';

    section.items.forEach((t) => {
      const globalIndex = filtered.findIndex((x) => x.id === t.id);
      grid.appendChild(createCard(t, globalIndex));
    });

    playlistEl.appendChild(grid);
  });

  // ─── Listeners globales (delete / add) ─────────────
  playlistEl.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const card = btn.closest('.card');
      const id = card.dataset.id;
      if (!confirm('¿Eliminar esta canción y su portada?')) return;
      await apiFetch(`/tracks/${id}`, { method: 'DELETE' });
      await loadTracks();
      await loadPlaylists();
    };
  });

  playlistEl.querySelectorAll('.add-btn').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const card = btn.closest('.card');
      const track = tracks.find((x) => x.id === card.dataset.id);
      if (track) openPlaylistModal(track);
    };
  });
}

// ═══════════════════════════════════════════════════════
//  REPRODUCIR
// ═══════════════════════════════════════════════════════
function playTrack(index) {
  if (index < 0 || index >= filtered.length) return;
  currentIndex = index;
  const track = filtered[index];
  audio.src = resolveUrl(track.streamUrl);
  audio.play().catch((err) => console.warn('Reproducción:', err.message));
  nowPlaying.innerHTML = `${ICONS.play} <span>${track.name}</span>`;
  trackMeta.innerHTML = `${sourceLabel(track)} · ${new Date(track.createdAt).toLocaleDateString()}`;
  render();
}

audio.onended = () => playTrack(currentIndex + 1);
prevBtn.onclick = () => playTrack(currentIndex - 1);
nextBtn.onclick = () => playTrack(currentIndex + 1);

// ═══════════════════════════════════════════════════════
//  BÚSQUEDA Y FILTROS
// ═══════════════════════════════════════════════════════
searchInput.oninput = () => {
  const q = searchInput.value.toLowerCase();
  filtered = tracks.filter((t) => t.name.toLowerCase().includes(q));
  render();
};

sourceFilterSel.onchange = () => loadTracks();
playlistFilterSel.onchange = () => loadTracks();

// ═══════════════════════════════════════════════════════
//  DESCARGAR 1 CANCIÓN
// ═══════════════════════════════════════════════════════
downloadBtn.onclick = async () => {
  const query = newTrackInput.value.trim();
  if (!query) return;

  downloadBtn.disabled = true;
  statusEl.style.color = '#1db954';
  statusEl.innerHTML = `${ICONS.search} Verificando si ya existe...`;

  try {
    const res = await apiFetch('/tracks/download', {
      method: 'POST',
      body: JSON.stringify({ query, source: 'manual' }),
    });
    const data = await res.json();

    if (res.status === 409) {
      statusEl.style.color = '#ffb84d';
      statusEl.innerHTML = `${ICONS.warn} ${data.message}`;
      return;
    }
    if (!res.ok) throw new Error(data.error);

    statusEl.style.color = '#1db954';
    statusEl.innerHTML = `${ICONS.ok} <b>${data.file.name}</b> agregada`;
    newTrackInput.value = '';

    if (data.quota && currentUser) {
      currentUser.downloadCount = data.quota.downloadCount;
      currentUser.downloadQuota = data.quota.downloadQuota;
      updateUserHeader();
    }

    await loadTracks();
  } catch (err) {
    statusEl.style.color = '#ff4b4b';
    statusEl.innerHTML = `${ICONS.error} ${err.message}`;
  } finally {
    downloadBtn.disabled = false;
    setTimeout(() => {
      statusEl.innerHTML = '';
      statusEl.style.color = '#1db954';
    }, 6000);
  }
};

// ═══════════════════════════════════════════════════════
//  MODAL PLAYLISTS
// ═══════════════════════════════════════════════════════
function openPlaylistModal(track) {
  modalTrackId = track.id;
  modalTrackName.textContent = track.name;

  if (playlists.length === 0) {
    playlistModalList.innerHTML = '<p style="opacity:0.5;">Aún no hay listas. Crea una abajo.</p>';
  } else {
    playlistModalList.innerHTML = playlists.map((p) => {
      const checked = (track.playlists || []).includes(p.id);
      return `
        <label class="pl-check">
          <input type="checkbox" data-plid="${p.id}" ${checked ? 'checked' : ''}>
          <span><i class="fa-solid fa-list"></i> ${p.name}</span>
          <span class="pl-count">${p.count}</span>
        </label>
      `;
    }).join('');

    playlistModalList.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.onchange = async () => {
        const plid = cb.dataset.plid;
        if (cb.checked) {
          await apiFetch(`/playlists/${plid}/tracks`, {
            method: 'POST',
            body: JSON.stringify({ trackId: modalTrackId }),
          });
        } else {
          await apiFetch(`/playlists/${plid}/tracks/${modalTrackId}`, { method: 'DELETE' });
        }
        await loadPlaylists();
        await loadTracks();
        const updated = tracks.find((x) => x.id === modalTrackId);
        if (updated) openPlaylistModal(updated);
      };
    });
  }

  playlistModal.classList.remove('hidden');
}

function closePlaylistModal() {
  playlistModal.classList.add('hidden');
  modalTrackId = null;
  newPlaylistInput.value = '';
}

closeModalBtn.onclick = closePlaylistModal;
playlistModal.onclick = (e) => {
  if (e.target === playlistModal) closePlaylistModal();
};

createPlaylistBtn.onclick = async () => {
  const name = newPlaylistInput.value.trim();
  if (!name) return;

  createPlaylistBtn.disabled = true;
  try {
    const res = await apiFetch('/playlists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const created = await res.json();
    if (!res.ok) throw new Error(created.error);

    newPlaylistInput.value = '';
    await loadPlaylists();

    if (modalTrackId) {
      await apiFetch(`/playlists/${created.id}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ trackId: modalTrackId }),
      });
      await loadPlaylists();
      await loadTracks();
      const updated = tracks.find((x) => x.id === modalTrackId);
      if (updated) openPlaylistModal(updated);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    createPlaylistBtn.disabled = false;
  }
};

newPlaylistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createPlaylistBtn.click();
});

// ═══════════════════════════════════════════════════════
//  CHARTS
// ═══════════════════════════════════════════════════════
async function loadSources() {
  try {
    const res = await apiFetch('/charts/sources');
    const sources = await res.json();
    chartSourceSel.innerHTML = sources
      .map((s) => `<option value="${s.id}" title="${s.description}">${s.name}</option>`)
      .join('');
  } catch (err) {
    console.error('Error cargando fuentes:', err);
  }
}

loadChartBtn.onclick = async () => {
  const source = chartSourceSel.value;
  loadChartBtn.disabled = true;
  chartStatus.style.color = '#1db954';
  chartStatus.innerHTML = `${ICONS.loading} Cargando chart...`;

  try {
    const res = await apiFetch(`/charts?source=${source}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentChart = data.tracks;
    chartStatus.innerHTML = `${ICONS.ok} ${data.count} canciones cargadas`;
    renderChart();
  } catch (err) {
    chartStatus.style.color = '#ff4b4b';
    chartStatus.innerHTML = `${ICONS.error} ${err.message}`;
  } finally {
    loadChartBtn.disabled = false;
  }
};

function renderChart() {
  chartList.innerHTML = '';
  if (currentChart.length === 0) {
    chartList.innerHTML = '<p style="opacity:0.5;">Sin resultados.</p>';
    return;
  }

  currentChart.forEach((track) => {
    const inLib = libraryNames.has(track.displayName.toLowerCase());
    const row = document.createElement('div');
    row.className = 'chart-row' + (inLib ? ' in-library' : '');
    row.innerHTML = `
      <div class="pos">${track.position}</div>
      <div class="info">
        <div class="title">${track.title}</div>
        <div class="artist">${track.artist}</div>
      </div>
      <div class="actions">
        <button ${inLib ? 'disabled' : ''}>
          ${inLib ? '<i class="fa-solid fa-check"></i> Ya la tienes' : '<i class="fa-solid fa-download"></i> Bajar'}
        </button>
      </div>
    `;

    const btn = row.querySelector('button');
    if (!inLib) {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.innerHTML = `${ICONS.loading}`;
        try {
          const res = await apiFetch('/tracks/download', {
            method: 'POST',
            body: JSON.stringify({
              query: track.query,
              source: chartSourceSel.value,
            }),
          });
          const data = await res.json();

          if (res.status === 409) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Ya la tienes';
            btn.disabled = true;
            row.classList.add('in-library');
            return;
          }
          if (!res.ok) throw new Error(data.error);

          if (data.quota && currentUser) {
            currentUser.downloadCount = data.quota.downloadCount;
            currentUser.downloadQuota = data.quota.downloadQuota;
            updateUserHeader();
          }

          btn.innerHTML = '<i class="fa-solid fa-check"></i> Bajada';
          row.classList.add('in-library');
          await loadTracks();
        } catch (err) {
          btn.innerHTML = '<i class="fa-solid fa-download"></i> Bajar';
          btn.disabled = false;
          console.error('Error bajando desde chart:', err);
        }
      };
    }

    chartList.appendChild(row);
  });
}

downloadChartBtn.onclick = async () => {
  const source = chartSourceSel.value;
  const limit = parseInt(chartLimitSel.value, 10);

  downloadChartBtn.disabled = true;
  downloadChartBtn.innerHTML = `${ICONS.loading} <span>Descargando...</span>`;
  chartStatus.style.color = '#1db954';
  chartStatus.innerHTML = `${ICONS.loading} Enviando descarga masiva (Top ${limit})...`;

  try {
    const res = await apiFetch('/charts/download', {
      method: 'POST',
      body: JSON.stringify({ source, limit, concurrency: 2 }),
    });
    const data = await res.json();

    if (res.status === 409) {
      chartStatus.style.color = '#ffb84d';
      chartStatus.innerHTML = `${ICONS.warn} ${data.message}`;
      return;
    }
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    chartStatus.innerHTML = `${ICONS.ok} ${data.message}`;
    pollDownloadProgress(limit);
  } catch (err) {
    chartStatus.style.color = '#ff4b4b';
    chartStatus.innerHTML = `${ICONS.error} ${err.message}`;
  } finally {
    downloadChartBtn.disabled = false;
    downloadChartBtn.innerHTML = `${ICONS.download} <span>Descargar chart</span>`;
  }
};

function pollDownloadProgress(expectedCount) {
  if (pollTimer) clearInterval(pollTimer);

  let checks = 0;
  const MAX_CHECKS = 120;

  pollTimer = setInterval(async () => {
    checks++;
    try {
      const statusRes = await apiFetch('/charts/status');
      const status = await statusRes.json();

      if (status.active) {
        const pct = Math.round(((status.done + status.skipped + status.failed) / status.total) * 100);
        chartStatus.innerHTML =
          `${ICONS.loading} Progreso ${pct}% · ${status.done + status.skipped + status.failed}/${status.total} ` +
          `(<i class="fa-solid fa-check"></i> ${status.done} · ` +
          `<i class="fa-solid fa-forward"></i> ${status.skipped} · ` +
          `<i class="fa-solid fa-xmark"></i> ${status.failed})`;
      } else {
        clearInterval(pollTimer);
        pollTimer = null;
        chartStatus.innerHTML =
          `${ICONS.flag} Listo · <i class="fa-solid fa-check"></i> ${status.done} descargadas · ` +
          `<i class="fa-solid fa-forward"></i> ${status.skipped} ya existían · ` +
          `<i class="fa-solid fa-xmark"></i> ${status.failed} fallidas`;
        await refreshUser();
        await loadTracks();
        await loadPlaylists();
        loadChartBtn.click();
        return;
      }

      if (checks >= MAX_CHECKS) {
        clearInterval(pollTimer);
        pollTimer = null;
        chartStatus.innerHTML = `${ICONS.clock} Timeout. Revisa la consola del servidor.`;
      }
    } catch (err) {
      console.warn('Poll error:', err.message);
    }
  }, 5000);
}

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
async function bootApp() {
  showApp();
  await refreshUser();
  await loadPlaylists();
  await loadTracks();
  await loadSources();
  loadChartBtn.click();
}

(async () => {
  const token = getToken();
  if (!token) {
    showAuthScreen();
    return;
  }
  try {
    const res = await apiFetch('/auth/me');
    currentUser = await res.json();
    await bootApp();
  } catch {
    showAuthScreen();
  }
})();