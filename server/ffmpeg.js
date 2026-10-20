// ffmpeg helpers (binary bundled via ffmpeg-static — nothing to install)
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exit ${code}`))));
  });
}

// Browser renders H.264 video; we add the soundtrack as AAC so every editor (Premiere, DaVinci, CapCut) can open it.
export function muxVideoAudio(videoPath, audioPath, outPath) {
  return runFfmpeg([
    '-i', videoPath, '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k',
    '-shortest', '-movflags', '+faststart',
    outPath,
  ]);
}
