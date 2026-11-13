import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { hashPassword, verifyPassword, newToken } from './auth.js';
import { aiStatus, extractTable } from './ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const jsonSmall = express.json({ limit: '5mb' });
const jsonLarge = express.json({ limit: '15mb' }); // AI skaner rasmlari uchun
app.use((req, res, next) => (req.path.startsWith('/api/ai/') ? jsonLarge : jsonSmall)(req, res, next));

const CONTROL_TYPES = ['BSB-I', 'BSB-II', 'CHSB-I', 'CHSB-II'];
const COMPETENCES = ['bilish', 'qollash', 'mulohaza'];
const SESSION_DAYS = 30;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ---------- auth middleware ----------
function publicUser(u) {
  return { id: u.id, username: u.username, fullName: u.full_name, role: u.role, school: u.school, createdAt: u.created_at };
}
function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return next(new HttpError(401, 'Tizimga kiring'));
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token);
  if (!row) return next(new HttpError(401, 'Sessiya muddati tugagan. Qayta kiring'));
  req.user = row;
  req.token = token;
  next();
}
function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Faqat administrator uchun'));
  next();
}

// ---------- report data validation ----------
function sanitizeData(input) {
  const criteria = Array.isArray(input?.criteria) ? input.criteria : [];
  const students = Array.isArray(input?.students) ? input.students : [];
  if (criteria.length > 60) throw new HttpError(400, 'Mezonlar soni juda ko‘p');
  if (students.length > 500) throw new HttpError(400, 'O‘quvchilar soni juda ko‘p');
  const ids = new Set();
  const cleanCriteria = criteria.map((c, i) => {
    const id = str(c.id, 40) || `c${i}`;
    if (ids.has(id)) throw new HttpError(400, 'Mezon identifikatori takrorlangan');
    ids.add(id);
    const max = Number(c.max);
    if (!Number.isFinite(max) || max <= 0 || max > 1000) throw new HttpError(400, `"${str(c.name)}" mezonining maksimal bali noto‘g‘ri`);
    const type = COMPETENCES.includes(c.type) ? c.type : 'bilish';
    return { id, name: str(c.name, 120) || `Mezon ${i + 1}`, max, type };
  });
  const cleanStudents = students.map((s, i) => {
    const scores = {};
    for (const c of cleanCriteria) {
      const raw = s?.scores?.[c.id];
      if (raw === null || raw === undefined || raw === '') continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      if (v < 0) throw new HttpError(400, `${str(s.name)}: manfiy ball qabul qilinmaydi`);
      if (v > c.max) throw new HttpError(400, `${str(s.name)}: "${c.name}" bo‘yicha ball ${c.max} dan oshmasligi kerak`);
      scores[c.id] = v;
    }
    return { id: str(s?.id, 40) || `s${i}`, name: str(s?.name, 160), scores };
  });
  return { criteria: cleanCriteria, students: cleanStudents };
}

// Bo'sh katak = baholanmagan (hisobga kirmaydi); foiz faqat ball kiritilgan mezonlar bo'yicha
function classPercent(data) {
  let got = 0, max = 0;
  for (const s of data.students) {
    for (const c of data.criteria) {
      const v = s.scores[c.id];
      if (typeof v === 'number') { got += v; max += c.max; }
    }
  }
  return max ? Math.min(100, (got * 100) / max) : 0;
}

// Ishga tushganda saqlangan sinf foizlarini joriy qoida bo'yicha yangilash
{
  const upd = db.prepare('UPDATE reports SET class_percent = ? WHERE id = ?');
  for (const r of db.prepare('SELECT id, data, class_percent FROM reports').all()) {
    const p = classPercent(JSON.parse(r.data));
    if (Math.abs(p - r.class_percent) > 1e-9) upd.run(p, r.id);
  }
}

function sanitizeMeta(b) {
  const meta = {
    school: str(b.school), className: str(b.className, 20), groupName: str(b.groupName, 40),
    academicYear: str(b.academicYear, 20), subject: str(b.subject, 100),
    controlType: str(b.controlType, 10), teacherName: str(b.teacherName, 160),
  };
  if (!meta.className) throw new HttpError(400, 'Sinf nomini kiriting');
  if (!meta.subject) throw new HttpError(400, 'Fan nomini kiriting');
  if (!CONTROL_TYPES.includes(meta.controlType)) throw new HttpError(400, 'Nazorat turini tanlang');
  return meta;
}

