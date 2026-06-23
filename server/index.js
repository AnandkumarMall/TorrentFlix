import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PORT, TMP_DIR } from './config.js';
import { addTorrent, getTorrent, selectOnly, touch, removeTorrent } from './torrent.js';
import { streamNative } from './stream.js';
import { decideStrategy, startHls, getJob, stopAllHlsFor } from './transcode.js';
import { startIdleSweeper, installShutdownHandlers } from './cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// --- Add a torrent by magnet link -----------------------------------------
app.post('/api/add', async (req, res) => {
  const magnet = (req.body?.magnet || '').trim();
  if (!magnet) return res.status(400).json({ error: 'magnet required' });
  try {
    const info = await addTorrent(magnet);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'failed to add torrent' });
  }
});

// --- Add a torrent by uploaded .torrent file -------------------------------
app.post('/api/upload', upload.single('torrent'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'torrent file required' });
  try {
    const info = await addTorrent(req.file.buffer);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'failed to add torrent' });
  }
});

// --- Decide how to play a file & prime the pipeline ------------------------
app.get('/api/play/:hash/:idx', async (req, res) => {
  const { hash } = req.params;
  const idx = Number(req.params.idx);
  const torrent = getTorrent(hash);
  if (!torrent) return res.status(404).json({ error: 'torrent not found' });
  const file = torrent.files[idx];
  if (!file) return res.status(404).json({ error: 'file not found' });

  // Switch active download to this file.
  selectOnly(torrent, idx);
  touch(hash);

  const native = file.name.match(/\.(mp4|m4v|webm)$/i);
  try {
    const strategy = await decideStrategy(file, !!native);
    if (strategy.mode === 'native') {
      return res.json({ mode: 'native', url: `/stream/${hash}/${idx}`, name: file.name, duration: strategy.codecs?.duration });
    }
    startHls(hash, idx, file, strategy.copyVideo);
    return res.json({
      mode: 'hls',
      url: `/hls/${hash}/${idx}/index.m3u8`,
      name: file.name,
      transcoding: !strategy.copyVideo,
      duration: strategy.codecs?.duration,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'failed to prepare stream' });
  }
});

// --- Native byte-range streaming -------------------------------------------
app.all('/stream/:hash/:idx', (req, res) => {
  streamNative(req, res, req.params.hash, Number(req.params.idx));
});

// --- HLS playlist + segments -----------------------------------------------
app.get('/hls/:hash/:idx/:file', (req, res) => {
  const { hash, file } = req.params;
  const idx = Number(req.params.idx);
  const job = getJob(hash, idx);
  if (!job) return res.status(404).send('no stream');
  if (!/^[\w.-]+$/.test(file)) return res.status(400).send('bad path');

  touch(hash);
  const full = path.join(job.dir, file);
  if (!full.startsWith(job.dir)) return res.status(400).send('bad path');

  // Wait briefly for the playlist/segment to appear (ffmpeg writes lazily).
  let tries = 0;
  const send = () => {
    if (fs.existsSync(full)) {
      res.setHeader('Cache-Control', 'no-cache');
      if (file.endsWith('.m3u8')) res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      else if (file.endsWith('.ts')) res.setHeader('Content-Type', 'video/mp2t');
      return res.sendFile(full);
    }
    if (tries++ > 50) return res.status(404).send('not ready');
    setTimeout(send, 200);
  };
  send();
});

// --- Live status for the UI ------------------------------------------------
app.get('/api/status/:hash', (req, res) => {
  const t = getTorrent(req.params.hash);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json({
    progress: t.progress,
    downloadSpeed: t.downloadSpeed,
    uploadSpeed: t.uploadSpeed,
    downloaded: t.downloaded,
    peers: t.numPeers,
    ready: t.ready,
  });
});

// --- Stop a torrent explicitly (e.g. on page unload) -----------------------
app.post('/api/stop/:hash', (req, res) => {
  const { hash } = req.params;
  const t = getTorrent(hash);
  if (t) {
    console.log('[cleanup] user closed page, dropping torrent', hash);
    stopAllHlsFor(hash);
    removeTorrent(hash);
  }
  res.status(200).end();
});

export { app };

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  app.listen(PORT, () => {
    console.log(`\n  ▶  Torrent stream running at http://localhost:${PORT}\n`);
  });
  startIdleSweeper();
  installShutdownHandlers();
}
