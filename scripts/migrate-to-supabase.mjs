// Mahalliy SQLite bazasidagi ma'lumotlarni Supabase Postgres ("eduanalyze" sxemasi) ga ko'chirish.
//   npm run db:migrate            — Supabase bo'sh bo'lsa ko'chiradi
//   npm run db:migrate -- --force — Supabase'dagi EduAnalyze ma'lumotlarini o'chirib, qayta ko'chiradi
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../server/store.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.env.EDU_DB_PATH || join(root, 'server', 'data', 'eduanalyze.db');
if (!existsSync(src)) { console.error(`SQLite fayli topilmadi: ${src}`); process.exit(1); }
if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL && !process.env.EDU_PGLITE) {
  console.error('SUPABASE_DB_URL o‘rnatilmagan (.env faylida). README’dagi “Supabase” bo‘limiga qarang.');
  process.exit(1);
}
const force = process.argv.includes('--force');
const sqlite = new DatabaseSync(src, { readOnly: true });
const target = await openStore();
console.log(`Manba: ${src}\nManzil: ${target.label}`);

const existing = (await target.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users')).n;
if (existing && !force) {
  console.error(`Supabase’da allaqachon ${existing} ta foydalanuvchi bor. Qayta ko‘chirish uchun: npm run db:migrate -- --force`);
  process.exit(1);
}

const TABLES = {
  users: ['id', 'username', 'password_hash', 'full_name', 'role', 'school', 'created_at'],
  sessions: ['token', 'user_id', 'created_at', 'expires_at'],
  catalog: ['id', 'kind', 'name'],
  reports: ['id', 'owner_id', 'school', 'class_name', 'group_name', 'academic_year', 'subject', 'control_type', 'teacher_name', 'data', 'student_count', 'class_percent', 'created_at', 'updated_at'],
  settings: ['key', 'value'],
  payments: ['id', 'user_id', 'report_id', 'report_label', 'amount', 'status', 'note', 'receipt_file_id', 'receipt_kind', 'tg_message_id', 'created_at', 'decided_at', 'used_at'],
};
const hasTable = (t) => Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t));
// eski formatdagi vaqtlar ("YYYY-MM-DD HH:MM:SS") -> ISO
const iso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(' ', 'T') + '.000Z' : v);

await target.tx(async (db) => {
  if (force) for (const t of ['payments', 'settings', 'reports', 'catalog', 'sessions', 'users']) await db.run(`DELETE FROM ${t}`);
  for (const [t, cols] of Object.entries(TABLES)) {
    if (!hasTable(t)) continue;
    const rows = sqlite.prepare(`SELECT * FROM ${t}`).all();
    for (const r of rows) {
      const vals = cols.map((c) => (c.endsWith('_at') ? iso(r[c] ?? null) : r[c] ?? null));
      await db.run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    }
    console.log(`  ${t}: ${rows.length} ta qator`);
  }
  // SERIAL ketma-ketliklarini moslash
  for (const t of ['users', 'catalog', 'reports', 'payments']) {
    await db.run(`SELECT setval(pg_get_serial_sequence('eduanalyze.${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
  }
});
console.log('✅ Ko‘chirish tugadi. Endi serverni qayta ishga tushiring — u Supabase bilan ishlaydi.');
await target.close();
