const API = 'http://localhost:3000/api';
const audio = document.getElementById('audio');
const playlist = document.getElementById('playlist');
const nowPlaying = document.getElementById('nowPlaying');
const search = document.getElementById('search');

let tracks = [];

async function loadTracks() {
  const res = await fetch(`${API}/tracks`);
  tracks = await res.json();
  render(tracks);
}

function render(list) {
  playlist.innerHTML = '';
  list.forEach((t, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${t.name}`;
    li.onclick = () => playTrack(t);
    playlist.appendChild(li);
  });
}

function playTrack(t) {
  audio.src = `${API}/stream/${t.id}`; // el proxy resuelve la URL real
  audio.play();
  nowPlaying.textContent = `▶ ${t.name}`;
  // Autoplay del siguiente
  audio.onended = () => {
    const idx = tracks.findIndex(x => x.id === t.id);
    if (tracks[idx + 1]) playTrack(tracks[idx + 1]);
  };
}

search.oninput = () => {
  const q = search.value.toLowerCase();
  render(tracks.filter(t => t.name.toLowerCase().includes(q)));
};

document.getElementById('downloadBtn').onclick = async () => {
  await fetch(`${API}/download/chart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'billboard' }),
  });
  alert('Lista obtenida. Revisa la consola del backend para descargar.');
};

loadTracks();