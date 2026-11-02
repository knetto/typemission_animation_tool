import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveformPeaks, waveformPeaks, sourceSampleRange, processedTrimRange } from '../../public/js/audio/waveform.js';
import { scrubGrain } from '../../public/js/audio/scrub.js';

test('waveform queries retain every transient at all zoom levels and partial block edges', () => {
  const pcm = Float32Array.from({ length: 10003 }, (_, i) => Math.sin(i * 0.17) * 0.15);
  pcm[1] = 0.95; pcm[65] = -0.98; pcm[8191] = 0.99; pcm[10002] = -0.96;
  const peaks = new WaveformPeaks(pcm);
  for (const [from, to] of [[0, pcm.length], [1, 2], [63, 66], [64, 128], [64, 8192], [8001, 9999], [9990, 10003], [-50, 30], [9900, 20000]]) {
    const samples = pcm.slice(Math.max(0, from), Math.min(pcm.length, to));
    assert.deepEqual(peaks.range(from, to), { min: Math.min(...samples), max: Math.max(...samples) });
  }
  assert.deepEqual(peaks.range(20000, 22000), { min: 0, max: 0 });
  assert.deepEqual(new WaveformPeaks(new Float32Array()).range(0, 5), { min: 0, max: 0 });
  assert.equal(waveformPeaks(pcm), waveformPeaks(pcm), 'zooming reuses the same source analysis');
});

test('right trims and extensions reveal/crop samples without changing their time scale', () => {
  const clip = { start: 0, offset: 10, duration: 5, speed: 2, reverse: false };
  const expected = sourceSampleRange(clip, 1, 1.1, 48000);
  for (const duration of [2, 5, 8]) assert.deepEqual(sourceSampleRange({ ...clip, duration }, 1, 1.1, 48000), expected);
  assert.deepEqual(expected, [12 * 48000, 12.2 * 48000]);
  assert.deepEqual(processedTrimRange({ ...clip, duration: 2 }, clip, 1, 1.1, 48000).map(Math.round), [48000, 52800]);
});

test('forward and reversed left/right trims keep processed peaks anchored to the original sound', () => {
  const original = { offset: 2, duration: 4, speed: 2, reverse: false };
  const leftTrimmed = { ...original, offset: 4, duration: 3 };
  assert.deepEqual(processedTrimRange(leftTrimmed, original, 0, 0.25, 48000), [48000, 60000]);
  assert.deepEqual(sourceSampleRange(leftTrimmed, 0, 0.25, 48000), sourceSampleRange(original, 1, 1.25, 48000));
  const reverse = { ...original, reverse: true };
  const reverseLeft = { ...reverse, duration: 3 };
  const reverseRight = { ...reverse, offset: 4, duration: 3 };
  assert.deepEqual(processedTrimRange(reverseLeft, reverse, 0, 0.25, 48000), [48000, 60000]);
  assert.deepEqual(processedTrimRange(reverseRight, reverse, 0, 0.25, 48000), [0, 12000]);
  const grown = { ...original, offset: 0, duration: 5 };
  assert.deepEqual(processedTrimRange(grown, original, 0, 0.25, 48000), [-48000, -36000], 'new audio lies outside the old bitmap and must use source samples');
});

test('scrub grains play the exact region forward and backwards, without changing the mix', () => {
  const pcm = Float32Array.from({ length: 100 }, (_, i) => i / 100), original = pcm.slice();
  assert.deepEqual(scrubGrain(pcm, 1000, 0.04, 1, 0.012), { pcm: pcm.slice(40, 52), start: 0.04, end: 0.052 });
  assert.deepEqual(scrubGrain(pcm, 1000, 0.04, -1, 0.012), { pcm: pcm.slice(28, 40).reverse(), start: 0.028, end: 0.04 });
  assert.deepEqual(scrubGrain(pcm, 1000, 0.095, 1, 0.012).pcm, pcm.slice(95));
  assert.deepEqual(pcm, original);
  assert.equal(scrubGrain(pcm, 1000, 10), null);
  assert.equal(scrubGrain(pcm, 1000, 0, -1), null);
  assert.equal(scrubGrain(pcm, 1000, NaN), null);
});
