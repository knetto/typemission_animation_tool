// Voice effect presets — rendered offline (OfflineAudioContext + JS post-processing)
import { nodes } from './synth.js';
import { finishVoice, telephoneCodec, rms, bitcrush, dropouts, stutter, concat, rng } from './dsp.js';
import { tapeDrift } from './robot.js';
import { runDsp } from './dsp-jobs.js';

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

function communication({ lo = 250, hi = 4500, presence = 1.5, frequency = 1800, drive = 1, ratio = 3, noise = 0, codec = null, speaker = false, bass = 0, air = 0, drift = 0 } = {}) {
  return {
    latency: 0.006,
    wet: (N, ctx, src, out, a, dur) => {
      const stages = [N.filter('lowshelf', 180, 0.707, bass), N.filter('highshelf', 4500, 0.707, air), N.filter('peaking', frequency, 0.85, presence), N.comp(-24, ratio, 0.004, 0.1)];
      if (drive > 1) {
        const saturation = N.shaper(1.6); saturation.oversample = '4x';
        stages.push(N.gain(drive), saturation, N.gain(1 / drive), N.filter('lowpass', hi, 0.707));
      }
      const signal = band(N, src, lo, hi, stages);
      signal.connect(out);
      if (speaker) {
        for (const [time, level] of [[0.018, 0.42], [0.037, 0.25], [0.063, 0.13]]) N.chain(signal, N.delay(time), N.filter('lowpass', 3800), N.gain(level), out);
      }
      if (noise) bed(N, out, dur, { f: Math.min(hi, 2200), level: noise });
    },
    tail: speaker ? 0.16 : 0.05,
    ...((codec || drift) ? { post: (y, sr) => { if (codec) y = telephoneCodec(y, sr, codec); return drift ? tapeDrift(y, sr, drift) : y; } } : {})
  };
}

function metal(N, input, out, { frequency = 75, depth = 0.45, delay = 0.007, feedback = 0.28, drive = 1.5 } = {}) {
  const modulated = N.gain(1);
  ring(N, null, input, modulated, frequency, depth);
  const comb = N.delay(delay, 0.1), fb = N.gain(feedback);
  modulated.connect(comb); N.chain(comb, N.filter('lowpass', 4800), fb, comb);
  const sum = N.gain(1);
  N.chain(modulated, N.gain(0.65), sum); N.chain(comb, N.gain(0.6), sum);
  const saturation = N.shaper(1.4); saturation.oversample = '4x';
  N.chain(sum, N.gain(drive), saturation, N.filter('highpass', 75), N.filter('lowpass', 4200), out);
}

const voiceCore = options => ({
  pre: (x, sr, amount) => runDsp('vocode', x, { sr, voice: { ...options, amount } }),
  transformsVoice: true,
});

