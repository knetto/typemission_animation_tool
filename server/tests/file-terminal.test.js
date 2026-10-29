import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, parseProject } from '../db.js';
import { normalizeFileOpts, fileSchedule, sequenceAt, fileSoundtrack, fileSoundEvents } from '../../public/js/files/model.js';
import { organicMove, filePointer, outroPointer } from '../../public/js/files/motion.js';

test('legacy database migration preserves existing audio projects and timelines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-migration-')), file = path.join(dir, 'studio.db');
  const legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, scene TEXT, scene_opts TEXT, timeline TEXT, duration REAL, created_at TEXT, updated_at TEXT);
    INSERT INTO projects VALUES (7, 'Existing recording', 'urgent', '{}', '{"clips":[{"fx":"phone_modern"}]}', 12, 'now', 'now');`);
  legacy.close();
  let db;
  try {
    db = openDb(file);
    const project = parseProject(db.prepare('SELECT * FROM projects WHERE id = 7').get());
    assert.equal(project.type, 'audio'); assert.equal(project.scene, 'urgent'); assert.equal(project.duration, 12);
    assert.deepEqual(project.timeline, { clips: [{ fx: 'phone_modern' }] }); assert.deepEqual(project.file_opts, {});
    db.close(); db = openDb(file); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 1, 'migration is idempotent');
  } finally { db?.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('image sequence holds each image for its configured duration and navigates folders in order', () => {
  const images = [{ id: 1, folder: 'A' }, { id: 2, folder: 'A', duration: 5 }, { id: 3, folder: 'B', duration: 0.5 }];
  const schedule = fileSchedule(images);
  assert.ok(schedule.intro > 4); assert.deepEqual(schedule.segments.map((s) => s.folderChanged), [true, false, true]);
  for (const [index, s] of schedule.segments.entries()) {
    assert.ok(Math.abs(s.close - s.open - [3, 5, 0.5][index]) < 1e-10);
    assert.equal(sequenceAt(schedule, s.open + 0.01).segment.image.id, images[index].id);
    assert.equal(sequenceAt(schedule, s.open + 0.01).phase, 'image');
    assert.equal(sequenceAt(schedule, s.close + 0.01).phase, 'close');
  }
  const withoutIntro = fileSchedule(images, { intro: false });
  assert.equal(withoutIntro.intro, 0); assert.equal(withoutIntro.segments[0].start, 0);
  assert.ok(Math.abs(schedule.total - withoutIntro.total - schedule.intro) < 1e-10);
  assert.equal(sequenceAt(withoutIntro, withoutIntro.total).phase, 'close');
  assert.equal(fileSchedule([], { intro: false }).total, 0);
});

test('navigation sounds use exact sequence events, remain deterministic and respect mute/volume', () => {
  const opts = normalizeFileOpts({ intro: false });
  const schedule = fileSchedule([{ id: 1, folder: 'Photos', duration: 3 }], opts);
  const a = fileSoundtrack(schedule, opts, 8000), b = fileSoundtrack(schedule, opts, 8000);
  assert.deepEqual(a, b); assert.equal(a.length, Math.ceil(schedule.total * 8000));
  assert.ok(a.some((sample) => sample !== 0)); assert.ok(a.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 0.9));
  const quiet = fileSoundtrack(schedule, { ...opts, volume: opts.volume / 2 }, 8000);
  a.forEach((sample, i) => assert.ok(Math.abs(sample / 2 - quiet[i]) < 1e-7));
  assert.ok(fileSoundtrack(schedule, { ...opts, sounds: false }, 8000).every((sample) => sample === 0));
  const s = schedule.segments[0];
  assert.ok(a.slice(Math.ceil((s.open + 0.2) * 8000), Math.floor(s.close * 8000)).every((sample) => sample === 0), 'image hold has no continuous noise');
  const events = fileSoundEvents(schedule, opts);
  assert.ok(events.some((e) => Math.abs(e.at - s.fileClick) < 1e-10));
  assert.ok(events.some((e) => Math.abs(e.at - s.closeClick) < 1e-10));
});

test('relaxed navigation pauses before clicks and pace never changes image hold times', () => {
  const images = [{ id: 1, folder: 'Files', duration: 3 }, { id: 2, folder: 'Files', duration: 5 }];
  const schedule = fileSchedule(images, { intro: false });
  const slower = fileSchedule(images, { intro: false, pace: 1.3 });
  assert.ok(schedule.segments[0].open > 2.8); assert.ok(schedule.segments[1].open - schedule.segments[1].start > 1.5);
  for (let i = 0; i < images.length; i++) {
    const a = schedule.segments[i], b = slower.segments[i];
    assert.ok(a.fileClick - a.fileArrive > 0.3);
    assert.ok(a.closeClick - a.closeArrive > 0.25);
    assert.ok(Math.abs((b.open - b.start) / (a.open - a.start) - 1.3) < 1e-10);
    assert.ok(Math.abs(b.close - b.open - images[i].duration) < 1e-10);
  }
});

test('curved pointer paths are smooth, continuous across phases and deterministic', () => {
  const from = { x: 20, y: 10 }, to = { x: 1020, y: 10 };
  assert.deepEqual(organicMove(from, to, 0), from); assert.deepEqual(organicMove(from, to, 1), to);
  assert.ok(Math.abs(organicMove(from, to, 0.5).y - 10) > 20, 'trajectory curves rather than following a straight line');
  assert.ok(Math.hypot(organicMove(from, to, 0.001).x - from.x, organicMove(from, to, 0.001).y - from.y) < 0.01, 'smooth acceleration from rest');
  const images = [{ id: 1, folder: 'A', duration: 0.5 }, { id: 2, folder: 'B', duration: 3 }];
  const { segments } = fileSchedule(images, { intro: false });
  const points = { folder: { x: 218, y: 330 }, file: { x: 574, y: 402 }, first: true };
  const s = segments[0];
  for (const t of [s.folderOpen, s.fileMove, s.open, s.close, s.closeClick]) {
    const a = filePointer(s, t - 0.00001, points), b = filePointer(s, t + 0.00001, points);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.05, `no pointer teleport at ${t}`);
  }
  const end = filePointer(s, s.end, points), next = filePointer(segments[1], segments[1].start, { ...points, first: false });
  assert.ok(Math.hypot(end.x - next.x, end.y - next.y) < 1e-9, 'segment boundary preserves pointer position');
  assert.equal(filePointer(s, s.folderClick - 0.1, points).hover, 'folder');
  assert.equal(filePointer(s, s.fileClick - 0.1, points).hover, 'file');
  assert.equal(filePointer(s, s.closeClick - 0.1, points).hover, 'close');
  assert.deepEqual(filePointer(s, s.fileArrive - 0.05, points), filePointer(s, s.fileArrive - 0.05, points));
});

test('mouse variations change the route while keeping click targets and replay stable', () => {
  const images = [{ id: 8, folder: 'Files' }, { id: 9, folder: 'Files' }];
  const a = fileSchedule(images, { intro: false, motionSeed: 123 }).segments[0];
  const b = fileSchedule(images, { intro: false, motionSeed: 456 }).segments[0];
  const points = { folder: { x: 218, y: 330 }, file: { x: 574, y: 402 }, first: true };
  const midpoint = a.start + (a.folderArrive - a.start) * 0.5;
  const p = filePointer(a, midpoint, points), q = filePointer(b, midpoint, points);
  assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 5, 'shuffling visibly changes the path');
  assert.deepEqual(p, filePointer(a, midpoint, points), 'seeking reproduces the same frame');
  for (const s of [a, b]) {
    for (const [time, target] of [[s.folderClick, points.folder], [s.fileClick, points.file], [s.closeClick, { x: 1706, y: 180 }]]) {
      const pointer = filePointer(s, time, points);
      assert.ok(Math.hypot(pointer.x - target.x, pointer.y - target.y) < 1e-9, 'click hits the exact target');
    }
    let previous = filePointer(s, s.start, points);
    for (let time = s.start + 1 / 120; time < s.end; time += 1 / 120) {
      const pointer = filePointer(s, time, points);
      assert.ok(Number.isFinite(pointer.x) && Number.isFinite(pointer.y));
      assert.ok(pointer.x > 0 && pointer.x < 1920 && pointer.y > 0 && pointer.y < 1080);
      assert.ok(Math.hypot(pointer.x - previous.x, pointer.y - previous.y) < 85, 'continuous motion');
      previous = pointer;
    }
  }
  const segments = fileSchedule(images).segments;
  assert.notEqual(segments[0].motionSeed, segments[1].motionSeed, 'each gesture set has a different variation');
});

test('optional logout outro closes after the last image and ends with a silent black-screen hold', () => {
  const images = [{ id: 1, folder: 'Files', duration: 3 }];
  assert.equal(normalizeFileOpts().outro, false);
  assert.equal(fileSchedule(images).outro, null);
  assert.equal(fileSchedule([], { intro: false, outro: true }).outro, null);
  for (const pace of [0.8, 1, 1.3]) {
    const opts = normalizeFileOpts({ intro: false, outro: true, pace });
    const schedule = fileSchedule(images, opts), s = schedule.segments.at(-1), o = schedule.outro;
    assert.equal(o.start, s.end); assert.equal(schedule.total, o.end);
    assert.ok(s.closeClick < o.start && o.start < o.arrive && o.arrive < o.click && o.click < o.terminal);
    assert.ok(o.logout < o.loggedOut && o.loggedOut < o.clear && o.clear < o.blank && o.blank < o.end);
    assert.equal(sequenceAt(schedule, o.start).phase, 'outro');
    assert.equal(sequenceAt(schedule, o.start).segment, null);
    assert.equal(sequenceAt(schedule, o.blank).phase, 'blank');
    assert.equal(sequenceAt(schedule, schedule.total).phase, 'blank');
    const lastPointer = filePointer(s, s.end, { folder: { x: 218, y: 330 }, file: { x: 574, y: 402 } });
    const nextPointer = outroPointer(o, o.start);
    assert.deepEqual([lastPointer.x, lastPointer.y], [nextPointer.x, nextPointer.y]);
    const clickPointer = outroPointer(o, o.click);
    assert.deepEqual([clickPointer.x, clickPointer.y], [1798, 90]); assert.equal(clickPointer.pressed, true);
    const events = fileSoundEvents(schedule, opts);
    assert.ok(events.some((e) => e.kind === 'click' && e.at === o.click));
    assert.ok(events.some((e) => e.kind === 'key' && e.at === o.logout));
    const pcm = fileSoundtrack(schedule, opts, 8000);
    assert.ok(pcm.slice(Math.ceil(o.blank * 8000)).every((sample) => sample === 0));
  }
});

test('folderLocked schedules a locked folder attempt before the cut (Deel 1) and opens after cracking (Deel 2)', () => {
  const images = [{ id: 1, folder: 'Files', duration: 3 }];
  const opts = normalizeFileOpts({ intro: false, folderLocked: true });
  assert.equal(opts.folderLocked, true);
  const schedule = fileSchedule(images, opts);
  const s = schedule.segments[0];
  assert.equal(s.locked, true);
  assert.ok(schedule.cut > 3 && schedule.cut < schedule.total);
  assert.equal(schedule.cut, s.cut);
  assert.ok(s.start < s.lockArrive && s.lockArrive < s.lockClick && s.lockClick < s.lockDoubleClick && s.lockDoubleClick < s.lockDenied && s.lockDenied < s.cut);
  assert.ok(s.cut < s.folderArrive && s.folderArrive < s.folderClick && s.folderClick < s.folderOpen && s.folderOpen < s.open);

  assert.equal(sequenceAt(schedule, s.lockClick).phase, 'lock_navigate');
  assert.equal(sequenceAt(schedule, s.lockDenied + 0.1).phase, 'locked');
  assert.equal(sequenceAt(schedule, s.cut + 0.1).phase, 'navigate');
  assert.equal(sequenceAt(schedule, s.open + 0.1).phase, 'image');

  const points = { folder: { x: 218, y: 330 }, file: { x: 574, y: 402 }, first: true };
  const pLockClick = filePointer(s, s.lockClick, points);
  assert.ok(Math.hypot(pLockClick.x - points.folder.x, pLockClick.y - points.folder.y) < 1e-9);
  assert.equal(pLockClick.pressed, true);

  const pPart2Click = filePointer(s, s.folderClick, points);
  assert.ok(Math.hypot(pPart2Click.x - points.folder.x, pPart2Click.y - points.folder.y) < 1e-9);
  assert.equal(pPart2Click.pressed, true);

  const events = fileSoundEvents(schedule, opts);
  assert.ok(events.some((e) => e.kind === 'denied' && Math.abs(e.at - s.lockDenied) < 1e-10));
  const pcm = fileSoundtrack(schedule, opts, 8000);
  const cutSample = Math.round(schedule.cut * 8000);
  assert.ok(pcm.slice(0, cutSample).some((sample) => sample !== 0), 'Deel 1 has navigation and denied sounds');
  assert.ok(pcm.slice(cutSample).some((sample) => sample !== 0), 'Deel 2 has folder and file open sounds');
});
