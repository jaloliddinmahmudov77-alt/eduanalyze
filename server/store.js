// Ma'lumotlar qatlami: bitta kod bilan ikki xil baza.
//  - SUPABASE_DB_URL (yoki DATABASE_URL) berilsa — Supabase Postgres, "eduanalyze" sxemasi;
//  - aks holda — mahalliy SQLite fayli (node:sqlite).
// SQL umumiy (portativ) yoziladi: "?" parametrlar, vaqtlar ISO matn sifatida JS'da hosil qilinadi, INSERT ... RETURNING id.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCHEMA = 'eduanalyze';

export const nowIso = () => new Date().toISOString();
export const addDaysIso = (d) => new Date(Date.now() + d * 86400_000).toISOString();

const TABLES_PG = `
CREATE SCHEMA IF NOT EXISTS ${SCHEMA};
CREATE TABLE IF NOT EXISTS ${SCHEMA}.users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher','admin')),
  school TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON ${SCHEMA}.users (lower(username));
CREATE TABLE IF NOT EXISTS ${SCHEMA}.sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ${SCHEMA}.users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ${SCHEMA}.reports (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES ${SCHEMA}.users(id) ON DELETE CASCADE,
  school TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  control_type TEXT NOT NULL CHECK (control_type IN ('BSB-I','BSB-II','CHSB-I','CHSB-II')),
  teacher_name TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  student_count INTEGER NOT NULL DEFAULT 0,
  class_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_owner ON ${SCHEMA}.reports(owner_id);
CREATE TABLE IF NOT EXISTS ${SCHEMA}.catalog (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('class','subject')),
  name TEXT NOT NULL,
  UNIQUE(kind, name)
);
CREATE TABLE IF NOT EXISTS ${SCHEMA}.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ${SCHEMA}.payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ${SCHEMA}.users(id) ON DELETE CASCADE,
  report_id INTEGER REFERENCES ${SCHEMA}.reports(id) ON DELETE SET NULL,
  report_label TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','used')),
  note TEXT NOT NULL DEFAULT '',
  receipt_file_id TEXT NOT NULL DEFAULT '',
  receipt_kind TEXT NOT NULL DEFAULT 'photo',
  tg_message_id INTEGER,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS payments_user_report ON ${SCHEMA}.payments(user_id, report_id);
CREATE INDEX IF NOT EXISTS payments_status ON ${SCHEMA}.payments(status);
CREATE TABLE IF NOT EXISTS ${SCHEMA}.messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES ${SCHEMA}.users(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('user','admin')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  tg_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS messages_user ON ${SCHEMA}.messages(user_id, id);
CREATE INDEX IF NOT EXISTS messages_tg ON ${SCHEMA}.messages(tg_message_id);
`;

// Supabase: jadvallar ommaviy API (anon/authenticated) uchun yopiq — faqat server (postgres roli) kiradi.
// Oddiy Postgres'da bu rollar bo'lmasa, blok hech narsa qilmaydi.
const SECURE_PG = `
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','reports','catalog','settings','payments','messages'] LOOP
    EXECUTE format('ALTER TABLE ${SCHEMA}.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA ${SCHEMA} FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${SCHEMA} FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${SCHEMA} FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA ${SCHEMA} REVOKE ALL ON TABLES FROM anon, authenticated';
  END IF;
END $$;
`;

// SQLite varianti (sxemasiz)
const TABLES_SQLITE = TABLES_PG
  .replace(/CREATE SCHEMA IF NOT EXISTS \w+;/, '')
  .replaceAll(`${SCHEMA}.`, '')
  .replaceAll('SERIAL PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT')
  .replaceAll('DOUBLE PRECISION', 'REAL');

/** "?" -> $1, $2 ... (Postgres uchun). Satr ichidagi "?" belgilariga tegmaydi. */
function toPg(sql) {
  let i = 0, out = '', inStr = false;
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    out += !inStr && ch === '?' ? `$${++i}` : ch;
  }
  return out;
}

export async function openStore() {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
  if (process.env.EDU_PGLITE) return openPglite(); // testlar uchun (xotiradagi haqiqiy Postgres)
  if (url) return openPostgres(url);
  return openSqlite();
}

