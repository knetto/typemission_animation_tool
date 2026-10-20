// Voice effect presets — rendered offline (OfflineAudioContext + JS post-processing)
import { nodes } from './synth.js';
import { speedPitch, finishVoice, telephoneCodec, rms, bitcrush, dropouts, stutter, concat, rng } from './dsp.js';

// helpers for wet chains
const bed = (N, out, dur, { type = 'bandpass', f = 2500, q = 0.5, level = 0.02, seed = 3 } = {}) => {
  const s = N.noise(dur + 0.04, seed), fl = N.filter(type, f, q), g = N.gain(0);
  // Noise follows speech activity, so pauses do not become a wall of hiss.
  for (const [time, activity] of N.voiceActivity || [[0, 1]]) g.gain.setTargetAtTime(level * activity, time, 0.015);
  g.gain.setTargetAtTime(0, dur, 0.008);
  s.connect(fl); fl.connect(g); g.connect(out); s.start(0); s.stop(dur + 0.04);
};
const band = (N, input, lo, hi, extra = []) => {
  // Fourth-order Butterworth slopes: no artificial resonant peaks at cutoffs.
  const h1 = N.filter('highpass', lo, 0.5412), h2 = N.filter('highpass', lo, 1.3066);
  const l1 = N.filter('lowpass', hi, 0.5412), l2 = N.filter('lowpass', hi, 1.3066);
  N.chain(input, h1, h2, l1, l2, ...extra);
  return extra.length ? extra[extra.length - 1] : l2;
};

function communication({ lo = 250, hi = 4500, presence = 1.5, frequency = 1800, drive = 1, ratio = 3, noise = 0, codec = null, speaker = false } = {}) {
  return {
    latency: 0.006, tail: 0.04,
    wet: (N, ctx, src, out, a, dur) => {
      const stages = [N.filter('peaking', frequency, 0.8, presence), N.comp(-22, ratio, 0.008, 0.12)];
      if (drive > 1) {
        const saturation = N.shaper(drive); saturation.oversample = '4x';
        stages.push(saturation, N.filter('lowpass', hi, 0.707));
      }
      const signal = band(N, src, lo, hi, stages);
      signal.connect(out);
      if (speaker) {
        const delay = N.delay(0.014), reflection = N.gain(0.1);
        N.chain(signal, delay, N.filter('lowpass', 3200), reflection, out);
      }
      if (noise) bed(N, out, dur, { f: Math.min(hi, 2200), level: noise });
    },
    ...(codec ? { post: (y, sr) => telephoneCodec(y, sr, codec) } : {})
  };
}
const ring = (N, ctx, input, out, freq, depth = 1) => {
  const carrier = N.gain(0), o = N.osc('sine', freq), d = N.gain(depth);
  o.connect(d); d.connect(carrier.gain); input.connect(carrier); carrier.connect(out);
  if (depth < 1) { const dry = N.gain(1 - depth); input.connect(dry); dry.connect(out); }
  o.start(0);
};
const modDelay = (N, input, out, { base = 0.004, depth = 0.003, rate = 0.3, feedback = 0.5, mix = 0.6 } = {}) => {
  const d = N.delay(base, 0.1), lfo = N.osc('sine', rate), lg = N.gain(depth), fb = N.gain(feedback), wet = N.gain(mix);
  lfo.connect(lg); lg.connect(d.delayTime); input.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out); input.connect(out);
  lfo.start(0);
};

function squelch(sr, seed = 9) {
  const r = rng(seed), n = Math.floor(0.22 * sr), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (r() * 2 - 1) * 0.35 * Math.pow(1 - i / n, 1.5);
  return out;
}
function beep(sr, f = 1400, dur = 0.12, g = 0.25) {
  const n = Math.floor(dur * sr), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * f * i) / sr) * g * Math.min(1, i / 200, (n - i) / 200);
  return out;
}

