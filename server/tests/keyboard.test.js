import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../index.js';
import { runFfmpeg } from '../ffmpeg.js';
import {
  FINGERS,
  KEYBOARD_LAYOUTS,
  getFlatKeys,
  defaultSelectedKeys,
  normalizeKeyboardOpts,
  findKeyIdsByInput,
  keyExportSlug,
  keyboardSchedule,
  keyboardSoundtrack,
  unityKeySizeId,
  normalizeUnityExportSettings,
} from '../../public/js/keyboard/model.js';
import { computeKeyRects } from '../../public/js/keyboard/renderer.js';
import {
  buildZipBlob,
  resolveUnityTargets,
  computeUnityTimeWindow,
  generateUnityCSharpScript,
  generateUnityReadme,
  unityClipTiming,
  unityFrameTime,
  sliceUnityAudio,
  generateUnityEditorScript,
} from '../../public/js/keyboard/unity-export.js';

test('All keyboard layouts (NL, US, UK, AZERTY, German QWERTZ) have 5 balanced rows and valid finger assignments', () => {
  const validFingers = new Set(FINGERS.map((f) => f.id));
  assert.deepEqual([...validFingers], ['pinky', 'ring', 'middle', 'index', 'index_right', 'thumb']);

  for (const layoutId of ['qwerty', 'qwerty_us', 'qwerty_uk', 'azerty', 'qwertz']) {
    const layout = KEYBOARD_LAYOUTS[layoutId];
    assert.ok(layout, `layout ${layoutId} exists`);
    assert.equal(layout.rows.length, 5, `${layoutId} has 5 rows`);
    for (const [rIdx, row] of layout.rows.entries()) {
      const prevRowIso = rIdx > 0 ? layout.rows[rIdx - 1].find((k) => k.isoEnter) : null;
      const sumW = row.reduce((acc, k) => acc + k.w, 0) + (prevRowIso ? prevRowIso.wBottom || 1 : 0);
      const expectedW = rIdx === 4 ? 15.75 : (rIdx === 2 && prevRowIso) ? 14.75 : 15;
      assert.ok(Math.abs(sumW - expectedW) < 1e-6, `${layoutId} row ${rIdx} sums to ${expectedW}u (got ${sumW})`);
      for (const k of row) {
        assert.ok(validFingers.has(k.finger), `${layoutId} key ${k.id} has valid finger ${k.finger}`);
      }
    }
    const { keys } = computeKeyRects(layoutId);
    assert.equal(keys.length, getFlatKeys(layoutId).length);
    assert.ok(keys.every((k) => k.x > 0 && k.x + k.w < 1920 && k.y > 0 && k.y + k.h < 1080));
  }

  // Layout-specific checks
  const qwertyLetters = defaultSelectedKeys('qwerty');
  assert.equal(qwertyLetters.length, 26);
  assert.equal(defaultSelectedKeys('qwerty_us').length, 26);
  assert.equal(defaultSelectedKeys('qwerty_uk').length, 26);
  const qwertyFlat = getFlatKeys('qwerty');
  assert.equal(qwertyFlat.find((k) => k.id === 'f')?.finger, 'index');
  assert.equal(qwertyFlat.find((k) => k.id === 'j')?.finger, 'index_right');
  const ukMatched = findKeyIdsByInput('qwerty_uk', '£¬@#');
  assert.deepEqual(ukMatched, ['3', 'grave', 'quote', 'hash']);
  const qwertzLetters = defaultSelectedKeys('qwertz');
  assert.ok(qwertzLetters.includes('auml') && qwertzLetters.includes('ouml') && qwertzLetters.includes('uuml') && qwertzLetters.includes('eszett'));
});

test('Unity variants cover selected colors, real key shapes and both entrance directions without duplicates', () => {
  for (const layout of Object.keys(KEYBOARD_LAYOUTS)) {
    const flat = getFlatKeys(layout);
    const opts = normalizeKeyboardOpts({ layout, selectedKeys: flat.map((key) => key.id), stickerStyle: 'pop' });
    const targets = resolveUnityTargets(opts, 'used_colors', { sizeScope: 'used_sizes' });
    assert.equal(new Set(targets.map((target) => target.slug)).size, targets.length);
    for (const key of flat) {
      assert.ok(targets.some((target) => target.sizeId === unityKeySizeId(key)
        && target.colorOverride === opts.fingerColors[key.finger] && target.hand === key.hand), `${layout}/${key.id} is represented exactly`);
    }
    const all = resolveUnityTargets(opts, 'finger_colors', { sizeScope: 'all_sizes' });
    assert.equal(all.length, new Set(flat.map(unityKeySizeId)).size * FINGERS.length);
    assert.equal(new Set(all.map((target) => target.slug)).size, all.length);
    assert.ok(all.some((target) => target.keyId === 'space' && target.widthUnits > 6));
    assert.equal(all.some((target) => target.isoEnter), flat.some((key) => key.isoEnter));
  }
});

