import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishVoice, telephoneCodec, rms } from '../../public/js/audio/dsp.js';
import { applyVoiceFx, VOICE_PRESETS } from '../../public/js/audio/voicefx.js';

test('saved projects retain every original voice preset ID', () => {
  const ids = VOICE_PRESETS.map(preset => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['none', 'radio_modern', 'radio_oldschool', 'radio_walkie', 'radio_military', 'radio_extreme', 'radio_minimal', 'phone_modern', 'phone_landline', 'phone_rotary', 'phone_bad', 'phone_minimal', 'robot', 'computer', 'alien', 'deep', 'high', 'echo', 'reverb', 'spy']) assert.ok(ids.includes(id), id);
});

test('bypass and silence never add noise or modify source samples', async () => {
  const input = Float32Array.of(0.1, -0.2, 0.3);
  assert.equal(await applyVoiceFx(input, 48000, 'none'), input);
  assert.equal(await applyVoiceFx(input, 48000, 'phone_modern', 0), input);
  assert.equal(await applyVoiceFx(input, 48000, 'phone_modern', -1), input);
  assert.equal(await applyVoiceFx(input, 48000, 'unknown_saved_preset'), input);
  const silence = new Float32Array(4800);
  assert.equal(await applyVoiceFx(silence, 48000, 'radio_walkie'), silence);
  const empty = new Float32Array();
  assert.equal(await applyVoiceFx(empty, 48000, 'phone_modern'), empty);
  assert.deepEqual(input, Float32Array.of(0.1, -0.2, 0.3));
});

test('voice loudness matching ignores the appended quiet tail', () => {
  const ref = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.2) * 0.1);
  const rendered = new Float32Array(5000);
  rendered.set(ref.map(sample => sample * 0.5));
  const original = rendered.slice();
  const output = finishVoice(ref, rendered);
  assert.ok(Math.abs(rms(output.subarray(0, ref.length)) - rms(ref)) < 1e-6);
  assert.equal(output.length, rendered.length);
  assert.deepEqual(rendered, original);
});

test('voice output preserves headroom without hard clipping peaks', () => {
  const input = Float32Array.of(0.8, -0.8, 0.2, -0.2);
  const wet = Float32Array.of(1.8, -0.7, 0.1, -0.1);
  const output = finishVoice(input, wet);
  assert.ok(output.every(sample => Math.abs(sample) <= 0.960001));
  assert.ok(Math.abs(output[1] / output[0] - wet[1] / wet[0]) < 1e-6);
  assert.deepEqual(wet, Float32Array.of(1.8, -0.7, 0.1, -0.1));
});

test('telephone coloration preserves timing, silence and source data', () => {
  for (const length of [0, 1, 2, 47999, 48000]) {
    const input = Float32Array.from({ length }, (_, i) => Math.sin(2 * Math.PI * 600 * i / 48000) * 0.2);
    const original = input.slice();
    const output = telephoneCodec(input, 48000);
    assert.equal(output.length, input.length);
    assert.ok(output.every(Number.isFinite));
    assert.deepEqual(input, original);
  }
  assert.ok(telephoneCodec(new Float32Array(4800), 48000).every(sample => sample === 0));
});
