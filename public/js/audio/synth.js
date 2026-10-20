// Building blocks for OfflineAudioContext graphs (shared by voice FX and built-in SFX)

export function nodes(ctx) {
  const sr = ctx.sampleRate;
  const filter = (type, f, q = 0.7, gain = 0) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = gain; return n; };
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const shaper = (k = 4) => {
    const n = ctx.createWaveShaper(), c = new Float32Array(2048);
    for (let i = 0; i < c.length; i++) { const x = (i / (c.length - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    n.curve = c; n.oversample = '2x'; return n;
  };
  const comp = (threshold = -24, ratio = 6, attack = 0.003, release = 0.15) => {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = threshold; c.ratio.value = ratio; c.attack.value = attack; c.release.value = release; c.knee.value = 6; return c;
  };
  const noiseBuffer = (dur, seed = 1) => {
    const b = ctx.createBuffer(1, Math.max(1, Math.ceil(sr * dur)), sr), d = b.getChannelData(0);
    let s = seed;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    return b;
  };
  const noise = (dur, seed) => { const s = ctx.createBufferSource(); s.buffer = noiseBuffer(dur, seed); return s; };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
  const delay = (t, max = 2) => { const d = ctx.createDelay(max); d.delayTime.value = t; return d; };
  const reverbIR = (dur = 2, decay = 3, seed = 5) => {
    const b = ctx.createBuffer(1, Math.ceil(sr * dur), sr), d = b.getChannelData(0);
    let s = seed;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = ((s / 2147483647) * 2 - 1) * Math.pow(1 - i / d.length, decay); }
    const c = ctx.createConvolver(); c.buffer = b; return c;
  };
  const chain = (...ns) => { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns; };
  return { filter, gain, shaper, comp, noise, noiseBuffer, osc, delay, reverbIR, chain, sr };
}

// Short synth sounds (used by built-in SFX library)
export function synth(ctx, out) {
  const N = nodes(ctx);
  const env = (t, d, g, attack = 0.004) => {
    const ga = ctx.createGain();
    ga.gain.setValueAtTime(0.0001, t);
    ga.gain.linearRampToValueAtTime(g, t + attack);
    ga.gain.exponentialRampToValueAtTime(0.0001, t + d);
    ga.connect(out); return ga;
  };
  const noise = (t, d, { type = 'bandpass', f = 3000, f1, q = 0.7, g = 0.5, attack = 0.004, seed = 1 } = {}) => {
    const s = N.noise(d + 0.05, seed), fl = N.filter(type, f, q);
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + d);
    s.connect(fl); fl.connect(env(t, d, g, attack)); s.start(t); s.stop(t + d + 0.02);
  };
  const tone = (t, d, { type = 'sine', f0, f1, g = 0.3, attack = 0.004, lp } = {}) => {
    const o = N.osc(type, f0);
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + d);
    let node = o;
    if (lp) { const fl = N.filter('lowpass', lp); o.connect(fl); node = fl; }
    node.connect(env(t, d, g, attack)); o.start(t); o.stop(t + d + 0.02);
  };
  let seedN = 100;
  const crackle = (t0, span, count, g) => {
    for (let k = 0; k < count; k++) {
      const r1 = ((k * 7919) % 1000) / 1000, r2 = ((k * 104729) % 1000) / 1000;
      noise(t0 + r1 * span, 0.015 + r2 * 0.03, { type: 'highpass', f: 1500 + r2 * 3000, g: g * (0.4 + r1 * 0.6), attack: 0.001, seed: seedN++ });
    }
  };
  return { noise, tone, crackle, N };
}
