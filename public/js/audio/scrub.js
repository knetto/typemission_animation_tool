// Short output-only grains for dragging the playhead. Normal transport playback
// remains on the existing audio element. No microphone or recording is opened.
export function scrubGrain(pcm, sr, time, direction = 1, duration = 0.12) {
  if (!pcm?.length || !Number.isFinite(time)) return null;
  const at = Math.floor(time * sr), length = Math.max(1, Math.round(duration * sr));
  if (direction < 0) {
    const end = Math.min(pcm.length, at), start = Math.max(0, end - length);
    if (end <= start || at > pcm.length + length) return null;
    return { pcm: pcm.slice(start, end).reverse(), start: start / sr, end: end / sr };
  }
  const start = Math.max(0, at), end = Math.min(pcm.length, start + length);
  if (end <= start) return null;
  return { pcm: pcm.slice(start, end), start: start / sr, end: end / sr };
}

export class ScrubPlayer {
  constructor(sr = 48000) { this.sr = sr; this.context = null; this.pcm = null; this.voices = new Set(); this.lastTime = null; this.lastStart = -Infinity; }
  async begin() {
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Audio scrubben wordt niet ondersteund in deze browser.');
      this.context = new AudioContextClass({ latencyHint: 'interactive' });
    }
    await this.context.resume();
    this.lastTime = null; this.lastStart = -Infinity;
  }
  load(pcm) { this.pcm = pcm; }
  seek(time) {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.pcm) return;
    const now = context.currentTime;
    if (now - this.lastStart < 0.025 || (this.lastTime !== null && Math.abs(time - this.lastTime) < 0.001)) return;
    const direction = this.lastTime !== null && time < this.lastTime ? -1 : 1;
    this.lastTime = time; this.lastStart = now;
    const grain = scrubGrain(this.pcm, this.sr, time, direction);
    this.stop();
    if (!grain) return;
    const buffer = context.createBuffer(1, grain.pcm.length, this.sr); buffer.copyToChannel(grain.pcm, 0);
    const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer;
    const duration = grain.pcm.length / this.sr, fade = Math.min(0.006, duration / 3);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(1, now + fade);
    gain.gain.setValueAtTime(1, now + duration - fade); gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain); gain.connect(context.destination);
    const voice = { source, gain }; this.voices.add(voice);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(voice); };
    source.start(now); source.stop(now + duration);
  }
  stop() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const { source, gain } of this.voices) {
      gain.gain.cancelScheduledValues(now); gain.gain.setTargetAtTime(0, now, 0.002);
      try { source.stop(now + 0.008); } catch {}
    }
  }
  dispose() { this.stop(); this.pcm = null; this.context?.close().catch(() => {}); this.context = null; }
}
