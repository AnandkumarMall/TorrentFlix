# ▶ Torrent Stream

A lightweight, fast, local web app to stream a magnet link or `.torrent` file
directly in your browser. The **server** is the torrent peer (full TCP/UDP swarm
via WebTorrent) and streams video to a plain `<video>` element over HTTP
byte-range — so the browser stays light and start-up/buffering stays minimal.

## Features
- Paste a **magnet link** or drop a **.torrent** file.
- Streams while downloading (sequential, playhead-prioritized pieces).
- Plays **everything**:
  - `mp4` / `webm` / `m4v` → direct native byte-range (zero CPU).
  - `mkv` (H.264) and similar → **remux** to HLS with `-c copy` (near-zero CPU).
  - `avi` / H.265 / odd codecs → on-the-fly **transcode** to HLS.
- Live status bar: peers, download speed, progress.
- Downloads **only** the file you watch; auto-cleans temp files on exit/idle.

## Requirements
- Node.js 18+ (uses native fetch / ESM). No system ffmpeg needed —
  `ffmpeg-static` / `ffprobe-static` ship the binaries.

## Run
```bash
npm install
npm start
# open http://localhost:8000
```
Set a different port with `PORT=9000 npm start`.

## How it works
| Path | When | Cost |
|------|------|------|
| Native byte-range (`/stream`) | mp4/webm/m4v | none |
| HLS remux (`-c copy`) | mkv etc. with H.264 video | very low |
| HLS transcode (libx264) | incompatible codecs | CPU-heavy |

## Notes
- Intended for **personal/local use**. No auth, single user.
- Seeking far ahead into a still-downloading file may pause briefly while those
  pieces arrive — expected for live torrent streaming.
- Only download/stream content you are legally allowed to.
