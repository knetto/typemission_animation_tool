import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vocode, tapeDrift } from '../../public/js/audio/robot.js';
import { rms, stutter } from '../../public/js/audio/dsp.js';
import { VOICE_PRESETS } from '../../public/js/audio/voicefx.js';

const sr = 48000;
const voice = (frequency = 173, length = sr) => Float32Array.from({ length }, (_, i) => 0.08 * (Math.sin(2 * Math.PI * frequency * i / sr) + 0.4 * Math.sin(4 * Math.PI * frequency * i / sr)));
function energyAt(x, frequency) {
  let real = 0, imaginary = 0;
  for (let i = sr / 10; i < x.length - sr / 10; i++) {
    const phase = 2 * Math.PI * frequency * i / sr;
    real += x[i] * Math.cos(phase); imaginary += x[i] * Math.sin(phase);
  }
  return Math.hypot(real, imaginary);
}

test('vocoder imposes a new fixed robot pitch on different incoming voices', () => {
  for (const frequency of [173, 227]) {
    const input = voice(frequency), original = input.slice();
    const output = vocode(input, sr, { frequency: 110 });
    assert.equal(output.length, input.length);
    assert.ok(energyAt(output, 110) > energyAt(output, frequency) * 8, 'carrier replaces the incoming pitch');
    assert.deepEqual(input, original);
    assert.ok(output.every(Number.isFinite));
  }
});

test('droid and low robot synthesis have distinct target pitches', () => {
  const input = voice();
  const low = vocode(input, sr, { frequency: 62, formant: 0.78, pulse: 0.7 });
  const high = vocode(input, sr, { frequency: 205, formant: 1.25, pulse: 0.65 });
  assert.ok(energyAt(low, 62) > energyAt(low, 205) * 10);
  assert.ok(energyAt(high, 205) > energyAt(high, 62) * 10);
});

test('robot carriers follow speech and fall silent between voice lines', () => {
  const input = new Float32Array(sr * 2);
  input.set(voice(173, sr / 3), sr / 4);
  input.set(voice(227, sr / 3), sr + sr / 4);
  const output = vocode(input, sr);
  assert.equal(rms(output, 0, sr / 5), 0, 'no buzz before speech');
  assert.ok(rms(output, sr / 3, sr / 2) > 0.01);
  assert.ok(rms(output, Math.round(sr * 0.85), Math.round(sr * 1.15)) < 1e-7, 'silent gaps do not contain a continuous synth');
  assert.ok(rms(output, Math.round(sr * 1.35), Math.round(sr * 1.5)) > 0.01);
  assert.deepEqual(vocode(new Float32Array(sr), sr), new Float32Array(sr));
});

test('vocoder is repeatable and tracks recording volume without quantization loss', () => {
  const input = voice();
  const loud = vocode(input, sr);
  const quiet = vocode(input.map(value => value * 0.02), sr);
  assert.ok(Math.abs(rms(quiet) / rms(loud) - 0.02) < 1e-6);
  assert.deepEqual(vocode(input, sr), loud);
  for (const length of [0, 1, 8, 100]) {
    const output = vocode(voice(173, length), sr);
    assert.equal(output.length, length);
    assert.ok(output.every(Number.isFinite));
  }
});

test('tape drift and short glitch edits preserve duration, sources and finite samples', () => {
  const input = voice(173, sr / 4), original = input.slice();
  const drifted = tapeDrift(input, sr);
  const glitched = stutter(input, sr, { rate: 12 });
  for (const output of [drifted, glitched]) {
    assert.equal(output.length, input.length);
    assert.ok(output.every(Number.isFinite));
    assert.notDeepEqual(output, input);
  }
  assert.deepEqual(input, original);
  assert.deepEqual(tapeDrift(input, sr, 0), input);
});

test('robot category includes the original saved IDs and six new voices', () => {
  const robots = VOICE_PRESETS.filter(preset => preset.group === 'Robot');
  assert.equal(robots.length, 9);
  for (const id of ['robot', 'vintage_robot', 'computer', 'robot_vocoder', 'robot_titan', 'robot_droid', 'robot_arcade', 'robot_hive', 'robot_glitch']) assert.ok(robots.some(preset => preset.id === id));
});

test('vocoder does not turn a low vowel into high-frequency carrier crackle', () => {
  function highpass(input) {
    const w = 2 * Math.PI * 5000 / sr, cosine = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2;
    const a0 = 1 + alpha, b0 = (1 + cosine) / (2 * a0), b1 = -2 * b0;
    const a1 = -2 * cosine / a0, a2 = (1 - alpha) / a0;
    const output = new Float32Array(input.length);
    let z1 = 0, z2 = 0;
    for (let i = 0; i < input.length; i++) {
      const y = b0 * input[i] + z1;
      z1 = b1 * input[i] - a1 * y + z2; z2 = b0 * input[i] - a2 * y;
      output[i] = y;
    }
    return output;
  }
  const vowel = Float32Array.from({ length: sr }, (_, i) => 0.08 * (Math.sin(2 * Math.PI * 173 * i / sr) + 0.4 * Math.sin(2 * Math.PI * 519 * i / sr)));
  for (const options of [{}, { frequency: 205, pulse: 0.65, breath: 0.1 }, { frequency: 62, formant: 0.78, pulse: 0.7 }]) {
    const output = vocode(vowel, sr, options);
    assert.ok(rms(highpass(highpass(output))) / rms(output) < 0.01, 'weak carrier bands must not amplify high-frequency leakage');
  }
});