export const VOICE_PRESETS = [
  { id: 'none', name: 'Originele stem', group: 'Basis', emoji: '🎙️', desc: 'Je opname zonder stemeffect.', popular: true },
  { id: 'voice_clean', name: 'Studio · helder', group: 'Basis', emoji: '🎙️', desc: 'Een rustige, heldere stem met gelijkmatiger volume.', popular: true,
    ...communication({ lo: 75, hi: 15000, frequency: 3200, presence: 1.5, ratio: 2 }) },
  { id: 'voice_broadcast', name: 'Presentator · warm', group: 'Basis', emoji: '🎧', desc: 'Warme lage tonen en een volle, duidelijke presentatiestem.',
    latency: 0.006,
    wet: (N, ctx, src, out) => N.chain(src, N.filter('highpass', 80), N.filter('lowshelf', 180, 0.7, 2), N.filter('peaking', 2800, 0.8, 2), N.comp(-24, 3, 0.01, 0.16), out) },

  // ---------- Radio ----------
  { id: 'radio_modern', name: 'Digitale portofoon', group: 'Radio', emoji: '📻', desc: 'Compact en duidelijk, met een lichte digitale radiokleur.', popular: true,
    ...communication({ lo: 220, hi: 5000, presence: 2, drive: 1.3, ratio: 3.5 }) },
  { id: 'radio_oldschool', name: 'Oude AM-radio', group: 'Radio', emoji: '📼', desc: 'Warm, smal en licht vervormd, met subtiele analoge ruis.', popular: true,
    ...communication({ lo: 280, hi: 3300, presence: 2.5, frequency: 1200, drive: 2.1, ratio: 3.5, noise: 0.002 }) },
  { id: 'radio_fm', name: 'FM-radio · omroep', group: 'Radio', emoji: '📻', desc: 'Volle omroepstem met meer detail en zachte compressie.',
    ...communication({ lo: 90, hi: 12000, frequency: 2800, presence: 2, drive: 1.15, ratio: 3 }) },
  { id: 'radio_dispatch', name: 'Meldkamer', group: 'Radio', emoji: '🚨', desc: 'Heldere, doordringende spraak zoals bij een meldkamer.',
    ...communication({ lo: 350, hi: 3800, frequency: 2100, presence: 3, drive: 1.4, ratio: 4 }) },
  { id: 'radio_walkie', name: 'Walkie-talkie', group: 'Radio', emoji: '📡', desc: 'Herkenbare portofoon met een korte ruis en eindpiep.',
    ...communication({ lo: 450, hi: 3200, presence: 2.5, drive: 2, ratio: 4, noise: 0.0015 }),
    post: (y, sr) => { const s = squelch(sr); for (let i = 0; i < Math.min(s.length / 2, y.length); i++) y[i] += s[i] * 0.08; return concat(y, beep(sr, 1400, 0.1, 0.035), squelch(sr, 12).map((v) => v * 0.1)); } },
  { id: 'radio_military', name: 'Militaire veldradio', group: 'Radio', emoji: '🪖', desc: 'Rauwe, compacte radio met nadruk op verstaanbaarheid.',
    ...communication({ lo: 380, hi: 3000, frequency: 1600, presence: 3.5, drive: 2.8, ratio: 5, noise: 0.0025 }) },
  { id: 'radio_extreme', name: 'Beschadigde radio', group: 'Radio', emoji: '💥', desc: 'Bewust zwaar vervormd met storingen en onderbrekingen.', latency: 0.006,
    wet: (N, ctx, src, out, a, dur) => { const e = band(N, src, 900, 2200, [N.shaper(25), N.comp(-35, 20)]); e.connect(out); bed(N, out, dur, { f: 2000, level: 0.07, seed: 6 }); },
    post: (y, sr, a) => { const c = bitcrush(y, 6, 3); return dropouts(c.map((v, i) => y[i] * (1 - a) + v * a), sr, { rate: 1.5 * a }); } },
  { id: 'radio_minimal', name: 'Subtiele radio', group: 'Radio', emoji: '🔈', desc: 'Een lichte radiokleur, met veel detail in je stem.',
    ...communication({ lo: 150, hi: 7000, presence: 1, frequency: 2800, ratio: 2 }) },

  // ---------- Telefoon ----------
  { id: 'phone_modern', name: 'Mobiel · normaal gesprek', group: 'Telefoon', emoji: '📱', desc: 'Een herkenbaar mobiel gesprek: helder, compact en zonder extra ruis.', popular: true,
    ...communication({ lo: 180, hi: 4800, presence: 1.5, ratio: 2.5 }) },
  { id: 'phone_hd', name: 'Mobiel · HD / modern', group: 'Telefoon', emoji: '📲', desc: 'Een moderne belverbinding met meer warmte en heldere medeklinkers.', popular: true,
    ...communication({ lo: 100, hi: 7000, frequency: 2600, presence: 1, ratio: 2 }) },
  { id: 'phone_90s', name: 'Mobiel · jaren 90', group: 'Telefoon', emoji: '📟', desc: 'Smal en licht korrelig, zoals een vroege digitale mobiele telefoon.',
    ...communication({ lo: 300, hi: 3200, presence: 2, ratio: 3, codec: { rate: 8000, bits: 7 } }) },
  { id: 'phone_speaker', name: 'Mobiel · speakerstand', group: 'Telefoon', emoji: '🔊', desc: 'Een kleine luidspreker met een lichte kamerreflectie.',
    ...communication({ lo: 250, hi: 6000, frequency: 1000, presence: 2.5, ratio: 2.5, speaker: true }) },
  { id: 'phone_voicemail', name: 'Voicemail', group: 'Telefoon', emoji: '📩', desc: 'Een opgenomen telefoonbericht met zachte digitale korrel.',
    ...communication({ lo: 300, hi: 3400, presence: 1, ratio: 3, codec: { rate: 8000, bits: 8 } }) },
  { id: 'phone_landline', name: 'Vaste lijn · klassiek', group: 'Telefoon', emoji: '☎️', desc: 'Het vertrouwde, smalle geluid van een klassieke huistelefoon.', popular: true,
    ...communication({ lo: 300, hi: 3400, presence: 1.5, drive: 1.2, ratio: 2.5 }) },
  { id: 'phone_rotary', name: 'Draaitelefoon · vintage', group: 'Telefoon', emoji: '🕰️', desc: 'Een warme, blikkerige oude telefoon met zachte lijnruis.',
    ...communication({ lo: 400, hi: 2700, frequency: 1100, presence: 3.5, drive: 2.3, ratio: 3.5, noise: 0.0015 }) },
  { id: 'phone_bad', name: 'Mobiel · slechte ontvangst', group: 'Telefoon', emoji: '📶', desc: 'Een zwak signaal met korte haperingen en wegvallende woorden.',
    ...communication({ lo: 300, hi: 3400, presence: 1, ratio: 3 }),
    post: (y, sr, a) => { const c = bitcrush(y, 8, 3).map((v, i) => y[i] * (1 - a) + v * a); return stutter(dropouts(c, sr, { rate: 1.8 * a, seed: 31 }), sr, { rate: 0.5 * a, seed: 32 }); } },
  { id: 'phone_minimal', name: 'Subtiele telefoon', group: 'Telefoon', emoji: '📞', desc: 'Een lichte telefoonkleur zonder een sterk vervormde stem.',
    ...communication({ lo: 140, hi: 5500, presence: 0.5, ratio: 1.5 }) },

  // ---------- Karakter ----------
  { id: 'robot', name: 'Robot', group: 'Karakter', emoji: '🤖', desc: 'Metalen robotstem',
    wet: (N, ctx, src, out) => { const mid = N.gain(1); ring(N, ctx, src, mid, 55, 0.85); const comb = N.delay(0.009, 0.1), fb = N.gain(0.55); mid.connect(comb); comb.connect(fb); fb.connect(comb); const sh = N.shaper(2); comb.connect(sh); mid.connect(sh); sh.connect(out); } },
  { id: 'computer', name: 'Computer / AI', group: 'Karakter', emoji: '💠', desc: 'Strakke synthetische AI-stem', pitch: -1,
    wet: (N, ctx, src, out) => { const hp = N.filter('highpass', 120), pk = N.filter('peaking', 5000, 1, 4), mid = N.gain(1); N.chain(src, hp, pk); ring(N, ctx, pk, mid, 30, 0.25); modDelay(N, mid, out, { base: 0.012, depth: 0.002, rate: 0.25, feedback: 0.2, mix: 0.35 }); const rv = N.reverbIR(0.6, 4), rg = N.gain(0.15); mid.connect(rv); rv.connect(rg); rg.connect(out); },
    tail: 0.6 },
  { id: 'alien', name: 'Alien', group: 'Karakter', emoji: '👽', desc: 'Buitenaards en zwevend', pitch: 4,
    wet: (N, ctx, src, out) => { const mid = N.gain(1); ring(N, ctx, src, mid, 420, 0.5); modDelay(N, mid, out, { base: 0.005, depth: 0.004, rate: 1.4, feedback: 0.6, mix: 0.7 }); const rv = N.reverbIR(1.5, 3), rg = N.gain(0.25); mid.connect(rv); rv.connect(rg); rg.connect(out); },
    tail: 1.5 },
  { id: 'deep', name: 'Diepe stem', group: 'Karakter', emoji: '🐻', desc: 'Lager en zwaarder', pitch: -5,
    wet: (N, ctx, src, out) => { const ls = N.filter('lowshelf', 200, 0.7, 4); N.chain(src, ls, out); }, keepDry: false },
  { id: 'high', name: 'Hoge stem', group: 'Karakter', emoji: '🐿️', desc: 'Hoger en lichter', pitch: 5 },
  { id: 'echo', name: 'Echo', group: 'Ruimte', emoji: '🏔️', desc: 'Herhalende echo', keepDry: true, tail: 2.5,
    wet: (N, ctx, src, out) => { const d = N.delay(0.28), fb = N.gain(0.45), lp = N.filter('lowpass', 3500); src.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(out); } },
  { id: 'reverb', name: 'Galm (hal)', group: 'Ruimte', emoji: '🏛️', desc: 'Grote ruimte', keepDry: true, tail: 2.8,
    wet: (N, ctx, src, out) => { const rv = N.reverbIR(2.6, 2.5), g = N.gain(0.6); src.connect(rv); rv.connect(g); g.connect(out); } },
  { id: 'spy', name: 'Spion-versleuteld', group: 'Karakter', emoji: '🕵️', desc: 'Glitchy versleutelde lijn', latency: 0.006,
    wet: (N, ctx, src, out, a, dur) => { const e = band(N, src, 300, 5000, [N.comp(-24, 6)]); const mid = N.gain(1); e.connect(mid); ring(N, ctx, mid, out, 90, 0.2); bed(N, out, dur, { f: 4000, level: 0.012, seed: 19 }); },
    post: (y, sr, a) => { const c = bitcrush(y, 8, 2).map((v, i) => y[i] * (1 - a) + v * a); return dropouts(stutter(c, sr, { rate: 1.2 * a, seed: 41 }), sr, { rate: 0.7 * a, maxLen: 0.06, seed: 42 }); } },
];

