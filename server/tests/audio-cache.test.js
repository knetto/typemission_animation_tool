import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, getProjectAudio, clipDefaults, SR } from '../../public/js/audio/engine.js';
import { buildSoundtrack, defaultSceneOpts, makeSchedule } from '../../public/js/scenes/renderer.js';

const source = Float32Array.from({ length: SR / 4 }, (_, i) => Math.sin(2 * Math.PI * 170 * i / SR) * 0.1);
const timeline = () => ({ tracks: [{ id: 'voice', name: 'Voice', gain: 1 }], clips: [{ ...clipDefaults(), id: 'line', name: 'A line', trackId: 'voice', src: { type: 'asset', id: 1 }, start: 0, offset: 0, duration: 0.25 }], effects: [] });
const engine = () => { const audio = new AudioEngine(() => ''); audio.sources.set('asset:1', Promise.resolve(source)); return audio; };

test('metadata edits retain prepared audio; audio and visual settings invalidate the right mix', async () => {
  const audio = engine(), tl = timeline(), first = await audio.renderMix(tl);
  tl.clips[0].name = 'Renamed'; tl.tracks[0].name = 'New track name'; tl.zoom = 250; tl.scene = 'urgent';
  assert.equal(await audio.renderMix(tl), first);
  tl.tracks[0].gain = 0.5;
  const quieter = await audio.renderMix(tl);
  assert.notEqual(quieter, first); assert.deepEqual(quieter.pcm, first.pcm.map(value => value * 0.5));
  const tracks = [...audio.trackRenders.values()];
  tl.effects = [{ id: 'overlay', trackId: 'voice', type: 'dropout', start: 0, duration: 0.2, visual: true }];
  const withVisual = await audio.renderMix(tl);
  tl.effects[0].visual = false;
  const withoutVisual = await audio.renderMix(tl);
  assert.deepEqual(withVisual.pcm, withoutVisual.pcm); assert.ok(withVisual.glitchPcm); assert.equal(withoutVisual.glitchPcm, null);
  assert.deepEqual([...audio.trackRenders.values()], tracks, 'gain and visual settings reuse the expensive voice render');
  assert.ok(audio.mixRenders.size <= 2);
});

test('concurrent views share a mix job and its progress while later edits cannot mutate that job', async () => {
  const audio = engine(), tl = timeline(), progressA = [], progressB = [];
  let release; audio.sources.set('asset:1', new Promise(resolve => { release = resolve; }));
  const a = audio.renderMix(tl, { onProgress: state => progressA.push(state) });
  const b = audio.renderMix(structuredClone(tl), { onProgress: state => progressB.push(state) });
  assert.equal(a, b, 'opening export joins the pending editor job');
  tl.clips[0].gain = 0.25;
  release(source);
  const rendered = await a;
  assert.deepEqual(rendered.pcm, source, 'the pending job owns a snapshot of its input settings');
  const edited = await audio.renderMix(tl);
  assert.deepEqual(edited.pcm, source.map(value => value * 0.25));
  for (const events of [progressA, progressB]) {
    assert.equal(events[0].progress, 0); assert.equal(events.at(-1).progress, 1);
    assert.ok(events.some(state => /clip|sporen|samenvoegen/i.test(state.label)));
    assert.ok(events.every((state, i) => !i || state.progress >= events[i - 1].progress));
  }
});

test('moving all clips in a track reuses its voice render with exact new timeline and overlay positions', async () => {
  const audio = engine(), tl = timeline(); tl.tracks[0].fx = 'high'; tl.tracks[0].fxAmount = 0.5;
  const initial = await audio.renderMix(tl), renderedVoice = [...audio.trackRenders.values()];
  tl.clips[0].start = 0.5;
  const moved = await audio.renderMix(tl);
  assert.deepEqual([...audio.trackRenders.values()], renderedVoice);
  assert.deepEqual(moved.pcm.subarray(SR / 2), initial.pcm);
  assert.ok(moved.pcm.subarray(0, SR / 2).every(sample => sample === 0));
  tl.effects = [{ id: 'drop', trackId: 'voice', type: 'dropout', start: 0.55, duration: 0.1 }];
  const dropped = await audio.renderMix(tl);
  assert.equal(dropped.pcm[Math.round(SR * 0.6)], 0);
  assert.deepEqual([...audio.trackRenders.values()], renderedVoice);
});

test('project sessions retain prepared audio across views and isolate different projects', async () => {
  const editor = getProjectAudio('cache-test-project', () => 'editor-url'); editor.sources.set('asset:1', Promise.resolve(source));
  const pending = editor.renderMix(timeline());
  const exportView = getProjectAudio('cache-test-project', () => 'export-url');
  assert.equal(editor, exportView); assert.equal(exportView.resolveUrl({}), 'export-url');
  assert.equal(exportView.renderMix(timeline()), pending);
  await pending;
  assert.notEqual(getProjectAudio('another-cache-test-project', () => ''), editor);
});

test('failed mix jobs can be retried and soundtrack caches respect audio changes', async () => {
  const audio = new AudioEngine(() => '');
  audio.sources.set('asset:1', Promise.reject(new Error('decode failed')));
  await assert.rejects(audio.renderMix(timeline()), /decode failed/);
  audio.sources.set('asset:1', Promise.resolve(source));
  assert.deepEqual((await audio.renderMix(timeline())).pcm, source);
  const opts = { ...defaultSceneOpts(), sfx: false }, schedule = makeSchedule('transmission', 0.25, opts);
  const first = await buildSoundtrack('transmission', source, schedule, opts);
  assert.equal(await buildSoundtrack('transmission', source, schedule, { ...opts, headline: 'Different title' }), first);
  assert.notEqual(await buildSoundtrack('transmission', source, { ...schedule, total: schedule.total + 1 }, opts), first);
});
