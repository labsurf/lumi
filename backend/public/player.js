// ─── Detección de entorno ─────────────────────────────
// Local → usa el proxy local (/api)
// GitHub Pages / producción → usa Render
const API = (() => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return '/api';
  }
  // ⚠️ CAMBIA ESTA URL POR LA TUYA DE RENDER (la tendrás en el Paso 5)
  return 'https://lumi-backend.onrender.com/api';
})();

console.log(`🌐 Frontend: ${window.location.origin}`);
console.log(`🔗 Backend: ${API}`);
// ─── DOM ──────────────────────────────────────────────
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

// ─── State ────────────────────────────────────────────
let tracks = [];
let filtered = [];
let currentIndex = -1;
let currentChart = [];
let libraryNames = new Set();
let playlists = [];
let modalTrackId = null;
let pollTimer = null;

// ─── Etiquetas de fuente (con iconos) ────────────────
const SOURCE_LABELS = {
  'manual': '<i class="fa-solid fa-music"></i> Suelta',
  'billboard-hot-100': '<i class="fa-solid fa-trophy"></i> Billboard',
  'itunes-us': '<i class="fa-brands fa-apple"></i> iTunes US',
  'itunes-mx': '<i class="fa-brands fa-apple"></i> iTunes MX',
  'itunes-es': '<i class="fa-brands fa-apple"></i> iTunes ES',
  'itunes-ar': '<i class="fa-brands fa-apple"></i> iTunes AR',
  'itunes-co': '<i class="fa-brands fa-apple"></i> iTunes CO',
  'spotify-global': '<i class="fa-brands fa-spotify"></i> Spotify',
};

function sourceLabel(id) {
  return SOURCE_LABELS[id] || `<i class="fa-solid fa-circle-question"></i> ${id}`;
}

// ─── Iconos reutilizables ────────────────────────────
const ICONS = {
  loading: '<i class="fa-solid fa-circle-notch fa-spin"></i>',
  search: '<i class="fa-solid fa-magnifying-glass"></i>',
  ok: '<i class="fa-solid fa-circle-check"></i>',
  warn: '<i class="fa-solid fa-triangle-exclamation"></i>',
  error: '<i class="fa-solid fa-circle-xmark"></i>',
  download: '<i class="fa-solid fa-download"></i>',
  pause: '<i class="fa-solid fa-circle-pause"></i>',
  play: '<i class="fa-solid fa-circle-play"></i>',
  clock: '<i class="fa-regular fa-clock"></i>',
  flag: '<i class="fa-solid fa-flag-checkered"></i>',
};

// ─── TABS ─────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`view-${tab.dataset.tab}`).classList.add('active');
  };
});

// ─── Cargar tracks con filtros ────────────────────────
async function loadTracks() {
  try {
    const params = new URLSearchParams();
    const src = sourceFilterSel.value;
    const pl = playlistFilterSel.value;
    if (src !== 'all') params.set('source', src);
    if (pl !== 'all') params.set('playlist', pl);

    const url = params.toString() ? `${API}/tracks?${params}` : `${API}/tracks`;
    const res = await fetch(url);
    tracks = await res.json();
    filtered = tracks;
    libraryNames = new Set(tracks.map((t) => t.name.toLowerCase()));
    render();
  } catch (err) {
    console.error('Error cargando tracks:', err);
  }
}

// ─── Cargar playlists ─────────────────────────────────
async function loadPlaylists() {
  const res = await fetch(`${API}/playlists`);
  playlists = await res.json();

  const current = playlistFilterSel.value;
  playlistFilterSel.innerHTML =
    '<option value="all">Todas las listas</option>' +
    playlists.map((p) => `<option value="${p.id}">${p.name} (${p.count})</option>`).join('');
  if ([...playlistFilterSel.options].some((o) => o.value === current)) {
    playlistFilterSel.value = current;
  }
}

// ─── Renderizar grid ──────────────────────────────────
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

  filtered.forEach((t, i) => {
    const isActive = currentIndex >= 0 && filtered[currentIndex]?.id === t.id;
    const card = document.createElement('div');
    card.className = 'card' + (isActive ? ' active' : '');
    card.dataset.id = t.id;

    const coverHtml = t.coverUrl
      ? `<img class="cover" src="${t.coverUrl}" alt="${t.name}" loading="lazy"
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
        <div class="source-badge" data-source="${t.source}">${sourceLabel(t.source)}</div>
        ${plChips ? `<div class="pl-chips">${plChips}</div>` : ''}
      </div>
    `;

    card.onclick = (e) => {
      if (e.target.closest('.delete-btn')) return;
      if (e.target.closest('.add-btn')) return;
      playTrack(i);
    };

    playlistEl.appendChild(card);
  });

  playlistEl.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const card = btn.closest('.card');
      const id = card.dataset.id;
      if (!confirm('¿Eliminar esta canción y su portada?')) return;
      await fetch(`${API}/tracks/${id}`, { method: 'DELETE' });
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