test('Unity filters can export only the current color or size and keep labelled keys distinct', () => {
  const opts = normalizeKeyboardOpts({ selectedKeys: ['f', 'g', 'h', 'j', 'space', 'enter'], previewKey: 'space' });
  const needed = resolveUnityTargets(opts, 'used_colors', { sizeScope: 'used_sizes' });
  assert.equal(needed.length, 4, 'F/G and H/J reuse their exact same blank stickers');
  const labelled = resolveUnityTargets(opts, 'used_colors', { sizeScope: 'used_sizes', contentMode: 'key_and_sticker' });
  assert.equal(labelled.length, opts.selectedKeys.length, 'labels are never replaced by a representative letter');
  const oneSize = resolveUnityTargets(opts, 'finger_colors', { sizeScope: 'current_size' });
  assert.equal(oneSize.length, 6);
  assert.ok(oneSize.every((target) => target.keyId === 'space' && target.sizeId === '7u'));
  const oneColor = resolveUnityTargets(opts, 'current_color', { sizeScope: 'all_sizes' });
  assert.ok(oneColor.every((target) => target.colorOverride === opts.fingerColors.thumb));
  const exact = resolveUnityTargets(opts, 'current_key', { sizeScope: 'all_sizes' });
  assert.equal(exact.length, 1);
  assert.equal(exact[0].keyId, 'space');
  assert.deepEqual(resolveUnityTargets({ selectedKeys: [] }, 'used_colors', { sizeScope: 'used_sizes' }), []);
  assert.deepEqual(resolveUnityTargets({ selectedKeys: [] }, 'selected_keys'), []);
});

test('Unity export settings round-trip and reject unsupported options', () => {
  const settings = normalizeUnityExportSettings({ targetScope: 'current_color', sizeScope: 'current_size', fps: 60, trimDelays: false });
  assert.deepEqual(normalizeKeyboardOpts({ unityExport: settings }).unityExport, settings);
  assert.equal(normalizeUnityExportSettings({ fps: 999, sizeScope: 'bogus' }).fps, 30);
  assert.equal(normalizeUnityExportSettings(null).sizeScope, 'used_sizes');
});

test('Unity frame and audio clocks preserve source FPS, final pose and completion sound at every animation speed', () => {
  for (const duration of [1.5, 3, 8]) {
    const opts = normalizeKeyboardOpts({ duration, startDelay: 0.7, endDelay: 0.8 });
    const schedule = keyboardSchedule(opts);
    for (const fps of [24, 30, 60]) {
      for (const contentMode of ['sticker_only', 'key_and_sticker', 'full_board']) {
        const timing = unityClipTiming(schedule, { fps, contentMode });
        assert.equal(unityFrameTime(timing, 0), timing.tStart);
        assert.equal(unityFrameTime(timing, timing.frameCount - 1), timing.tEnd);
        assert.ok(timing.tEnd >= Math.min(schedule.total, schedule.pressPeak + 0.535), 'completion chime is not cut off');
        for (let index = 1; index < timing.frameCount - 1; index++) {
          assert.ok(Math.abs(unityFrameTime(timing, index) - unityFrameTime(timing, index - 1) - 1 / fps) < 1e-12);
        }
        const pcm = new Float32Array(Math.ceil(schedule.total * 48000)).fill(0.25);
        const clip = sliceUnityAudio(pcm, timing);
        assert.equal(clip.length, Math.ceil(timing.frameCount / fps * 48000));
        assert.equal(clip[0], 0.25);
        assert.equal(clip.at(-1), 0, 'final hold has silence, not stretched audio');
      }
    }
  }
});

test('Unity importer explicitly slices real frames and creates clips at the exported FPS', () => {
  const meta = [{ slug: 'test', filename: 'test.png', fps: 60, frameCount: 2, frames: [
    { name: 'frame_000', x: 0, y: 256, width: 256, height: 256 },
    { name: 'frame_001', x: 256, y: 256, width: 256, height: 256 },
  ] }];
  const importer = generateUnityEditorScript(meta);
  assert.ok(importer.includes('animation.frames.Select'));
  assert.ok(importer.includes('clip.frameRate = animation.fps'));
  assert.ok(importer.includes('TextureImporterNPOTScale.None'));
  assert.ok(importer.includes("Replace('\\\\', '/')"), 'generated C# path separator is escaped correctly');
  const framesImporter = generateUnityEditorScript(meta, { wantSpriteSheet: false });
  assert.ok(framesImporter.includes('SpriteImportMode.Single'));
});

