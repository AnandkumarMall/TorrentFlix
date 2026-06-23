# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies (ffmpeg/ffprobe binaries ship via npm)
npm start            # Start server on PORT (default 8000)
npm run dev          # Start with --watch for auto-reload
PORT=9000 npm start  # Run on a custom port
```

No test suite, linter, or build step is configured.

## Architecture

This is a **local web app** that streams torrents directly in the browser. The Node/Express server acts as the BitTorrent peer (full TCP/UDP swarm via WebTorrent) and delivers video over HTTP to a plain `<video>` element. The frontend is a vanilla JS SPA — no framework.

### Streaming strategies (the core decision tree)

The server chooses one of three delivery paths per file, listed from cheapest to most expensive:

| Path | Trigger | Mechanism | CPU cost |
|------|---------|-----------|----------|
| **Native byte-range** (`server/stream.js`) | `.mp4`, `.m4v`, `.webm` | WebTorrent `createReadStream` piped to HTTP 206 response; piece range prioritized via `torrent.critical()` | Zero |
| **HLS remux** (`server/transcode.js`) | `.mkv` etc. with H.264 video | `ffmpeg -c:v copy` rewraps to HLS segments on-the-fly | Near-zero |
| **HLS transcode** (`server/transcode.js`) | Incompatible codecs (H.265, AVI, etc.) | `libx264` ultrafast re-encode to HLS | Heavy |

Strategy is decided in `decideStrategy()` (`server/transcode.js:50`) by probing the file's codecs via `ffprobe` on the first 6 MB.

### Data flow

1. **Add torrent** — `POST /api/add` (magnet) or `POST /api/upload` (.torrent file) → `addTorrent()` in `server/torrent.js`. A single shared `WebTorrent` client manages all torrents. The largest video file is auto-selected.
2. **Select & probe** — `GET /api/play/:hash/:idx` → `selectOnly()` restricts download to that file only (saves bandwidth), then `decideStrategy()` probes codecs and returns `{ mode, url }`.
3. **Stream** — either `GET /stream/:hash/:idx` (native) or `GET /hls/:hash/:idx/*` (HLS segments + playlist). The HLS endpoint polls for file existence since ffmpeg writes lazily.
4. **Status polling** — `GET /api/status/:hash` returns live peer/speed/progress stats every second.

### Download prioritization

- `server/torrent.js:47-57` — `selectOnly()` deselects all pieces, then re-selects the chosen file. This means only the file being watched is downloaded.
- `server/stream.js:48-53` — `torrent.critical()` marks the playhead region as highest priority so the browser can start playback before the full file arrives.

### Lifecycle & cleanup

- `server/torrent.js:14` — `lastActivity` map tracks activity per infoHash, bumped by `touch()` on any stream request.
- `server/cleanup.js:7-18` — Idle sweeper runs every 60s; drops torrents with no activity for 30 minutes (`IDLE_TIMEOUT`).
- `server/cleanup.js:22-37` — On SIGINT/SIGTERM, destroys the WebTorrent client and wipes the temp directory.

### Key configuration (`server/config.js`)

- `TMP_DIR` — `os.tmpdir()/torrent-stream`; where WebTorrent stores pieces and ffmpeg writes HLS segments.
- `EXTRA_TRACKERS` — Appended to magnet URIs for faster peer discovery.
- `NATIVE_EXT` vs `VIDEO_EXT` — `NATIVE_EXT` is a subset of `VIDEO_EXT`; files with video extensions that aren't native go through HLS.

### Frontend (`public/app.js`)

Vanilla JS, no framework. Uses hls.js (loaded from CDN) for HLS playback in non-Safari browsers. Drag-and-drop and paste-to-stream UX. Auto-plays the largest video file in the torrent.

### Dependencies

- **webtorrent** — Torrent client (full swarm participation, piece download/upload)
- **fluent-ffmpeg** + **ffmpeg-static** + **ffprobe-static** — Video probing, remuxing, and transcoding (binaries ship with npm, no system install needed)
- **express** — HTTP server
- **multer** — Multipart parsing for .torrent file uploads
