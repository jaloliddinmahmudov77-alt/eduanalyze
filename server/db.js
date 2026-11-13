import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.EDU_DB_PATH || join(__dirname, 'data', 'eduanalyze.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher','admin')) DEFAULT 'teacher',
  school TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  control_type TEXT NOT NULL CHECK (control_type IN ('BSB-I','BSB-II','CHSB-I','CHSB-II')),
  teacher_name TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  student_count INTEGER NOT NULL DEFAULT 0,
  class_percent REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_owner ON reports(owner_id);
CREATE TABLE IF NOT EXISTS catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('class','subject')),
  name TEXT NOT NULL,
  UNIQUE(kind, name)
);
`);

// Birinchi ishga tushirishda administrator va namunaviy o'qituvchi yaratiladi.
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const ins = db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)');
  ins.run('admin', hashPassword(process.env.EDU_ADMIN_PASSWORD || 'admin123'), 'Administrator', 'admin');
  ins.run('teacher', hashPassword('teacher123'), "Mahmudov Jasurbek Jo'raboy o'g'li", 'teacher');
  const cat = db.prepare('INSERT OR IGNORE INTO catalog (kind, name) VALUES (?,?)');
  for (const c of ['5-A', '5-B', '6-A', '6-B', '7-A', '7-B', '8-A', '9-A', '10-A', '10-B', '11-A']) cat.run('class', c);
  for (const s of ['Ingliz tili', 'Matematika', 'Ona tili', 'Adabiyot', 'Fizika', 'Kimyo', 'Biologiya', 'Tarix', 'Geografiya', 'Informatika', 'Rus tili']) cat.run('subject', s);
}
