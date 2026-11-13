import express from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiStatus, extractTable } from './ai.js';
import { hashPassword, newToken, verifyPassword } from './auth.js';
import { addDaysIso, nowIso, openStore } from './store.js';
import {
  botEnabled, botStatus, fetchReceipt, money, notifyAdmin, refreshPaymentMessage, sendPaymentToAdmin, sendUserMessageToAdmin, startBot, stopBot,
} from './telegram.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.env.NODE_ENV === 'production';
const store = await openStore();
const app = express();
app.disable('x-powered-by');
// Reverse proxy (Nginx, Render, Railway...) orqasida: EDU_TRUST_PROXY=1 — haqiqiy IP rate-limit uchun
app.set('trust proxy', process.env.EDU_TRUST_PROXY ? (/^\d+$/.test(process.env.EDU_TRUST_PROXY) ? Number(process.env.EDU_TRUST_PROXY) : process.env.EDU_TRUST_PROXY) : 'loopback');

// Xavfsizlik sarlavhalari
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const jsonSmall = express.json({ limit: '5mb' });
const jsonLarge = express.json({ limit: '15mb' }); // AI skaner va to'lov cheklari uchun
app.use((req, res, next) => (req.path.startsWith('/api/ai/') || req.path === '/api/payments' ? jsonLarge : jsonSmall)(req, res, next));

const CONTROL_TYPES = ['BSB-I', 'BSB-II', 'CHSB-I', 'CHSB-II'];
const COMPETENCES = ['bilish', 'qollash', 'mulohaza'];
const SESSION_DAYS = 30;
const DEFAULT_PRICE = 15000;
const REDOWNLOAD_MINUTES = 30; // to'lovdan keyin qayta yuklab olish oynasi

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ---------- sozlamalar (narx, karta, bot) ----------
const settingsCache = new Map();
async function getSetting(key) {
  if (settingsCache.has(key)) return settingsCache.get(key);
  const r = await store.get('SELECT value FROM settings WHERE key = ?', [key]);
  settingsCache.set(key, r?.value ?? null);
  return r?.value ?? null;
}
async function setSetting(key, value) {
  const ex = await store.get('SELECT key FROM settings WHERE key = ?', [key]);
  if (ex) await store.run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
  else await store.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  settingsCache.set(key, value);
}
const getPrice = async () => Number(await getSetting('price')) || DEFAULT_PRICE;

