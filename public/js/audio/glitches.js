import { rms, rng, telephoneCodec, bitcrush } from './dsp.js';

export const GLITCH_PRESETS = [
  { id: 'combined', name: 'Alles gecombineerd', icon: '⚡', desc: 'Stotteren, haperen, wegvallen, slechte verbinding en digitale storing in één blok.', color: '#a78bfa' },
  { id: 'stutter', name: 'Stotteren', icon: '↻', desc: 'Herhaal een kort stukje van de stem.', color: '#c084fc' },
  { id: 'hitch', name: 'Haperen', icon: '▥', desc: 'Laat de stem ritmisch onderbreken.', color: '#fb923c' },
  { id: 'dropout', name: 'Valt weg', icon: '⊘', desc: 'Laat alleen dit stukje audio wegvallen.', color: '#fb7185' },
  { id: 'connection', name: 'Slechte verbinding', icon: '⌁', desc: 'Telefoonklank met wegvallende en herhaalde audiopakketjes.', color: '#38bdf8' },
  { id: 'digital', name: 'Digitale storing', icon: 'ϟ', desc: 'Korte, korrelige digitale vervorming.', color: '#facc15' },
];
export const GLITCH_BY_ID = Object.fromEntries(GLITCH_PRESETS.map(preset => [preset.id, preset]));
export const glitchDefaults = () => ({ type: 'stutter', amount: 1, rate: 9, grain: 0.065, enabled: true,
  dynamic: false, dynamicOptIn: false, density: 0.32, burst: 0.24, variation: 0.5, seed: 0,
  visual: true, visualAmount: 1, bits: 5, sampleRate: 7000, packetLoss: 0.2, packetRepeat: 0.15, gate: 0.58 });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function seedOf(id = '') {
  let seed = 2166136261;
  for (const character of String(id)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
}

const windowCache = new Map();
const enabledParts = effect => ['stutter', 'hitch', 'dropout', 'connection', 'digital'].filter(type => effect.parts?.[type] !== false);
const active = effect => effect.enabled !== false && GLITCH_BY_ID[effect.type] && (effect.amount ?? 1) > 0
  && Number.isFinite(effect.start) && Number.isFinite(effect.duration) && effect.duration > 0
  && (effect.type !== 'combined' || enabledParts(effect).length > 0);

// The earlier release enabled bursts automatically, including in saved blocks.
// Restore those blocks too; bursts now require an explicit choice in the UI.
export const isDynamicGlitch = effect => effect.dynamic === true && effect.dynamicOptIn === true;

// Timing uses seconds, never a fraction of the region's length. Extending a
// block adds new bursts; it cannot lengthen a repeated syllable into seconds.
export function glitchWindows(effect) {
  if (!active(effect)) return [];
  if (!isDynamicGlitch(effect)) return [{ start: 0, end: effect.duration }];
  const key = JSON.stringify([effect.id, effect.seed, effect.duration, effect.density, effect.burst, effect.variation]);
  if (windowCache.has(key)) return windowCache.get(key);
  const random = rng(seedOf(`${effect.id}:${effect.seed ?? 0}`));
  const density = clamp(effect.density ?? 0.32, 0.05, 1), burst = clamp(effect.burst ?? 0.24, 0.04, 1);
  const variation = clamp(effect.variation ?? 0.5, 0, 1), windows = [];
  let cursor = 0;
  while (cursor < effect.duration) {
    const duration = burst * (1 + (random() * 2 - 1) * variation * 0.65);
    windows.push({ start: cursor, end: Math.min(effect.duration, cursor + duration) });
    const gap = burst * (1 / density - 1) * (1 + (random() * 2 - 1) * variation * 0.8);
    cursor += duration + gap;
  }
  windowCache.set(key, windows);
  if (windowCache.size > 128) windowCache.delete(windowCache.keys().next().value);
  return windows;
}

const boundaryMix = (at, start, end, fade) => Math.min(1, Math.max(0, (at - start) / fade), Math.max(0, (end - 1 - at) / fade));

// A visual control signal, not extra audio. Max/union merging avoids stronger
// screen distortion when multiple regions or glitch-tagged tracks overlap.
export function glitchVisualEnvelope(length, sr, effects, timelineOffset = 0) {
  let envelope = null;
  for (const effect of effects || []) {
    if (effect.visual === false || (effect.visualAmount ?? 1) <= 0) continue;
    for (const window of glitchWindows(effect)) {
      const a = Math.round((effect.start + window.start - timelineOffset) * sr);
      const b = Math.round((effect.start + window.end - timelineOffset) * sr);
      const start = Math.max(0, a), end = Math.min(length, b);
      if (end <= start) continue;
      envelope ||= new Float32Array(length);
      const fade = Math.max(1, Math.min(Math.round(sr * 0.004), Math.floor((b - a) / 4)));
      const strength = clamp(effect.amount ?? 1, 0, 1) * clamp(effect.visualAmount ?? 1, 0, 1);
      for (let i = start; i < end; i++) envelope[i] = Math.max(envelope[i], boundaryMix(i, a, b, fade) * strength);
    }
  }
  return envelope;
}

function processSegment(input, sr, effect) {
  const random = rng(seedOf(effect.id)), count = input.length;
  const output = new Float32Array(count);
  if (effect.type === 'combined') {
    // Dropouts are timed interruptions, not a full-region mute: simply
    // stacking the standalone dropout would silence every other component.
    const parts = enabledParts(effect);
    const connection = parts.includes('connection') ? processSegment(input, sr, { ...effect, type: 'connection' }) : input;
    const digital = parts.includes('digital') ? processSegment(connection, sr, { ...effect, type: 'digital' }) : connection;
    for (let i = 0; i < count; i++) output[i] = connection[i] * 0.65 + digital[i] * 0.35;
    const repeatStart = Math.floor(count * 0.13), repeatEnd = Math.floor(count * 0.5);
    const repeated = parts.includes('stutter') ? processSegment(output.slice(repeatStart, repeatEnd), sr, { ...effect, type: 'stutter' }) : output.slice(repeatStart, repeatEnd);
    const edge = Math.max(1, Math.min(Math.round(sr * 0.003), Math.floor(repeated.length / 4)));
    for (let i = 0; i < repeated.length; i++) {
      const mix = Math.min(1, i / edge, (repeated.length - 1 - i) / edge);
      output[repeatStart + i] = output[repeatStart + i] * (1 - mix) + repeated[i] * mix;
    }
    const interrupted = parts.includes('hitch') ? processSegment(output, sr, { ...effect, type: 'hitch' }) : output;
    const dropStart = Math.floor(count * 0.62), dropEnd = Math.floor(count * 0.8);
    const dropEdge = Math.max(1, Math.min(Math.round(sr * 0.003), Math.floor((dropEnd - dropStart) / 4)));
    for (let i = dropStart; parts.includes('dropout') && i < dropEnd; i++) {
      const depth = Math.min(1, (i - dropStart) / dropEdge, (dropEnd - 1 - i) / dropEdge);
      interrupted[i] *= 1 - depth;
    }
    return interrupted;
  }
  if (effect.type === 'dropout') return output;
  if (effect.type === 'stutter') {
    const grain = clamp(Math.round((effect.grain ?? 0.065) * sr), 4, Math.max(4, Math.floor(count / 2)));
    const seam = Math.max(1, Math.min(Math.round(sr * 0.004), Math.floor(grain / 4)));
    const cycle = grain - seam;
    for (let i = 0; i < count; i++) {
      const at = i % cycle;
      const mix = at < seam && i >= cycle ? at / seam : 1;
      output[i] = (input[at] || 0) * mix + (input[at + cycle] || 0) * (1 - mix);
    }
    return output;
  }
  if (effect.type === 'hitch') {
    const period = Math.max(8, Math.min(count, Math.round(sr / clamp(effect.rate ?? 9, 2, 30))));
    const open = Math.round(period * clamp(effect.gate ?? 0.58, 0.1, 0.95)), edge = Math.max(1, Math.round(sr * 0.002));
    for (let i = 0; i < count; i++) {
      const at = i % period;
      output[i] = input[i] * (at < open ? Math.min(1, at / edge, (open - at) / edge) : 0);
    }
    return output;
  }
  const gain = Math.min(64, 0.22 / Math.max(1e-7, rms(input)));
  const normalized = new Float32Array(count);
  if (effect.type === 'digital') {
    for (let i = 0; i < count; i++) normalized[i] = input[i] * gain;
    const crushed = bitcrush(normalized, clamp(effect.bits ?? 5, 3, 12), Math.max(1, Math.round(sr / clamp(effect.sampleRate ?? 7000, 2000, sr))));
    for (let i = 0; i < count; i++) output[i] = crushed[i] / gain;
    return output;
  }
  // Filter before reducing the sample rate to avoid high-frequency aliasing.
  const hpCoefficient = Math.exp(-2 * Math.PI * 330 / sr), lpCoefficient = 1 - Math.exp(-2 * Math.PI * 2100 / sr);
  let previous = 0, highpass = 0, lowpass = 0, lowpass2 = 0;
  for (let i = 0; i < count; i++) {
    highpass = hpCoefficient * (highpass + input[i] - previous); previous = input[i];
    lowpass += (highpass - lowpass) * lpCoefficient; lowpass2 += (lowpass - lowpass2) * lpCoefficient;
    normalized[i] = lowpass2 * gain;
  }
  const codec = telephoneCodec(normalized, sr, { rate: 6000, bits: 5 });
  const packet = Math.max(1, Math.round(sr * 0.025)), fade = Math.max(1, Math.round(sr * 0.002));
  let state = 1, previousState = 1;
  for (let i = 0; i < count; i++) {
    if (i % packet === 0) {
      previousState = state; const choice = random(), loss = clamp(effect.packetLoss ?? 0.2, 0, 0.8);
      state = choice < loss ? 0 : choice < loss + clamp(effect.packetRepeat ?? 0.15, 0, 0.8) && i >= packet ? 2 : 1;
    }
    const blend = Math.min(1, (i % packet) / fade);
    const previousSample = previousState === 0 ? 0 : codec[previousState === 2 ? Math.max(0, i - packet) : i] / gain;
    const currentSample = state === 0 ? 0 : codec[state === 2 ? Math.max(0, i - packet) : i] / gain;
    output[i] = previousSample * (1 - blend) + currentSample * blend;
  }
  return output;
}

// Effects never extend audio or move later words. Only selected samples change;
// a small boundary crossfade avoids clicks at the two overlay edges.
export function applyGlitchRegions(input, sr, effects, timelineOffset = 0) {
  let output = input;
  for (const effect of effects || []) {
    const amount = clamp(Number.isFinite(effect.amount) ? effect.amount : 1, 0, 1);
    const windows = glitchWindows(effect);
    for (let index = 0; index < windows.length; index++) {
      const window = windows[index];
      const regionStart = Math.round((effect.start + window.start - timelineOffset) * sr);
      const regionEnd = Math.round((effect.start + window.end - timelineOffset) * sr);
      const start = Math.max(0, regionStart), end = Math.min(input.length, regionEnd);
      if (end <= start) continue;
      if (output === input) output = input.slice();
      const segment = output.slice(start, end), wet = processSegment(segment, sr, { ...effect, id: isDynamicGlitch(effect) ? `${effect.id}:${effect.seed ?? 0}:${index}` : effect.id });
      const fade = Math.max(1, Math.min(Math.round(sr * 0.004), Math.floor((regionEnd - regionStart) / 4)));
      for (let i = 0; i < segment.length; i++) {
        const at = start + i;
        const edge = boundaryMix(at, regionStart, regionEnd, fade);
        const mix = amount * edge;
        output[at] = segment[i] * (1 - mix) + wet[i] * mix;
      }
    }
  }
  return output;
}
