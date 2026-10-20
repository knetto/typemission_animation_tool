// SQLite database layer (Node's built-in node:sqlite — no native build needed)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      scene       TEXT NOT NULL DEFAULT 'transmission',
      scene_opts  TEXT NOT NULL DEFAULT '{}',
      timeline    TEXT NOT NULL DEFAULT '{}',
      duration    REAL NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      filename    TEXT NOT NULL,
      mime        TEXT,
      kind        TEXT NOT NULL DEFAULT 'upload',   -- upload | recording | render
      duration    REAL NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sfx (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      filename    TEXT NOT NULL,
      mime        TEXT,
      category    TEXT NOT NULL DEFAULT 'Eigen',
      duration    REAL NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      scene       TEXT NOT NULL,
      width       INTEGER NOT NULL,
      height      INTEGER NOT NULL,
      fps         INTEGER NOT NULL,
      duration    REAL NOT NULL DEFAULT 0,
      size        INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT 'Files',
      duration REAL NOT NULL DEFAULT 3,
      position INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Additive migration: existing projects remain Audio Terminal projects.
  const columns = db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name);
  if (!columns.includes('type')) db.exec("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'audio'");
  if (!columns.includes('file_opts')) db.exec("ALTER TABLE projects ADD COLUMN file_opts TEXT NOT NULL DEFAULT '{}'");
  if (!columns.includes('keyboard_opts')) db.exec("ALTER TABLE projects ADD COLUMN keyboard_opts TEXT NOT NULL DEFAULT '{}'");
  return db;
}

export const parseProject = (row) => row && ({
  ...row,
  scene_opts: safeJson(row.scene_opts, {}),
  timeline: safeJson(row.timeline, {}),
  file_opts: safeJson(row.file_opts, {}),
  keyboard_opts: safeJson(row.keyboard_opts, {}),
});

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
