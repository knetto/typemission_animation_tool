import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
} from '../../public/js/keyboard/model.js';
import { computeKeyRects } from '../../public/js/keyboard/renderer.js';

test('All keyboard layouts (NL, US, UK, AZERTY, German QWERTZ) have 5 balanced rows and valid finger assignments', () => {
  const validFingers = new Set(FINGERS.map((f) => f.id));
  assert.deepEqual([...validFingers], ['pinky', 'ring', 'middle', 'index', 'index_right', 'thumb']);

  for (const layoutId of ['qwerty', 'qwerty_us', 'qwerty_uk', 'azerty', 'qwertz']) {
    const layout = KEYBOARD_LAYOUTS[layoutId];
    assert.ok(layout, `layout ${layoutId} exists`);
    assert.equal(layout.rows.length, 5, `${layoutId} has 5 rows`);
    for (const [rIdx, row] of layout.rows.entries()) {
      const prevRowIso = rIdx > 0 ? layout.rows[rIdx - 1].find((k) => k.isoEnter) : null;
      const sumW = row.reduce((acc, k) => acc + k.w, 0) + (prevRowIso ? prevRowIso.wBottom || 1.25 : 0);
      assert.ok(Math.abs(sumW - 15) < 1e-6, `${layoutId} row ${rIdx} sums to 15u (got ${sumW})`);
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
  assert.equal(opts.fingerColors.index, '#3b82f6');
  assert.equal(opts.fingerColors.index_right, '#1d4ed8');

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
