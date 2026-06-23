import path from 'path';
import { MIME } from './config.js';
import { getTorrent, touch } from './torrent.js';

function contentType(name) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

// Byte-range streaming for browser-native files (mp4/webm/m4v).
// WebTorrent prioritizes the pieces backing the requested range, and
// torrent.critical keeps the playhead pieces highest priority -> low buffering.
export function streamNative(req, res, infoHash, fileIndex) {
  const torrent = getTorrent(infoHash);
  if (!torrent) return res.status(404).send('torrent not found');
  const file = torrent.files[fileIndex];
  if (!file) return res.status(404).send('file not found');

  touch(infoHash);

  const total = file.length;
  const range = req.headers.range;
  res.setHeader('Content-Type', contentType(file.name));
  res.setHeader('Accept-Ranges', 'bytes');

  let start = 0;
  let end = total - 1;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  } else {
    res.status(200);
  }

  res.setHeader('Content-Length', end - start + 1);

  // Prioritize the pieces around the requested start so playback starts fast.
  try {
    const pieceLen = torrent.pieceLength;
    const offset = file.offset + start;
    const p0 = Math.floor(offset / pieceLen);
    const p1 = Math.min(torrent.pieces.length - 1, p0 + 5);
    torrent.critical(p0, p1);
  } catch {}

  if (req.method === 'HEAD') return res.end();

  const stream = file.createReadStream({ start, end });
  stream.on('error', () => res.destroyed || res.end());
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}