function reportRow(r, withData = true) {
  const out = {
    id: r.id, ownerId: r.owner_id, ownerName: r.owner_name,
    school: r.school, className: r.class_name, groupName: r.group_name, academicYear: r.academic_year,
    subject: r.subject, controlType: r.control_type, teacherName: r.teacher_name,
    studentCount: r.student_count, classPercent: r.class_percent,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
  if (withData) out.data = JSON.parse(r.data);
  return out;
}

function getOwnedReport(req, id) {
  const r = db.prepare('SELECT r.*, u.full_name AS owner_name FROM reports r JOIN users u ON u.id = r.owner_id WHERE r.id = ?').get(Number(id));
  if (!r) throw new HttpError(404, 'Hisobot topilmadi');
  if (req.user.role !== 'admin' && r.owner_id !== req.user.id) throw new HttpError(403, 'Bu hisobotga ruxsatingiz yo‘q');
  return r;
}

// ---------- routes: auth ----------
app.post('/api/auth/login', wrap((req, res) => {
  const username = str(req.body?.username, 60);
  const password = String(req.body?.password ?? '');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Login yoki parol noto‘g‘ri');
  const token = newToken();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(token, u.id);
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  res.json({ token, user: publicUser(u) });
}));

function createSession(userId) {
  const token = newToken();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(token, userId);
  return token;
}

// ---------- ro'yxatdan o'tish (faqat o'qituvchi roli) ----------
const ALLOW_REGISTER = process.env.EDU_ALLOW_REGISTER !== 'false';
const registerHits = new Map(); // IP -> vaqt belgilari (oddiy cheklov: soatiga 10 ta)
app.get('/api/auth/config', (_req, res) => res.json({ allowRegister: ALLOW_REGISTER }));
app.post('/api/auth/register', wrap((req, res) => {
  if (!ALLOW_REGISTER) throw new HttpError(403, 'Ro‘yxatdan o‘tish o‘chirilgan. Administratorga murojaat qiling');
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const hits = (registerHits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (hits.length >= 10) throw new HttpError(429, 'Juda ko‘p urinish. Birozdan keyin qayta urinib ko‘ring');
  const username = str(req.body?.username, 60);
  const fullName = str(req.body?.fullName, 160);
  const school = str(req.body?.school, 200);
  const password = String(req.body?.password ?? '');
  if (!fullName) throw new HttpError(400, 'F.I.O. ni kiriting');
  if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) throw new HttpError(400, 'Login kamida 3 ta lotin harfi, raqam yoki . _ - belgilaridan iborat bo‘lsin');
  if (password.length < 6) throw new HttpError(400, 'Parol kamida 6 belgidan iborat bo‘lsin');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Bu login band. Boshqasini tanlang');
  const info = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, school) VALUES (?,?,?,'teacher',?)`)
    .run(username, hashPassword(password), fullName, school);
  hits.push(now);
  registerHits.set(ip, hits);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: createSession(user.id), user: publicUser(user) });
}));

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

app.put('/api/auth/profile', requireAuth, wrap((req, res) => {
  const fullName = str(req.body?.fullName, 160);
  const school = str(req.body?.school, 200);
  if (!fullName) throw new HttpError(400, 'F.I.O. ni kiriting');
  db.prepare('UPDATE users SET full_name = ?, school = ? WHERE id = ?').run(fullName, school, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
}));

app.post('/api/auth/password', requireAuth, wrap((req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(current, req.user.password_hash)) throw new HttpError(400, 'Joriy parol noto‘g‘ri');
  if (String(next || '').length < 6) throw new HttpError(400, 'Yangi parol kamida 6 belgidan iborat bo‘lsin');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.token);
  res.json({ ok: true });
}));

// ---------- routes: reports ----------
app.get('/api/reports', requireAuth, wrap((req, res) => {
  const where = [];
  const params = [];
  if (req.user.role !== 'admin') { where.push('r.owner_id = ?'); params.push(req.user.id); }
  else if (req.query.owner) { where.push('r.owner_id = ?'); params.push(Number(req.query.owner)); }
  const type = str(req.query.type, 10);
  if (type === 'BSB' || type === 'CHSB') { where.push('r.control_type LIKE ?'); params.push(`${type}-%`); }
  else if (CONTROL_TYPES.includes(type)) { where.push('r.control_type = ?'); params.push(type); }
  const q = str(req.query.q, 100).toLowerCase();
  if (q) {
    where.push('(lower(r.class_name) LIKE ? OR lower(r.subject) LIKE ? OR lower(r.group_name) LIKE ? OR lower(r.teacher_name) LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = db.prepare(`SELECT r.*, u.full_name AS owner_name FROM reports r JOIN users u ON u.id = r.owner_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.updated_at DESC, r.id DESC`).all(...params);
  res.json({ reports: rows.map((r) => reportRow(r, false)) });
}));

app.get('/api/reports/:id', requireAuth, wrap((req, res) => {
  res.json({ report: reportRow(getOwnedReport(req, req.params.id)) });
}));

app.post('/api/reports', requireAuth, wrap((req, res) => {
  const meta = sanitizeMeta(req.body || {});
  const data = sanitizeData(req.body?.data || {});
  const info = db.prepare(`INSERT INTO reports (owner_id, school, class_name, group_name, academic_year, subject, control_type, teacher_name, data, student_count, class_percent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, meta.school, meta.className, meta.groupName, meta.academicYear, meta.subject,
    meta.controlType, meta.teacherName, JSON.stringify(data), data.students.length, classPercent(data));
  res.status(201).json({ report: reportRow(getOwnedReport(req, info.lastInsertRowid)) });
}));

