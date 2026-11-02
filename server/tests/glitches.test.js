import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGlitchRegions, GLITCH_PRESETS, glitchDefaults, glitchWindows, glitchVisualEnvelope } from '../../public/js/audio/glitches.js';
import { AudioEngine, clipDefaults, SR } from '../../public/js/audio/engine.js';

const sr = 48000;
const signal = (seconds = 1) => Float32Array.from({ length: Math.round(sr * seconds) }, (_, i) => (0.05 + 0.035 * Math.sin(i / 7000)) * (Math.sin(2 * Math.PI * (240 * i / sr + 70 * (i / sr) ** 2)) + 0.25 * Math.sin(i * 0.47)));
const effect = (type, overrides = {}) => ({ ...glitchDefaults(), dynamic: false, dynamicOptIn: true, visual: false, id: 'test', trackId: 'voice', type, start: 0.2, duration: 0.45, ...overrides });

test('new and previously auto-dynamic blocks restore continuous sound until bursts are explicitly enabled', () => {
  assert.equal(glitchDefaults().dynamic, false);
  const input = signal(2);
  for (const preset of GLITCH_PRESETS) {
    const current = effect(preset.id, { duration: 1.5, dynamic: false });
    const legacy = { ...current, dynamic: true }; delete legacy.dynamicOptIn;
    const unset = { ...legacy }; delete unset.dynamic;
    assert.deepEqual(glitchWindows(legacy), [{ start: 0, end: 1.5 }]);
    const continuous = applyGlitchRegions(input, sr, [current]);
    assert.deepEqual(applyGlitchRegions(input, sr, [legacy]), continuous, preset.id);
    assert.deepEqual(applyGlitchRegions(input, sr, [unset]), continuous, preset.id);
    assert.notDeepEqual(applyGlitchRegions(input, sr, [{ ...legacy, dynamicOptIn: true }]), continuous, 'optional bursts still work');
  }
});

test('every glitch changes only the selected samples without modifying source data or duration', () => {
  const input = signal(), original = input.slice();
  for (const preset of GLITCH_PRESETS) {
    const output = applyGlitchRegions(input, sr, [effect(preset.id)]);
    assert.equal(output.length, input.length);
    assert.deepEqual(output.subarray(0, sr * 0.2), input.subarray(0, sr * 0.2), preset.id);
    assert.deepEqual(output.subarray(sr * 0.65), input.subarray(sr * 0.65), preset.id);
    assert.notDeepEqual(output.subarray(sr * 0.25, sr * 0.6), input.subarray(sr * 0.25, sr * 0.6), preset.id);
    assert.ok(output.every(Number.isFinite), preset.id);
    assert.deepEqual(input, original, preset.id);
    assert.deepEqual(applyGlitchRegions(input, sr, [effect(preset.id)]), output, 'preview/export must be repeatable');
  }
});

test('dropout silences the chosen moment while stutter repeats and hitch only interrupts parts', () => {
  const input = signal();
  const drop = applyGlitchRegions(input, sr, [effect('dropout')]);
  assert.ok(drop.subarray(sr * 0.21, sr * 0.64).every(value => value === 0));
  const stutter = applyGlitchRegions(input, sr, [effect('stutter', { grain: 0.05 })]);
  const cycle = Math.round(sr * (0.05 - 0.004));
  assert.equal(stutter[sr * 0.2 + cycle + 500], input[sr * 0.2 + 500], 'stutter repeats its short source fragment');
  const hitch = applyGlitchRegions(input, sr, [effect('hitch')]);
  const middle = hitch.subarray(sr * 0.21, sr * 0.64);
  const silent = middle.filter(value => value === 0).length / middle.length;
  assert.ok(silent > 0.25 && silent < 0.6, 'hitch has both speech and interruptions');
});

test('combined glitch keeps audible distorted speech and includes a timed dropout', () => {
  const input = signal();
  const combined = applyGlitchRegions(input, sr, [effect('combined')]);
  const center = combined.subarray(Math.round(sr * 0.21), Math.round(sr * 0.64));
  const silent = center.filter(value => value === 0).length / center.length;
  assert.ok(silent > 0.2 && silent < 0.85, 'combining dropout must not mute the entire block');
  const dropCenter = Math.round(sr * (0.2 + 0.45 * 0.7));
  assert.ok(combined.subarray(dropCenter - 100, dropCenter + 100).every(value => value === 0));
  for (const type of ['connection', 'hitch', 'stutter', 'digital', 'dropout']) assert.notDeepEqual(combined, applyGlitchRegions(input, sr, [effect(type)]), 'combined must not just alias a single preset');
});

