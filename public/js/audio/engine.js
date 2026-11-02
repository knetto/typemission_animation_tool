// Audio engine: decode sources, process clips (trim/reverse/speed/pitch/voice FX), mix the timeline.
// Playback uses a plain <audio> element with a rendered WAV — no live AudioContext (Bluetooth-safe).
import { reverse, peaks } from './dsp.js';
import { runDsp } from './dsp-jobs.js';
import { applyVoiceFx } from './voicefx.js';
import { applyGlitchRegions, glitchVisualEnvelope } from './glitches.js';
import { renderBuiltin, SR } from './sfxlib.js';
import { encodeWav } from '../util.js';

export { SR };

export function defaultTimeline() {
  return {
    version: 1,
    zoom: 90,
    tracks: [
      { id: 't_voice', name: 'Audio 1', kind: 'voice', gain: 1, mute: false, solo: false, glitch: false, fx: 'none', fxAmount: 1 },
    ],
    clips: [],
    effects: [],
  };
}

export const clipDefaults = () => ({ gain: 1, fadeIn: 0, fadeOut: 0, reverse: false, speed: 1, pitch: 0, fx: 'none', fxAmount: 1 });

export class AudioEngine {
  constructor(resolveUrl) {
    this.resolveUrl = resolveUrl;          // (src) => url for asset/sfx sources
    this.sources = new Map();              // srcKey -> Promise<Float32Array>
    this.sourceReady = new Map();          // decoded PCM for source-accurate live trim drawing
    this.durations = new Map();            // srcKey -> seconds
    this.processed = new Map();            // clipKey -> Promise<Float32Array>
    this.processedReady = new Map();       // clipKey -> Float32Array (sync access for drawing)
    this.peakCache = new Map();
    this.trackRenders = new Map();          // cache voice FX independently of glitch overlays
    this.mixRenders = new Map();            // completed/in-flight mixes shared by editor and export
  }

  srcKey(src) { return `${src.type}:${src.id ?? src.key}`; }

  getSource(src) {
    const k = this.srcKey(src);
    if (!this.sources.has(k)) {
      const p = (async () => {
        let pcm;
        if (src.type === 'builtin') pcm = await renderBuiltin(src.key);
        else pcm = await decodeUrl(this.resolveUrl(src));
        this.durations.set(k, pcm.length / SR);
        this.sourceReady.set(k, pcm);
        return pcm;
      })();
      p.catch(() => this.sources.delete(k));
      this.sources.set(k, p);
    }
    return this.sources.get(k);
  }

  sourceDuration(src) { return this.durations.get(this.srcKey(src)); }

  clipKey(c) { return JSON.stringify([this.srcKey(c.src), +c.offset.toFixed(4), +c.duration.toFixed(4), !!c.reverse, c.speed, c.pitch, c.fx, c.fxAmount]); }

  processClip(c) {
    const key = this.clipKey(c);
    if (!this.processed.has(key)) {
      const p = (async () => {
        const src = await this.getSource(c.src);
        this.sourceReady.set(this.srcKey(c.src), src);
        const a = Math.max(0, Math.round(c.offset * SR));
        const b = Math.min(src.length, Math.round((c.offset + c.duration * c.speed) * SR));
        let y = src.slice(a, Math.max(a + 1, b));
        if (c.reverse) y = reverse(y);
        if (c.speed !== 1 || c.pitch !== 0) y = await runDsp('speedPitch', y, { speed: c.speed, pitch: c.pitch });
        const want = Math.max(1, Math.round(c.duration * SR));
        if (Math.abs(y.length - want) > 1) { const z = new Float32Array(want); z.set(y.subarray(0, want)); y = z; }
        if (c.fx && c.fx !== 'none') y = await applyVoiceFx(y, SR, c.fx, c.fxAmount ?? 1);
        this.processedReady.set(key, y);
        return y;
      })();
      p.catch((e) => { console.error('processClip', e); this.processed.delete(key); });
      this.processed.set(key, p);
      if (this.processed.size > 300) { const first = this.processed.keys().next().value; this.processed.delete(first); this.processedReady.delete(first); }
    }
    return this.processed.get(key);
  }

  clipPeaks(c, buckets) {
    const y = this.processedReady.get(this.clipKey(c));
    if (!y) return null;
    const k = this.clipKey(c) + '|' + buckets;
    if (!this.peakCache.has(k)) {
      const visible = y.subarray(0, Math.min(y.length, Math.round(c.duration * SR)));
      this.peakCache.set(k, peaks(visible, buckets));
      if (this.peakCache.size > 500) this.peakCache.delete(this.peakCache.keys().next().value);
    }
    return this.peakCache.get(k);
  }

