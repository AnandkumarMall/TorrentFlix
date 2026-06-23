# TorrentFlix 🎬

TorrentFlix is a lightning-fast, lightweight web application that allows you to instantly stream video files from magnet links or `.torrent` files directly in your browser. No need to wait for a full download—just paste your link and start watching immediately!

## ✨ Features

- **Instant Streaming**: Start watching videos within seconds.
- **Smart Format Handling**: Streams web-friendly formats (`.mp4`, `.webm`, `.mkv`) natively using HTTP byte-range requests, allowing for instant, random-access seeking (even into parts of the file that haven't finished downloading yet).
- **On-the-Fly Transcoding**: Automatically detects unsupported formats (like `.avi`) and transcodes them on-the-fly into HTTP Live Streaming (HLS) segments using `ffmpeg`.
- **Sleek UI**: Beautiful, responsive, dark-themed YouTube-style video player powered by `Plyr`.
- **Intelligent Resource Management**: Built-in background sweepers automatically clean up disk space and terminate torrents exactly when you close the tab or go idle, preventing storage bloat.
- **Fully Tested**: Comes with an automated Jest test suite to ensure API and tracking stability.

---

## 🏗️ Architecture & Technology Stack

TorrentFlix is designed to be highly optimized and dependency-light, utilizing modern web standards for the best streaming experience.

### Backend (Node.js + Express)
* **WebTorrent (`webtorrent`)**: The core engine. It connects to the DHT network to fetch metadata, connects to peers, and aggressively downloads the exact byte-chunks requested by the video player.
* **FFmpeg (`fluent-ffmpeg` + `ffmpeg-static`)**: Acts as a safety net. If a video file is not natively playable by the browser, the backend spins up an isolated `ffmpeg` process to convert the file into an HLS (`.m3u8` / `.ts`) stream in real-time.
* **Express.js**: Serves the REST API, handles static file routing, and manages the byte-range HTTP streams for native video playback.

### Frontend (Vanilla JS + HTML + CSS)
* **Plyr**: A simple, accessible, and customizable HTML5 Video player. It provides a premium, customized interface with 5-second skip intervals.
* **Hls.js**: A JavaScript library that implements an HTTP Live Streaming client. It intercepts the video player when transcoding is required and stitches the `.ts` video segments together seamlessly.
* **Beacon API**: Uses `navigator.sendBeacon` to instantly alert the backend to drop torrents the exact millisecond the user closes the tab or refreshes the page.

---

## 🚀 How to Start

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/AnandkumarMall/TorrentFlix.git
   cd TorrentFlix
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```

### Running the App
Start the server using:
```bash
npm start
```
*The server will launch at `http://localhost:8000`.*

Open your browser, paste a magnet link (or drop a `.torrent` file), click **Stream**, and grab your popcorn! 🍿

### Development & Testing
To run the server with live-reloading during development:
```bash
npm run dev
```

To run the automated test suite (powered by Jest and Supertest):
```bash
npm run test
```

---

## 🛠️ How it Works under the Hood

1. **Upload Phase**: A user submits a magnet link or `.torrent` file to the `/api/add` endpoint.
2. **Metadata Resolution**: WebTorrent fetches the metadata. A heartbeat interval keeps the session alive during this potentially slow DHT discovery phase.
3. **Codec Probing**: Once the files are discovered, the backend uses `ffprobe` to check the video/audio codecs.
4. **Playback Decision**: 
    - If the browser can play it natively (e.g., standard `.mkv` or `.mp4`), the server returns a `native` streaming URL. The frontend requests specific byte ranges, and WebTorrent prioritizes downloading those exact pieces from peers.
    - If it's unsupported, the server returns an `hls` URL. `ffmpeg` begins transcoding the file to `TMP_DIR`, and `hls.js` fetches the live segments.
5. **Cleanup**: When the user closes the page, an immediate `/api/stop` beacon is fired, deleting the torrent, stopping `ffmpeg`, and wiping the temporary storage directory.

## License
MIT License
