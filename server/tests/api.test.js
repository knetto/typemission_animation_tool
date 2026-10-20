// API tests — run with: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../index.js';
import { runFfmpeg } from '../ffmpeg.js';

let server, base, tmp, db;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  const created = createApp({ storageDir: tmp });
  db = created.db;
  const { app } = created;
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = (method, url, body) => fetch(base + url, {
  method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));

function wav(seconds = 0.5, rate = 8000) {
  const n = Math.floor(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), 44 + i * 2);
  return b;
}

test('project CRUD', async () => {
  const c = await json('POST', '/api/projects', { name: 'Missie 1', scene: 'urgent' });
  assert.equal(c.status, 201);
  assert.equal(c.body.scene, 'urgent');
  const u = await json('PUT', `/api/projects/${c.body.id}`, { name: 'Missie 1b', timeline: { tracks: [1] }, duration: 12.5 });
  assert.equal(u.body.name, 'Missie 1b');
  assert.deepEqual(u.body.timeline, { tracks: [1] });
  const list = await json('GET', '/api/projects');
  assert.ok(list.body.some((p) => p.id === c.body.id && p.duration === 12.5));
  assert.equal((await json('DELETE', `/api/projects/${c.body.id}`)).status, 204);
  assert.equal((await json('GET', `/api/projects/${c.body.id}`)).status, 404);
});

test('asset upload, rename, delete', async () => {
  const p = (await json('POST', '/api/projects', { name: 'Upload test' })).body;
  const fd = new FormData();
  fd.append('files', new Blob([wav()], { type: 'audio/wav' }), 'stem één.wav');
  fd.append('files', new Blob([wav()], { type: 'audio/wav' }), 'tweede.wav');
  const r = await fetch(`${base}/api/projects/${p.id}/assets`, { method: 'POST', body: fd });
  const assets = await r.json();
  assert.equal(r.status, 201);
  assert.equal(assets.length, 2);
  assert.equal(assets[0].name, 'stem één');
  const file = await fetch(`${base}/files/audio/${assets[0].filename}`);
  assert.equal(file.status, 200);
  const ren = await json('PATCH', `/api/assets/${assets[0].id}`, { name: 'Intro', duration: 0.5 });
  assert.equal(ren.body.name, 'Intro');
  assert.equal(ren.body.duration, 0.5);
  assert.equal((await json('DELETE', `/api/assets/${assets[1].id}`)).status, 204);
  const full = await json('GET', `/api/projects/${p.id}`);
  assert.equal(full.body.assets.length, 1);
});

test('sfx library persists uploads', async () => {
  const fd = new FormData();
  fd.append('files', new Blob([wav(0.2)], { type: 'audio/wav' }), 'piep.wav');
  fd.append('category', 'Mijn effecten');
  const up = await (await fetch(`${base}/api/sfx`, { method: 'POST', body: fd })).json();
  assert.equal(up[0].category, 'Mijn effecten');
  const list = await json('GET', '/api/sfx');
  assert.ok(list.body.some((s) => s.name === 'piep'));
  assert.equal((await json('DELETE', `/api/sfx/${up[0].id}`)).status, 204);
});

test('export muxes video + audio into mp4', async () => {
  const p = (await json('POST', '/api/projects', { name: 'Export test' })).body;
  const v = path.join(tmp, 'v.mp4'), a = path.join(tmp, 'a.wav');
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v]);
  fs.writeFileSync(a, wav(1));
  const fd = new FormData();
  fd.append('video', new Blob([fs.readFileSync(v)], { type: 'video/mp4' }), 'v.mp4');
  fd.append('audio', new Blob([fs.readFileSync(a)], { type: 'audio/wav' }), 'a.wav');
  fd.append('scene', 'ai'); fd.append('width', '320'); fd.append('height', '180'); fd.append('fps', '30'); fd.append('duration', '1');
  const r = await fetch(`${base}/api/projects/${p.id}/exports`, { method: 'POST', body: fd });
  const e = await r.json();
  assert.equal(r.status, 201, JSON.stringify(e));
  assert.ok(e.size > 1000);
  const dl = await fetch(`${base}/files/exports/${e.filename}`);
  assert.equal(dl.status, 200);
});

test('File Terminal images persist folders, hold times and an isolated ordered sequence', async () => {
  const p = (await json('POST', '/api/projects', { name: 'File project', type: 'file' })).body;
  assert.equal(p.type, 'file');
  const fd = new FormData(), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=', 'base64');
  fd.append('files', new Blob([png], { type: 'image/png' }), 'foto één.png');
  fd.append('files', new Blob([png], { type: 'image/png' }), 'Evidence.png');
  fd.append('folder', 'Missie');
  const response = await fetch(`${base}/api/projects/${p.id}/images`, { method: 'POST', body: fd });
  assert.equal(response.status, 201);
  const images = await response.json();
  assert.equal(images[0].name, 'foto één.png'); assert.equal(images[0].duration, 3); assert.equal(images[0].folder, 'Missie');
  assert.equal((await fetch(`${base}/files/images/${images[0].filename}`)).status, 200);
  assert.equal((await json('PATCH', `/api/images/${images[0].id}`, { duration: -1 })).status, 400);
  const updated = await json('PATCH', `/api/images/${images[0].id}`, { duration: 5, folder: 'Bewijs', name: 'Renamed.png' });
  assert.equal(updated.body.duration, 5); assert.equal(updated.body.folder, 'Bewijs');
  assert.equal((await json('PUT', `/api/projects/${p.id}/image-order`, { ids: [images[1].id, images[0].id] })).status, 204);
  assert.equal((await json('PUT', `/api/projects/${p.id}/image-order`, { ids: [images[0].id, images[0].id] })).status, 400);
  assert.equal((await json('PUT', `/api/projects/${p.id}/image-order`, { ids: [images[0].id, 999999] })).status, 400);
  await json('PUT', `/api/projects/${p.id}`, { file_opts: { theme: 'blue', intro: false, sounds: true, folders: ['Bestanden', 'Bewijs'] } });
  const full = (await json('GET', `/api/projects/${p.id}`)).body;
  assert.deepEqual(full.images.map((i) => i.id), [images[1].id, images[0].id]); assert.equal(full.file_opts.theme, 'blue');
  assert.equal((await json('GET', '/api/projects')).body.find((x) => x.id === p.id).image_count, 2);
  await json('DELETE', `/api/images/${images[1].id}`);
  assert.equal((await fetch(`${base}/files/images/${images[1].filename}`)).status, 404);
  await json('DELETE', `/api/projects/${p.id}`);
  assert.equal((await fetch(`${base}/files/images/${images[0].filename}`)).status, 404);
});