test('extra characters input matches primary and secondary symbols and generates clean slugs', () => {
  const matchedNl = findKeyIdsByInput('qwerty', 'A.,?!@°¨ ');
  assert.deepEqual(matchedNl, ['a', 'period', 'comma', 'slash', '1', 'at', 'degree', 'diaeresis', 'space']);

  const matchedUs = findKeyIdsByInput('qwerty_us', 'A.,?! ');
  assert.deepEqual(matchedUs, ['a', 'period', 'comma', 'slash', '1', 'space']);

  const matchedQwertz = findKeyIdsByInput('qwertz', 'äöüß');
  assert.deepEqual(matchedQwertz, ['auml', 'ouml', 'uuml', 'eszett']);

  const flat = getFlatKeys('qwertz');
  const auml = flat.find((k) => k.id === 'auml');
  const comma = flat.find((k) => k.id === 'comma');
  assert.equal(keyExportSlug(auml), 'a-umlaut');
  assert.equal(keyExportSlug(comma), 'komma');
});

test('keyboard sticker soundtrack is deterministic and respects blankSticker default and volume', () => {
  const opts = normalizeKeyboardOpts({ layout: 'azerty', fingerColors: { pinky: '#112233' } });
  assert.equal(opts.layout, 'azerty');
  assert.equal(opts.blankSticker, true, 'blank sticker covers letter by default');
  assert.equal(opts.fingerColors.pinky, '#112233');
  assert.equal(opts.fingerColors.index, '#456d74');
  assert.equal(opts.fingerColors.index_right, '#375169');

  const sched = keyboardSchedule(opts);
  assert.equal(sched.startDelay, 0.4);
  assert.equal(sched.endDelay, 0.4);
  assert.ok(sched.startDelay < sched.focusStart && sched.focusStart < sched.peelStart && sched.peelStart < sched.peelEnd && sched.peelEnd < sched.pressPeak && sched.pressPeak < sched.animEnd && sched.animEnd < sched.total);

  const customDelaySched = keyboardSchedule({ ...opts, startDelay: 0.75, endDelay: 0.5, duration: 3.0 });
  assert.equal(customDelaySched.startDelay, 0.75);
  assert.equal(customDelaySched.endDelay, 0.5);
  assert.ok(Math.abs(customDelaySched.total - 4.25) < 1e-9);
  const delayedPcm = keyboardSoundtrack(customDelaySched, { ...opts, startDelay: 0.75, endDelay: 0.5 }, 8000);
  assert.ok(delayedPcm.slice(0, Math.floor(0.75 * 8000)).every((s) => s === 0), 'silent during initial still frame delay');
  assert.ok(delayedPcm.slice(Math.ceil(customDelaySched.animEnd * 8000)).every((s) => s === 0), 'silent during end still frame delay');

  const pcmA = keyboardSoundtrack(sched, opts, 8000);
  const pcmB = keyboardSoundtrack(sched, opts, 8000);
  assert.deepEqual(pcmA, pcmB);
  assert.ok(pcmA.some((s) => Math.abs(s) > 0.05));
  assert.ok(keyboardSoundtrack(sched, { ...opts, sounds: false }, 8000).every((s) => s === 0));
});

test('updated peel remains smooth at every animation speed and preserves the original pling', () => {
  for (const duration of [1.5, 3, 8]) {
    for (const sampleRate of [8000, 44100, 48000]) {
      const opts = normalizeKeyboardOpts({ duration });
      const schedule = keyboardSchedule(opts);
      const pcm = keyboardSoundtrack(schedule, opts, sampleRate);
      assert.ok(pcm.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 0.95));
      const peel = pcm.slice(Math.round(schedule.peelStart * sampleRate), Math.round(schedule.peelEnd * sampleRate));
      const energy = (samples) => samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length;
      const quietTail = peel.slice(-Math.round(0.015 * sampleRate));
      const middle = peel.slice(Math.round(peel.length * 0.35), Math.round(peel.length * 0.65));
      assert.ok(energy(middle) > 0.00001, 'adhesive is audible during application');
      assert.ok(energy(quietTail) < energy(middle) * 0.2, 'texture settles before the completion sound');
      const windowSize = Math.round(0.020 * sampleRate);
      const windows = [];
      for (let offset = Math.round(peel.length * 0.25); offset + windowSize <= peel.length * 0.75; offset += windowSize) {
        windows.push(energy(peel.subarray(offset, offset + windowSize)));
      }
      assert.ok(Math.min(...windows) > Math.max(...windows) * 0.15,
        'peel stays continuous instead of repeatedly dropping between separate sounds');
    }
  }
  const schedule = keyboardSchedule();
  const pcm = keyboardSoundtrack(schedule);
  // Recorded from the original soundtrack before changing the peel. After the
  // press tail, the samples contain only the pling the user wanted to keep.
  const chime = pcm.slice(Math.round((schedule.pressPeak + 0.26) * 48000), Math.round((schedule.pressPeak + 0.535) * 48000));
  assert.equal(createHash('sha256').update(Buffer.from(chime.buffer)).digest('hex'),
    'c93b723a4a6250c2d400acc630d657da81a4ac7b06d9f4c53026c318e618c8c2');
});

