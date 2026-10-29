import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../index.js';
import { openDb, parseProject } from '../db.js';
import { runFfmpeg } from '../ffmpeg.js';
import { normalizeAirlineOpts, imageDimensions, setAirlineLanguage, getAirlineFlights, COPY_FIELDS } from '../../public/js/airline/model.js';
import { AIRLINE_COPY, LOCALE_DATA } from '../../public/js/airline/locales.js';

let server, base, tmp, db, dirs, png;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'airline-test-'));
  const created = createApp({ storageDir: tmp });
  db = created.db; dirs = created.dirs;
  server = await new Promise(resolve => { const s = created.app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  const file = path.join(tmp, 'test.png');
  await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90', '-frames:v', '1', file]);
  png = fs.readFileSync(file);
});
after(async () => {
  await new Promise(resolve => server.close(resolve)); db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
async function json(method, url, body) {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function upload(id, format = 'png', design = 'website', image = png) {
  const body = new FormData();
  body.append('image', new Blob([image], { type: 'image/png' }), 'design.png');
  body.append('format', format); body.append('design', design);
  const response = await fetch(`${base}/api/projects/${id}/image-exports`, { method: 'POST', body });
  return { status: response.status, body: await response.json() };
}

test('airline migration preserves existing audio projects', () => {
  const file = path.join(tmp, 'old.db');
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, scene TEXT DEFAULT 'transmission', scene_opts TEXT DEFAULT '{}', timeline TEXT DEFAULT '{}', duration REAL DEFAULT 0, created_at TEXT, updated_at TEXT); INSERT INTO projects (id, name) VALUES (1, 'Existing mission')");
  old.close();
  const migrated = openDb(file);
  try {
    const project = parseProject(migrated.prepare('SELECT * FROM projects WHERE id = 1').get());
    assert.equal(project.type, 'audio'); assert.equal(project.name, 'Existing mission');
    assert.deepEqual(project.airline_opts, {});
  } finally { migrated.close(); }
});

test('airline settings survive create, update, listing, reopen and copy', async () => {
  const options = normalizeAirlineOpts({ airline: 'CIEL AIR', origin: 'Paris', originCode: 'CDG', language: 'FR', passenger: 'Zoë Martin', date: '18 JUIN 2027', heroTitle: 'Prochain arrêt,', from: 'Départ' });
  const created = await json('POST', '/api/projects', { name: 'French airline', type: 'airline', airline_opts: options });
  assert.equal(created.status, 201); assert.equal(created.body.type, 'airline');
  assert.deepEqual(created.body.airline_opts, options);
  options.design = 'ticket'; options.flight = 'CI 321'; options.gate = '';
  assert.equal((await json('PUT', `/api/projects/${created.body.id}`, { airline_opts: options })).status, 200);
  assert.deepEqual((await json('GET', `/api/projects/${created.body.id}`)).body.airline_opts, options);
  const listed = (await json('GET', '/api/projects')).body.find(p => p.id === created.body.id);
  assert.deepEqual(listed.airline_opts, options);
  const reopened = openDb(path.join(tmp, 'studio.db'));
  try { assert.deepEqual(parseProject(reopened.prepare('SELECT * FROM projects WHERE id = ?').get(created.body.id)).airline_opts, options); }
  finally { reopened.close(); }
  const copy = await json('POST', '/api/projects', { name: 'Copy', type: listed.type, airline_opts: listed.airline_opts });
  assert.deepEqual(copy.body.airline_opts, options);
  assert.equal((await json('POST', '/api/projects', { type: 'unrecognized' })).body.type, 'audio');
});

test('both still designs export as actual PNG and JPEG, persist and delete', async () => {
  const project = (await json('POST', '/api/projects', { name: 'Berlin', type: 'airline' })).body;
  for (const [format, design] of [['png', 'website'], ['jpg', 'ticket']]) {
    const result = await upload(project.id, format, design);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const item = result.body;
    assert.equal(item.scene, `airline-${design}`); assert.equal(item.width, 160); assert.equal(item.height, 90);
    assert.equal(item.fps, 0); assert.equal(item.duration, 0); assert.ok(item.filename.endsWith('.' + format));
    const response = await fetch(`${base}/files/exports/${item.filename}`);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.length, item.size);
    assert.equal(bytes.subarray(0, format === 'jpg' ? 3 : 8).toString('hex'), format === 'jpg' ? 'ffd8ff' : '89504e470d0a1a0a');
    assert.ok((await json('GET', `/api/projects/${project.id}`)).body.exports.some(e => e.id === item.id));
    assert.equal((await json('DELETE', `/api/exports/${item.id}`)).status, 204);
    assert.equal(fs.existsSync(path.join(dirs.exports, item.filename)), false);
  }
  const retained = (await upload(project.id)).body;
  await json('DELETE', `/api/projects/${project.id}`);
  assert.equal(fs.existsSync(path.join(dirs.exports, retained.filename)), false);
  assert.equal(fs.readdirSync(dirs.tmp).length, 0);
});

test('image exports reject missing projects, unsupported types, corrupt PNG and oversized dimensions', async () => {
  assert.equal((await upload(999999)).status, 404);
  const audio = (await json('POST', '/api/projects', { name: 'Audio' })).body;
  assert.equal((await upload(audio.id)).status, 400);
  const airline = (await json('POST', '/api/projects', { type: 'airline' })).body;
  assert.equal((await upload(airline.id, 'png', 'website', Buffer.from('not an image'))).status, 400);
  const oversized = Buffer.from(png); oversized.writeUInt32BE(99999, 16);
  assert.equal((await upload(airline.id, 'png', 'website', oversized)).status, 400);
  assert.equal((await upload(airline.id, 'png', 'website', png.subarray(0, 33))).status, 400);
  assert.equal((await json('GET', `/api/projects/${airline.id}`)).body.exports.length, 0);
  assert.equal(fs.readdirSync(dirs.tmp).length, 0);
});

test('defaults retain an English interface, optional passenger and consistent image sizes', () => {
  const opts = normalizeAirlineOpts();
  assert.equal(opts.date, '18 JUN 2027'); assert.equal(opts.dateLabel, 'Date');
  assert.equal(opts.passenger, ''); assert.equal(opts.passengerLabel, 'Passenger');
  assert.equal(opts.destination, 'Berlin'); assert.equal(opts.language, 'EN');
  assert.equal(opts.airline, 'Airline'); assert.equal(opts.origin, 'London'); assert.equal(opts.originCode, 'LHR');
  assert.deepEqual(imageDimensions(opts), { width: 1920, height: 1080 });
  assert.deepEqual(imageDimensions({ design: 'ticket', scale: 2 }), { width: 3200, height: 1600 });
  assert.deepEqual(imageDimensions({ scale: 2 }), { width: 3840, height: 2160 });
  assert.equal(normalizeAirlineOpts(null).language, 'EN');
  assert.equal(normalizeAirlineOpts({ accent: 'invalid', scale: 999 }).accent, '#2259dd');
});

test('every flag translates all page and ticket labels and shares its route with all three flights', () => {
  for (const language of ['EN', 'NL', 'FR', 'DE', 'ES']) {
    const opts = setAirlineLanguage(normalizeAirlineOpts(), language);
    for (const [key] of COPY_FIELDS) assert.equal(opts[key], AIRLINE_COPY[language][key], `${language}.${key}`);
    assert.equal(opts.origin, LOCALE_DATA[language].origin); assert.equal(opts.originCode, LOCALE_DATA[language].originCode);
    assert.equal(opts.destination, LOCALE_DATA[language].destination);
    const flights = getAirlineFlights(opts); assert.equal(flights.length, 3);
    assert.equal(new Set(flights.map(flight => flight.flight)).size, 3);
    for (const flight of flights) {
      assert.equal(flight.originCode, opts.originCode); assert.equal(flight.origin, opts.origin);
      assert.equal(flight.destinationCode, opts.destinationCode); assert.equal(flight.destination, opts.destination);
    }
  }
});

test('manual copy is remembered per language, custom data survives switching, and extra flight edits persist', async () => {
  let opts = normalizeAirlineOpts({ airline: 'Custom air', passenger: 'Zoë', date: 'A custom date' });
  opts.search = 'My own search'; opts.otherFlights[0].fare = '€ 115'; opts.otherFlights[1].flight = 'FL 999';
  opts = setAirlineLanguage(opts, 'FR'); opts.search = 'Mon bouton';
  opts = setAirlineLanguage(opts, 'EN'); assert.equal(opts.search, 'My own search');
  opts = setAirlineLanguage(opts, 'FR'); assert.equal(opts.search, 'Mon bouton');
  assert.equal(opts.airline, 'Custom air'); assert.equal(opts.passenger, 'Zoë'); assert.equal(opts.date, 'A custom date');
  opts.origin = 'Lyon'; opts.originCode = 'LYS';
  assert.ok(getAirlineFlights(opts).every(flight => flight.originCode === 'LYS'));
  const created = await json('POST', '/api/projects', { type: 'airline', airline_opts: opts });
  const reopened = normalizeAirlineOpts((await json('GET', `/api/projects/${created.body.id}`)).body.airline_opts);
  assert.equal(reopened.otherFlights[0].fare, '€ 115'); assert.equal(reopened.otherFlights[1].flight, 'FL 999');
  assert.equal(setAirlineLanguage(reopened, 'EN').search, 'My own search');
});

test('old English-only saved defaults upgrade while custom labels remain intact', () => {
  const opts = normalizeAirlineOpts({ language: 'DE', airline: 'AEROVIA', origin: 'Amsterdam', originCode: 'AMS', search: 'Search flights', from: 'Custom departure', featured: 'Your city escape starts here.' });
  assert.equal(opts.airline, 'Airline'); assert.equal(opts.origin, 'Frankfurt'); assert.equal(opts.originCode, 'FRA');
  assert.equal(opts.search, 'Flüge suchen'); assert.equal(opts.from, 'Custom departure'); assert.equal(opts.featured, 'Wähle deinen Flug');
});

test('child/adult ticket choice persists independently of language and custom passenger text', async () => {
  assert.equal(normalizeAirlineOpts({}).ticketType, 'adult');
  assert.equal(normalizeAirlineOpts({ ticketType: 'invalid' }).ticketType, 'adult');
  let opts = normalizeAirlineOpts({ ticketType: 'child', passenger: 'Alex', passengerCount: 'My adult text' });
  for (const [language, child, count] of [['EN', 'Child', '1 child'], ['NL', 'Kind', '1 kind'], ['FR', 'Enfant', '1 enfant'], ['DE', 'Kind', '1 Kind'], ['ES', 'Niño', '1 niño']]) {
    opts = setAirlineLanguage(opts, language);
    assert.equal(opts.ticketType, 'child'); assert.equal(opts.childTicket, child); assert.equal(opts.childPassengerCount, count);
    assert.equal(opts.passenger, 'Alex');
  }
  opts = setAirlineLanguage(opts, 'EN');
  assert.equal(opts.passengerCount, 'My adult text');
  const project = (await json('POST', '/api/projects', { type: 'airline', airline_opts: opts })).body;
  const reopened = normalizeAirlineOpts((await json('GET', `/api/projects/${project.id}`)).body.airline_opts);
  assert.equal(reopened.ticketType, 'child');
  const updated = await json('PUT', `/api/projects/${project.id}`, { airline_opts: { ...reopened, ticketType: 'adult' } });
  assert.equal(normalizeAirlineOpts(updated.body.airline_opts).ticketType, 'adult');
  assert.equal(updated.body.airline_opts.passengerCount, 'My adult text');
});