// ---------- boshlang'ich ma'lumotlar ----------
{
  const n = (await store.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users')).n;
  if (n === 0) {
    const t = nowIso();
    let adminPass = process.env.EDU_ADMIN_PASSWORD || '';
    if (!adminPass && IS_PROD) {
      adminPass = randomBytes(12).toString('base64url');
      console.warn(`\n[!] Administrator yaratildi. Login: admin  Parol: ${adminPass}\n    Bu parol faqat hozir ko'rsatiladi — kirib, darhol almashtiring.\n`);
    }
    await store.run('INSERT INTO users (username, password_hash, full_name, role, school, created_at) VALUES (?,?,?,?,?,?)',
      ['admin', hashPassword(adminPass || 'admin123'), 'Administrator', 'admin', '', t]);
    if (!IS_PROD) {
      await store.run('INSERT INTO users (username, password_hash, full_name, role, school, created_at) VALUES (?,?,?,?,?,?)',
        ['teacher', hashPassword('teacher123'), "Mahmudov Jasurbek Jo'raboy o'g'li", 'teacher', '', t]);
    }
  }
  const cats = (await store.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM catalog')).n;
  if (cats === 0) {
    for (const c of ['5-A', '5-B', '6-A', '6-B', '7-A', '7-B', '8-A', '9-A', '10-A', '10-B', '11-A']) await store.run('INSERT INTO catalog (kind, name) VALUES (?,?)', ['class', c]);
    for (const s of ['Ingliz tili', 'Matematika', 'Ona tili', 'Adabiyot', 'Fizika', 'Kimyo', 'Biologiya', 'Tarix', 'Geografiya', 'Informatika', 'Rus tili']) await store.run('INSERT INTO catalog (kind, name) VALUES (?,?)', ['subject', s]);
  }
  if (!(await getSetting('price'))) await setSetting('price', String(DEFAULT_PRICE));
}

// ---------- auth ----------
function publicUser(u) {
  return { id: u.id, username: u.username, fullName: u.full_name, role: u.role, school: u.school, createdAt: u.created_at };
}
// Sessiya keshi: har so'rovda bazaga borib kelmaslik uchun (Supabase uzoq regionda bo'lsa ~0.2 s tejaydi).
// Chiqish, parol/rol o'zgarishi, foydalanuvchi o'chirilishida darhol tozalanadi; aks holda 30 soniyada yangilanadi.
const SESSION_CACHE_MS = Number(process.env.EDU_SESSION_CACHE_MS ?? 30_000);
const sessionCache = new Map(); // token -> { user, expiresAt, at }
const forgetToken = (token) => sessionCache.delete(token);
const forgetUser = (userId) => { for (const [t, v] of sessionCache) if (v.user.id === userId) sessionCache.delete(t); };
async function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return next(new HttpError(401, 'Tizimga kiring'));
  const now = Date.now();
  const hit = sessionCache.get(token);
  if (hit && now - hit.at < SESSION_CACHE_MS && hit.expiresAt > now) {
    req.user = hit.user;
    req.token = token;
    return next();
  }
  const row = await store.get(`SELECT u.*, s.expires_at AS session_expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`, [token, nowIso()]);
  if (!row) { forgetToken(token); return next(new HttpError(401, 'Sessiya muddati tugagan. Qayta kiring')); }
  const { session_expires_at: exp, ...user } = row;
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(token, { user, expiresAt: Date.parse(exp) || now, at: now });
  req.user = user;
  req.token = token;
  next();
}
function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Faqat administrator uchun'));
  next();
}
async function createSession(userId) {
  const token = newToken();
  await store.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)', [token, userId, nowIso(), addDaysIso(SESSION_DAYS)]);
  await store.run('DELETE FROM sessions WHERE expires_at <= ?', [nowIso()]);
  return token;
}
const findUserByName = (username) => store.get('SELECT * FROM users WHERE lower(username) = lower(?)', [username]);
const getUser = (id) => store.get('SELECT * FROM users WHERE id = ?', [id]);

// ---------- hisobot ma'lumotlarini tekshirish ----------
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
  for (const s of data.students) for (const c of data.criteria) {
    const v = s.scores[c.id];
    if (typeof v === 'number') { got += v; max += c.max; }
  }
  return max ? Math.min(100, (got * 100) / max) : 0;
}