test('keyboard project API persists options and exports individual per-key MP4 files', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
  const { app, db } = createApp({ storageDir: tmp });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const createRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Blind Typen Les 1', type: 'keyboard' }),
    });
    assert.equal(createRes.status, 201);
    const proj = await createRes.json();
    assert.equal(proj.type, 'keyboard');

    const updateRes = await fetch(`${base}/api/projects/${proj.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keyboard_opts: {
          layout: 'qwertz',
          selectedKeys: ['f', 'j', 'comma'],
          blankSticker: true,
        },
      }),
    });
    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.keyboard_opts.layout, 'qwertz');
    assert.deepEqual(updated.keyboard_opts.selectedKeys, ['f', 'j', 'comma']);

    // Test per-key export filename with keyLabel
    const v = path.join(tmp, 'v.mp4');
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v]);
    const fd = new FormData();
    fd.append('video', new Blob([fs.readFileSync(v)], { type: 'video/mp4' }), 'v.mp4');
    fd.append('scene', 'keyboard');
    fd.append('keyLabel', 'komma');
    fd.append('width', '320');
    fd.append('height', '180');
    fd.append('fps', '30');
    fd.append('duration', '3');

    const expRes = await fetch(`${base}/api/projects/${proj.id}/exports`, { method: 'POST', body: fd });
    const exp = await expRes.json();
    assert.equal(expRes.status, 201);
    assert.equal(exp.scene, 'keyboard');
    assert.ok(exp.filename.includes('-keyboard-toets-komma-'), `filename includes key slug: ${exp.filename}`);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Unity Sprite export resolves finger/master/key targets, trims still delays, and builds valid ZIP packages', async () => {
  const opts = normalizeKeyboardOpts({ layout: 'azerty', selectedKeys: ['a', 'z', 'space'], previewKey: 'a' });

  const fingerTargets = resolveUnityTargets(opts, 'finger_colors');
  assert.equal(fingerTargets.length, 6);
  assert.equal(fingerTargets[0].colorOverride, '#745c39');
  assert.equal(fingerTargets[3].colorOverride, '#456d74');
  assert.equal(fingerTargets[4].colorOverride, '#375169');

  const masterTargets = resolveUnityTargets(opts, 'white_tintable');
  assert.equal(masterTargets.length, 1);
  assert.equal(masterTargets[0].colorOverride, '#ffffff');

  const keyTargets = resolveUnityTargets(opts, 'selected_keys');
  assert.equal(keyTargets.length, 3);

  const sched = keyboardSchedule(opts);
  const winTrimmed = computeUnityTimeWindow(sched, { contentMode: 'sticker_only', trimStillDelays: true, fps: 30 });
  const winFull = computeUnityTimeWindow(sched, { contentMode: 'sticker_only', trimStillDelays: false, fps: 30 });
  assert.ok(winTrimmed.tStart >= sched.peelStart);
  assert.ok(winTrimmed.tEnd - winTrimmed.tStart < winFull.tEnd - winFull.tStart);

  const fakeMeta = [
    {
      slug: 'sticker_pinky_745c39',
      filename: 'sticker_pinky_745c39_256x256_6x5_30fps.png',
      cellWidth: 256,
      cellHeight: 256,
      keyPixelWidth: 100,
      keyPixelHeight: 100,
      columns: 6,
      rows: 5,
      frameCount: 30,
      fps: 30,
    },
  ];
  const cs = generateUnityCSharpScript(opts, fakeMeta);
  assert.ok(cs.includes('class StickerSpriteAnimator : MonoBehaviour'));
  assert.ok(cs.includes('#745c39'));
  const readme = generateUnityReadme(opts, fakeMeta, { contentMode: 'sticker_only', targetScope: 'finger_colors', fps: 30 });
  assert.ok(readme.includes('Cell Size X = 256, Y = 256'));

  const zipBlob = await buildZipBlob([
    { path: 'Scripts/StickerSpriteAnimator.cs', data: cs },
    { path: 'README_UNITY.txt', data: readme },
  ]);
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  // Verify PK\x03\x04 ZIP magic header
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
  assert.equal(zipBytes[2], 0x03);
  assert.equal(zipBytes[3], 0x04);
});