  mixKey(tl, { clipIds = null, ignoreMute = false } = {}) {
    return JSON.stringify([
      tl.tracks.map(t => [t.id, t.fx || 'none', t.fxAmount ?? 1, t.gain ?? 1, !!t.mute, !!t.solo, !!t.glitch]),
      tl.clips.map(c => [c.id, c.trackId, c.start, this.clipKey(c), c.gain, c.fadeIn, c.fadeOut]),
      (tl.effects || []).map(e => [e.id, e.trackId, e.type, e.start, e.duration, e.enabled !== false, e.amount ?? 1, e.rate ?? 9, e.grain ?? 0.065,
        e.dynamic === true && e.dynamicOptIn === true, e.density ?? 0.32, e.burst ?? 0.24, e.variation ?? 0.5, e.seed ?? 0,
        e.visual !== false, e.visualAmount ?? 1, e.bits ?? 5, e.sampleRate ?? 7000, e.packetLoss ?? 0.2, e.packetRepeat ?? 0.15, e.gate ?? 0.58,
        ['stutter', 'hitch', 'dropout', 'connection', 'digital'].map(part => e.parts?.[part] !== false)]),
      clipIds, ignoreMute,
    ]);
  }

  // Names, selection, zoom and scene appearance never invalidate audio.
  renderMix(tl, options = {}) {
    const key = this.mixKey(tl, options), listener = options.onProgress;
    let job = this.mixRenders.get(key);
    if (!job) {
      job = { listeners: new Set(), progress: { progress: 0, label: 'Audiobestanden laden…' }, promise: null };
      const report = progress => { job.progress = progress; for (const notify of job.listeners) notify(progress); };
      const timeline = structuredClone(tl);
      job.promise = Promise.resolve().then(() => this._renderMix(timeline, { ...options, onProgress: report })).then(result => { report({ progress: 1, label: 'Audio klaar' }); return result; });
      this.mixRenders.set(key, job);
      job.promise.catch(() => { if (this.mixRenders.get(key) === job) this.mixRenders.delete(key); }).finally(() => job.listeners.clear());
      // Keep only a couple of full mixes; source/track caches handle older edits.
      if (this.mixRenders.size > 2) this.mixRenders.delete(this.mixRenders.keys().next().value);
    }
    if (listener) { listener(job.progress); if (job.progress.progress < 1) job.listeners.add(listener); }
    return job.promise;
  }

  // Mix timeline (or a subset of clips) into mono PCM.
  async _renderMix(tl, { clipIds = null, ignoreMute = false, onProgress = () => {} } = {}) {
    const anySolo = tl.tracks.some((t) => t.solo);
    const trackOn = (t) => ignoreMute || (anySolo ? t.solo : !t.mute);
    const tracks = Object.fromEntries(tl.tracks.map((t) => [t.id, t]));
    const clips = tl.clips.filter((c) => tracks[c.trackId] && (clipIds ? clipIds.includes(c.id) : trackOn(tracks[c.trackId])));
    let decoded = 0, rendered = 0;
    const bufs = await Promise.all(clips.map(async c => { const pcm = await this.processClip(c); onProgress({ progress: 0.35 * ++decoded / clips.length, label: `Audioclips voorbereiden · ${decoded}/${clips.length}` }); return pcm; }));
    const base = clipIds ? Math.min(...clips.map((c) => c.start), Infinity) : 0;
    const offset = Number.isFinite(base) ? base : 0;
    // Sum each track before its effect, so overlapping lines and effect tails
    // share one continuous chain. Track gain follows FX to preserve volume.
    const renderedTracks = await Promise.all(tl.tracks.map(async (track) => {
      const entries = clips.flatMap((clip, i) => clip.trackId === track.id ? [{ clip, pcm: bufs[i], start: Math.round((clip.start - offset) * SR) }] : []);
      if (!entries.length) return null;
      const start = Math.min(...entries.map(entry => entry.start));
      const length = Math.max(...entries.map(entry => entry.start - start + entry.pcm.length));
      const cacheKey = JSON.stringify([track.id, track.fx, track.fxAmount, entries.map(({ clip, start: at }) => [this.clipKey(clip), at - start, clip.gain, clip.fadeIn, clip.fadeOut])]);
      if (!this.trackRenders.has(cacheKey)) {
        const rendering = (async () => {
          let pcm = new Float32Array(length);
          for (const { clip, pcm: y, start: clipStart } of entries) {
            const s0 = clipStart - start;
            const dlen = Math.round(clip.duration * SR), fi = clip.fadeIn * SR, fo = clip.fadeOut * SR;
            for (let k = 0; k < y.length; k++) {
              let env = 1;
              if (fi > 0 && k < fi) env = k / fi;
              if (fo > 0) { if (k >= dlen) env = 0; else if (k > dlen - fo) env = Math.min(env, (dlen - k) / fo); }
              pcm[s0 + k] += y[k] * clip.gain * env;
            }
          }
          if (track.fx && track.fx !== 'none') pcm = await applyVoiceFx(pcm, SR, track.fx, track.fxAmount ?? 1);
          return pcm;
        })();
        this.trackRenders.set(cacheKey, rendering);
        rendering.catch(() => this.trackRenders.delete(cacheKey));
        if (this.trackRenders.size > 6) this.trackRenders.delete(this.trackRenders.keys().next().value);
      }
      onProgress({ progress: 0.35 + 0.5 * rendered / tl.tracks.length, label: track.fx && track.fx !== 'none' ? `Stemeffect voorbereiden · ${track.name || 'Audiospoor'}` : 'Sporen voorbereiden…' });
      const basePcm = await this.trackRenders.get(cacheKey);
      const effects = (tl.effects || []).filter(effect => effect.trackId === track.id);
      const pcm = applyGlitchRegions(basePcm, SR, effects, offset + start / SR);
      const visual = glitchVisualEnvelope(basePcm.length, SR, effects, offset + start / SR);
      onProgress({ progress: 0.35 + 0.5 * ++rendered / tl.tracks.length, label: `Sporen voorbereiden · ${rendered}/${tl.tracks.length}` });
      return { track, start, pcm, basePcm, visual };
    }));
    const activeTracks = renderedTracks.filter(Boolean);
    onProgress({ progress: 0.9, label: 'Sporen samenvoegen…' });
    const total = Math.max(1, ...activeTracks.map(({ start, pcm }) => start + pcm.length));
    const mix = new Float32Array(total);
    const glitchMix = activeTracks.some(({ track, visual }) => track.glitch || visual) ? new Float32Array(total) : null;
    for (const { track, start, pcm, basePcm, visual } of activeTracks) {
      const gain = track.gain ?? 1;
      for (let i = 0; i < pcm.length; i++) {
        const value = pcm[i] * gain;
        mix[start + i] += value;
        // Merge visual triggers once. Read the pre-glitch voice for overlays so
        // an intentional audio dropout can still produce a screen glitch.
        if (glitchMix) glitchMix[start + i] = Math.max(glitchMix[start + i], track.glitch ? Math.abs(value) : 0, visual ? Math.abs(basePcm[i] * gain) * visual[i] : 0);
      }
    }
    let peak = 0;
    for (let i = 0; i < mix.length; i++) { const v = Math.abs(mix[i]); if (v > peak) peak = v; }
    if (peak > 0.98) {
      const s = 0.98 / peak;
      for (let i = 0; i < mix.length; i++) {
        mix[i] *= s;
      }
    }
    return { pcm: mix, glitchPcm: glitchMix, duration: mix.length / SR, offset };
  }
}

