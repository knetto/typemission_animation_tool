// Pure DSP on Float32Array (mono). Everything runs offline — no live AudioContext.

export function resample(x, rate) {
  // rate > 1 → shorter & higher (like playbackRate)
  const n = Math.max(1, Math.floor(x.length / rate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rate, i0 = p | 0, f = p - i0;
    const a = x[i0] ?? 0, b = x[i0 + 1] ?? a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

const hannCache = new Map();
function hann(N) {
  if (!hannCache.has(N)) hannCache.set(N, Float32Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1))));
  return hannCache.get(N);
}

// WSOLA time stretch: factor > 1 → longer, pitch preserved
export function timeStretch(x, factor) {
  if (Math.abs(factor - 1) < 1e-3) return x.slice();
  const N = 1536, Hs = N / 4, tol = 256, L = N / 2;
  const Ha = Hs / factor;
  const outLen = Math.max(1, Math.floor(x.length * factor));
  const out = new Float32Array(outLen + N), norm = new Float32Array(outLen + N);
  const win = hann(N);
  let prev = 0;
  for (let k = 0, outPos = 0; outPos < outLen; k++, outPos += Hs) {
    const nominal = Math.round(k * Ha);
    let pos = nominal;
    const natural = prev + Hs;
    if (k > 0 && natural + L < x.length) {
      let best = -Infinity, bestD = 0;
      for (let d = -tol; d <= tol; d += 4) {
        const p = nominal + d;
        if (p < 0 || p + L >= x.length) continue;
        let c = 0;
        for (let i = 0; i < L; i += 4) c += x[p + i] * x[natural + i];
        if (c > best) { best = c; bestD = d; }
      }
      pos = nominal + bestD;
    }
    if (pos < 0) pos = 0;
    for (let i = 0; i < N; i++) {
      const v = x[pos + i];
      if (v === undefined) break;
      out[outPos + i] += v * win[i];
      norm[outPos + i] += win[i];
    }
    prev = pos;
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) res[i] = out[i] / Math.max(norm[i], 1);
  return res;
}

// speed: tempo (pitch kept). semitones: pitch (tempo kept).
export function speedPitch(x, speed = 1, semitones = 0) {
  const p = Math.pow(2, semitones / 12);
  let y = x;
  if (Math.abs(p - 1) > 1e-4) y = resample(y, p);
  const stretch = p / speed;
  if (Math.abs(stretch - 1) > 1e-3) y = timeStretch(y, stretch);
  return y === x ? x.slice() : y;
}

export function reverse(x) { const y = x.slice(); y.reverse(); return y; }

export function rms(x, a = 0, b = x.length) {
  let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

// Non-silent regions in seconds: [[start, end], ...]
export function detectVoiced(x, sr, { thresholdDb = -42, minSilence = 0.35, pad = 0.08, frame = 0.02 } = {}) {
  const hop = Math.max(1, Math.floor(frame * sr));
  const thr = Math.pow(10, thresholdDb / 20);
  const voiced = [];
  for (let i = 0; i < x.length; i += hop) voiced.push(rms(x, i, Math.min(x.length, i + hop)) > thr);
  const regions = [];
  let start = -1;
  voiced.forEach((v, i) => {
    if (v && start < 0) start = i;
    if (!v && start >= 0) { regions.push([start, i]); start = -1; }
  });
  if (start >= 0) regions.push([start, voiced.length]);
  // merge gaps shorter than minSilence
  const minGap = minSilence / frame, merged = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < minGap) last[1] = r[1]; else merged.push([...r]);
  }
  const dur = x.length / sr;
  return merged.map(([a, b]) => [Math.max(0, a * frame - pad), Math.min(dur, b * frame + pad)]);
}

export function peaks(x, buckets) {
  const out = new Float32Array(buckets);
  const step = x.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor(b * step), e = Math.min(x.length, Math.floor((b + 1) * step));
    let m = 0;
    for (let i = a; i < e; i += 4) { const v = Math.abs(x[i]); if (v > m) m = v; }
    out[b] = m;
  }
  return out;
}

