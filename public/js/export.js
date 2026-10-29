// Frame-by-frame MP4 export: canvas scene → WebCodecs H.264 → mp4-muxer → server (ffmpeg adds AAC audio)
import { Muxer, ArrayBufferTarget } from '/vendor/mp4-muxer.mjs';
import { createScene, buildSoundtrack, ensureFonts } from './scenes/renderer.js';
import { encodeWav } from './util.js';
import { SR } from './audio/engine.js';

const CODECS = {
  '1080-30': ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'],
  '1080-60': ['avc1.64002a', 'avc1.4d002a', 'avc1.42e02a', 'avc1.640033'],
  '2160-30': ['avc1.640033', 'avc1.4d0033', 'avc1.640034'],
  '2160-60': ['avc1.640034', 'avc1.640033'],
};

export const exportSupported = () => typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';

async function pickConfig(width, height, fps) {
  const list = CODECS[`${height}-${fps}`] || CODECS['1080-30'];
  const bitrate = Math.round(width * height * fps * 0.14);   // ~8.7 Mbps @1080p30, ~35 Mbps @4K30
  for (const hw of ['prefer-hardware', 'no-preference', 'prefer-software']) {
    for (const codec of list) {
      const config = { codec, width, height, bitrate, framerate: fps, hardwareAcceleration: hw, avc: { format: 'avc' }, latencyMode: 'quality' };
      try { const r = await VideoEncoder.isConfigSupported(config); if (r.supported) return r.config; } catch { /* try next */ }
    }
  }
  throw new Error(`Your browser cannot encode H.264 ${height}p${fps}. Try 1080p / 30fps in Chrome or Edge.`);
}

/**
 * Render a project scene to MP4 and upload it.
 * @param {object} o { projectId, mode, opts, voice(Float32Array@SR), width, height, fps, onProgress(p, label), signal }
 */
export async function renderExport({ projectId, mode, opts, voice, width = 1920, height = 1080, fps = 30, onProgress = () => {}, signal }) {
  if (!exportSupported()) throw new Error('WebCodecs is not supported. Use Chrome or Edge.');
  await ensureFonts();
  onProgress(0, 'Preparing…');

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const scene = createScene(canvas, { mode, opts, voice });
  const sched = scene.schedule;
  const soundtrack = await buildSoundtrack(mode, voice, sched, opts);
  scene.setSoundtrack(soundtrack);
  const duration = sched.total;
  return renderCanvasExport({ projectId, canvas, scene, soundtrack, duration, mode, width, height, fps, onProgress, signal });
}