// Ishga tushganda saqlangan sinf foizlarini joriy qoida bo'yicha yangilash
for (const r of await store.all('SELECT id, data, class_percent FROM reports')) {
  const p = classPercent(JSON.parse(r.data));
  if (Math.abs(p - r.class_percent) > 1e-9) await store.run('UPDATE reports SET class_percent = ? WHERE id = ?', [p, r.id]);
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
const metaOf = (r) => ({
  school: r.school, className: r.class_name, groupName: r.group_name, academicYear: r.academic_year,
  subject: r.subject, controlType: r.control_type, teacherName: r.teacher_name,
});
const reportLabel = (r) => `${r.class_name}${r.group_name ? ` (${r.group_name})` : ''} · ${r.subject} · ${r.control_type}`;

async function getOwnedReport(req, id) {
  const r = await store.get('SELECT r.*, u.full_name AS owner_name FROM reports r JOIN users u ON u.id = r.owner_id WHERE r.id = ?', [Number(id)]);
  if (!r) throw new HttpError(404, 'Hisobot topilmadi');
  if (req.user.role !== 'admin' && r.owner_id !== req.user.id) throw new HttpError(403, 'Bu hisobotga ruxsatingiz yo‘q');
  return r;
}

async function insertReport(ownerId, meta, dataJson, count, pct) {
  const t = nowIso();
  const row = await store.get(`INSERT INTO reports (owner_id, school, class_name, group_name, academic_year, subject, control_type, teacher_name, data, student_count, class_percent, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, [ownerId, meta.school, meta.className, meta.groupName, meta.academicYear, meta.subject,
    meta.controlType, meta.teacherName, dataJson, count, pct, t, t]);
  return row.id;
}

// ---------- routes: auth ----------
// Parolni terib topishdan himoya: 15 daqiqada IP bo'yicha 20 ta, login bo'yicha 10 ta xato urinish
const loginFails = new Map(); // kalit -> vaqtlar
const LOGIN_WINDOW = 15 * 60_000;
const recentFails = (key) => (loginFails.get(key) || []).filter((t) => Date.now() - t < LOGIN_WINDOW);
const DEFAULT_PASSWORDS = ['admin123', 'teacher123'];
app.post('/api/auth/login', async (req, res) => {
  const username = str(req.body?.username, 60);
  const password = String(req.body?.password ?? '');
  const ipKey = `ip:${req.ip}`, userKey = `u:${username.toLowerCase()}`;
  if (recentFails(ipKey).length >= 20 || recentFails(userKey).length >= 10)
    throw new HttpError(429, 'Juda ko‘p noto‘g‘ri urinish. 15 daqiqadan keyin qayta urinib ko‘ring');
  const u = await findUserByName(username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    for (const k of [ipKey, userKey]) loginFails.set(k, [...recentFails(k), Date.now()]);
    if (loginFails.size > 10_000) loginFails.clear();
    throw new HttpError(401, 'Login yoki parol noto‘g‘ri');
  }
  loginFails.delete(userKey);
  if (IS_PROD && DEFAULT_PASSWORDS.includes(password))
    throw new HttpError(403, 'Bu hisob standart (ochiq) parolga ega — xavfsizlik uchun kirish bloklangan. Serverda parolni almashtiring: npm run user:password -- ' + u.username + ' YANGI_PAROL');
  res.json({ token: await createSession(u.id), user: publicUser(u) });
});

const ALLOW_REGISTER = process.env.EDU_ALLOW_REGISTER !== 'false';
const registerHits = new Map(); // IP -> vaqtlar (soatiga 10 ta)
app.get('/api/auth/config', (_req, res) => res.json({ allowRegister: ALLOW_REGISTER }));
app.post('/api/auth/register', async (req, res) => {
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
  if (await findUserByName(username)) throw new HttpError(409, 'Bu login band. Boshqasini tanlang');
  const row = await store.get(`INSERT INTO users (username, password_hash, full_name, role, school, created_at) VALUES (?,?,?,'teacher',?,?) RETURNING id`,
    [username, hashPassword(password), fullName, school, nowIso()]);
  hits.push(now);
  registerHits.set(ip, hits);
  const user = await getUser(row.id);
  notifyAdmin(`🆕 Yangi foydalanuvchi: <b>${fullName.replace(/[<>&]/g, '')}</b> (<code>${username}</code>)${school ? `\n🏫 ${school.replace(/[<>&]/g, '')}` : ''}`);
  res.status(201).json({ token: await createSession(user.id), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await store.run('DELETE FROM sessions WHERE token = ?', [req.token]);
  forgetToken(req.token);
  res.json({ ok: true });
});

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  const fullName = str(req.body?.fullName, 160);
  const school = str(req.body?.school, 200);
  if (!fullName) throw new HttpError(400, 'F.I.O. ni kiriting');
  await store.run('UPDATE users SET full_name = ?, school = ? WHERE id = ?', [fullName, school, req.user.id]);
  forgetUser(req.user.id);
  res.json({ user: publicUser(await getUser(req.user.id)) });
});

app.post('/api/auth/password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(current, req.user.password_hash)) throw new HttpError(400, 'Joriy parol noto‘g‘ri');
  if (String(next || '').length < 6) throw new HttpError(400, 'Yangi parol kamida 6 belgidan iborat bo‘lsin');
  await store.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(next), req.user.id]);
  await store.run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', [req.user.id, req.token]);
  forgetUser(req.user.id);
  res.json({ ok: true });
});

// ---------- routes: reports ----------
app.get('/api/reports', requireAuth, async (req, res) => {
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
  const rows = await store.all(`SELECT r.*, u.full_name AS owner_name FROM reports r JOIN users u ON u.id = r.owner_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.updated_at DESC, r.id DESC`, params);
  res.json({ reports: rows.map((r) => reportRow(r, false)) });
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
  res.json({ report: reportRow(await getOwnedReport(req, req.params.id)) });
});

app.post('/api/reports', requireAuth, async (req, res) => {
  const meta = sanitizeMeta(req.body || {});
  const data = sanitizeData(req.body?.data || {});
  const id = await insertReport(req.user.id, meta, JSON.stringify(data), data.students.length, classPercent(data));
  res.status(201).json({ report: reportRow(await getOwnedReport(req, id)) });
});

app.put('/api/reports/:id', requireAuth, async (req, res) => {
  const meta = sanitizeMeta(req.body || {});
  const data = sanitizeData(req.body?.data || {});
  const r = await getOwnedReport(req, req.params.id);
  const updated = {
    ...r, school: meta.school, class_name: meta.className, group_name: meta.groupName, academic_year: meta.academicYear,
    subject: meta.subject, control_type: meta.controlType, teacher_name: meta.teacherName, data: JSON.stringify(data),
    student_count: data.students.length, class_percent: classPercent(data), updated_at: nowIso(),
  };
  await store.run(`UPDATE reports SET school=?, class_name=?, group_name=?, academic_year=?, subject=?, control_type=?, teacher_name=?,
    data=?, student_count=?, class_percent=?, updated_at=? WHERE id=?`, [updated.school, updated.class_name, updated.group_name,
    updated.academic_year, updated.subject, updated.control_type, updated.teacher_name, updated.data, updated.student_count, updated.class_percent, updated.updated_at, r.id]);
  res.json({ report: reportRow(updated) }); // qayta o'qimaymiz — bitta borib-kelish tejaladi
});

app.post('/api/reports/:id/duplicate', requireAuth, async (req, res) => {
  const r = await getOwnedReport(req, req.params.id);
  const id = await insertReport(req.user.id, { ...metaOf(r), subject: r.subject + ' (nusxa)' }, r.data, r.student_count, r.class_percent);
  res.status(201).json({ report: reportRow(await getOwnedReport(req, id)) });
});

app.delete('/api/reports/:id', requireAuth, async (req, res) => {
  const r = await getOwnedReport(req, req.params.id);
  await store.run('DELETE FROM reports WHERE id = ?', [r.id]);
  res.json({ ok: true });
});

// ---------- routes: to'lov va pullik Excel ----------
let excelLib = null;
const getExcelLib = async () => (excelLib ??= await import('./gen/excel.mjs'));

async function billingConfig() {
  return {
    price: await getPrice(),
    cardNumber: (await getSetting('card_number')) || '',
    cardOwner: (await getSetting('card_owner')) || '',
    botReady: botEnabled() && Boolean(await getSetting('admin_tg_id')),
    redownloadMinutes: REDOWNLOAD_MINUTES,
  };
}

function paymentRow(p) {
  return {
    id: p.id, userId: p.user_id, userName: p.full_name, username: p.username, reportId: p.report_id, reportLabel: p.report_label,
    amount: p.amount, status: p.status, note: p.note, createdAt: p.created_at, decidedAt: p.decided_at, usedAt: p.used_at,
    hasReceipt: Boolean(p.receipt_file_id),
  };
}
const PAY_SELECT = `SELECT p.*, u.full_name, u.username, u.school FROM payments p JOIN users u ON u.id = p.user_id`;
const getPayment = (id) => store.get(`${PAY_SELECT} WHERE p.id = ?`, [id]);
const listPayments = (where, limit, params = []) => store.all(`${PAY_SELECT} WHERE ${where} ORDER BY p.id DESC LIMIT ${Number(limit) || 50}`, params);

async function latestPayment(userId, reportId) {
  return store.get(`${PAY_SELECT} WHERE p.user_id = ? AND p.report_id = ? ORDER BY p.id DESC LIMIT 1`, [userId, reportId]);
}

/** Yuklab olishga ruxsat: admin — bepul; aks holda tasdiqlangan to'lov yoki 30 daqiqalik qayta yuklash oynasi */
async function downloadAccess(user, reportId) {
  if (user.role === 'admin') return { free: true };
  const since = new Date(Date.now() - REDOWNLOAD_MINUTES * 60_000).toISOString();
  const recent = await store.get(`SELECT id FROM payments WHERE user_id = ? AND report_id = ? AND status = 'used' AND used_at > ? ORDER BY used_at DESC LIMIT 1`, [user.id, reportId, since]);
  if (recent) return { redownload: recent.id };
  const credit = await store.get(`SELECT id FROM payments WHERE user_id = ? AND report_id = ? AND status = 'approved' ORDER BY id LIMIT 1`, [user.id, reportId]);
  if (credit) return { credit: credit.id };
  return null;
}

app.get('/api/billing/config', requireAuth, async (_req, res) => res.json(await billingConfig()));

app.get('/api/reports/:id/payment', requireAuth, async (req, res) => {
  const r = await getOwnedReport(req, req.params.id);
  const access = await downloadAccess(req.user, r.id);
  const p = await latestPayment(req.user.id, r.id);
  res.json({ access: access ? (access.free ? 'free' : access.credit ? 'credit' : 'redownload') : 'none', payment: p ? paymentRow(p) : null, config: await billingConfig() });
});

app.post('/api/reports/:id/export', requireAuth, async (req, res) => {
  const r = await getOwnedReport(req, req.params.id);
  const data = JSON.parse(r.data);
  const lib = await getExcelLib();
  let buffer;
  try {
    // avval faylni yaratamiz — xato bo'lsa to'lov sarflanmaydi
    buffer = Buffer.from(await (await lib.buildReportWorkbook(metaOf(r), data)).xlsx.writeBuffer());
  } catch (e) {
    throw new HttpError(400, e.message || 'Excel faylni yaratib bo‘lmadi');
  }
  const access = await downloadAccess(req.user, r.id);
  if (!access) {
    const p = await latestPayment(req.user.id, r.id);
    throw new HttpError(402, `Excel faylni yuklab olish pullik: ${money(await getPrice())}`, { payment: p ? paymentRow(p) : null, config: await billingConfig() });
  }
  if (access.credit) {
    const upd = await store.run(`UPDATE payments SET status = 'used', used_at = ? WHERE id = ? AND status = 'approved'`, [nowIso(), access.credit]);
    if (!upd.changes) throw new HttpError(409, 'Qayta urinib ko‘ring');
    getPayment(access.credit).then((p) => p && refreshPaymentMessage(p)).catch(() => {});
  }
  const name = lib.reportFileName(metaOf(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Download-Mode', access.free ? 'free' : access.credit ? 'paid' : 'redownload');
  res.send(buffer);
});

const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const paymentHits = new Map();
app.post('/api/payments', requireAuth, async (req, res) => {
  const r = await getOwnedReport(req, req.body?.reportId);
  const mimeType = str(req.body?.mimeType, 40);
  const b64 = String(req.body?.receipt || '');
  if (!RECEIPT_TYPES.includes(mimeType)) throw new HttpError(400, 'Chek rasm (JPG, PNG, WEBP) yoki PDF bo‘lishi kerak');
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length < 1000) throw new HttpError(400, 'Chek fayli topilmadi');
  if (buffer.length > 10 * 1024 * 1024) throw new HttpError(400, 'Chek fayli 10 MB dan oshmasligi kerak');
  const now = Date.now();
  const hits = (paymentHits.get(req.user.id) || []).filter((t) => now - t < 3600_000);
  if (hits.length >= 20) throw new HttpError(429, 'Juda ko‘p urinish. Birozdan keyin qayta urinib ko‘ring');
  const pending = await store.get(`SELECT id FROM payments WHERE user_id = ? AND report_id = ? AND status = 'pending'`, [req.user.id, r.id]);
  if (pending) throw new HttpError(409, 'Bu hisobot uchun to‘lov allaqachon tekshirilmoqda');
  if (await downloadAccess(req.user, r.id)) throw new HttpError(409, 'Bu hisobot uchun to‘lov allaqachon tasdiqlangan — faylni yuklab olishingiz mumkin');
  hits.push(now);
  paymentHits.set(req.user.id, hits);
  const row = await store.get(`INSERT INTO payments (user_id, report_id, report_label, amount, status, created_at) VALUES (?,?,?,?, 'pending', ?) RETURNING id`,
    [req.user.id, r.id, reportLabel(r), await getPrice(), nowIso()]);
  let p = await getPayment(row.id);
  const sent = await sendPaymentToAdmin(p, { buffer, mimeType });
  if (sent) {
    await store.run('UPDATE payments SET tg_message_id = ?, receipt_file_id = ?, receipt_kind = ? WHERE id = ?', [sent.messageId, sent.fileId, sent.kind, p.id]);
    p = await getPayment(p.id);
  }
  res.status(201).json({ payment: paymentRow(p), delivered: Boolean(sent) });
});

app.get('/api/payments/mine', requireAuth, async (req, res) => {
  res.json({ payments: (await listPayments('p.user_id = ?', 100, [req.user.id])).map(paymentRow) });
});

/** Bot tugmasi: tasdiqlash / rad etish (faqat telegram.js dagi admin tekshiruvidan keyin chaqiriladi) */
async function decidePayment(id, status, messageId) {
  const p = await getPayment(id);
  if (!p) return { ok: false, error: 'To‘lov topilmadi' };
  if (p.status !== 'pending') return { ok: false, error: 'Bu to‘lov allaqachon ko‘rib chiqilgan' };
  const upd = await store.run(`UPDATE payments SET status = ?, decided_at = ?, tg_message_id = COALESCE(tg_message_id, ?) WHERE id = ? AND status = 'pending'`,
    [status, nowIso(), messageId ?? null, id]);
  if (!upd.changes) return { ok: false, error: 'Bu to‘lov allaqachon ko‘rib chiqilgan' };
  const fresh = await getPayment(id);
  if (messageId && fresh.tg_message_id !== messageId) fresh.tg_message_id = messageId;
  await refreshPaymentMessage(fresh);
  if (status === 'approved') await addAdminMessage(fresh.user_id, `✅ To‘lov #${fresh.id} (${fresh.report_label}) tasdiqlandi. Excel hisobotni yuklab olishingiz mumkin.`);
  // rad etilganda sabab bot orqali so'raladi va keyin yuboriladi
  return { ok: true };
}

// ---------- xabarlar: foydalanuvchi <-> admin (Telegram bot orqali) ----------
function messageRow(m) {
  return { id: m.id, sender: m.sender, text: m.text, createdAt: m.created_at, readAt: m.read_at };
}
async function addAdminMessage(userId, text) {
  const row = await store.get(`INSERT INTO messages (user_id, sender, text, created_at) VALUES (?, 'admin', ?, ?) RETURNING id`, [userId, String(text).slice(0, 2000), nowIso()]);
  return row.id;
}
const findMessageByTg = (tgId) => store.get(`SELECT m.user_id, u.full_name FROM messages m JOIN users u ON u.id = m.user_id WHERE m.tg_message_id = ? AND m.sender = 'user' ORDER BY m.id DESC LIMIT 1`, [tgId]);
const getUserBrief = (id) => store.get('SELECT id, full_name, username, school FROM users WHERE id = ?', [id]);

const messageHits = new Map();
app.get('/api/messages', requireAuth, async (req, res) => {
  const rows = await store.all(`SELECT * FROM (SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 300) t ORDER BY id`, [req.user.id]);
  if (rows.some((m) => m.sender === 'admin' && !m.read_at))
    await store.run(`UPDATE messages SET read_at = ? WHERE user_id = ? AND sender = 'admin' AND read_at IS NULL`, [nowIso(), req.user.id]);
  res.json({ messages: rows.map(messageRow), adminOnline: botEnabled() && Boolean(await getSetting('admin_tg_id')) });
});
app.get('/api/messages/unread', requireAuth, async (req, res) => {
  const r = await store.get(`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM messages WHERE user_id = ? AND sender = 'admin' AND read_at IS NULL`, [req.user.id]);
  res.json({ unread: r.n });
});
app.post('/api/messages', requireAuth, async (req, res) => {
  const text = str(req.body?.text, 2000);
  if (!text) throw new HttpError(400, 'Xabar matnini yozing');
  const now = Date.now();
  const hits = (messageHits.get(req.user.id) || []).filter((t) => now - t < 3600_000);
  if (hits.length >= 40) throw new HttpError(429, 'Juda ko‘p xabar. Birozdan keyin yozing');
  hits.push(now);
  messageHits.set(req.user.id, hits);
  const row = await store.get(`INSERT INTO messages (user_id, sender, text, created_at) VALUES (?, 'user', ?, ?) RETURNING id`, [req.user.id, text, nowIso()]);
  const tgId = await sendUserMessageToAdmin(req.user, text);
  if (tgId) await store.run('UPDATE messages SET tg_message_id = ? WHERE id = ?', [tgId, row.id]);
  res.status(201).json({ message: messageRow(await store.get('SELECT * FROM messages WHERE id = ?', [row.id])), delivered: Boolean(tgId) });
});

// ---------- sayt admin paneli: to'lovlar (ko'rish; qaror faqat Telegram bot orqali) ----------
app.get('/api/admin/billing', requireAuth, requireAdmin, async (_req, res) => {
  const by = Object.fromEntries((await store.all(`SELECT status, CAST(COUNT(*) AS INTEGER) AS n, CAST(COALESCE(SUM(amount),0) AS INTEGER) AS s FROM payments GROUP BY status`)).map((r) => [r.status, r]));
  res.json({
    config: await billingConfig(),
    bot: await botStatus(),
    database: store.label,
    stats: {
      pending: by.pending?.n || 0, approved: (by.approved?.n || 0) + (by.used?.n || 0), used: by.used?.n || 0, rejected: by.rejected?.n || 0,
      revenue: (by.approved?.s || 0) + (by.used?.s || 0),
    },
    payments: (await listPayments('1=1', 200)).map(paymentRow),
  });
});
app.get('/api/admin/payments/:id/receipt', requireAuth, requireAdmin, async (req, res) => {
  const p = await getPayment(Number(req.params.id));
  if (!p?.receipt_file_id) throw new HttpError(404, 'Chek topilmadi');
  const f = await fetchReceipt(p.receipt_file_id).catch(() => { throw new HttpError(502, 'Chekni Telegram’dan olib bo‘lmadi'); });
  res.setHeader('Content-Type', f.mimeType);
  res.send(f.buffer);
});

app.get('/api/stats', requireAuth, async (req, res) => {
  const all = req.user.role === 'admin';
  // ikkala so'rov parallel (uzoq regionda bitta borib-kelish tejaladi)
  const [rows, teachers] = await Promise.all([
    store.all(`SELECT r.*, u.full_name AS owner_name FROM reports r JOIN users u ON u.id = r.owner_id
      ${all ? '' : 'WHERE r.owner_id = ?'} ORDER BY r.updated_at DESC, r.id DESC`, all ? [] : [req.user.id]),
    all ? store.get(`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users WHERE role = 'teacher'`) : null,
  ]);
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
  if (all) out.teachers = teachers.n;
  res.json(out);
});

// ---------- routes: catalog ----------
app.get('/api/catalog', requireAuth, async (_req, res) => {
  const rows = await store.all('SELECT * FROM catalog ORDER BY kind, name');
  res.json({ classes: rows.filter((r) => r.kind === 'class'), subjects: rows.filter((r) => r.kind === 'subject') });
});
app.post('/api/catalog', requireAuth, requireAdmin, async (req, res) => {
  const kind = req.body?.kind === 'subject' ? 'subject' : 'class';
  const name = str(req.body?.name, 100);
  if (!name) throw new HttpError(400, 'Nomini kiriting');
  if (await store.get('SELECT id FROM catalog WHERE kind = ? AND lower(name) = lower(?)', [kind, name])) throw new HttpError(409, 'Bu nom allaqachon mavjud');
  const row = await store.get('INSERT INTO catalog (kind, name) VALUES (?,?) RETURNING id', [kind, name]);
  res.status(201).json({ item: await store.get('SELECT * FROM catalog WHERE id = ?', [row.id]) });
});
app.delete('/api/catalog/:id', requireAuth, requireAdmin, async (req, res) => {
  await store.run('DELETE FROM catalog WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ---------- routes: users (admin) ----------
app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
  const rows = await store.all(`SELECT u.*, (SELECT CAST(COUNT(*) AS INTEGER) FROM reports r WHERE r.owner_id = u.id) AS report_count
    FROM users u ORDER BY u.role, u.full_name`);
  res.json({ users: rows.map((u) => ({ ...publicUser(u), reportCount: u.report_count })) });
});
app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const username = str(req.body?.username, 60);
  const fullName = str(req.body?.fullName, 160);
  const password = String(req.body?.password ?? '');
  const role = req.body?.role === 'admin' ? 'admin' : 'teacher';
  if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(username)) throw new HttpError(400, 'Login kamida 3 ta lotin harfi/raqamdan iborat bo‘lsin');
  if (!fullName) throw new HttpError(400, 'F.I.O. ni kiriting');
  if (password.length < 6) throw new HttpError(400, 'Parol kamida 6 belgidan iborat bo‘lsin');
  if (await findUserByName(username)) throw new HttpError(409, 'Bu login band');
  const row = await store.get('INSERT INTO users (username, password_hash, full_name, role, school, created_at) VALUES (?,?,?,?,?,?) RETURNING id',
    [username, hashPassword(password), fullName, role, str(req.body?.school, 200), nowIso()]);
  res.status(201).json({ user: publicUser(await getUser(row.id)) });
});
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const u = await getUser(Number(req.params.id));
  if (!u) throw new HttpError(404, 'Foydalanuvchi topilmadi');
  const fullName = str(req.body?.fullName ?? u.full_name, 160);
  const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'teacher' ? 'teacher' : u.role;
  if (u.id === req.user.id && role !== 'admin') throw new HttpError(400, 'O‘zingizni administrator rolidan chiqara olmaysiz');
  await store.run('UPDATE users SET full_name = ?, role = ?, school = ? WHERE id = ?', [fullName, role, str(req.body?.school ?? u.school, 200), u.id]);
  forgetUser(u.id); // rol o'zgarishi darhol kuchga kirsin
  if (req.body?.password) {
    if (String(req.body.password).length < 6) throw new HttpError(400, 'Parol kamida 6 belgidan iborat bo‘lsin');
    await store.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(req.body.password), u.id]);
    await store.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
  }
  res.json({ user: publicUser(await getUser(u.id)) });
});
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'O‘zingizni o‘chira olmaysiz');
  await store.run('DELETE FROM users WHERE id = ?', [id]);
  forgetUser(id);
  res.json({ ok: true });
});

