import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resynthesizeVoice } from '../../public/js/audio/voice-model.js';
import { VOICE_PRESETS } from '../../public/js/audio/voicefx.js';
import { rms, rng } from '../../public/js/audio/dsp.js';

const sr = 48000;
function energyAt(x, frequency) {
  let re = 0, im = 0;
  for (let i = 4800; i < x.length - 4800; i++) {
    const phase = 2 * Math.PI * frequency * i / sr;
    re += x[i] * Math.cos(phase); im += x[i] * Math.sin(phase);
  }
  return Math.hypot(re, im);
}
const vowel = () => Float32Array.from({ length: sr }, (_, i) => {
  let sample = 0;
  for (let harmonic = 1; harmonic <= 45; harmonic++) {
    const f = harmonic * 100;
    const tract = Math.exp(-Math.pow((f - 650) / 170, 2)) + 0.35 * Math.exp(-Math.pow((f - 2200) / 250, 2));
    sample += 0.03 * tract * Math.sin(2 * Math.PI * f * i / sr);
  }
  return sample;
});

test('voice model changes vowel resonances independently of pitch', () => {
  const input = vowel(), original = input.slice();
  const neutral = resynthesizeVoice(input, sr, { frequency: 100, formant: 1 });
  const transformed = resynthesizeVoice(input, sr, { frequency: 100, formant: 1.2 });
  const centroid = x => {
    let weighted = 0, weight = 0;
    for (let f = 400; f <= 1000; f += 100) { const e = energyAt(x, f); weighted += f * e; weight += e; }
    return weighted / weight;
  };
  assert.ok(centroid(neutral) > 600 && centroid(neutral) < 700);
  assert.ok(centroid(transformed) > centroid(neutral) * 1.15, 'vocal-tract shape changes without transposing the harmonic grid');
  assert.deepEqual(input, original);
  assert.equal(transformed.length, input.length);
});

test('Mother replaces the voiced source at full strength instead of overlaying the original voice', async () => {
  const mother = VOICE_PRESETS.find(preset => preset.id === 'computer');
  const input = Float32Array.from({ length: sr }, (_, i) => 0.07 * (Math.sin(2 * Math.PI * 227 * i / sr) + 0.4 * Math.sin(2 * Math.PI * 454 * i / sr)));
  const output = await mother.pre(input, sr, 1);
  assert.match(mother.name, /Mother/);
  assert.ok(energyAt(output, 172) > energyAt(output, 227) * 10, 'the incoming fundamental is replaced by Mother');
  assert.ok(rms(output) > rms(input) * 0.7);
  assert.ok(output.every(Number.isFinite));
  assert.deepEqual(await mother.pre(input, sr, 0), input, 'zero strength preserves the input');
});

test('unvoiced consonants keep their waveform instead of acquiring a synth buzz', () => {
  const random = rng(617);
  let previous = 0;
  const consonant = Float32Array.from({ length: sr }, () => {
    const white = (random() * 2 - 1) * 0.05, sample = white - previous;
    previous = white; return sample;
  });
  const output = resynthesizeVoice(consonant, sr, { frequency: 172, formant: 1.12, warmth: 0.55 });
  const error = Float32Array.from(output, (value, i) => value - consonant[i]);
  assert.ok(rms(error) < rms(consonant) * 0.01, 'fricatives retain the original speech detail');
});

test('strength changes the transformed voice, including above 50 percent', () => {
  const input = vowel();
  const middle = resynthesizeVoice(input, sr, { frequency: 172, formant: 1.12, amount: 0.6 });
  const full = resynthesizeVoice(input, sr, { frequency: 172, formant: 1.12, amount: 1 });
  assert.ok(energyAt(full, 172) > energyAt(middle, 172) * 5, 'the upper strength range continues to morph the model');
});
