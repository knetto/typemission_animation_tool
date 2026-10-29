// Transmission Studio — local Express server
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, parseProject } from './db.js';
import { muxVideoAudio, runFfmpeg, pngSequenceToProRes, pngSequenceToWebm } from './ffmpeg.js';

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
      SELECT p.id, p.name, p.type, p.scene, p.duration, p.keyboard_opts, p.hack_opts, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count,
        (SELECT COUNT(*) FROM project_images i WHERE i.project_id = p.id) AS image_count,
        (SELECT COUNT(*) FROM exports e WHERE e.project_id = p.id) AS export_count
      FROM projects p ORDER BY p.updated_at DESC`).all();
    res.json(rows.map((r) => { const parsed = parseProject(r); return { ...r, keyboard_opts: parsed.keyboard_opts, hack_opts: parsed.hack_opts }; }));
  });

  app.post('/api/projects', (req, res) => {
    const name = String(req.body?.name || 'Nieuw project').slice(0, 120);
    const scene = ['transmission', 'urgent', 'ai'].includes(req.body?.scene) ? req.body.scene : 'transmission';
    const type = ['audio', 'file', 'keyboard', 'hack'].includes(req.body?.type) ? req.body.type : 'audio';
    const fileOpts = req.body?.file_opts && typeof req.body.file_opts === 'object' ? JSON.stringify(req.body.file_opts) : '{}';
    const hackOpts = req.body?.hack_opts && typeof req.body.hack_opts === 'object' ? JSON.stringify(req.body.hack_opts) : '{}';
    const info = db.prepare('INSERT INTO projects (name, scene, type, file_opts, hack_opts) VALUES (?, ?, ?, ?, ?)').run(name, scene, type, fileOpts, hackOpts);
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
    db.prepare(`UPDATE projects SET name = ?, scene = ?, scene_opts = ?, timeline = ?, file_opts = ?, keyboard_opts = ?, hack_opts = ?, duration = ?, updated_at = ? WHERE id = ?`).run(
      b.name !== undefined ? String(b.name).slice(0, 120) : p.name,
      ['transmission', 'urgent', 'ai'].includes(b.scene) ? b.scene : p.scene,
      b.scene_opts !== undefined ? JSON.stringify(b.scene_opts) : p.scene_opts,
      b.timeline !== undefined ? JSON.stringify(b.timeline) : p.timeline,
      b.file_opts !== undefined ? JSON.stringify(b.file_opts) : p.file_opts,
      b.keyboard_opts !== undefined ? JSON.stringify(b.keyboard_opts) : p.keyboard_opts,
      b.hack_opts !== undefined ? JSON.stringify(b.hack_opts) : p.hack_opts,
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
    if (!p || !['file', 'keyboard', 'hack'].includes(p.type)) return res.status(400).json({ error: 'Project not found' });
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

  // ---------- Freesound API v2 & OAuth2 Callback (http://localhost:3000/callback) ----------
  const FREESOUND_CALLBACK_URL = 'http://localhost:3000/callback';

  function getFreesoundConfig() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'freesound'").get();
    let saved = {};
    if (row?.value) {
      try { saved = JSON.parse(row.value); } catch {}
    }
    return {
      clientId: saved.clientId || process.env.FREESOUND_CLIENT_ID || '',
      apiKey: saved.apiKey || process.env.FREESOUND_API_KEY || process.env.FREESOUND_CLIENT_SECRET || '',
      accessToken: saved.accessToken || '',
      refreshToken: saved.refreshToken || '',
      expiresAt: Number(saved.expiresAt) || 0,
    };
  }

  function saveFreesoundConfig(patch) {
    const next = { ...getFreesoundConfig(), ...patch };
    db.prepare("INSERT INTO settings (key, value) VALUES ('freesound', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(next));
    return next;
  }

  function buildFreesoundStatus(cfg = getFreesoundConfig()) {
    const hasKey = Boolean(cfg.apiKey?.trim());
    const hasClientId = Boolean(cfg.clientId?.trim());
    const oauthConnected = Boolean(cfg.accessToken);
    const authorizeUrl = hasClientId
      ? `https://freesound.org/apiv2/oauth2/authorize/?client_id=${encodeURIComponent(cfg.clientId.trim())}&response_type=code`
      : '';
    return {
      configured: hasKey || oauthConnected,
      hasKey,
      hasClientId,
      oauthConnected,
      clientId: cfg.clientId || '',
      callbackUrl: FREESOUND_CALLBACK_URL,
      authorizeUrl,
    };
  }

  async function getFreesoundAuthHeader() {
    let cfg = getFreesoundConfig();
    if (cfg.accessToken) {
      if (cfg.expiresAt && Date.now() > cfg.expiresAt - 30000 && cfg.refreshToken && cfg.clientId && cfg.apiKey) {
        try {
          const body = new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.apiKey,
            grant_type: 'refresh_token',
            refresh_token: cfg.refreshToken,
          });
          const r = await fetch('https://freesound.org/apiv2/oauth2/access_token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          });
          if (r.ok) {
            const data = await r.json();
            cfg = saveFreesoundConfig({
              accessToken: data.access_token || '',
              refreshToken: data.refresh_token || cfg.refreshToken,
              expiresAt: Date.now() + (Number(data.expires_in) || 86400) * 1000,
            });
          }
        } catch {}
      }
      if (cfg.accessToken) return `Bearer ${cfg.accessToken}`;
    }
    if (cfg.apiKey?.trim()) return `Token ${cfg.apiKey.trim()}`;
    return null;
  }

  app.get('/api/freesound/status', (_req, res) => {
    res.json(buildFreesoundStatus());
  });

  app.put('/api/freesound/config', (req, res) => {
    const clientId = String(req.body?.clientId ?? '').trim();
    const apiKey = String(req.body?.apiKey ?? '').trim();
    const current = getFreesoundConfig();
    const updated = saveFreesoundConfig({
      clientId: clientId || current.clientId,
      apiKey: apiKey || current.apiKey,
    });
    res.json(buildFreesoundStatus(updated));
  });

  app.post('/api/freesound/disconnect', (req, res) => {
    const clearAll = Boolean(req.body?.clearAll);
    const updated = saveFreesoundConfig(
      clearAll
        ? { clientId: '', apiKey: '', accessToken: '', refreshToken: '', expiresAt: 0 }
        : { accessToken: '', refreshToken: '', expiresAt: 0 }
    );
    res.json(buildFreesoundStatus(updated));
  });

  app.get('/callback', async (req, res) => {
    const code = String(req.query?.code || '').trim();
    const errParam = String(req.query?.error || '').trim();
    const cfg = getFreesoundConfig();

    const renderCallbackHtml = (ok, title, message) => `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <title>${title} — Transmission Studio</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0f1d; color: #eaf2ff; font-family: system-ui, sans-serif; }
    .card { max-width: 420px; padding: 28px; border-radius: 16px; background: #131d35; border: 1px solid ${ok ? '#10b981' : '#f43f5e'}; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.6); }
    h2 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0 0 20px; color: #9ab0d6; font-size: 14px; line-height: 1.5; }
    a { display: inline-block; padding: 10px 18px; border-radius: 10px; background: #3b82f6; color: #fff; text-decoration: none; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${ok ? '✅ Freesound gekoppeld!' : '⚠️ Freesound koppeling mislukt'}</h2>
    <p>${message}</p>
    <a href="/#/library">Terug naar Geluidenbibliotheek</a>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'freesound-oauth-done', ok: ${ok ? 'true' : 'false'} }, '*');
        if (${ok ? 'true' : 'false'}) setTimeout(() => window.close(), 900);
      } else if (${ok ? 'true' : 'false'}) {
        setTimeout(() => { location.href = '/#/library'; }, 1200);
      }
    } catch {}
  </script>
</body>
</html>`;

    if (errParam || !code) {
      return res.status(400).send(renderCallbackHtml(false, 'Koppeling geannuleerd', errParam || 'Geen autorisatiecode ontvangen op /callback.'));
    }
    if (!cfg.clientId || !cfg.apiKey) {
      return res.status(400).send(renderCallbackHtml(false, 'API gegevens ontbreken', 'Vul eerst je Freesound Client ID en Client Secret / API Key in bij de Geluidenbibliotheek.'));
    }

    try {
      const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.apiKey,
        grant_type: 'authorization_code',
        code,
      });
      const tokenRes = await fetch('https://freesound.org/apiv2/oauth2/access_token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !data.access_token) {
        return res.status(400).send(renderCallbackHtml(false, 'Token uitwisseling mislukt', data.error_description || data.error || `HTTP ${tokenRes.status}`));
      }
      saveFreesoundConfig({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || '',
        expiresAt: Date.now() + (Number(data.expires_in) || 86400) * 1000,
      });
      return res.send(renderCallbackHtml(true, 'Freesound verbonden', 'Je Freesound OAuth2 account is gekoppeld. Dit venster sluit automatisch.'));
    } catch (e) {
      return res.status(500).send(renderCallbackHtml(false, 'Netwerkfout', e.message));
    }
  });

  app.get('/api/freesound/search', async (req, res) => {
    const auth = await getFreesoundAuthHeader();
    if (!auth) {
      return res.status(400).json({ error: 'Stel eerst je Freesound API Key of OAuth2 koppeling in.' });
    }
    const query = String(req.query?.q || '').trim();
    const sort = ['score', 'downloads_desc', 'rating_desc', 'duration_asc', 'duration_desc', 'created_desc'].includes(req.query?.sort)
      ? req.query.sort
      : 'score';
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(30, parseInt(req.query?.pageSize, 10) || 16));
    const maxDur = Number(req.query?.maxDuration);

    const params = new URLSearchParams({
      query,
      sort,
      page: String(page),
      page_size: String(pageSize),
      fields: 'id,name,tags,description,duration,previews,images,username,license,avg_rating,num_downloads',
    });
    if (Number.isFinite(maxDur) && maxDur > 0) {
      params.set('filter', `duration:[0 TO ${maxDur}]`);
    }

    try {
      const r = await fetch(`https://freesound.org/apiv2/search/text/?${params.toString()}`, {
        headers: { Authorization: auth },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: data.detail || data.error || `Freesound fout (${r.status})` });
      }
      const results = (data.results || []).map((item) => ({
        id: item.id,
        name: item.name,
        username: item.username,
        license: item.license || '',
        duration: Number(item.duration) || 0,
        tags: Array.isArray(item.tags) ? item.tags.slice(0, 6) : [],
        rating: Number(item.avg_rating) || 0,
        downloads: Number(item.num_downloads) || 0,
        waveformUrl:
          item.images?.waveform_m ||
          item.images?.waveform_l ||
          item.images?.spectral_m ||
          '',
        previewUrl:
          item.previews?.['preview-hq-mp3'] ||
          item.previews?.['preview-lq-mp3'] ||
          item.previews?.['preview-hq-ogg'] ||
          item.previews?.['preview-lq-ogg'] ||
          '',
        previewOgg: item.previews?.['preview-hq-ogg'] || '',
      }));
      res.json({
        count: Number(data.count) || 0,
        next: Boolean(data.next),
        previous: Boolean(data.previous),
        page,
        results,
      });
    } catch (e) {
      res.status(502).json({ error: 'Kon Freesound niet bereiken: ' + e.message });
    }
  });

  app.post('/api/freesound/import', async (req, res) => {
    const auth = await getFreesoundAuthHeader();
    if (!auth) {
      return res.status(400).json({ error: 'Stel eerst je Freesound API Key of OAuth2 koppeling in.' });
    }
    const soundId = Number(req.body?.id || req.body?.soundId);
    const rawName = String(req.body?.name || `Freesound ${soundId}`).trim();
    const category = String(req.body?.category || 'Freesound').trim().slice(0, 40) || 'Freesound';
    const duration = Number(req.body?.duration) || 0;
    let previewUrl = String(req.body?.previewUrl || '').trim();

    if (!soundId && !previewUrl) {
      return res.status(400).json({ error: 'soundId of previewUrl ontbreekt' });
    }

    try {
      if (!previewUrl && soundId) {
        const infoRes = await fetch(`https://freesound.org/apiv2/sounds/${soundId}/?fields=id,name,duration,previews`, {
          headers: { Authorization: auth },
        });
        const infoData = await infoRes.json().catch(() => ({}));
        if (!infoRes.ok) {
          return res.status(infoRes.status).json({ error: infoData.detail || 'Kon geluidsinfo niet ophalen van Freesound' });
        }
        previewUrl =
          infoData.previews?.['preview-hq-mp3'] ||
          infoData.previews?.['preview-hq-ogg'] ||
          infoData.previews?.['preview-lq-mp3'] ||
          '';
      }

      if (!previewUrl) {
        return res.status(400).json({ error: 'Geen audiobestand beschikbaar voor dit geluid' });
      }

      const audioRes = await fetch(previewUrl);
      if (!audioRes.ok) {
        return res.status(502).json({ error: `Download van Freesound mislukt (HTTP ${audioRes.status})` });
      }
      const ext = previewUrl.endsWith('.ogg') ? '.ogg' : '.mp3';
      const mime = ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg';
      const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
      const outPath = path.join(dirs.sfx, filename);
      const buf = Buffer.from(await audioRes.arrayBuffer());
      await fs.promises.writeFile(outPath, buf);

      const cleanName = baseName(rawName).slice(0, 120) || `Freesound ${soundId}`;
      const info = db
        .prepare('INSERT INTO sfx (name, filename, mime, category, duration) VALUES (?, ?, ?, ?, ?)')
        .run(cleanName, filename, mime, category, duration);
      const created = db.prepare('SELECT * FROM sfx WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(created);
    } catch (e) {
      res.status(500).json({ error: 'Importeren mislukt: ' + e.message });
    }
  });

  // ---------- exports (browser-rendered video + soundtrack → ffmpeg mux → MP4) ----------
  app.post('/api/projects/:id/exports', uploadTmp.fields([{ name: 'video', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async (req, res) => {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    const video = req.files?.video?.[0], audio = req.files?.audio?.[0];
    const cleanup = () => Promise.all([video, audio].filter(Boolean).map((f) => safeUnlink(f.path)));
    const audioOnlyExport = req.body?.scene === 'audio';
    if (!project || (audioOnlyExport ? !audio || video : !video)) { await cleanup(); return res.status(400).json({ error: 'Exportbestanden ontbreken of project bestaat niet' }); }
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'transmissie';
    const scene = audioOnlyExport ? 'audio' : ['transmission', 'urgent', 'ai', 'file', 'keyboard', 'hack'].includes(req.body.scene) ? req.body.scene : project.scene;
    const format = audioOnlyExport ? (req.body.format === 'mp3' ? 'mp3' : 'wav') : 'mp4';
    const keySlug = req.body.keyLabel ? '-toets-' + String(req.body.keyLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) : '';
    const partSlug = req.body.partLabel ? '-' + String(req.body.partLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) : '';
    const filename = `${slug}-${scene}${keySlug}${partSlug}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${format}`;
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

  // ---------- transparent MOV exports (browser PNG frames with alpha → ffmpeg → ProRes 4444) ----------
  const movSessions = new Map();   // token -> { dir, projectId, created }
  const dropMovSession = async (token) => {
    const s = movSessions.get(token);
    movSessions.delete(token);
    if (s) await fs.promises.rm(s.dir, { recursive: true, force: true }).catch(() => {});
  };
  const movSession = (req, res, next) => {
    const s = /^[a-f0-9]{24}$/.test(req.params.token) ? movSessions.get(req.params.token) : null;
    if (!s) return res.status(404).json({ error: 'Export-sessie niet gevonden (verlopen?)' });
    req.movSession = s; next();
  };
  const uploadFrames = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => cb(null, req.movSession.dir),
      filename: (_req, file, cb) => cb(null, file.originalname),
    }),
    fileFilter: (_req, file, cb) => cb(null, /^\d{6}\.png$/.test(file.originalname)),
    limits: { fileSize: 200 * 1024 * 1024, files: 400 },
  });

  app.post('/api/projects/:id/exports/mov', async (req, res) => {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project niet gevonden' });
    // clean up sessions abandoned for more than 3 hours
    for (const [t, s] of movSessions) if (Date.now() - s.created > 3 * 3600e3) dropMovSession(t);
    const token = crypto.randomBytes(12).toString('hex');
    const dir = path.join(dirs.tmp, `mov-${token}`);
    await fs.promises.mkdir(dir, { recursive: true });
    movSessions.set(token, { dir, projectId: project.id, created: Date.now() });
    res.status(201).json({ token });
  });

  app.post('/api/exports/mov/:token/frames', movSession, uploadFrames.array('frames'), (req, res) => {
    res.json({ received: req.files?.length || 0 });
  });

  app.post('/api/exports/mov/:token/finish', movSession, uploadTmp.single('audio'), async (req, res) => {
    const s = req.movSession, audio = req.file;
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(s.projectId);
    const frameCount = (await fs.promises.readdir(s.dir)).filter((f) => /^\d{6}\.png$/.test(f)).length;
    if (!project || !frameCount) {
      if (audio) await safeUnlink(audio.path);
      await dropMovSession(req.params.token);
      return res.status(400).json({ error: 'Geen frames ontvangen of project bestaat niet' });
    }
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'transmissie';
    const scene = ['transmission', 'urgent', 'ai', 'file', 'keyboard', 'hack'].includes(req.body.scene) ? req.body.scene : project.scene;
    const fps = [24, 25, 30, 50, 60].includes(Number(req.body.fps)) ? Number(req.body.fps) : 30;
    const format = req.body.format === 'webm' ? 'webm' : 'mov';
    const filename = `${slug}-${scene}-transparant-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${format}`;
    const outPath = path.join(dirs.exports, filename);
    try {
      const encode = format === 'webm' ? pngSequenceToWebm : pngSequenceToProRes;
      await encode(path.join(s.dir, '%06d.png'), fps, audio?.path, outPath);
      const size = (await fs.promises.stat(outPath)).size;
      const info = db.prepare('INSERT INTO exports (project_id, filename, scene, width, height, fps, duration, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(project.id, filename, scene, Number(req.body.width) || 1920, Number(req.body.height) || 1080, fps, Number(req.body.duration) || 0, size);
      touch(project.id);
      res.status(201).json(db.prepare('SELECT * FROM exports WHERE id = ?').get(info.lastInsertRowid));
    } catch (e) {
      console.error('mov export failed', e);
      await safeUnlink(outPath);
      res.status(500).json({ error: `${format.toUpperCase()}-export mislukt: ` + e.message });
    } finally {
      if (audio) await safeUnlink(audio.path);
      await dropMovSession(req.params.token);
    }
  });

  app.delete('/api/exports/mov/:token', async (req, res) => {
    await dropMovSession(req.params.token);
    res.status(204).end();
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
