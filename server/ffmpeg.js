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

// PNG sequence (with alpha) + soundtrack → ProRes 4444 .mov that keeps transparency in every NLE.
export function pngSequenceToProRes(framePattern, fps, audioPath, outPath) {
  return runFfmpeg([
    '-framerate', String(fps), '-i', framePattern,
    ...(audioPath ? ['-i', audioPath] : []),
    '-map', '0:v:0', ...(audioPath ? ['-map', '1:a:0', '-c:a', 'pcm_s16le', '-ar', '48000', '-shortest'] : []),
    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0',
    '-r', String(fps),
    outPath,
  ]);
}

// Compact transparent video: inter-frame VP9 compression with an alpha channel.
export function pngSequenceToWebm(framePattern, fps, audioPath, outPath) {
  return runFfmpeg([
    '-framerate', String(fps), '-i', framePattern,
    ...(audioPath ? ['-i', audioPath] : []),
    '-map', '0:v:0', ...(audioPath ? ['-map', '1:a:0', '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-shortest'] : []),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '32', '-b:v', '0',
    '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-lag-in-frames', '0',
    '-r', String(fps),
    outPath,
  ]);
}
