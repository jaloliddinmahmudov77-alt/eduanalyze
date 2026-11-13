// Foydalanuvchi parolini serverda almashtirish (masalan, standart admin parolini):
//   npm run user:password -- admin "YangiKuchliParol123"
import { hashPassword } from '../server/auth.js';
import { openStore } from '../server/store.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Foydalanish: npm run user:password -- <login> <yangi_parol>');
  process.exit(1);
}
if (password.length < 10 || ['admin123', 'teacher123'].includes(password)) {
  console.error('Parol kamida 10 belgidan iborat va standart bo‘lmasligi kerak');
  process.exit(1);
}
const store = await openStore();
const u = await store.get('SELECT id, username FROM users WHERE lower(username) = lower(?)', [username]);
if (!u) { console.error(`“${username}” topilmadi`); await store.close(); process.exit(1); }
await store.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), u.id]);
await store.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
console.log(`✅ “${u.username}” paroli almashtirildi (${store.label}). Barcha eski sessiyalar yopildi.`);
await store.close();