test('audio-only exports save WAV and MP3 with no video metadata and retain edited audio duration', async () => {
  const p = (await json('POST', '/api/projects', { name: 'Edited audio' })).body;
  for (const format of ['wav', 'mp3']) {
    const fd = new FormData(); fd.append('audio', new Blob([wav(0.5)], { type: 'audio/wav' }), 'edited.wav');
    fd.append('scene', 'audio'); fd.append('format', format); fd.append('duration', '0.5');
    const response = await fetch(`${base}/api/projects/${p.id}/exports`, { method: 'POST', body: fd });
    const exp = await response.json(); assert.equal(response.status, 201, JSON.stringify(exp));
    assert.equal(exp.scene, 'audio'); assert.ok(exp.filename.endsWith('.' + format));
    assert.deepEqual([exp.width, exp.height, exp.fps], [0, 0, 0]); assert.equal(exp.duration, 0.5);
    const download = await fetch(`${base}/files/exports/${exp.filename}`); assert.equal(download.status, 200);
    assert.ok((await download.arrayBuffer()).byteLength > 1000);
    const decoded = path.join(tmp, `decoded-${format}.raw`);
    await runFfmpeg(['-i', path.join(tmp, 'exports', exp.filename), '-f', 'f32le', '-ar', '48000', decoded]);
    const samples = fs.readFileSync(decoded); assert.ok(Math.abs(samples.length / 4 / 48000 - 0.5) < 0.03);
    assert.ok(samples.readFloatLE(4000) !== 0);
  }
  assert.equal((await json('GET', `/api/projects/${p.id}`)).body.exports.length, 2);
});

test('Freesound API configuration and /callback route', async () => {
  const s0 = await json('GET', '/api/freesound/status');
  assert.equal(s0.status, 200);
  assert.equal(s0.body.callbackUrl, 'http://localhost:3000/callback');

  const saved = await json('PUT', '/api/freesound/config', { clientId: 'test_client_123', apiKey: 'test_secret_456' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.configured, true);
  assert.equal(saved.body.hasKey, true);
  assert.equal(saved.body.hasClientId, true);
  assert.ok(saved.body.authorizeUrl.includes('client_id=test_client_123'));

  const cb = await fetch(`${base}/callback?error=access_denied`);
  assert.equal(cb.status, 400);
  const html = await cb.text();
  assert.ok(html.includes('Koppeling geannuleerd'));

  const cleared = await json('POST', '/api/freesound/disconnect', { clearAll: true });
  assert.equal(cleared.body.configured, false);
});

test('File Terminal variants (images, login_log, email) persist and schedule intro -> explorer -> viewer', async () => {
  const { normalizeFileOpts, fileSchedule, parseLogEntries, scrambleText } = await import('../../public/js/files/model.js');
  const pLog = (await json('POST', '/api/projects', { name: 'Log Terminal', type: 'file', file_opts: { variant: 'login_log' } })).body;
  assert.equal(pLog.type, 'file');
  assert.equal(pLog.file_opts.variant, 'login_log');

  const logOpts = normalizeFileOpts(pLog.file_opts);
  assert.equal(logOpts.variant, 'login_log');
  assert.equal(logOpts.logs.length, 1);
  const logSched = fileSchedule([], logOpts);
  assert.ok(logSched.intro > 4);
  assert.equal(logSched.segments.length, 1);
  assert.equal(logSched.segments[0].folder, 'Logs');

  const parsed = parseLogEntries(logOpts.logs[0].entriesText);
  assert.equal(parsed.length, 5);
  assert.ok(!logOpts.logs[0].entriesText.includes('root_ghost'));
  const unauthEntries = parsed.filter((e) => e.status === 'UNAUTHORIZED');
  assert.equal(unauthEntries.length, 1);
  assert.equal(unauthEntries[0].user, 'unknown');

  const pMail = (await json('POST', '/api/projects', { name: 'Email Terminal', type: 'file', file_opts: { variant: 'email' } })).body;
  assert.equal(pMail.file_opts.variant, 'email');
  const mailOpts = normalizeFileOpts(pMail.file_opts);
  assert.equal(mailOpts.emails[0].scrambled, true);
  const scrambledSample = scrambleText('Geheim bericht voor agent', 1, 10);
  assert.equal(scrambledSample.length, 'Geheim bericht voor agent'.length);
  assert.NotEqual?.(scrambledSample, 'Geheim bericht voor agent');
  const mailSched = fileSchedule([], mailOpts);
  assert.ok(mailSched.intro > 4);
  assert.equal(mailSched.segments.length, 1);
  assert.equal(mailSched.segments[0].folder, 'Inbox');
});


