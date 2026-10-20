// Transmission Studio — local Express server
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, parseProject } from './db.js';
import { muxVideoAudio, runFfmpeg } from './ffmpeg.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ storageDir = path.join(ROOT, 'storage') } = {}) {
  const dirs = {
    audio: path.join(storageDir, 'audio'),
    images: path.join(storageDir, 'images'),
    sfx: path.join(storageDir, 'sfx'),
    exports: path.join(storageDir, 'exports'),
    tmp: path.join(storageDir, 'tmp'),
  };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
  const db = openDb(path.join(storageDir, 'studio.db'));

  const app = express();
  app.use(express.json({ limit: '20mb' }));

  // ---------- uploads ----------
  const storageFor = (dir) => multer.diskStorage({
    destination: dir,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || guessExt(file.mimetype)).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  });
  const audioOnly = (_req, file, cb) => cb(null, /^audio\/|video\/webm|application\/octet-stream/.test(file.mimetype));
  const uploadAudio = multer({ storage: storageFor(dirs.audio), fileFilter: audioOnly, limits: { fileSize: 500 * 1024 * 1024 } });
  const uploadSfx = multer({ storage: storageFor(dirs.sfx), fileFilter: audioOnly, limits: { fileSize: 100 * 1024 * 1024 } });
  const uploadTmp = multer({ storage: storageFor(dirs.tmp), limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
  const uploadImages = multer({ storage: storageFor(dirs.images), fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(new Error('Use JPG, PNG or WebP images.'));
    cb(null, true);
  }, limits: { fileSize: 30 * 1024 * 1024 } });

  // multer may hand us latin1-decoded UTF-8 names; only re-decode when that yields valid text
  const fixName = (s) => { const u = Buffer.from(s, 'latin1').toString('utf8'); return u.includes('\uFFFD') ? s : u; };
  const baseName = (s) => fixName(s).replace(/\.[^.]+$/, '');
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const safeUnlink = (f) => fs.promises.unlink(f).catch(() => {});

  // ---------- static files ----------
  app.use('/files/audio', express.static(dirs.audio, { maxAge: '1d' }));
  app.use('/files/images', express.static(dirs.images, { maxAge: '1d' }));
  app.use('/files/sfx', express.static(dirs.sfx, { maxAge: '1d' }));
  app.use('/files/exports', express.static(dirs.exports));
  app.use('/vendor/mp4-muxer.mjs', (_req, res) => res.sendFile(path.join(ROOT, 'node_modules/mp4-muxer/build/mp4-muxer.mjs')));
  app.get('/legacy', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
  app.use(express.static(path.join(ROOT, 'public')));

  // ---------- projects ----------
  app.get('/api/projects', (_req, res) => {
    const rows = db.prepare(`
      SELECT p.id, p.name, p.type, p.scene, p.duration, p.keyboard_opts, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count,
        (SELECT COUNT(*) FROM project_images i WHERE i.project_id = p.id) AS image_count,
        (SELECT COUNT(*) FROM exports e WHERE e.project_id = p.id) AS export_count
      FROM projects p ORDER BY p.updated_at DESC`).all();
    res.json(rows.map((r) => ({ ...r, keyboard_opts: parseProject(r).keyboard_opts })));
  });

  app.post('/api/projects', (req, res) => {
    const name = String(req.body?.name || 'Nieuw project').slice(0, 120);
    const scene = ['transmission', 'urgent', 'ai'].includes(req.body?.scene) ? req.body.scene : 'transmission';
    const type = ['audio', 'file', 'keyboard'].includes(req.body?.type) ? req.body.type : 'audio';
    const info = db.prepare('INSERT INTO projects (name, scene, type) VALUES (?, ?, ?)').run(name, scene, type);
    res.status(201).json(parseProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid)));
  });

  app.get('/api/projects/:id', (req, res) => {
    const p = parseProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
    if (!p) return res.status(404).json({ error: 'Project niet gevonden' });
    p.assets = db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(p.id);
    p.exports = db.prepare('SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC').all(p.id);
    p.images = db.prepare('SELECT * FROM project_images WHERE project_id = ? ORDER BY position, id').all(p.id);
    res.json(p);
  });

  app.put('/api/projects/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Project niet gevonden' });
    const b = req.body || {};
    db.prepare(`UPDATE projects SET name = ?, scene = ?, scene_opts = ?, timeline = ?, file_opts = ?, keyboard_opts = ?, duration = ?, updated_at = ? WHERE id = ?`).run(
      b.name !== undefined ? String(b.name).slice(0, 120) : p.name,
      ['transmission', 'urgent', 'ai'].includes(b.scene) ? b.scene : p.scene,
      b.scene_opts !== undefined ? JSON.stringify(b.scene_opts) : p.scene_opts,
      b.timeline !== undefined ? JSON.stringify(b.timeline) : p.timeline,
      b.file_opts !== undefined ? JSON.stringify(b.file_opts) : p.file_opts,
      b.keyboard_opts !== undefined ? JSON.stringify(b.keyboard_opts) : p.keyboard_opts,
      Number.isFinite(b.duration) ? b.duration : p.duration,
      now(), p.id,
    );
    res.json(parseProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id)));
  });

  app.delete('/api/projects/:id', async (req, res) => {
    const id = req.params.id;
    const assets = db.prepare('SELECT filename FROM assets WHERE project_id = ?').all(id);
    const exps = db.prepare('SELECT filename FROM exports WHERE project_id = ?').all(id);
    const images = db.prepare('SELECT filename FROM project_images WHERE project_id = ?').all(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    await Promise.all([
      ...assets.map((a) => safeUnlink(path.join(dirs.audio, a.filename))),
      ...exps.map((e) => safeUnlink(path.join(dirs.exports, e.filename))),
      ...images.map((e) => safeUnlink(path.join(dirs.images, e.filename))),
    ]);
    res.status(204).end();
  });

  // ---------- assets (project audio) ----------
  app.post('/api/projects/:id/assets', uploadAudio.array('files', 50), (req, res) => {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Project niet gevonden' });
    const kind = ['upload', 'recording', 'render'].includes(req.body?.kind) ? req.body.kind : 'upload';
    const ins = db.prepare('INSERT INTO assets (project_id, name, filename, mime, kind, duration) VALUES (?, ?, ?, ?, ?, ?)');
    const out = (req.files || []).map((f) => {
      const name = req.body?.name || baseName(f.originalname);
      const info = ins.run(req.params.id, name, f.filename, f.mimetype, kind, Number(req.body?.duration) || 0);
      return db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid);
    });
    touch(req.params.id);
    res.status(201).json(out);
  });

  app.patch('/api/assets/:id', (req, res) => {
    const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Bestand niet gevonden' });
    db.prepare('UPDATE assets SET name = ?, duration = ? WHERE id = ?').run(
      req.body?.name !== undefined ? String(req.body.name).slice(0, 120) : a.name,
      Number.isFinite(req.body?.duration) ? req.body.duration : a.duration, a.id);
    res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(a.id));
  });

  app.delete('/api/assets/:id', async (req, res) => {
    const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Bestand niet gevonden' });
    db.prepare('DELETE FROM assets WHERE id = ?').run(a.id);
    await safeUnlink(path.join(dirs.audio, a.filename));
    res.status(204).end();
  });

  // ---------- File Terminal & Keyboard background images ----------
  app.post('/api/projects/:id/images', (req, res, next) => {
    const p = db.prepare('SELECT type FROM projects WHERE id = ?').get(req.params.id);
    if (!p || !['file', 'keyboard'].includes(p.type)) return res.status(400).json({ error: 'Project not found' });
    next();
  }, uploadImages.array('files', 50), (req, res) => {
    const folder = String(req.body?.folder || 'Files').trim().slice(0, 60) || 'Files';
    let position = db.prepare('SELECT COALESCE(MAX(position), -1) AS n FROM project_images WHERE project_id = ?').get(req.params.id).n + 1;
    const ins = db.prepare('INSERT INTO project_images (project_id, name, filename, mime, folder, position) VALUES (?, ?, ?, ?, ?, ?)');
    const out = (req.files || []).map((f) => {
      const info = ins.run(req.params.id, fixName(f.originalname).slice(0, 160), f.filename, f.mimetype, folder, position++);
      return db.prepare('SELECT * FROM project_images WHERE id = ?').get(info.lastInsertRowid);
    });
    touch(req.params.id);
    res.status(201).json(out);
  });

  app.patch('/api/images/:id', (req, res) => {
    const image = db.prepare('SELECT * FROM project_images WHERE id = ?').get(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    const b = req.body || {};
    if (b.duration !== undefined && (!Number.isFinite(b.duration) || b.duration < 0.5 || b.duration > 60)) return res.status(400).json({ error: 'Choose a viewing time between 0.5 and 60 seconds.' });
    db.prepare('UPDATE project_images SET name = ?, folder = ?, duration = ? WHERE id = ?').run(
      b.name !== undefined ? String(b.name).trim().slice(0, 160) || image.name : image.name,
      b.folder !== undefined ? String(b.folder).trim().slice(0, 60) || 'Files' : image.folder,
      b.duration ?? image.duration, image.id);
    touch(image.project_id);
    res.json(db.prepare('SELECT * FROM project_images WHERE id = ?').get(image.id));
  });

  app.put('/api/projects/:id/image-order', (req, res) => {
    const ids = req.body?.ids;
    const actual = db.prepare('SELECT id FROM project_images WHERE project_id = ?').all(req.params.id).map((x) => x.id);
    if (!Array.isArray(ids) || ids.length !== actual.length || new Set(ids).size !== ids.length || ids.some((id) => !actual.includes(id))) return res.status(400).json({ error: 'Invalid file order' });
    const update = db.prepare('UPDATE project_images SET position = ? WHERE id = ? AND project_id = ?');
    db.exec('BEGIN');
    try { ids.forEach((id, i) => update.run(i, id, req.params.id)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    touch(req.params.id);
    res.status(204).end();
  });

  app.delete('/api/images/:id', async (req, res) => {
    const image = db.prepare('SELECT * FROM project_images WHERE id = ?').get(req.params.id);
    if (!image) return res.status(404).json({ error: 'Image not found' });
    db.prepare('DELETE FROM project_images WHERE id = ?').run(image.id);
    await safeUnlink(path.join(dirs.images, image.filename));
    touch(image.project_id);
    res.status(204).end();
  });

  // ---------- sound effects library (shared across projects) ----------
  app.get('/api/sfx', (_req, res) => res.json(db.prepare('SELECT * FROM sfx ORDER BY category, name').all()));

  app.post('/api/sfx', uploadSfx.array('files', 50), (req, res) => {
    const ins = db.prepare('INSERT INTO sfx (name, filename, mime, category, duration) VALUES (?, ?, ?, ?, ?)');
    const out = (req.files || []).map((f) => {
      const info = ins.run(baseName(f.originalname), f.filename, f.mimetype, String(req.body?.category || 'Eigen').slice(0, 40), 0);
      return db.prepare('SELECT * FROM sfx WHERE id = ?').get(info.lastInsertRowid);
    });
    res.status(201).json(out);
  });

  app.patch('/api/sfx/:id', (req, res) => {
    const s = db.prepare('SELECT * FROM sfx WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Effect niet gevonden' });
    db.prepare('UPDATE sfx SET name = ?, category = ?, duration = ? WHERE id = ?').run(
      req.body?.name !== undefined ? String(req.body.name).slice(0, 120) : s.name,
      req.body?.category !== undefined ? String(req.body.category).slice(0, 40) : s.category,
      Number.isFinite(req.body?.duration) ? req.body.duration : s.duration, s.id);
    res.json(db.prepare('SELECT * FROM sfx WHERE id = ?').get(s.id));
  });

  app.delete('/api/sfx/:id', async (req, res) => {
    const s = db.prepare('SELECT * FROM sfx WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Effect niet gevonden' });
    db.prepare('DELETE FROM sfx WHERE id = ?').run(s.id);
    await safeUnlink(path.join(dirs.sfx, s.filename));
    res.status(204).end();
  });

  // ---------- exports (browser-rendered video + soundtrack → ffmpeg mux → MP4) ----------
  app.post('/api/projects/:id/exports', uploadTmp.fields([{ name: 'video', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async (req, res) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    const video = req.files?.video?.[0], audio = req.files?.audio?.[0];
    const cleanup = () => Promise.all([video, audio].filter(Boolean).map((f) => safeUnlink(f.path)));
    const audioOnlyExport = req.body?.scene === 'audio';
    if (!project || (audioOnlyExport ? !audio || video : !video)) { await cleanup(); return res.status(400).json({ error: 'Exportbestanden ontbreken of project bestaat niet' }); }
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'transmissie';
    const scene = audioOnlyExport ? 'audio' : ['transmission', 'urgent', 'ai', 'file', 'keyboard'].includes(req.body.scene) ? req.body.scene : project.scene;
    const format = audioOnlyExport ? (req.body.format === 'mp3' ? 'mp3' : 'wav') : 'mp4';
    const keySlug = req.body.keyLabel ? '-toets-' + String(req.body.keyLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) : '';
    const filename = `${slug}-${scene}${keySlug}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${format}`;
    const outPath = path.join(dirs.exports, filename);
    let cancelled = false;
    res.on('close', () => { if (!res.writableEnded) cancelled = true; });
    try {
      if (audioOnlyExport) await runFfmpeg(['-i', audio.path, '-map', '0:a:0', '-vn', '-ar', '48000', ...(format === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '320k'] : ['-c:a', 'pcm_s16le']), outPath]);
      else if (audio) await muxVideoAudio(video.path, audio.path, outPath);
      else await fs.promises.copyFile(video.path, outPath);
      if (cancelled) { await safeUnlink(outPath); return; }
      const size = (await fs.promises.stat(outPath)).size;
      const info = db.prepare('INSERT INTO exports (project_id, filename, scene, width, height, fps, duration, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(project.id, filename, scene, audioOnlyExport ? 0 : Number(req.body.width) || 1920, audioOnlyExport ? 0 : Number(req.body.height) || 1080,
          audioOnlyExport ? 0 : Number(req.body.fps) || 30, Number(req.body.duration) || 0, size);
      touch(project.id);
      res.status(201).json(db.prepare('SELECT * FROM exports WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) {
      console.error('export failed', e);
      await safeUnlink(outPath);
      res.status(500).json({ error: 'Export mislukt: ' + e.message });
    } finally {
      await cleanup();
    }
  });

  app.delete('/api/exports/:id', async (req, res) => {
    const e = db.prepare('SELECT * FROM exports WHERE id = ?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Export niet gevonden' });
    db.prepare('DELETE FROM exports WHERE id = ?').run(e.id);
    await safeUnlink(path.join(dirs.exports, e.filename));
    res.status(204).end();
  });

  // SPA fallback
  app.get(/^\/(?!api|files|vendor).*/, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

  // errors (e.g. multer limits)
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 400).json({ error: err.message || 'Onbekende fout' });
  });

  function touch(id) { db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), id); }

  return { app, db, dirs };
}

function guessExt(mime = '') {
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('mp4') || mime.includes('aac')) return '.m4a';
  return '.bin';
}

// start when run directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT) || 3000;
  const { app } = createApp();
  app.listen(PORT, () => {
    console.log(`\n  🕵️  Transmission Studio draait op  http://localhost:${PORT}\n`);
  });
}