// ─── Reproducir ───────────────────────────────────────
function playTrack(index) {
  if (index < 0 || index >= filtered.length) return;
  currentIndex = index;
  const track = filtered[index];
  audio.src = `${API}/stream/${track.id}`;
  audio.play();
  nowPlaying.innerHTML = `${ICONS.play} <span>${track.name}</span>`;
  trackMeta.textContent = `${sourceLabel(track.source).replace(/<[^>]+>/g, '')} · ${new Date(track.createdAt).toLocaleDateString()}`;
  trackMeta.innerHTML = `${sourceLabel(track.source)} · ${new Date(track.createdAt).toLocaleDateString()}`;
  render();
}

audio.onended = () => playTrack(currentIndex + 1);
prevBtn.onclick = () => playTrack(currentIndex - 1);
nextBtn.onclick = () => playTrack(currentIndex + 1);

// ─── Búsqueda ─────────────────────────────────────────
searchInput.oninput = () => {
  const q = searchInput.value.toLowerCase();
  filtered = tracks.filter((t) => t.name.toLowerCase().includes(q));
  render();
};

sourceFilterSel.onchange = () => loadTracks();
playlistFilterSel.onchange = () => loadTracks();

// ─── Descargar 1 canción ─────────────────────────────
downloadBtn.onclick = async () => {
  const query = newTrackInput.value.trim();
  if (!query) return;

  downloadBtn.disabled = true;
  statusEl.style.color = '#1db954';
  statusEl.innerHTML = `${ICONS.search} Verificando si ya existe...`;

  try {
    const res = await fetch(`${API}/tracks/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    await loadTracks();
  } catch (err) {
    statusEl.style.color = '#ff4b4b';
    statusEl.innerHTML = `${ICONS.error} Error: ${err.message}`;
  } finally {
    downloadBtn.disabled = false;
    setTimeout(() => {
      statusEl.innerHTML = '';
      statusEl.style.color = '#1db954';
    }, 6000);
  }
};

// ─── MODAL ────────────────────────────────────────────
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
          await fetch(`${API}/playlists/${plid}/tracks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId: modalTrackId }),
          });
        } else {
          await fetch(`${API}/playlists/${plid}/tracks/${modalTrackId}`, {
            method: 'DELETE',
          });
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

// ─── MODAL: crear lista ──────────────────────────────
createPlaylistBtn.onclick = async () => {
  const name = newPlaylistInput.value.trim();
  if (!name) return;

  createPlaylistBtn.disabled = true;
  try {
    const res = await fetch(`${API}/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const created = await res.json();
    if (!res.ok) throw new Error(created.error);

    newPlaylistInput.value = '';
    await loadPlaylists();

    if (modalTrackId) {
      await fetch(`${API}/playlists/${created.id}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

// ─── CHART: fuentes ──────────────────────────────────
async function loadSources() {
  const res = await fetch(`${API}/charts/sources`);
  const sources = await res.json();
  chartSourceSel.innerHTML = sources
    .map((s) => `<option value="${s.id}" title="${s.description}">${s.name}</option>`)
    .join('');
}

// ─── CHART: ver lista ────────────────────────────────
loadChartBtn.onclick = async () => {
  const source = chartSourceSel.value;
  loadChartBtn.disabled = true;
  chartStatus.style.color = '#1db954';
  chartStatus.innerHTML = `${ICONS.loading} Cargando chart...`;

  try {
    const res = await fetch(`${API}/charts?source=${source}`);
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
          const res = await fetch(`${API}/tracks/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

// ─── CHART: descarga masiva ──────────────────────────
downloadChartBtn.onclick = async () => {
  const source = chartSourceSel.value;
  const limit = parseInt(chartLimitSel.value, 10);

  downloadChartBtn.disabled = true;
  downloadChartBtn.innerHTML = `${ICONS.loading} <span>Descargando...</span>`;
  chartStatus.style.color = '#1db954';
  chartStatus.innerHTML = `${ICONS.loading} Enviando descarga masiva (Top ${limit})...`;

  try {
    const res = await fetch(`${API}/charts/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// ─── Polling de progreso ─────────────────────────────
function pollDownloadProgress(expectedCount) {
  if (pollTimer) clearInterval(pollTimer);

  let checks = 0;
  const MAX_CHECKS = 120;

  pollTimer = setInterval(async () => {
    checks++;
    try {
      const statusRes = await fetch(`${API}/charts/status`);
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

// ─── Init ────────────────────────────────────────────
(async () => {
  await loadPlaylists();
  await loadTracks();
  await loadSources();
  loadChartBtn.click();
})();