app.put('/api/reports/:id', requireAuth, wrap((req, res) => {
  const r = getOwnedReport(req, req.params.id);
  const meta = sanitizeMeta(req.body || {});
  const data = sanitizeData(req.body?.data || {});
  db.prepare(`UPDATE reports SET school=?, class_name=?, group_name=?, academic_year=?, subject=?, control_type=?, teacher_name=?,
    data=?, student_count=?, class_percent=?, updated_at=datetime('now') WHERE id=?`).run(meta.school, meta.className, meta.groupName,
    meta.academicYear, meta.subject, meta.controlType, meta.teacherName, JSON.stringify(data), data.students.length, classPercent(data), r.id);
  res.json({ report: reportRow(getOwnedReport(req, r.id)) });
}));

app.post('/api/reports/:id/duplicate', requireAuth, wrap((req, res) => {
  const r = getOwnedReport(req, req.params.id);
  const info = db.prepare(`INSERT INTO reports (owner_id, school, class_name, group_name, academic_year, subject, control_type, teacher_name, data, student_count, class_percent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, r.school, r.class_name, r.group_name, r.academic_year, r.subject + ' (nusxa)',
    r.control_type, r.teacher_name, r.data, r.student_count, r.class_percent);
  res.status(201).json({ report: reportRow(getOwnedReport(req, info.lastInsertRowid)) });
}));

app.delete('/api/reports/:id', requireAuth, wrap((req, res) => {
  const r = getOwnedReport(req, req.params.id);
  db.prepare('DELETE FROM reports WHERE id = ?').run(r.id);
  res.json({ ok: true });
}));

app.get('/api/stats', requireAuth, wrap((req, res) => {
  const all = req.user.role === 'admin';
  const rows = db.prepare(`SELECT r.*, u.full_name AS owner_name FROM reports r JOIN users u ON u.id = r.owner_id
    ${all ? '' : 'WHERE r.owner_id = ?'} ORDER BY r.updated_at DESC, r.id DESC`).all(...(all ? [] : [req.user.id]));
  const classes = new Set();
  const students = new Set();
  let bsb = 0, chsb = 0;
  for (const r of rows) {
    const key = `${r.owner_id}|${r.class_name.toLowerCase()}|${r.group_name.toLowerCase()}`;
    classes.add(key);
    for (const s of JSON.parse(r.data).students) if (s.name) students.add(`${key}|${s.name.toLowerCase().replace(/\s+/g, ' ')}`);
    if (r.control_type.startsWith('BSB')) bsb++; else chsb++;
  }
  const out = { classes: classes.size, students: students.size, bsb, chsb, recent: rows.slice(0, 6).map((r) => reportRow(r, false)) };
  if (all) out.teachers = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'`).get().n;
  res.json(out);
}));

