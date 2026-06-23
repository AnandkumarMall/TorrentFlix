const $ = (id) => document.getElementById(id);
const magnetInput = $('magnet');
const errorEl = $('error');
const playerWrap = $('player-wrap');
const video = $('video');
let player = null;
const filesEl = $('files');
const statusEl = $('status');
const progressBar = $('progress-bar');

let current = null;       // { infoHash, files }
let statusTimer = null;
let hls = null;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return (n / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

function renderFiles() {
  filesEl.innerHTML = '';
  if (!current) return;
  for (const f of current.files) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="name">${f.name}</div>
      <div class="size">${fmtBytes(f.length)}</div>
    `;
    if (!f.isVideo) {
      li.classList.add('novideo');
    } else {
      li.onclick = () => play(f.index, li);
    }
    filesEl.appendChild(li);
  }
}

// Immediately tell the server to stop downloading when you refresh/close the page
window.addEventListener('beforeunload', () => {
  if (current && current.infoHash) {
    navigator.sendBeacon(`/api/stop/${current.infoHash}`);
  }
});

async function play(idx, li) {
  showError('');
  [...filesEl.children].forEach((c) => c.classList.remove('active'));
  if (li) li.classList.add('active');

  if (hls) { hls.destroy(); hls = null; }
  if (player) { player.destroy(); player = null; }
  
  let videoEl = document.getElementById('video');
  videoEl.removeAttribute('src');
  videoEl.load();

  try {
    const info = await postJSONPlay(idx);

    if (window.Plyr) {
      const plyrOpts = {
        controls: ['play-large', 'play', 'rewind', 'fast-forward', 'progress', 'current-time', 'duration', 'mute', 'volume', 'fullscreen'],
        seekTime: 5
      };
      if (typeof info.duration === 'number' && info.duration > 0) {
        plyrOpts.duration = info.duration;
      }
      try {
        player = new Plyr(videoEl, plyrOpts);
      } catch (e) { console.error('Plyr init error:', e); }
    }

    if (info.mode === 'native') {
      videoEl.src = info.url;
      videoEl.play().catch(() => {});
    } else if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: false, maxBufferLength: 30, liveDurationInfinity: false });
      hls.loadSource(info.url);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = info.url;
      videoEl.play().catch(() => {});
    }
    
    if (info.transcoding) {
      showError('Transcoding this format on the fly — playback may start with a short delay.');
    }
  } catch (e) {
    showError(e.message);
  }
}

async function postJSONPlay(idx) {
  const res = await fetch(`/api/play/${current.infoHash}/${idx}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'failed to play');
  return data;
}

function startStatus() {
  if (statusTimer) clearTimeout(statusTimer);
  let active = true;
  if (window.stopStatus) window.stopStatus();
  window.stopStatus = () => { active = false; };

  const tick = async () => {
    if (!active) return;
    try {
      const res = await fetch(`/api/status/${current.infoHash}`);
      if (res.status === 404) {
        active = false;
        showError('Session expired or torrent removed due to inactivity. Please stream again.');
        return;
      }
      if (res.ok) {
        const s = await res.json();
        statusEl.innerHTML =
          `<span>Peers <b>${s.peers}</b></span>` +
          `<span>Down <b>${fmtBytes(s.downloadSpeed)}/s</b></span>` +
          `<span>Progress <b>${(s.progress * 100).toFixed(1)}%</b></span>` +
          `<span>Got <b>${fmtBytes(s.downloaded)}</b></span>`;
        progressBar.style.width = `${(s.progress * 100).toFixed(1)}%`;
      }
    } catch {}
    if (active) statusTimer = setTimeout(tick, 1000);
  };
  tick();
}

function setLoading(isLoading) {
  const btn = $('add');
  const fileBtn = document.querySelector('.file-btn');
  if (isLoading) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
    fileBtn.style.pointerEvents = 'none';
    fileBtn.style.opacity = '0.5';
  } else {
    btn.disabled = false;
    btn.textContent = 'Stream';
    fileBtn.style.pointerEvents = 'auto';
    fileBtn.style.opacity = '1';
  }
}

async function loadTorrent(promise) {
  showError('');
  setLoading(true);
  try {
    const info = await promise;
    current = info;
    playerWrap.hidden = false;
    renderFiles();
    startStatus();
    // Auto-play the largest video file.
    const firstVideo = info.files.filter((f) => f.isVideo).sort((a, b) => b.length - a.length)[0];
    if (firstVideo) {
      const li = [...filesEl.children][info.files.indexOf(firstVideo)];
      play(firstVideo.index, li);
    } else {
      showError('No playable video file found in this torrent.');
    }
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
  }
}

$('add').onclick = () => {
  const magnet = magnetInput.value.trim();
  if (!magnet) return showError('Paste a magnet link first.');
  loadTorrent(postJSON('/api/add', { magnet }));
};

magnetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('add').click();
});

$('file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) uploadTorrent(file);
});

function uploadTorrent(file) {
  const fd = new FormData();
  fd.append('torrent', file);
  loadTorrent(
    fetch('/api/upload', { method: 'POST', body: fd }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'upload failed');
      return data;
    })
  );
}

// Drag & drop anywhere.
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { if (e.target === document.documentElement) document.body.classList.remove('dragging'); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = [...e.dataTransfer.files].find((f) => f.name.endsWith('.torrent'));
  if (file) uploadTorrent(file);
});
