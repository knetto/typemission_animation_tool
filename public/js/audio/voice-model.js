// Harmonic speech resynthesis: separate the vocal-tract envelope from the
// incoming pitch, then rebuild voiced speech with a new excitation. Unvoiced
// consonants retain their timing and phase. Runs inside the DSP worker.

const plans = new Map();
function plan(size) {
  if (!plans.has(size)) {
    const reverse = new Uint16Array(size), bits = Math.log2(size);
    const cosine = new Float64Array(size / 2), sine = new Float64Array(size / 2);
    const window = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      let x = i, reversed = 0;
      for (let bit = 0; bit < bits; bit++) { reversed = reversed * 2 + (x & 1); x >>>= 1; }
      reverse[i] = reversed;
      window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size);
      if (i < size / 2) { cosine[i] = Math.cos(2 * Math.PI * i / size); sine[i] = Math.sin(2 * Math.PI * i / size); }
    }
    plans.set(size, { reverse, cosine, sine, window });
  }
  return plans.get(size);
}

function fft(real, imaginary, inverse = false) {
  const size = real.length, { reverse, cosine, sine } = plan(size);
  for (let i = 0; i < size; i++) {
    const j = reverse[i];
    if (j > i) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let span = 2; span <= size; span *= 2) {
    const half = span / 2, step = size / span;
    for (let start = 0; start < size; start += span) for (let i = 0; i < half; i++) {
      const angle = i * step, c = cosine[angle], s = sine[angle] * (inverse ? 1 : -1);
      const a = start + i, b = a + half;
      const r = real[b] * c - imaginary[b] * s, im = real[b] * s + imaginary[b] * c;
      real[b] = real[a] - r; imaginary[b] = imaginary[a] - im;
      real[a] += r; imaginary[a] += im;
    }
  }
  if (inverse) for (let i = 0; i < size; i++) { real[i] /= size; imaginary[i] /= size; }
}

function estimatePitch(input, start, size, sr) {
  const step = Math.max(1, Math.floor(sr / 8000)), rate = sr / step;
  const count = Math.floor(size / step), samples = new Float64Array(count);
  let mean = 0;
  for (let i = 0; i < count; i++) { samples[i] = input[Math.max(0, Math.min(input.length - 1, start + i * step))]; mean += samples[i]; }
  mean /= count;
  for (let i = 0; i < count; i++) samples[i] -= mean;
  let best = 0, bestLag = 0;
  const first = Math.ceil(rate / 420), last = Math.min(Math.floor(rate / 65), Math.floor(count / 2));
  for (let lag = first; lag <= last; lag++) {
    let cross = 0, left = 0, right = 0;
    for (let i = lag; i < count; i++) { cross += samples[i] * samples[i - lag]; left += samples[i] ** 2; right += samples[i - lag] ** 2; }
    const correlation = cross / Math.sqrt(Math.max(1e-20, left * right));
    // Prefer the first well-supported period to an octave/subharmonic.
    if (correlation > best + 0.015) { best = correlation; bestLag = lag; }
  }
  return best > 0.5 && bestLag ? rate / bestLag : 0;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sinc = x => Math.abs(x) < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);

// Spectrum of a Hann-windowed sinusoid. Using its fractional bin position and
// continuous phase avoids the pitch stair-stepping of FFT-bin oscillators.
function addHarmonic(real, imaginary, bin, phase, amplitude) {
  const size = real.length, center = Math.round(bin);
  const pr = Math.sin(phase), pi = -Math.cos(phase);
  for (let k = Math.max(1, center - 3); k <= Math.min(size / 2 - 1, center + 3); k++) {
    const d = k - bin;
    const magnitude = size * (0.5 * sinc(d) + 0.25 * sinc(d - 1) + 0.25 * sinc(d + 1)) * amplitude * 0.5;
    const wr = Math.cos(Math.PI * d) * magnitude, wi = -Math.sin(Math.PI * d) * magnitude;
    const r = pr * wr - pi * wi, im = pr * wi + pi * wr;
    real[k] += r; imaginary[k] += im; real[size - k] += r; imaginary[size - k] -= im;
  }
}