// ---------- routes: catalog (classes, subjects) ----------
app.get('/api/catalog', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM catalog ORDER BY kind, name').all();
  res.json({ classes: rows.filter((r) => r.kind === 'class'), subjects: rows.filter((r) => r.kind === 'subject') });
});
app.post('/api/catalog', requireAuth, requireAdmin, wrap((req, res) => {
  const kind = req.body?.kind === 'subject' ? 'subject' : 'class';
  const name = str(req.body?.name, 100);
  if (!name) throw new HttpError(400, 'Nomini kiriting');
  const dup = db.prepare('SELECT id FROM catalog WHERE kind = ? AND lower(name) = lower(?)').get(kind, name);
  if (dup) throw new HttpError(409, 'Bu nom allaqachon mavjud');
  const info = db.prepare('INSERT INTO catalog (kind, name) VALUES (?,?)').run(kind, name);
  res.status(201).json({ item: db.prepare('SELECT * FROM catalog WHERE id = ?').get(info.lastInsertRowid) });
}));
app.delete('/api/catalog/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM catalog WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- routes: users (admin) ----------
app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM reports r WHERE r.owner_id = u.id) AS report_count
    FROM users u ORDER BY u.role, u.full_name`).all();
  res.json({ users: rows.map((u) => ({ ...publicUser(u), reportCount: u.report_count })) });
});
app.post('/api/users', requireAuth, requireAdmin, wrap((req, res) => {
  const username = str(req.body?.username, 60);
  const fullName = str(req.body?.fullName, 160);
  const password = String(req.body?.password ?? '');
  const role = req.body?.role === 'admin' ? 'admin' : 'teacher';
  if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) throw new HttpError(400, 'Login kamida 3 ta lotin harfi/raqamdan iborat bo‘lsin');
  if (!fullName) throw new HttpError(400, 'F.I.O. ni kiriting');
  if (password.length < 6) throw new HttpError(400, 'Parol kamida 6 belgidan iborat bo‘lsin');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Bu login band');
  const info = db.prepare('INSERT INTO users (username, password_hash, full_name, role, school) VALUES (?,?,?,?,?)')
    .run(username, hashPassword(password), fullName, role, str(req.body?.school, 200));
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
}));
app.put('/api/users/:id', requireAuth, requireAdmin, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!u) throw new HttpError(404, 'Foydalanuvchi topilmadi');
  const fullName = str(req.body?.fullName ?? u.full_name, 160);
  const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'teacher' ? 'teacher' : u.role;
  if (u.id === req.user.id && role !== 'admin') throw new HttpError(400, 'O‘zingizni administrator rolidan chiqara olmaysiz');
  db.prepare('UPDATE users SET full_name = ?, role = ?, school = ? WHERE id = ?').run(fullName, role, str(req.body?.school ?? u.school, 200), u.id);
  if (req.body?.password) {
    if (String(req.body.password).length < 6) throw new HttpError(400, 'Parol kamida 6 belgidan iborat bo‘lsin');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
}));
app.delete('/api/users/:id', requireAuth, requireAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'O‘zingizni o‘chira olmaysiz');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
}));

// ---------- AI Vision skaner ----------
app.get('/api/ai/status', requireAuth, (_req, res) => res.json(aiStatus()));
app.post('/api/ai/extract', requireAuth, wrap(async (req, res) => {
  const image = String(req.body?.image || '');
  if (!image || image.length > 14_000_000) throw new HttpError(400, 'Rasm topilmadi yoki juda katta');
  const result = await extractTable({ userId: req.user.id, image, mimeType: String(req.body?.mimeType || '') });
  res.json({ result });
}));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Topilmadi')));

// ---------- static client (production) ----------
const dist = join(__dirname, '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && status !== 502 && status !== 503 ? 'Serverda xatolik yuz berdi' : err.message });
});

const PORT = Number(process.env.EDU_PORT || 5174);
app.listen(PORT, () => console.log(`EduAnalyze API: http://localhost:${PORT}`));