const BY_ID = Object.fromEntries(VOICE_PRESETS.map((p) => [p.id, p]));
export const presetName = (id) => (BY_ID[id] ? `${BY_ID[id].group === 'Basis' ? '' : BY_ID[id].group + ' · '}${BY_ID[id].name}` : 'Geen');

export async function applyVoiceFx(x, sr, presetId, amount = 1) {
  const p = BY_ID[presetId];
  amount = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
  if (!p || presetId === 'none' || amount <= 0 || !x.length || rms(x) < 1e-7) return x;
  let y = x;
  if (p.pitch) {
    const shifted = speedPitch(y, 1, p.pitch * amount);
    y = new Float32Array(x.length);
    y.set(shifted.subarray(0, y.length));
  }
  if (p.wet) {
    const reference = y, tail = p.tail ?? 0.05;
    const latency = Math.round((p.latency || 0) * sr);
    const ctx = new OfflineAudioContext(1, y.length + Math.ceil(tail * sr) + latency, sr);
    const buf = ctx.createBuffer(1, y.length, sr);
    // Consistent drive/compression for quiet and loud recordings.
    const inputGain = Math.min(12, 0.1 / Math.max(1e-7, rms(y)));
    buf.copyToChannel(Float32Array.from(y, sample => sample * inputGain), 0);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const N = nodes(ctx);
    N.voiceActivity = [];
    const hop = Math.max(1, Math.round(sr * 0.02));
    for (let i = 0; i < y.length; i += hop) N.voiceActivity.push([i / sr, Math.min(1, rms(y, i, Math.min(y.length, i + hop)) * inputGain / 0.02)]);
    p.wet(N, ctx, src, ctx.destination, 1, y.length / sr);
    src.start(0);
    let wet = (await ctx.startRendering()).getChannelData(0).slice(latency);
    if (p.post) wet = p.post(wet, sr, 1);
    for (let i = 0; i < wet.length; i++) wet[i] /= inputGain;
    // Process only the effect signal before mixing. Even glitch presets respect
    // the original voice at low strength, and 0% remains an exact bypass.
    y = new Float32Array(Math.max(reference.length, wet.length));
    for (let i = 0; i < y.length; i++) y[i] = (reference[i] || 0) * (p.keepDry ? 1 : 1 - amount) + (wet[i] || 0) * amount;
  }
  else if (p.post) y = p.post(y, sr, amount);
  return finishVoice(x, y);
}
