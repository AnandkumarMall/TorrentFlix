import os from 'os';
import path from 'path';

export const PORT = process.env.PORT || 8000;

// Temp dir where WebTorrent stores downloaded pieces (disk-backed -> low RAM).
export const TMP_DIR = path.join(os.tmpdir(), 'torrent-stream');

// Drop a torrent after this long with no stream activity (ms).
export const IDLE_TIMEOUT = 60 * 1000; // 1 min

// Extra public trackers appended to magnets for faster peer discovery.
export const EXTRA_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://9.rarbg.com:2810/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://explodie.org:6969/announce',
  'wss://tracker.openwebtorrent.com',
];

// Containers the browser can usually play natively via byte-range (no ffmpeg).
export const NATIVE_EXT = new Set(['.mp4', '.m4v', '.webm', '.mkv']);

// Anything we treat as a video file at all.
export const VIDEO_EXT = new Set([
  '.mp4', '.m4v', '.webm', '.mkv', '.avi', '.mov', '.wmv',
  '.flv', '.mpg', '.mpeg', '.ts', '.m2ts', '.3gp', '.ogv', '.divx',
]);

export const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
};
