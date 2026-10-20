// Audio engine: decode sources, process clips (trim/reverse/speed/pitch/voice FX), mix the timeline.
// Playback uses a plain <audio> element with a rendered WAV — no live AudioContext (Bluetooth-safe).
import { speedPitch, reverse, peaks } from './dsp.js';
import { applyVoiceFx } from './voicefx.js';
import { renderBuiltin, SR } from './sfxlib.js';
import { encodeWav } from '../util.js';

export { SR };

export function defaultTimeline() {
  return {
    version: 1,
    zoom: 90,
    tracks: [
      { id: 't_voice', name: 'Audio 1', kind: 'voice', gain: 1, mute: false, solo: false },
    ],
    clips: [],
  };
}

export const clipDefaults = () => ({ gain: 1, fadeIn: 0, fadeOut: 0, reverse: false, speed: 1, pitch: 0, fx: 'none', fxAmount: 1 });

export class AudioEngine {
  constructor(resolveUrl) {
    this.resolveUrl = resolveUrl;          // (src) => url for asset/sfx sources
    this.sources = new Map();              // srcKey -> Promise<Float32Array>
    this.durations = new Map();            // srcKey -> seconds
    this.processed = new Map();            // clipKey -> Promise<Float32Array>
    this.processedReady = new Map();       // clipKey -> Float32Array (sync access for drawing)
    this.peakCache = new Map();
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
        const a = Math.max(0, Math.round(c.offset * SR));
        const b = Math.min(src.length, Math.round((c.offset + c.duration * c.speed) * SR));
        let y = src.slice(a, Math.max(a + 1, b));
        if (c.reverse) y = reverse(y);
        if (c.speed !== 1 || c.pitch !== 0) y = speedPitch(y, c.speed, c.pitch);
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

  // Mix timeline (or a subset of clips) into mono PCM
  async renderMix(tl, { clipIds = null, ignoreMute = false } = {}) {
    const anySolo = tl.tracks.some((t) => t.solo);
    const trackOn = (t) => ignoreMute || (anySolo ? t.solo : !t.mute);
    const tracks = Object.fromEntries(tl.tracks.map((t) => [t.id, t]));
    const clips = tl.clips.filter((c) => tracks[c.trackId] && (clipIds ? clipIds.includes(c.id) : trackOn(tracks[c.trackId])));
    const bufs = await Promise.all(clips.map((c) => this.processClip(c)));
    const base = clipIds ? Math.min(...clips.map((c) => c.start), Infinity) : 0;
    const offset = Number.isFinite(base) ? base : 0;
    let total = 1;
    clips.forEach((c, i) => { total = Math.max(total, Math.round((c.start - offset) * SR) + bufs[i].length); });
    const mix = new Float32Array(total);
    clips.forEach((c, i) => {
      const y = bufs[i], s0 = Math.round((c.start - offset) * SR);
      const g = c.gain * (tracks[c.trackId].gain ?? 1);
      const dlen = Math.round(c.duration * SR), fi = c.fadeIn * SR, fo = c.fadeOut * SR;
      for (let k = 0; k < y.length; k++) {
        let env = 1;
        if (fi > 0 && k < fi) env = k / fi;
        if (fo > 0) { if (k >= dlen) env = 0; else if (k > dlen - fo) env = Math.min(env, (dlen - k) / fo); }
        mix[s0 + k] += y[k] * g * env;
      }
    });
    let peak = 0;
    for (let i = 0; i < mix.length; i++) { const v = Math.abs(mix[i]); if (v > peak) peak = v; }
    if (peak > 0.98) { const s = 0.98 / peak; for (let i = 0; i < mix.length; i++) mix[i] *= s; }
    return { pcm: mix, duration: mix.length / SR, offset };
  }
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

// Simple preview player around <audio>
export class Player {
  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.url = null;
    this.offset = 0;      // timeline time at audio t=0
  }
  load(pcm, offset = 0) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(encodeWav(pcm, SR));
    this.el.src = this.url;
    this.offset = offset;
  }
  async play(from = 0) {
    this.el.currentTime = Math.max(0, from - this.offset);
    await this.el.play();
  }
  pause() { this.el.pause(); }
  dispose() { this.pause(); this.el.removeAttribute('src'); this.el.load(); if (this.url) URL.revokeObjectURL(this.url); this.url = null; }
  get playing() { return !this.el.paused && !this.el.ended; }
  get time() { return this.offset + this.el.currentTime; }
}