// A single retained project session bounds memory while preserving expensive
// processing when switching between its editor and export screen.
let projectAudio = null;
export function getProjectAudio(projectId, resolveUrl) {
  if (!projectAudio || projectAudio.id !== projectId) projectAudio = { id: projectId, engine: new AudioEngine(resolveUrl) };
  projectAudio.engine.resolveUrl = resolveUrl;
  return projectAudio.engine;
}

const decodeCache = new Map();
export function decodeUrl(url) {
  if (!decodeCache.has(url)) {
    decodeCache.set(url, (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Kon audio niet laden');
      const ab = await res.arrayBuffer();
      return decodeArrayBuffer(ab);
    })());
  }
  return decodeCache.get(url);
}

export async function decodeArrayBuffer(ab) {
  const ctx = new OfflineAudioContext(1, 1, SR);   // decoding only — never touches the audio device
  const buf = await ctx.decodeAudioData(ab);
  const c0 = buf.getChannelData(0);
  if (buf.numberOfChannels === 1) return c0.slice();
  const out = new Float32Array(c0.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels; }
  return out;
}

const wavCache = new WeakMap();
// Simple preview player around <audio>
export class Player {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.url = null;
    this.offset = 0;      // timeline time at audio t=0
    this._starting = false;
    this.pcm = null;
  }
  load(pcm, offset = 0) {
    if (this.pcm === pcm && this.url) { this.offset = offset; return; }
    this._starting = false;
    if (this.url) URL.revokeObjectURL(this.url);
    if (!wavCache.has(pcm)) wavCache.set(pcm, encodeWav(pcm, SR));
    this.url = URL.createObjectURL(wavCache.get(pcm)); this.pcm = pcm;
    this.el.src = this.url;
    this.offset = offset;
  }
  async play(from = 0) {
    this._starting = true;
    try {
      this.el.currentTime = Math.max(0, from - this.offset);
      await this.el.play();
    } finally {
      this._starting = false;
    }
  }
  pause() { this._starting = false; this.el.pause(); }
  dispose() { this.pause(); this.el.removeAttribute('src'); this.el.load(); if (this.url) URL.revokeObjectURL(this.url); this.url = null; this.pcm = null; }
  get playing() { return this._starting || (!this.el.paused && !this.el.ended); }
  get time() { return this.offset + this.el.currentTime; }
}