export function resynthesizeVoice(input, sr, { frequency = 110, formant = 1, chord = [0], intonation = 0, warmth = 0, cutoff = 5800, amount = 1, grain = 0.0022, preservePitch = false, robotic = 0 } = {}) {
  const output = new Float32Array(input.length);
  if (!input.length) return output;
  let totalEnergy = 0;
  for (let i = 0; i < input.length; i++) totalEnergy += input[i] ** 2;
  if (totalEnergy / input.length < 1e-14) return output;
  if (input.length < 64 || amount <= 0) return input.slice();
  const size = sr >= 32000 ? 2048 : 1024, hop = size / 4, half = size / 2;
  const { window } = plan(size), normalization = new Float32Array(input.length);
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  const envelope = new Float64Array(size), cepstralImaginary = new Float64Array(size);
  const synthReal = new Float64Array(size), synthImaginary = new Float64Array(size);
  const binHz = sr / size, maxFrequency = Math.min(cutoff, sr * 0.43);
  const lifter = Math.max(12, Math.round(sr * grain));
  let phase = 0, currentPitch = frequency, incomingPitch = frequency, pitchBaseline = 0, frameIndex = 0;
  let voiced = 0;
  for (let start = -half; start < input.length; start += hop, frameIndex++) {
    imaginary.fill(0); cepstralImaginary.fill(0); synthReal.fill(0); synthImaginary.fill(0);
    let frameEnergy = 0, crossings = 0, validSamples = 0, previousSample = 0;
    for (let i = 0; i < size; i++) {
      const sample = input[start + i] || 0;
      real[i] = sample * window[i]; frameEnergy += real[i] ** 2;
      if (start + i >= 0 && start + i < input.length) { if (sample * previousSample < 0) crossings++; validSamples++; }
      previousSample = sample;
    }
    if (frameEnergy < 1e-13) {
      phase += 2 * Math.PI * currentPitch * hop / sr;
      for (let i = Math.max(0, -start); i < size && start + i < input.length; i++) normalization[start + i] += window[i] ** 2;
      continue;
    }
    fft(real, imaginary);
    let logPower = 0, power = 0, count = 0, referencePower = 0;
    for (let k = 0; k < size; k++) {
      const squared = real[k] ** 2 + imaginary[k] ** 2;
      referencePower += squared;
      envelope[k] = 0.5 * Math.log(Math.max(1e-18, squared));
      if (k * binHz >= 150 && k * binHz <= 4000) { logPower += Math.log(Math.max(1e-18, squared)); power += squared; count++; }
    }
    const flatness = Math.exp(logPower / count) / Math.max(1e-18, power / count);
    const fricative = clamp((crossings / Math.max(1, validSamples) - 0.12) / 0.08, 0, 1);
    const targetVoicing = clamp((0.35 - flatness) / 0.28, 0, 1) * (1 - fricative);
    voiced += (targetVoicing - voiced) * (targetVoicing < voiced ? 0.8 : 0.65);
    if (!preservePitch && (intonation || amount < 1) && frameIndex % 4 === 0 && targetVoicing > 0.6) {
      const estimated = estimatePitch(input, start, size, sr);
      if (estimated) { incomingPitch = estimated; pitchBaseline = pitchBaseline ? pitchBaseline * 0.98 + estimated * 0.02 : estimated; }
    }
    const contour = pitchBaseline ? clamp(incomingPitch / pitchBaseline, 0.7, 1.4) ** intonation : 1;
    const targetPitch = incomingPitch ** (1 - amount) * (frequency * contour) ** amount;
    currentPitch += (targetPitch - currentPitch) * 0.22;
    phase += 2 * Math.PI * currentPitch * hop / sr;
    // Low-quefrency liftering removes the old harmonic comb while retaining
    // the changing vocal-tract resonances that distinguish the vowels.
    fft(envelope, cepstralImaginary, true);
    for (let k = 1; k < size; k++) {
      const q = Math.min(k, size - k);
      envelope[k] *= q <= lifter ? 0.5 + 0.5 * Math.cos(Math.PI * q / lifter) : 0;
      cepstralImaginary[k] = 0;
    }
    fft(envelope, cepstralImaginary);
    const tract = 1 + (formant - 1) * amount;
    if (preservePitch) {
      // Mother keeps the original harmonic frequencies, phases and prosody.
      // Only reshape the vocal-tract envelope: a small feminine coloration
      // and gentle spectral flattening, without imposing a higher synth pitch.
      let meanEnvelope = 0, envelopeCount = 0;
      for (let k = 1; k < half; k++) if (k * binHz >= 200 && k * binHz <= 3500) { meanEnvelope += envelope[k]; envelopeCount++; }
      meanEnvelope /= Math.max(1, envelopeCount);
      for (let k = 0; k < size; k++) {
        const mirror = Math.min(k, size - k), f = mirror * binHz;
        const position = clamp(mirror / tract, 0, half - 1), at = Math.floor(position), fraction = position - at;
        const shifted = envelope[at] * (1 - fraction) + envelope[Math.min(half, at + 1)] * fraction;
        const voicedWeight = voiced * clamp((6500 - f) / 2500, 0, 1);
        const color = shifted - envelope[mirror] - robotic * amount * (envelope[mirror] - meanEnvelope);
        const tilt = -warmth * amount * 0.5 * Math.log1p((f / 3000) ** 2);
        const gain = Math.exp(clamp((color + tilt) * voicedWeight, -0.32, 0.38));
        synthReal[k] = real[k] * gain; synthImaginary[k] = imaginary[k] * gain;
      }
      fft(synthReal, synthImaginary, true);
      for (let i = Math.max(0, -start); i < size && start + i < input.length; i++) {
        output[start + i] += synthReal[i] * window[i];
        normalization[start + i] += window[i] ** 2;
      }
      continue;
    }
    for (const note of chord) {
      const f0 = currentPitch * 2 ** (note / 12);
      for (let harmonic = 1; harmonic * f0 < maxFrequency; harmonic++) {
        const f = harmonic * f0, sourceBin = clamp(f / tract / binHz, 1, half - 2), k = Math.floor(sourceBin), fraction = sourceBin - k;
        const spectralAmplitude = Math.exp(envelope[k] * (1 - fraction) + envelope[k + 1] * fraction) * 4 / size;
        const tilt = (1 + (f / 2400) ** 2) ** (-warmth * 0.5);
        const edge = clamp((maxFrequency - f) / 700, 0, 1);
        const atStart = harmonic * (phase * 2 ** (note / 12) - 2 * Math.PI * f0 * half / sr);
        addHarmonic(synthReal, synthImaginary, f / binHz, atStart, spectralAmplitude * tilt * edge / Math.sqrt(chord.length));
      }
    }
    // Preserve unvoiced phonemes and upper consonants, not the original vowel
    // fundamental. A full-strength robot therefore changes the voice itself.
    for (let k = 0; k < size; k++) {
      const f = Math.min(k, size - k) * binHz;
      const harmonicWeight = voiced * clamp((6500 - f) / 2500, 0, 1);
      synthReal[k] *= Math.sqrt(harmonicWeight); synthImaginary[k] *= Math.sqrt(harmonicWeight);
    }
    let synthesizedPower = 0;
    for (let k = 0; k < size; k++) synthesizedPower += synthReal[k] ** 2 + synthImaginary[k] ** 2;
    // Match total frame energy; do not amplify independent carrier bands.
    const gain = synthesizedPower > referencePower * 1e-16 ? Math.sqrt(referencePower / synthesizedPower) : 0;
    for (let k = 0; k < size; k++) {
      const f = Math.min(k, size - k) * binHz;
      const original = Math.sqrt(1 - voiced * clamp((6500 - f) / 2500, 0, 1));
      synthReal[k] = synthReal[k] * gain * Math.sqrt(voiced) + real[k] * original;
      synthImaginary[k] = synthImaginary[k] * gain * Math.sqrt(voiced) + imaginary[k] * original;
    }
    fft(synthReal, synthImaginary, true);
    for (let i = Math.max(0, -start); i < size && start + i < input.length; i++) {
      output[start + i] += synthReal[i] * window[i];
      normalization[start + i] += window[i] ** 2;
    }
  }
  for (let i = 0; i < output.length; i++) output[i] /= Math.max(1e-8, normalization[i]);
  return output;
}