function vocoder(options, { color = 0, room = 0, metallic = false } = {}) {
  return {
    ...voiceCore(options), tail: Math.max(0.08, room),
    wet: (N, ctx, src, out) => {
      const voice = N.filter('peaking', 1800, 0.75, color);
      src.connect(voice);
      if (metallic) metal(N, voice, out, { frequency: 36, depth: 0.25, delay: 0.015, feedback: 0.22, drive: 1.3 });
      else voice.connect(out);
      if (room) N.chain(voice, N.delay(0.02), N.reverbIR(room, 3), N.filter('lowpass', 5000), N.gain(0.28), out);
    },
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
  { id: 'radio_modern', name: 'Digitale portofoon', group: 'Radio', emoji: '📻', desc: 'Strakke, samengedrukte zendstem met hoorbare digitale korrel.', popular: true,
    ...communication({ lo: 370, hi: 4200, frequency: 2700, presence: 5, drive: 2.5, ratio: 6, codec: { rate: 10000, bits: 6 } }) },
  { id: 'radio_oldschool', name: 'Oude AM-radio', group: 'Radio', emoji: '📼', desc: 'Warm, smal en licht vervormd, met subtiele analoge ruis.', popular: true,
    ...communication({ lo: 280, hi: 2500, presence: 4, frequency: 1000, drive: 5, ratio: 4, noise: 0.004, drift: 0.0018 }) },
  { id: 'radio_fm', name: 'FM-radio · omroep', group: 'Radio', emoji: '📻', desc: 'Volle omroepstem met meer detail en zachte compressie.',
    ...communication({ lo: 65, hi: 14000, frequency: 3000, presence: 3, bass: 3.5, air: 2.5, drive: 1.5, ratio: 4 }) },
  { id: 'radio_dispatch', name: 'Meldkamer', group: 'Radio', emoji: '🚨', desc: 'Heldere, doordringende spraak zoals bij een meldkamer.',
    ...communication({ lo: 600, hi: 3400, frequency: 2200, presence: 8, drive: 3, ratio: 5 }) },
  { id: 'radio_walkie', name: 'Walkie-talkie', group: 'Radio', emoji: '📡', desc: 'Herkenbare portofoon met een korte ruis en eindpiep.',
    ...communication({ lo: 450, hi: 2900, presence: 4, drive: 4, ratio: 5, noise: 0.003 }),
    post: (y, sr) => { const s = squelch(sr); for (let i = 0; i < Math.min(s.length / 2, y.length); i++) y[i] += s[i] * 0.08; return concat(y, beep(sr, 1400, 0.1, 0.035), squelch(sr, 12).map((v) => v * 0.1)); } },
  { id: 'radio_military', name: 'Militaire veldradio', group: 'Radio', emoji: '🪖', desc: 'Rauwe, compacte radio met nadruk op verstaanbaarheid.',
    ...communication({ lo: 480, hi: 2300, frequency: 1550, presence: 6, drive: 8, ratio: 7, noise: 0.007, codec: { rate: 7000, bits: 5 } }) },
  { id: 'radio_extreme', name: 'Beschadigde radio', group: 'Radio', emoji: '💥', desc: 'Bewust zwaar vervormd met storingen en onderbrekingen.', latency: 0.006,
    wet: (N, ctx, src, out, a, dur) => { const e = band(N, src, 900, 2200, [N.shaper(25), N.comp(-35, 20)]); e.connect(out); bed(N, out, dur, { f: 2000, level: 0.07, seed: 6 }); },
    post: (y, sr, a) => { const c = bitcrush(y, 6, 3); return dropouts(c.map((v, i) => y[i] * (1 - a) + v * a), sr, { rate: 1.5 * a }); } },
  { id: 'radio_minimal', name: 'Subtiele radio', group: 'Radio', emoji: '🔈', desc: 'Een lichte radiokleur, met veel detail in je stem.',
    ...communication({ lo: 150, hi: 7000, presence: 1, frequency: 2800, ratio: 2 }) },

  // ---------- Telefoon ----------
  { id: 'phone_modern', name: 'Mobiel · normaal gesprek', group: 'Telefoon', emoji: '📱', desc: 'Een herkenbaar mobiel gesprek: helder, compact en zonder extra ruis.', popular: true,
    ...communication({ lo: 260, hi: 3900, presence: 2, ratio: 3, codec: { rate: 8000, bits: 8 } }) },
  { id: 'phone_hd', name: 'Mobiel · HD / modern', group: 'Telefoon', emoji: '📲', desc: 'Een moderne belverbinding met meer warmte en heldere medeklinkers.', popular: true,
    ...communication({ lo: 100, hi: 7600, frequency: 2600, presence: 1, ratio: 2 }) },
  { id: 'phone_90s', name: 'Mobiel · jaren 90', group: 'Telefoon', emoji: '📟', desc: 'Smal en licht korrelig, zoals een vroege digitale mobiele telefoon.',
    ...communication({ lo: 300, hi: 2800, frequency: 2200, presence: 4, ratio: 4, codec: { rate: 7000, bits: 4 } }) },
  { id: 'phone_speaker', name: 'Mobiel · speakerstand', group: 'Telefoon', emoji: '🔊', desc: 'Een kleine luidspreker met een lichte kamerreflectie.',
    ...communication({ lo: 430, hi: 5400, frequency: 1700, presence: 6, drive: 3, ratio: 3, speaker: true }) },
  { id: 'phone_voicemail', name: 'Voicemail', group: 'Telefoon', emoji: '📩', desc: 'Doffe, compacte opname met korrel en een holle middentoon.',
    ...communication({ lo: 420, hi: 2600, frequency: 850, presence: 5, drive: 2, ratio: 6, codec: { rate: 6000, bits: 6 } }) },
  { id: 'phone_landline', name: 'Vaste lijn · klassiek', group: 'Telefoon', emoji: '☎️', desc: 'Het vertrouwde, smalle geluid van een klassieke huistelefoon.', popular: true,
    ...communication({ lo: 300, hi: 3400, presence: 1.5, drive: 1.2, ratio: 2.5 }) },
  { id: 'phone_rotary', name: 'Draaitelefoon · vintage', group: 'Telefoon', emoji: '🕰️', desc: 'Een warme, blikkerige oude telefoon met zachte lijnruis.',
    ...communication({ lo: 550, hi: 2300, frequency: 1250, presence: 6, drive: 5, ratio: 3.5, noise: 0.003 }) },
  { id: 'phone_bad', name: 'Mobiel · slechte ontvangst', group: 'Telefoon', emoji: '📶', desc: 'Een zwak signaal met korte haperingen en wegvallende woorden.',
    ...communication({ lo: 300, hi: 3400, presence: 1, ratio: 3 }),
    post: (y, sr) => stutter(dropouts(telephoneCodec(y, sr, { rate: 6000, bits: 5 }), sr, { rate: 3.2, minLen: 0.045, maxLen: 0.15, seed: 31 }), sr, { rate: 1.4, seed: 32 }) },
  { id: 'phone_minimal', name: 'Subtiele telefoon', group: 'Telefoon', emoji: '📞', desc: 'Een lichte telefoonkleur zonder een sterk vervormde stem.',
    ...communication({ lo: 100, hi: 11000, presence: 0.5, ratio: 1.5 }) },

  // ---------- Robot ----------
  { id: 'vintage_robot', name: 'Robot · bunker / analoog', group: 'Robot', emoji: '⚙️', desc: 'Lage, vlakke bunkercomputer met donkere spraakresonanties en analoge kleuring.', popular: true, latency: 0.006, tail: 0.4,
    ...voiceCore({ frequency: 92, formant: 0.88, warmth: 0.4, cutoff: 4300 }),
    wet: (N, ctx, src, out, a, dur) => {
      const stages = [N.filter('peaking', 1150, 1.1, 3), N.gain(1.8), N.shaper(1.6), N.comp(-24, 3, 0.006, 0.14)];
      const filtered = band(N, src, 280, 2800, stages);
      const mid = N.gain(1);
      ring(N, ctx, filtered, mid, 38, 0.4);
      const comb = N.delay(0.011, 0.1), fb = N.gain(0.42);
      mid.connect(comb); comb.connect(fb); fb.connect(comb);
      const room = N.reverbIR(0.35, 3.5), rg = N.gain(0.18);
      comb.connect(out); mid.connect(out); mid.connect(room); room.connect(rg); rg.connect(out);
      bed(N, out, dur, { f: 1900, q: 0.7, level: 0.0035, seed: 17 });
    },
    post: (y, sr) => tapeDrift(telephoneCodec(y, sr, { rate: 10000, bits: 8 }), sr, 0.001) },
  { id: 'robot', name: 'Robot · metaal', group: 'Robot', emoji: '🤖', desc: 'Opnieuw gevormde robotstem met een vaste toon, metalen klinkers en korte resonantie.', popular: true, tail: 0.24,
    ...voiceCore({ frequency: 118, formant: 0.97, cutoff: 5200 }),
    wet: (N, ctx, src, out) => metal(N, src, out) },
  { id: 'computer', name: 'Mother · scheepscomputer', group: 'Robot', emoji: '💠', tags: 'AI android moeder mother I Am Mother warm vrouwelijk ruimteschip', popular: true,
    desc: 'Je eigen toonhoogte en intonatie, met een zachte vrouwelijke robotkleur, korte blikkerige galm en heel subtiel gekraak tijdens het spreken.',
    ...voiceCore({ preservePitch: true, formant: 1.035, robotic: 0.08, warmth: 0.18, grain: 0.0025 }), latency: 0.006, tail: 0.48,
    wet: (N, ctx, src, out, a, dur) => {
      const voice = N.filter('highpass', 75), warmth = N.filter('lowshelf', 230, 0.707, 2.5), presence = N.filter('peaking', 2700, 0.8, 1.2), air = N.filter('highshelf', 4700, 0.707, -2);
      const compressor = N.comp(-22, 1.8, 0.012, 0.18);
      N.chain(src, voice, warmth, presence, air, compressor, out);
      // Parallel, damped shell resonances give the voice a small metal body.
      // The unmodulated speech path stays intact; there is no pitch carrier.
      for (const [time, feedback, level] of [[0.0078, 0.38, 0.17], [0.0123, 0.29, 0.1]]) {
        const shell = N.delay(time, 0.1), damping = N.filter('lowpass', 3500), returnGain = N.gain(feedback);
        N.chain(compressor, N.filter('highpass', 420), shell, damping, returnGain, shell);
        N.chain(damping, N.filter('peaking', 1250, 1.5, 2), N.gain(level), out);
      }
      N.chain(compressor, N.delay(0.021), N.reverbIR(0.4, 3.4), N.filter('highpass', 300), N.filter('lowpass', 3800), N.gain(0.24), out);
      // Sparse, softly edged crackles follow speech activity, rather than
      // introducing a continuous hiss or clicks through silent pauses.
      const random = rng(193), texture = N.noise(dur + 0.04, 194), textureGain = N.gain(0);
      const textureLevel = 0.0022 * Math.min(1, rms(src.buffer.getChannelData(0)) / 0.1);
      for (const [time, activity] of N.voiceActivity || []) {
        if (activity < 0.25 || random() > 0.085) continue;
        textureGain.gain.setTargetAtTime(textureLevel * activity, time + 0.006, 0.001);
        textureGain.gain.setTargetAtTime(0, time + 0.01 + random() * 0.006, 0.002);
      }
      textureGain.gain.setTargetAtTime(0, dur, 0.002);
      N.chain(texture, N.filter('highpass', 1100), N.filter('lowpass', 3600), textureGain, out);
      texture.start(0); texture.stop(dur + 0.04);
    } },
  { id: 'robot_vocoder', name: 'Robot · vocoder', group: 'Robot', emoji: '🎹', desc: 'Klassieke zingende synthesizerstem: je woorden sturen een vaste elektronische toon.', popular: true,
    ...vocoder({ frequency: 110, formant: 1, cutoff: 5800 }, { color: 1.5 }) },
  { id: 'robot_titan', name: 'Robot · Titan', group: 'Robot', emoji: '🦾', desc: 'Diepe, zware gevechtsrobot met een lage synthstem, donkere klinkers en metalen pantser.', popular: true,
    ...vocoder({ frequency: 64, formant: 0.82, warmth: 0.7, cutoff: 4200 }, { metallic: true, room: 0.32, color: -2 }) },
  { id: 'robot_droid', name: 'Robot · kleine droid', group: 'Robot', emoji: '🛸', desc: 'Hoge, vriendelijke robotstem met heldere klinkers en een licht zwevende elektronische toon.', popular: true,
    ...vocoder({ frequency: 225, formant: 1.22, intonation: 0.08, cutoff: 6200 }, { room: 0.15, color: 2 }) },
  { id: 'robot_arcade', name: 'Robot · 8-bit arcade', group: 'Robot', emoji: '👾', desc: 'Vlakke retro-computerstem met grove klinkerresonanties en hoorbare digitale stapjes.',
    ...vocoder({ frequency: 135, formant: 1.05, cutoff: 4700, grain: 0.0013 }, { color: 3 }),
    post: (y, sr) => telephoneCodec(y, sr, { rate: 11000, bits: 6 }) },
  { id: 'robot_hive', name: 'Robot · collectief', group: 'Robot', emoji: '🔮', desc: 'Meerdere synthetische stemmen in één: een donker, dreigend robotkoor met een ruimtelijke staart.',
    ...vocoder({ frequency: 95, chord: [0, 7, 12], formant: 0.95, warmth: 0.2, cutoff: 5300 }, { room: 0.75, color: 1 }) },
  { id: 'robot_glitch', name: 'Robot · defect / glitch', group: 'Robot', emoji: '🔧', desc: 'Een haperende digitale robot die lettergrepen herhaalt en korte signaalfouten maakt.',
    ...vocoder({ frequency: 155, formant: 1.08, cutoff: 5100 }),
    post: (y, sr) => dropouts(stutter(telephoneCodec(y, sr, { rate: 11000, bits: 7 }), sr, { rate: 2, seed: 84 }), sr, { rate: 1.2, minLen: 0.02, maxLen: 0.045, seed: 85 }) },

  // ---------- Karakter ----------
  { id: 'alien', name: 'Alien', group: 'Karakter', emoji: '👽', desc: 'Buitenaards en zwevend', pitch: 4,
    wet: (N, ctx, src, out) => { const mid = N.gain(1); ring(N, ctx, src, mid, 420, 0.5); modDelay(N, mid, out, { base: 0.005, depth: 0.004, rate: 1.4, feedback: 0.6, mix: 0.7 }); const rv = N.reverbIR(1.5, 3), rg = N.gain(0.25); mid.connect(rv); rv.connect(rg); rg.connect(out); },
    tail: 1.5 },
  { id: 'deep', name: 'Diepe stem', group: 'Karakter', emoji: '🐻', desc: 'Lager en zwaarder', pitch: -5,
    wet: (N, ctx, src, out) => { const ls = N.filter('lowshelf', 200, 0.7, 4); N.chain(src, ls, out); }, keepDry: false },
  { id: 'high', name: 'Hoge stem', group: 'Karakter', emoji: '🐿️', desc: 'Hoger en lichter', pitch: 5 },
  { id: 'echo', name: 'Echo', group: 'Ruimte', emoji: '🏔️', desc: 'Herhalende echo', keepDry: true, tail: 2.5,
    wet: (N, ctx, src, out) => { const d = N.delay(0.28), fb = N.gain(0.45), lp = N.filter('lowpass', 3500); src.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(out); } },
  { id: 'reverb', name: 'Galm · grote hal', group: 'Ruimte', emoji: '🏛️', desc: 'Hoorbare vroege reflecties en een brede, langzaam uitdovende galm achter je stem.', keepDry: true, tail: 3.1,
    wet: (N, ctx, src, out) => {
      for (const [time, gain] of [[0.029, 0.3], [0.047, 0.24], [0.073, 0.17]]) N.chain(src, N.delay(time), N.filter('lowpass', 6500), N.gain(gain), out);
      N.chain(src, N.delay(0.025), N.reverbIR(2.9, 1.8), N.filter('highpass', 180), N.filter('lowpass', 6500), N.gain(1.35), out);
    } },
  { id: 'spy', name: 'Spion-versleuteld', group: 'Karakter', emoji: '🕵️', desc: 'Glitchy versleutelde lijn', latency: 0.006,
    wet: (N, ctx, src, out, a, dur) => { const e = band(N, src, 500, 4200, [N.comp(-24, 6)]); ring(N, ctx, e, out, 165, 0.8); bed(N, out, dur, { f: 4000, level: 0.006, seed: 19 }); },
    post: (y, sr) => dropouts(stutter(bitcrush(y, 6, 4), sr, { rate: 2.6, seed: 41 }), sr, { rate: 1.5, maxLen: 0.07, seed: 42 }) },
];

const BY_ID = Object.fromEntries(VOICE_PRESETS.map((p) => [p.id, p]));
export const presetName = (id) => (BY_ID[id] ? `${BY_ID[id].group === 'Basis' ? '' : BY_ID[id].group + ' · '}${BY_ID[id].name}` : 'Geen');

export async function applyVoiceFx(x, sr, presetId, amount = 1) {
  const p = BY_ID[presetId];
  amount = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 1;
  if (!p || presetId === 'none' || amount <= 0 || !x.length || rms(x) < 1e-7) return x;
  let y = x;
  if (p.pitch) {
    // Give the overlap/add windows real context at both ends. Without this,
    // short words lose their attack and pitch presets start with a fade.
    const padding = 3072;
    const padded = new Float32Array(y.length + padding * 2);
    padded.set(y, padding);
    for (let i = 0; i < padding; i++) {
      padded[padding - 1 - i] = y[i % y.length];
      padded[padding + y.length + i] = y[y.length - 1 - i % y.length];
    }
    const shifted = (await runDsp('speedPitch', padded, { speed: 1, pitch: p.pitch * amount })).subarray(padding);
    y = new Float32Array(x.length);
    y.set(shifted.subarray(0, y.length));
  }
  const reference = y;
  if (p.pre) y = finishVoice(reference, await p.pre(y, sr, amount), 4);
  if (p.wet) {
    const tail = p.tail ?? 0.05;
    const latency = Math.round((p.latency || 0) * sr);
    const ctx = new OfflineAudioContext(1, y.length + Math.ceil(tail * sr) + latency, sr);
    const buf = ctx.createBuffer(1, y.length, sr);
    // Consistent drive/compression for quiet and loud recordings.
    const inputGain = Math.min(12, 0.1 / Math.max(1e-7, rms(y)));
    const channel = buf.getChannelData(0);
    for (let i = 0; i < y.length; i++) channel[i] = y[i] * inputGain;
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
    // Balance transformed speech before the strength crossfade. A compressed
    // or resonant preset should not swamp the original at just 5% strength.
    if (!p.keepDry) wet = finishVoice(reference, wet, 8);
    // Process only the effect signal before mixing. Even glitch presets respect
    // the original voice at low strength, and 0% remains an exact bypass.
    y = new Float32Array(Math.max(reference.length, wet.length));
    // The model morphs voiced pitch and vocal-tract shape. Above half strength
    // its rebuilt voice replaces the original; consonants remain in the model.
    const wetAmount = p.transformsVoice ? Math.min(1, amount * 2) : amount * (1 - (p.speechMix || 0));
    for (let i = 0; i < y.length; i++) y[i] = (reference[i] || 0) * (p.keepDry ? 1 : 1 - wetAmount) + (wet[i] || 0) * wetAmount;
  }
  else {
    if (p.post) y = p.post(y, sr, amount);
    if (p.pre) y = Float32Array.from(y, (value, i) => (reference[i] || 0) * (1 - amount) + value * amount);
  }
  return finishVoice(x, y);
}