// ---------- health-check (hosting/monitoring uchun) ----------
app.get('/api/health', async (_req, res) => {
  try {
    await store.get('SELECT 1 AS ok');
    res.json({ ok: true, db: store.kind, bot: (await botStatus()).running ?? false, uptime: Math.round(process.uptime()) });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'Baza bilan aloqa yo‘q' });
  }
});

// ---------- AI Vision skaner ----------
app.get('/api/ai/status', requireAuth, (_req, res) => res.json(aiStatus()));
app.post('/api/ai/extract', requireAuth, async (req, res) => {
  const image = String(req.body?.image || '');
  if (!image || image.length > 14_000_000) throw new HttpError(400, 'Rasm topilmadi yoki juda katta');
  const result = await extractTable({ userId: req.user.id, image, mimeType: String(req.body?.mimeType || '') });
  res.json({ result });
});

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Topilmadi')));

// ---------- static client (production) ----------
const dist = join(__dirname, '..', 'client', 'dist');
if (existsSync(dist)) {
  // Vite assetlari hash'li nomga ega — uzoq keshlash; index.html — har doim yangi
  app.use('/assets', express.static(join(dist, 'assets'), { maxAge: '1y', immutable: true, index: false }));
  app.use(express.static(dist, { maxAge: '1d', index: false }));
  app.get(/^\/(?!api).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(dist, 'index.html')); });
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500 && status !== 502 && status !== 503) console.error(err);
  res.status(status).json({
    error: status >= 500 && status !== 502 && status !== 503 ? 'Serverda xatolik yuz berdi' : status === 413 ? 'Fayl juda katta' : err.message,
    ...(err.extra || {}),
  });
});

const PORT = Number(process.env.EDU_PORT || process.env.PORT_API || 5174);
const server = app.listen(PORT, () => console.log(`EduAnalyze API: http://localhost:${PORT} · baza: ${store.label}${IS_PROD ? ' · production' : ''}`));

// To'g'ri to'xtash (hosting qayta ishga tushirganda): bot, HTTP va baza ulanishlarini yopish
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig}: server to'xtatilmoqda...`);
    stopBot();
    server.close(() => store.close().catch(() => {}).finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

startBot({ store, getSetting, setSetting, onDecision: decidePayment, listPayments, getPayment, addAdminMessage, findMessageByTg, getUserBrief });
