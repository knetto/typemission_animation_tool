import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureAudio, formatDbfs } from '../../public/js/audio/meter.js';
import { fitPanelWidths } from '../../public/js/editor-panels.js';
import { buildSoundtrack, makeSchedule } from '../../public/js/scenes/renderer.js';

const sr = 48000;
const tone = (amplitude) => Float32Array.from({ length: sr }, (_, i) => amplitude * Math.sin(2 * Math.PI * 1000 * i / sr));

test('meter reports calibrated sine RMS in dBFS and tracks gain changes', () => {
  const loud = measureAudio(tone(0.5), sr, 0.5);
  const quiet = measureAudio(tone(0.25), sr, 0.5);
  assert.ok(Math.abs(loud.dbfs - 20 * Math.log10(0.5 / Math.SQRT2)) < 0.001);
  assert.ok(Math.abs(loud.dbfs - quiet.dbfs - 20 * Math.log10(2)) < 0.001);
  assert.equal(formatDbfs(loud.dbfs), '-9.0 dBFS');
});

test('meter follows timeline silence and never reads ahead of playback', () => {
  const pcm = new Float32Array(sr * 2);
  pcm.set(tone(0.5), sr);
  assert.equal(measureAudio(pcm, sr, 0.99).dbfs, -Infinity);
  assert.equal(measureAudio(pcm, sr, 1).dbfs, -Infinity);
  assert.ok(Math.abs(measureAudio(pcm, sr, 1.5).dbfs + 9.0309) < 0.001);
  assert.equal(measureAudio(pcm, sr, -1).live, false);
  assert.equal(measureAudio(pcm, sr, 2).live, false);
  assert.equal(formatDbfs(-Infinity), '−∞ dBFS');
});

test('meter retains genuinely quiet levels and does not invent noise', () => {
  assert.ok(Math.abs(measureAudio(tone(0.00001), sr, 0.5).dbfs + 103.0103) < 0.001);
  assert.equal(measureAudio(new Float32Array(sr), sr, 0.5).rms, 0);
  assert.equal(measureAudio(new Float32Array(), sr, 0).dbfs, -Infinity);
});

test('scene meter uses final soundtrack gain and scheduled audio position', async () => {
  const voice = tone(0.5);
  voice[sr - 1] = 2; // A transient makes the final soundtrack normalize down.
  const opts = { sfx: false, preDelay: 0.2, postDelay: 0.2 };
  const schedule = makeSchedule('transmission', voice.length / sr, opts);
  const soundtrack = await buildSoundtrack('transmission', voice, schedule, opts);
  const level = measureAudio(soundtrack, sr, schedule.tAudio + 0.5);
  assert.ok(Math.abs(level.dbfs - 20 * Math.log10(0.5 * 0.49 / Math.SQRT2)) < 0.001);
  assert.equal(measureAudio(soundtrack, sr, schedule.tAudio - 0.01).dbfs, -Infinity);
  assert.equal(measureAudio(soundtrack, sr, schedule.tAudioEnd + 0.1).dbfs, -Infinity);
});

test('panel widths preserve usable sidebars and timeline without overflow', () => {
  for (const width of [761, 800, 1024, 1280, 1440, 1920]) {
    for (const preferred of [{ left: 264, right: 320 }, { left: 520, right: 520 }, { left: -10, right: 99999 }]) {
      const panels = fitPanelWidths(width, preferred);
      assert.ok(panels.left >= 200 && panels.left <= 520);
      assert.ok(panels.right >= 248 && panels.right <= 520);
      assert.ok(panels.left + panels.right + 16 + panels.center <= width);
    }
  }
  assert.deepEqual(fitPanelWidths(1440, { left: 360, right: 420 }), { left: 360, right: 420, center: 320 });
});
