// Deterministic speech-envelope vocoder. No microphone, network or live audio
// context: the same samples are used for clip previews, track FX and export.
import { rms, rng } from './dsp.js';

function bandpass(input, sr, frequency, q) {
  const w = 2 * Math.PI * Math.min(sr * 0.45, frequency) / sr;
  const alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  const b0 = alpha / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - alpha) / a0;
  const output = new Float32Array(input.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < input.length; i++) {
    const y = b0 * input[i] + z1;
    z1 = -a1 * y + z2;
    z2 = -b0 * input[i] - a2 * y;
    output[i] = y;
  }
  return output;
}

// Polynomial corrections at waveform edges avoid the aliasing of a naive saw
// or square oscillator, especially on bright, high-pitched droid voices.
function polyBlep(phase, step) {
  if (phase < step) { const x = phase / step; return 2 * x - x * x - 1; }
  if (phase > 1 - step) { const x = (phase - 1) / step; return x * x + 2 * x + 1; }
  return 0;
}

export function vocode(input, sr, { frequency = 110, bands = 24, formant = 1, pulse = 0.2, breath = 0.08, articulation = 0.22, chord = [0], vibrato = 0 } = {}) {
  const output = new Float32Array(input.length);
  const level = rms(input);
  if (!input.length || level < 1e-7) return output;
  const carrier = new Float32Array(input.length), random = rng(73);
  const phases = chord.map(() => 0);
  for (let i = 0; i < carrier.length; i++) {
    let value = 0;
    for (let note = 0; note < chord.length; note++) {
      const step = Math.min(0.4, frequency * 2 ** (chord[note] / 12) * (vibrato ? 1 + vibrato * Math.sin(2 * Math.PI * 4.2 * i / sr) : 1) / sr);
      const phase = phases[note];
      const saw = 2 * phase - 1 - polyBlep(phase, step);
      const square = (phase < 0.5 ? 1 : -1) + polyBlep(phase, step) - polyBlep((phase + 0.5) % 1, step);
      value += saw * (1 - pulse) + square * pulse;
      phases[note] = (phase + step) % 1;
    }
    carrier[i] = value / Math.sqrt(chord.length) + (random() * 2 - 1) * breath;
  }
  const low = 100, high = Math.min(8500, sr * 0.4);
  const ratio = (high / low) ** (1 / (bands - 1));
  const q = 0.85 / (Math.sqrt(ratio) - 1 / Math.sqrt(ratio));
  const attack = 1 - Math.exp(-1 / (sr * 0.002));
  const release = 1 - Math.exp(-1 / (sr * 0.018));
  for (let band = 0; band < bands; band++) {
    const frequency = low * ratio ** band;
    const analysis = bandpass(input, sr, frequency, q);
    const synth = bandpass(carrier, sr, frequency * formant, q);
    const scale = 1 / Math.max(0.008, rms(synth));
    let envelope = 0;
    for (let i = 0; i < input.length; i++) {
      const value = Math.abs(analysis[i]);
      envelope += (value - envelope) * (value > envelope ? attack : release);
      // Keep consonant detail in the upper bands for understandable speech.
      output[i] += synth[i] * scale * envelope + (frequency > 2800 ? analysis[i] * articulation : 0);
    }
  }
  // A carrier must never buzz through an empty gap. The short release follows
  // speech without the clicks produced by a hard gate or chopped audio frames.
  const gateAttack = 1 - Math.exp(-1 / (sr * 0.001));
  const gateRelease = 1 - Math.exp(-1 / (sr * 0.009));
  let activity = 0;
  for (let i = 0; i < input.length; i++) {
    const value = Math.abs(input[i]);
    activity += (value - activity) * (value > activity ? gateAttack : gateRelease);
    const gate = Math.min(1, activity / Math.max(1e-7, level * 0.045));
    output[i] *= gate;
  }
  return output;
}

// Smooth tape speed drift: tiny time changes rather than random pitch
// jumps. Linear interpolation keeps the duration and avoids sample steps.
export function tapeDrift(input, sr, depth = 0.0018) {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const time = i / sr;
    const position = Math.max(0, Math.min(input.length - 1, i + sr * depth * (Math.sin(2 * Math.PI * 0.7 * time) + 0.12 * Math.sin(2 * Math.PI * 8.3 * time))));
    const index = Math.floor(position), fraction = position - index;
    out[i] = input[index] * (1 - fraction) + (input[Math.min(index + 1, input.length - 1)] || 0) * fraction;
  }
  return out;
}