function openSqlite() {
  // node:sqlite dinamik yuklanadi (Postgres rejimida kerak emas)
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const path = process.env.EDU_DB_PATH || join(__dirname, 'data', 'eduanalyze.db');
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    migrateLegacySqlite(db);
    db.exec(TABLES_SQLITE);
    // node:sqlite null-prototip obyektlar qaytaradi — oddiy obyektga aylantiramiz
    const plain = (r) => (r ? { ...r } : r);
    const api = {
      all: async (sql, p = []) => db.prepare(sql).all(...p).map(plain),
      get: async (sql, p = []) => plain(db.prepare(sql).get(...p)),
      run: async (sql, p = []) => { const r = db.prepare(sql).run(...p); return { changes: Number(r.changes) }; },
    };
    let chain = Promise.resolve();
    return {
      kind: 'sqlite',
      label: `SQLite (${path})`,
      ...api,
      // tranzaksiyalar ketma-ket bajariladi (bitta ulanish)
      tx: (fn) => {
        const run = chain.catch(() => {}).then(async () => {
          db.exec('BEGIN');
          try { const r = await fn(api); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
        });
        chain = run;
        return run;
      },
      close: async () => db.close(),
    };
  });
}

/** Avvalgi versiya bazasi: users.username COLLATE NOCASE edi va vaqtlar "YYYY-MM-DD HH:MM:SS" — mos keladi, faqat yangi jadvallar qo'shiladi */
function migrateLegacySqlite(db) {
  try { db.exec("UPDATE sessions SET expires_at = replace(expires_at, ' ', 'T') || '.000Z' WHERE expires_at NOT LIKE '%T%'"); } catch { /* jadval hali yo'q */ }
}

async function openPostgres(url) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => Number(v)); // bigint (COUNT) -> number
  const pool = new pg.Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 5,
  });
  // har bir ulanishda search_path bir marta (kutib) o'rnatiladi
  const prepared = new WeakSet();
  const withClient = async (fn) => {
    const c = await pool.connect();
    try {
      if (!prepared.has(c)) { await c.query(`SET search_path TO ${SCHEMA}, public`); prepared.add(c); }
      return await fn(c);
    } finally { c.release(); }
  };
  try {
    await pool.query(TABLES_PG);
    await pool.query(SECURE_PG);
  } catch (e) {
    await pool.end().catch(() => {});
    throw new Error(`Supabase'ga ulanib bo'lmadi: ${e.message}. SUPABASE_DB_URL (Session pooler satri va parol) ni tekshiring`);
  }
  const q = (client) => ({
    all: async (sql, p = []) => (await client.query(toPg(sql), p)).rows,
    get: async (sql, p = []) => (await client.query(toPg(sql), p)).rows[0],
    run: async (sql, p = []) => ({ changes: (await client.query(toPg(sql), p)).rowCount }),
  });
  const viaPool = {
    all: (sql, p = []) => withClient(async (c) => (await c.query(toPg(sql), p)).rows),
    get: (sql, p = []) => withClient(async (c) => (await c.query(toPg(sql), p)).rows[0]),
    run: (sql, p = []) => withClient(async (c) => ({ changes: (await c.query(toPg(sql), p)).rowCount })),
  };
  const host = (() => { try { return new URL(url).hostname; } catch { return 'postgres'; } })();
  return {
    kind: 'postgres',
    label: `Supabase Postgres (${host}, sxema: ${SCHEMA})`,
    ...viaPool,
    tx: (fn) => withClient(async (c) => {
      try { await c.query('BEGIN'); const r = await fn(q(c)); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK'); throw e; }
    }),
    close: () => pool.end(),
  };
}

async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec(TABLES_PG);
  await pg.exec(SECURE_PG);
  await pg.exec(`SET search_path TO ${SCHEMA}, public`);
  const api = {
    all: async (sql, p = []) => (await pg.query(toPg(sql), p)).rows,
    get: async (sql, p = []) => (await pg.query(toPg(sql), p)).rows[0],
    run: async (sql, p = []) => ({ changes: (await pg.query(toPg(sql), p)).affectedRows ?? 0 }),
  };
  return { kind: 'postgres', label: 'PGlite (test)', ...api, tx: async (fn) => fn(api), close: () => pg.close() };
}
