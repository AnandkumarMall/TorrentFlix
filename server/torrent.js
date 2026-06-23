import WebTorrent from 'webtorrent';
import path from 'path';
import { TMP_DIR, EXTRA_TRACKERS, VIDEO_EXT, NATIVE_EXT } from './config.js';

// Single shared client for the whole process.
export const client = new WebTorrent();

client.on('error', (err) => {
  // Surfacing client-level errors but never crashing the server.
  console.error('[webtorrent] client error:', err?.message || err);
});

// Tracks last-activity time per infoHash for idle cleanup.
export const lastActivity = new Map();

export function touch(infoHash) {
  lastActivity.set(infoHash, Date.now());
}

function ext(name) {
  return path.extname(name).toLowerCase();
}

function isVideo(name) {
  return VIDEO_EXT.has(ext(name));
}

// Build the JSON-safe file list we hand to the frontend.
function describe(torrent) {
  const files = torrent.files.map((f, index) => ({
    index,
    name: f.name,
    path: f.path,
    length: f.length,
    isVideo: isVideo(f.name),
    native: NATIVE_EXT.has(ext(f.name)),
  }));
  return {
    infoHash: torrent.infoHash,
    name: torrent.name,
    length: torrent.length,
    files,
  };
}

// Download ONLY the chosen file; deselect everything else to save bandwidth.
export function selectOnly(torrent, fileIndex) {
  try {
    torrent.deselect(0, torrent.pieces.length - 1, false);
  } catch {
    // Older/newer API differences — file-level select below is the real driver.
  }
  torrent.files.forEach((f, i) => {
    if (i === fileIndex) f.select();
    else f.deselect();
  });
}

function appendTrackers(magnet) {
  if (!magnet.startsWith('magnet:')) return magnet;
  const tr = EXTRA_TRACKERS.map((t) => '&tr=' + encodeURIComponent(t)).join('');
  return magnet + tr;
}

// Add a magnet string or a .torrent Buffer. Resolves once metadata is ready.
export function addTorrent(input) {
  return new Promise((resolve, reject) => {
    const source = typeof input === 'string' ? appendTrackers(input.trim()) : input;

    // Reuse an already-added torrent (idempotent paste). client.get() is async
    // in webtorrent 2.x, so match the infoHash against client.torrents instead.
    if (typeof input === 'string') {
      const m = /xt=urn:btih:([a-z0-9]+)/i.exec(input);
      const hash = m && m[1].toLowerCase();
      const existing = hash && client.torrents.find((t) => t.infoHash === hash);
      if (existing && existing.ready) {
        touch(existing.infoHash);
        return resolve(describe(existing));
      }
      if (existing) {
        // Added but metadata not ready yet — wait for it instead of re-adding.
        existing.once('ready', () => {
          touch(existing.infoHash);
          resolve(describe(existing));
        });
        return;
      }
    }

    let settled = false;
    let keepalive;
    const cleanup = () => { if (keepalive) clearInterval(keepalive); };

    const onError = (err) => {
      cleanup();
      if (settled) return;
      settled = true;
      reject(err);
    };

    const torrent = client.add(source, { path: TMP_DIR }, (t) => {
      cleanup();
      if (settled) return;
      settled = true;
      touch(t.infoHash);

      // Auto-select the largest video file so playback prioritizes it.
      const videos = t.files
        .map((f, index) => ({ f, index }))
        .filter((x) => isVideo(x.f.name));
      const pick = (videos.length ? videos : t.files.map((f, index) => ({ f, index })))
        .sort((a, b) => b.f.length - a.f.length)[0];
      if (pick) selectOnly(t, pick.index);

      resolve(describe(t));
    });

    if (torrent.infoHash) touch(torrent.infoHash);
    keepalive = setInterval(() => {
      if (torrent && torrent.infoHash) touch(torrent.infoHash);
    }, 10000);

    torrent.on('error', onError);
  });
}

export function getTorrent(infoHash) {
  return client.torrents.find((t) => t.infoHash === infoHash);
}

export function removeTorrent(infoHash) {
  const t = getTorrent(infoHash);
  if (!t) return;
  lastActivity.delete(infoHash);
  client.remove(infoHash, { destroyStore: true }, () => {});
}
