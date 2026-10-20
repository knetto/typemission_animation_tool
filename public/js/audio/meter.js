// Digital signal level over a causal 50 ms window, in dB relative to full scale.
// This measures the PCM being played/exported, not speaker loudness in the room.
export function measureAudio(pcm, sampleRate, time, windowSeconds = 0.05) {
  const silence = { rms: 0, peak: 0, dbfs: -Infinity, live: false };
  if (!pcm?.length || !Number.isFinite(time) || time < 0 || time >= pcm.length / sampleRate) return silence;
  const count = Math.max(1, Math.round(sampleRate * windowSeconds));
  const end = Math.min(pcm.length, Math.floor(time * sampleRate) + 1);
  const start = Math.max(0, end - count);
  let sum = 0, peak = 0;
  for (let i = start; i < end; i++) {
    const sample = Number.isFinite(pcm[i]) ? pcm[i] : 0;
    sum += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(sum / count);
  return { rms, peak, dbfs: rms > 0 ? 20 * Math.log10(rms) : -Infinity, live: peak > 0 };
}

export const formatDbfs = (value) => Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : '−∞ dBFS';