export function matchLoudness(ref, y, maxGain = 4) {
  const a = rms(ref), b = rms(y);
  if (b < 1e-6 || a < 1e-6) return y;
  const g = Math.min(maxGain, a / b);
  for (let i = 0; i < y.length; i++) y[i] *= g;
  return y;
}

export function bitcrush(x, bits = 8, hold = 1) {
  const q = Math.pow(2, bits - 1), y = new Float32Array(x.length);
  let held = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % hold === 0) held = Math.round(x[i] * q) / q;
    y[i] = held;
  }
  return y;
}

// Telephone-style companding, at a reduced sample rate, with interpolation
// instead of sample-and-hold aliasing. This is a sound model, not a GSM codec.
export function telephoneCodec(x, sr, { rate = 8000, bits = 8 } = {}) {
  if (!x.length) return x.slice();
  const sampled = resample(x, sr / Math.min(rate, sr));
  const steps = 2 ** (bits - 1) - 1, mu = 255, logMu = Math.log1p(mu);
  for (let i = 0; i < sampled.length; i++) {
    const value = Math.max(-1, Math.min(1, sampled[i]));
    const encoded = Math.sign(value) * Math.log1p(mu * Math.abs(value)) / logMu;
    const quantized = Math.round(encoded * steps) / steps;
    sampled[i] = Math.sign(quantized) * Math.expm1(Math.abs(quantized) * logMu) / mu;
  }
  const decoded = resample(sampled, Math.min(rate, sr) / sr);
  const out = new Float32Array(x.length);
  out.set(decoded.subarray(0, out.length));
  return out;
}

// Match speech rather than the appended reverb/beep tail, then preserve peak
// headroom with one gain change. Never hard-clip the rendered voice.
export function finishVoice(ref, rendered, maxGain = 4) {
  const out = rendered.slice();
  const referenceLevel = rms(ref);
  const voiceLevel = rms(out, 0, Math.min(ref.length, out.length));
  if (referenceLevel < 1e-7) return new Float32Array(ref.length);
  let gain = voiceLevel > 1e-7 ? Math.min(maxGain, referenceLevel / voiceLevel) : 1;
  let peak = 0;
  for (const sample of out) peak = Math.max(peak, Math.abs(sample));
  if (peak * gain > 0.96) gain = 0.96 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

// deterministic PRNG so effects sound the same every render
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export function dropouts(x, sr, { rate = 1.2, minLen = 0.03, maxLen = 0.18, seed = 7 } = {}) {
  const y = x.slice(), r = rng(seed), dur = x.length / sr;
  const count = Math.floor(dur * rate);
  for (let k = 0; k < count; k++) {
    const s = Math.floor(r() * x.length), len = Math.floor((minLen + r() * (maxLen - minLen)) * sr);
    for (let i = 0; i < len && s + i < y.length; i++) {
      const edge = Math.min(1, Math.min(i, len - i) / 60);
      y[s + i] *= 1 - edge * 0.97;
    }
  }
  return y;
}

export function stutter(x, sr, { rate = 0.8, seed = 3 } = {}) {
  const y = x.slice(), r = rng(seed), count = Math.floor((x.length / sr) * rate);
  for (let k = 0; k < count; k++) {
    const s = Math.floor(r() * (x.length - sr * 0.3));
    const slice = Math.floor((0.03 + r() * 0.05) * sr), reps = 2 + Math.floor(r() * 3);
    for (let rep = 1; rep <= reps; rep++)
      for (let i = 0; i < slice && s + rep * slice + i < y.length; i++) y[s + rep * slice + i] = x[s + i];
  }
  return y;
}

export function addNoise(x, level, seed = 11) {
  const r = rng(seed);
  for (let i = 0; i < x.length; i++) x[i] += (r() * 2 - 1) * level;
  return x;
}

export function concat(...arrs) {
  const n = arrs.reduce((a, b) => a + b.length, 0), out = new Float32Array(n);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