test('bypass, disabled, invalid and out-of-range blocks leave the exact input intact', () => {
  const input = signal();
  for (const overlay of [effect('dropout', { amount: 0 }), effect('stutter', { enabled: false }), effect('missing'), effect('dropout', { start: 5 }), effect('dropout', { duration: -1 }), effect('dropout', { start: NaN })]) {
    assert.equal(applyGlitchRegions(input, sr, [overlay]), input);
  }
  for (const preset of GLITCH_PRESETS) assert.ok(applyGlitchRegions(new Float32Array(sr), sr, [effect(preset.id)]).every(value => value === 0), 'glitches must not introduce sound in silence');
  assert.equal(applyGlitchRegions(input, sr, []).length, input.length);
});

test('timeline offsets and partially overlapping blocks stay in the intended time interval', () => {
  const input = signal();
  const offset = applyGlitchRegions(input, sr, [effect('dropout', { start: 5.2 })], 5);
  assert.deepEqual(offset, applyGlitchRegions(input, sr, [effect('dropout')], 0));
  const clipped = applyGlitchRegions(input, sr, [effect('dropout', { start: -0.5, duration: 0.75 })]);
  assert.equal(clipped[0], 0);
  assert.deepEqual(clipped.subarray(sr / 4), input.subarray(sr / 4));
});

test('track overlays apply after voice FX, preserve other tracks and reuse voice renders when moved', async () => {
  const audio = new AudioEngine(() => '');
  const source = signal(); audio.sources.set('asset:1', Promise.resolve(source));
  const clip = { ...clipDefaults(), id: 'line', trackId: 'voice', src: { type: 'asset', id: 1 }, start: 0.1, offset: 0, duration: 1 };
  const timeline = { tracks: [{ id: 'voice', fx: 'high', fxAmount: 0.5, glitch: true }, { id: 'music', gain: 0.25 }], clips: [clip, { ...clip, id: 'music', trackId: 'music' }], effects: [] };
  const dry = await audio.renderMix(timeline);
  const cached = [...audio.trackRenders.values()];
  timeline.effects = [effect('dropout', { start: 0.3 })];
  const changed = await audio.renderMix(timeline);
  assert.deepEqual([...audio.trackRenders.values()], cached, 'changing an overlay must not recalculate long voice effects');
  const at = Math.round(sr * 0.4), sourceAt = at - Math.round(sr * 0.1);
  assert.ok(Math.abs(changed.pcm[at] - source[sourceAt] * 0.25) < 1e-7, 'music remains audible when voice drops out');
  assert.equal(changed.glitchPcm[at], 0, 'the screen-glitch feed follows the actual affected voice');
  assert.deepEqual(changed.pcm.subarray(0, sr * 0.3), dry.pcm.subarray(0, sr * 0.3));
  const preview = await audio.renderMix({ ...timeline, clips: [clip], tracks: [timeline.tracks[0]] }, { clipIds: ['line'], ignoreMute: true });
  assert.equal(preview.offset, 0.1);
  assert.equal(preview.pcm[Math.round(sr * 0.3)], 0, 'selection preview uses timeline-relative overlay positions');
  timeline.effects[0].start = 0.6;
  await audio.renderMix(timeline);
  assert.ok(cached.every(promise => [...audio.trackRenders.values()].includes(promise)));
  assert.equal(changed.duration, dry.duration);
  assert.equal(SR, sr);
});

test('stretching dynamic regions adds short varied bursts with clean speech between them', () => {
  const input = signal(8);
  for (const preset of GLITCH_PRESETS) {
    const short = effect(preset.id, { dynamic: true, duration: 2 }), long = { ...short, duration: 8 };
    const windows = glitchWindows(long), early = glitchWindows(short);
    assert.ok(windows.length > early.length);
    assert.deepEqual(windows.slice(0, early.length - 1), early.slice(0, -1), 'extension preserves earlier burst timing');
    assert.ok(windows.every(window => window.end - window.start < 0.5), 'bursts do not stretch with the region');
    const output = applyGlitchRegions(input, sr, [long]);
    let changed = 0;
    for (let i = 0; i < input.length; i++) if (input[i] !== output[i]) changed++;
    assert.ok(changed / input.length > 0.03 && changed / input.length < 0.55, `${preset.id} preserves most of the original speech`);
    assert.deepEqual(applyGlitchRegions(input, sr, [long]), output, 'replay and export use identical bursts');
  }
});

test('density, burst duration, variation and shuffled patterns change the distribution predictably', () => {
  const base = effect('stutter', { dynamic: true, duration: 12, variation: 0 });
  const occupied = windows => windows.reduce((sum, window) => sum + window.end - window.start, 0);
  assert.ok(occupied(glitchWindows({ ...base, density: 0.8 })) > occupied(glitchWindows({ ...base, density: 0.15 })) * 3);
  assert.ok(glitchWindows({ ...base, burst: 0.08 }).length > glitchWindows({ ...base, burst: 0.6 }).length * 3);
  const varied = { ...base, variation: 0.8 };
  assert.notDeepEqual(glitchWindows(varied), glitchWindows(base));
  assert.notDeepEqual(glitchWindows({ ...varied, seed: 1 }), glitchWindows(varied));
  assert.deepEqual(glitchWindows({ ...varied }), glitchWindows(varied));
});

