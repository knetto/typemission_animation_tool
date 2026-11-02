import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, SR, clipDefaults, defaultTimeline } from '../../public/js/audio/engine.js';
import { applyVoiceFx } from '../../public/js/audio/voicefx.js';

const source = Float32Array.from({ length: SR / 5 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / SR) * 0.1);
const clip = (id, trackId, start = 0) => ({ ...clipDefaults(), id, trackId, src: { type: 'asset', id: 1 }, start, offset: 0, duration: source.length / SR });
const engine = () => {
  const engine = new AudioEngine(() => { throw new Error('Test source must be cached'); });
  engine.sources.set('asset:1', Promise.resolve(source));
  return engine;
};
function near(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-6, `sample ${i}`);
}

test('track FX process the combined audio after clip FX, fades and clip gain', async () => {
  const audio = engine();
  const track = { id: 'voice', fx: 'high', fxAmount: 0.65, gain: 0.4, glitch: true };
  const clips = [
    { ...clip('a', track.id, 0.1), gain: 0.7, fadeIn: 0.03, fx: 'high', fxAmount: 0.3 },
    { ...clip('b', track.id, 0.2), gain: 0.5, fadeOut: 0.04 },
  ];
  const saved = JSON.stringify({ tracks: [track], clips });
  const dry = await audio.renderMix({ tracks: [{ ...track, fx: 'none', gain: 1 }], clips });
  const start = Math.round(0.1 * SR);
  const wet = await applyVoiceFx(dry.pcm.slice(start), SR, track.fx, track.fxAmount);
  const expected = new Float32Array(start + wet.length);
  expected.set(wet.map(value => value * track.gain), start);
  const output = await audio.renderMix({ tracks: [track], clips });
  near(output.pcm, expected);
  near(output.glitchPcm, expected);
  assert.equal(JSON.stringify({ tracks: [track], clips }), saved, 'FX never overwrite clip settings');
});

test('added and moved voice lines use the destination track effect without changing cached clips', async () => {
  const audio = engine();
  const tl = { tracks: [{ id: 'dry' }, { id: 'wet', fx: 'high', fxAmount: 1 }], clips: [clip('a', 'dry')] };
  const dry = await audio.processClip(tl.clips[0]);
  const wet = await applyVoiceFx(source, SR, 'high');
  tl.clips[0].trackId = 'wet';
  near((await audio.renderMix(tl)).pcm, wet);
  assert.equal(await audio.processClip(tl.clips[0]), dry, 'moving preserves clip cache');
  tl.clips.push(clip('b', 'wet', 0.3));
  const raw = (await audio.renderMix({ ...tl, tracks: tl.tracks.map(track => ({ ...track, fx: 'none' })) })).pcm;
  near((await audio.renderMix(tl)).pcm, await applyVoiceFx(raw, SR, 'high'));
  tl.tracks[1].fxAmount = 0;
  near((await audio.renderMix(tl)).pcm, raw);
  tl.tracks[1].fx = 'none';
  tl.tracks[1].fxAmount = 1;
  near((await audio.renderMix(tl)).pcm, raw);
});

test('track effects respect mute, solo, selection offsets and independent tracks', async () => {
  const audio = engine();
  const tracks = [{ id: 'a', fx: 'high', mute: true }, { id: 'b', gain: 0.5 }];
  const clips = [clip('a', 'a', 1), clip('b', 'b')];
  near((await audio.renderMix({ tracks, clips })).pcm, source.map(value => value * 0.5));
  tracks[0].solo = true;
  const solo = await audio.renderMix({ tracks, clips });
  near(solo.pcm.slice(SR), await applyVoiceFx(source, SR, 'high'));
  assert.ok(solo.pcm.subarray(0, SR).every(value => value === 0));
  const selected = await audio.renderMix({ tracks, clips }, { clipIds: ['a'], ignoreMute: true });
  assert.equal(selected.offset, 1);
  near(selected.pcm, solo.pcm.slice(SR));
  assert.equal((await audio.renderMix({ tracks, clips }, { clipIds: [] })).pcm.length, 1);
  assert.equal((await audio.renderMix({ tracks: [{ fx: 'high' }], clips: [] })).pcm.length, 1);
});

test('old tracks without FX retain their audio and new tracks start with bypass', async () => {
  const audio = engine();
  const tracks = [{ id: 'old', gain: 0.5 }];
  near((await audio.renderMix({ tracks, clips: [clip('old', 'old')] })).pcm, source.map(value => value * 0.5));
  const track = defaultTimeline().tracks[0];
  assert.equal(track.fx, 'none');
  assert.equal(track.fxAmount, 1);
});
