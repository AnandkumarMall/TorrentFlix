import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'fs';
import path from 'path';
import { TMP_DIR } from './config.js';

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// One running HLS job per `${infoHash}:${fileIndex}`.
const jobs = new Map();

function jobKey(infoHash, fileIndex) {
  return `${infoHash}:${fileIndex}`;
}

// Probe the first chunk of a file to learn its video/audio codecs.
// We download a small prefix to a temp file (mkv/avi headers live up front).
export async function probeCodecs(file) {
  const prefix = path.join(TMP_DIR, `probe-${file.name.replace(/[^\w.-]/g, '_')}.bin`);
  await new Promise((resolve, reject) => {
    const end = Math.min(file.length - 1, 6 * 1024 * 1024);
    
    // Prioritize pieces for the probe to prevent hanging
    try {
      const pLen = file._torrent?.pieceLength;
      if (pLen) file._torrent.critical(0, Math.ceil(end / pLen));
    } catch {}

    const rs = file.createReadStream({ start: 0, end });
    const ws = fs.createWriteStream(prefix);
    rs.on('error', reject);
    ws.on('error', reject);
    ws.on('finish', resolve);
    rs.pipe(ws);
  });

  try {
    const data = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(prefix, (err, meta) => (err ? reject(err) : resolve(meta)));
    });
    const streams = data.streams || [];
    const v = streams.find((s) => s.codec_type === 'video');
    const a = streams.find((s) => s.codec_type === 'audio');
    return {
      video: v?.codec_name || null,
      audio: a?.codec_name || null,
      duration: parseFloat(data.format?.duration) || null,
    };
  } finally {
    fs.promises.unlink(prefix).catch(() => {});
  }
}

// Decide how to deliver a file: native byte-range, or HLS (remux vs transcode).
export async function decideStrategy(file, native) {
  if (native) return { mode: 'native' };

  let codecs = { video: null, audio: null, duration: null };
  try {
    codecs = await probeCodecs(file);
  } catch (e) {
    console.warn('[transcode] probe failed, will transcode:', e?.message || e);
  }
  // H.264 video can be copied (fast remux); everything else is re-encoded.
  const copyVideo = codecs.video === 'h264';
  return { mode: 'hls', copyVideo, codecs };
}

// Start (or reuse) an HLS job that reads the still-downloading torrent file
// and writes a growing event playlist + segments.
export function startHls(infoHash, fileIndex, file, copyVideo) {
  const key = jobKey(infoHash, fileIndex);
  const existing = jobs.get(key);
  if (existing) return existing;

  const dir = path.join(TMP_DIR, 'hls', key.replace(':', '_'));
  fs.mkdirSync(dir, { recursive: true });
  const playlist = path.join(dir, 'index.m3u8');

  const videoOpts = copyVideo
    ? ['-c:v', 'copy']
    : [
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '48', '-sc_threshold', '0',
      ];

  const command = ffmpeg(file.createReadStream())
    .inputOptions(['-analyzeduration', '10M', '-probesize', '10M', '-fflags', '+genpts'])
    .outputOptions([
      ...videoOpts,
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_playlist_type', 'event',
      '-hls_list_size', '0',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
    ])
    .output(playlist)
    .on('start', (cmd) => console.log('[ffmpeg] start', key, '\n  ' + cmd))
    .on('stderr', (line) => console.log('[ffmpeg]', line))
    .on('error', (err) => {
      if (!String(err?.message).includes('SIGKILL')) {
        console.error('[ffmpeg] ERROR', key, err?.message || err);
      }
    })
    .on('end', () => console.log('[ffmpeg] done', key));

  command.run();

  const job = { dir, playlist, command };
  jobs.set(key, job);
  return job;
}

export function stopHls(infoHash, fileIndex) {
  const key = jobKey(infoHash, fileIndex);
  const job = jobs.get(key);
  if (!job) return;
  try {
    job.command.kill('SIGKILL');
  } catch {}
  fs.promises.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  jobs.delete(key);
}

export function stopAllHlsFor(infoHash) {
  for (const key of [...jobs.keys()]) {
    if (key.startsWith(infoHash + ':')) {
      const [, idx] = key.split(':');
      stopHls(infoHash, Number(idx));
    }
  }
}

export function getJob(infoHash, fileIndex) {
  return jobs.get(jobKey(infoHash, fileIndex));
}