// Shared encoder for Audio Terminal scenes, File Terminal sequence, and Keyboard Sticker animations.
export async function renderCanvasExport({ projectId, canvas, scene, soundtrack, duration, startTime = 0, mode = 'file', keyLabel = '', partLabel = '', width = 1920, height = 1080, fps = 30, onProgress = () => {}, signal }) {
  if (!exportSupported()) throw new Error('Video export requires Chrome or Edge.');
  canvas.width = width; canvas.height = height;
  const frames = Math.ceil(duration * fps);

  const config = await pickConfig(width, height, fps);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
  let encErr = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  encoder.configure(config);

  scene.reset();
  const t0 = performance.now();
  try {
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new DOMException('Geannuleerd', 'AbortError');
      if (encErr) throw encErr;
      scene.draw(startTime + i / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 10) {
        if (signal?.aborted) throw new DOMException('Geannuleerd', 'AbortError');
        if (encErr) throw encErr;
        await new Promise((r) => setTimeout(r, 1));
      }
      if (i % 6 === 0) {
        const el = (performance.now() - t0) / 1000, eta = (el / (i + 1)) * (frames - i - 1);
        onProgress((i / frames) * 0.9, `Frame ${i + 1} / ${frames} · ~${Math.ceil(eta)}s remaining`);
        await new Promise((r) => setTimeout(r, 0));   // keep UI responsive
      }
    }
    await encoder.flush();
    if (encErr) throw encErr;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  muxer.finalize();

  onProgress(0.92, 'Uploading & adding audio…');
  const fd = new FormData();
  fd.append('video', new Blob([target.buffer], { type: 'video/mp4' }), 'video.mp4');
  fd.append('audio', encodeWav(soundtrack, SR), 'audio.wav');
  fd.append('scene', mode); fd.append('width', width); fd.append('height', height); fd.append('fps', fps); fd.append('duration', duration.toFixed(2));
  if (keyLabel) fd.append('keyLabel', keyLabel);
  if (partLabel) fd.append('partLabel', partLabel);
  const response = await fetch(`/api/projects/${projectId}/exports`, { method: 'POST', body: fd, signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Video export failed');
  onProgress(1, 'Done!');
  return result;
}

// Transparent export: canvas frames → PNG → server → WebM VP9/Opus or MOV ProRes/PCM.
// H.264/WebCodecs has no alpha channel, so every frame is uploaded losslessly as PNG in batches.
export async function renderCanvasExportMov({ projectId, canvas, scene, soundtrack, duration, mode = 'hack', format = 'mov', width = 1920, height = 1080, fps = 30, onProgress = () => {}, signal }) {
  canvas.width = width; canvas.height = height;
  const frames = Math.ceil(duration * fps);
  const abortErr = () => new DOMException('Geannuleerd', 'AbortError');
  const json = async (r, fallback) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || fallback); return b; };

  onProgress(0, `Preparing transparent ${format.toUpperCase()}…`);
  const { token } = await json(await fetch(`/api/projects/${projectId}/exports/mov`, { method: 'POST', signal }), 'Could not start transparent export');
  const toPng = () => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'));
  const upload = (batch) => {
    const fd = new FormData();
    for (const [i, blob] of batch) fd.append('frames', blob, `${String(i).padStart(6, '0')}.png`);
    return fetch(`/api/exports/mov/${token}/frames`, { method: 'POST', body: fd, signal }).then((r) => json(r, 'Frame upload failed'));
  };

  let ok = false;
  try {
    scene.reset();
    const t0 = performance.now();
    let batch = [], bytes = 0, inFlight = Promise.resolve();
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw abortErr();
      scene.draw(i / fps);
      const blob = await toPng();
      batch.push([i, blob]); bytes += blob.size;
      if (batch.length >= 40 || bytes > 48 * 1024 * 1024 || i === frames - 1) {
        await inFlight;                      // keep at most one batch uploading while we render the next
        inFlight = upload(batch);
        inFlight.catch(() => {});            // error is re-thrown at the next await
        batch = []; bytes = 0;
      }
      if (i % 3 === 0) {
        const el = (performance.now() - t0) / 1000, eta = (el / (i + 1)) * (frames - i - 1);
        onProgress((i / frames) * 0.85, `Frame ${i + 1} / ${frames} · ~${Math.ceil(eta)}s remaining`);
      }
    }
    await inFlight;

    onProgress(0.88, format === 'webm' ? 'Building compact WebM (alpha)…' : 'Building ProRes 4444 MOV (alpha)…');
    const fd = new FormData();
    fd.append('format', format);
    fd.append('audio', encodeWav(soundtrack, SR), 'audio.wav');
    fd.append('scene', mode); fd.append('width', width); fd.append('height', height); fd.append('fps', fps); fd.append('duration', duration.toFixed(2));
    const result = await json(await fetch(`/api/exports/mov/${token}/finish`, { method: 'POST', body: fd, signal }), 'Transparent export failed');
    ok = true;
    onProgress(1, 'Done!');
    return result;
  } finally {
    if (!ok) fetch(`/api/exports/mov/${token}`, { method: 'DELETE' }).catch(() => {});
  }
}

export async function renderAudioExport({ projectId, pcm, format = 'wav', partLabel = '', onProgress = () => {}, signal }) {
  if (!pcm.length) throw new Error('Add audio to the timeline first.');
  if (signal?.aborted) throw new DOMException('Geannuleerd', 'AbortError');
  onProgress(0.1, 'Preparing audio…');
  const fd = new FormData();
  fd.append('audio', encodeWav(pcm, SR), 'audio.wav');
  fd.append('scene', 'audio'); fd.append('format', format); fd.append('duration', (pcm.length / SR).toFixed(3));
  if (partLabel) fd.append('partLabel', partLabel);
  onProgress(0.5, 'Saving audio…');
  const response = await fetch(`/api/projects/${projectId}/exports`, { method: 'POST', body: fd, signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Audio export failed');
  onProgress(1, 'Done!');
  return result;
}
