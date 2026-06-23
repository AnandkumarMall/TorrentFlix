import fs from 'fs';
import { IDLE_TIMEOUT, TMP_DIR } from './config.js';
import { client, lastActivity, removeTorrent } from './torrent.js';
import { stopAllHlsFor } from './transcode.js';

// Periodically drop torrents that have had no stream activity.
export function startIdleSweeper() {
  setInterval(() => {
    const now = Date.now();
    for (const t of [...client.torrents]) {
      const last = lastActivity.get(t.infoHash) || 0;
      if (now - last > IDLE_TIMEOUT) {
        console.log('[cleanup] dropping idle torrent', t.infoHash);
        stopAllHlsFor(t.infoHash);
        removeTorrent(t.infoHash);
      }
    }
  }, 15 * 1000).unref();
}

// Best-effort wipe of everything on shutdown.
export function installShutdownHandlers() {
  let done = false;
  const shutdown = () => {
    if (done) return;
    done = true;
    console.log('\n[cleanup] shutting down…');
    for (const t of [...client.torrents]) stopAllHlsFor(t.infoHash);
    client.destroy(() => {
      fs.rm(TMP_DIR, { recursive: true, force: true }, () => process.exit(0));
    });
    // Hard exit if destroy hangs.
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