test('sound customization changes the requested behavior and combined components can be disabled', () => {
  const input = signal();
  for (const [type, a, b] of [
    ['digital', { bits: 3 }, { bits: 12 }], ['digital', { sampleRate: 2000 }, { sampleRate: 16000 }],
    ['connection', { packetLoss: 0, packetRepeat: 0 }, { packetLoss: 0.7, packetRepeat: 0.2 }],
    ['hitch', { gate: 0.2 }, { gate: 0.9 }], ['stutter', { grain: 0.02 }, { grain: 0.15 }],
  ]) assert.notDeepEqual(applyGlitchRegions(input, sr, [effect(type, a)]), applyGlitchRegions(input, sr, [effect(type, b)]), type);
  const parts = { stutter: false, hitch: false, dropout: false, connection: false, digital: false };
  const off = effect('combined', { parts, visual: true });
  assert.equal(applyGlitchRegions(input, sr, [off]), input);
  assert.equal(glitchVisualEnvelope(input.length, sr, [off]), null);
  assert.notDeepEqual(applyGlitchRegions(input, sr, [effect('combined')]), applyGlitchRegions(input, sr, [effect('combined', { parts: { dropout: false, hitch: false } })]));
});

test('visual bursts match audio windows and union overlapping triggers instead of adding them', () => {
  const overlay = effect('dropout', { dynamic: true, visual: true, duration: 3, variation: 0 });
  const mask = glitchVisualEnvelope(sr * 4, sr, [overlay]);
  const duplicate = glitchVisualEnvelope(sr * 4, sr, [overlay, overlay, { ...overlay, id: 'same-timing' }]);
  assert.deepEqual(duplicate, mask);
  assert.equal(mask[Math.round(sr * 0.3)], 1);
  assert.equal(mask[Math.round(sr * 0.6)], 0, 'the clean gap has no visual trigger');
  assert.deepEqual(glitchVisualEnvelope(sr * 4, sr, [{ ...overlay, start: 5.2 }], 5), mask, 'preview offsets retain exact timing');
  for (const override of [{ visual: false }, { enabled: false }, { amount: 0 }, { visualAmount: 0 }]) {
    assert.equal(glitchVisualEnvelope(sr * 4, sr, [{ ...overlay, ...override }]), null);
  }
});

test('dropout visuals use the original voice; overlapping glitch tracks never double the screen trigger', async () => {
  const audio = new AudioEngine(() => '');
  const source = signal(2); audio.sources.set('asset:1', Promise.resolve(source));
  const clip = { ...clipDefaults(), id: 'a', trackId: 'voice', src: { type: 'asset', id: 1 }, start: 1, offset: 0, duration: 2 };
  const overlay = effect('dropout', { start: 1.2, visual: true });
  const tl = { tracks: [{ id: 'voice', gain: 1 }], clips: [clip], effects: [overlay] };
  const rendered = await audio.renderMix(tl), at = Math.round(sr * 1.3);
  assert.equal(rendered.pcm[at], 0);
  assert.ok(rendered.glitchPcm.subarray(at, at + 100).some(value => value > 0.01), 'muted words still produce the visual interruption');
  assert.ok(rendered.glitchPcm.subarray(0, sr * 1.2).every(value => value === 0));
  const visualOff = await audio.renderMix({ ...tl, effects: [{ ...overlay, visual: false }] });
  assert.equal(visualOff.glitchPcm, null);
  assert.deepEqual(visualOff.pcm, rendered.pcm, 'visual toggle never alters audio');
  const otherTrack = { id: 'other', glitch: true, gain: 1 };
  const overlap = { ...tl, tracks: [...tl.tracks, otherTrack], clips: [clip, { ...clip, id: 'b', trackId: 'other' }] };
  const tagged = await audio.renderMix({ ...overlap, effects: [] });
  assert.deepEqual((await audio.renderMix(overlap)).glitchPcm, tagged.glitchPcm, 'overlay and other tagged track use one maximum, never summed triggers');
  assert.deepEqual((await audio.renderMix({ ...overlap, tracks: overlap.tracks.map(track => ({ ...track, glitch: true })) })).glitchPcm, tagged.glitchPcm);
  assert.equal((await audio.renderMix({ ...tl, tracks: [{ id: 'voice', mute: true }] })).glitchPcm, null);
  const silent = { ...tl, clips: [{ ...clip, gain: 0 }] };
  assert.ok((await audio.renderMix(silent)).glitchPcm.every(value => value === 0), 'empty or silent audio does not invent visual triggers');
});
