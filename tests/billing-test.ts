// Pullik yuklash + Telegram bot oqimi (soxta Telegram serveri bilan). Har ikkala bazada: SQLite va Postgres (PGlite).
//   npm run test:billing
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fails = 0, passes = 0;
const ok = (c: unknown, m: string) => { if (c) passes++; else { fails++; console.error('  ✗', m); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- soxta Telegram ----
type Call = { method: string; body: Record<string, unknown>; raw: string; id?: number };
let calls: Call[] = [];
let queue: unknown[] = [];
let updateId = 1;
let msgId = 100;
const readBody = (req: IncomingMessage) => new Promise<string>((r) => { let b = ''; req.setEncoding('latin1'); req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const tg = createServer(async (req, res) => {
  const raw = await readBody(req);
  const url = req.url || '';
  if (url.startsWith('/file/')) { res.setHeader('Content-Type', 'image/jpeg'); res.end(Buffer.alloc(2000, 7)); return; }
  const method = url.split('/').pop() || '';
  let body: Record<string, unknown> = {};
  if ((req.headers['content-type'] || '').includes('json')) body = JSON.parse(raw || '{}');
  else { // multipart: oddiy maydonlarni ajratib olish
    for (const m of raw.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)) body[m[1]] = m[2];
    if (raw.includes('name="photo"')) body.photo = 'binary';
  }
  calls.push({ method, body, raw });
  const reply = (result: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, result })); };
  if (method === 'getMe') return reply({ id: 1, username: 'EduAnalyzeBot', first_name: 'EduAnalyze' });
  if (method === 'getUpdates') {
    if (queue.length) { const u = queue.map((x) => ({ update_id: updateId++, ...(x as object) })); queue = []; return reply(u); }
    await sleep(300);
    return reply([]);
  }
  if (method === 'sendPhoto' || method === 'sendDocument') return reply({ message_id: ++msgId, photo: [{ file_id: 'small' }, { file_id: `FILE${msgId}` }] });
  if (method === 'sendMessage') { calls[calls.length - 1].id = ++msgId; return reply({ message_id: msgId }); }
  if (method === 'getFile') return reply({ file_path: 'photos/x.jpg' });
  return reply(true);
}).listen(0);
const tgPort = (tg.address() as { port: number }).port;

const msg = (fromId: number, username: string, text: string, replyTo?: number) => ({ message: { message_id: 1, chat: { id: fromId, type: 'private' }, from: { id: fromId, username }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) } });
const cb = (fromId: number, username: string, data: string, messageId: number) => ({ callback_query: { id: `q${updateId}`, from: { id: fromId, username }, data, message: { message_id: messageId, chat: { id: fromId } } } });
const waitFor = async (pred: () => boolean, ms = 4000) => { const t = Date.now(); while (!pred() && Date.now() - t < ms) await sleep(100); return pred(); };

async function runSuite(label: string, env: Record<string, string>, port: number) {
  console.log(`\n== ${label} ==`);
  calls = []; queue = [];
  const srv: ChildProcess = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: { ...process.env, EDU_PORT: String(port), TELEGRAM_BOT_TOKEN: 'TEST:TOKEN', TELEGRAM_ADMIN_USERNAME: 'Mahmudov567', TELEGRAM_API_BASE: `http://127.0.0.1:${tgPort}`, SUPABASE_DB_URL: '', DATABASE_URL: '', GEMINI_API_KEY: '', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  srv.stderr?.on('data', (d) => (stderr += d));
  try {
    const B = `http://127.0.0.1:${port}/api`;
    for (let i = 0; i < 60; i++) { try { await fetch(`${B}/auth/config`); break; } catch { await sleep(250); } }
    const post = (path: string, body: unknown, token?: string) => fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const get = (path: string, token: string) => fetch(B + path, { headers: { Authorization: `Bearer ${token}` } });
    const teacher = (await (await post('/auth/login', { username: 'teacher', password: 'teacher123' })).json()).token;
    const admin = (await (await post('/auth/login', { username: 'admin', password: 'admin123' })).json()).token;
    ok(teacher && admin, 'login');

    // 1) Begona profil va admin bog'lanishi
    queue.push(msg(555, 'boshqa_odam', '/start'));
    await waitFor(() => calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === 555));
    ok(/ruxsat yo/i.test(String(calls.find((c) => c.body.chat_id === 555)?.body.text)), `begona profil rad etildi: ${String(calls.find((c) => c.body.chat_id === 555)?.body.text)}`);
    queue.push(msg(777, 'Mahmudov567', '/start'));
    await waitFor(() => calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === 777));
    ok(String(calls.find((c) => c.body.chat_id === 777)?.body.text).includes('administratori sifatida'), '@Mahmudov567 admin sifatida bog‘landi');

    // 2) Hisobot va pullik yuklash
    const rep = (await (await post('/reports', { className: '6-A', subject: 'Ingliz tili', controlType: 'CHSB-I', data: { criteria: [{ id: 'a', name: 'L', max: 6, type: 'bilish' }], students: [{ id: 's', name: 'Ali', scores: { a: 5 } }] } }, teacher)).json()).report;
    let r = await post(`/reports/${rep.id}/export`, {}, teacher);
    const j402 = await r.json();
    ok(r.status === 402 && j402.config.price === 15000, `to‘lovsiz yuklab bo‘lmaydi (402, 15 000) — ${r.status}`);
    r = await post(`/reports/${rep.id}/export`, {}, admin);
    ok(r.status === 200 && r.headers.get('x-download-mode') === 'free', 'sayt administratori bepul yuklaydi');

    // 3) Chek yuborish -> botga rasm + tugmalar
    const receipt = Buffer.alloc(5000, 1).toString('base64');
    r = await post('/payments', { reportId: rep.id, receipt, mimeType: 'image/jpeg' }, teacher);
    const pay = (await r.json()).payment;
    ok(r.status === 201 && pay.status === 'pending' && pay.amount === 15000, 'to‘lov so‘rovi yaratildi');
    const photo = calls.find((c) => c.method === 'sendPhoto');
    ok(photo && photo.raw.includes('777') && photo.raw.includes(`ap:${pay.id}`) && photo.raw.includes(`rj:${pay.id}`), 'chek adminga ✅/❌ tugmalari bilan yuborildi');
    ok((await post('/payments', { reportId: rep.id, receipt, mimeType: 'image/jpeg' }, teacher)).status === 409, 'ikkinchi chek kutilayotganda qabul qilinmaydi');
    ok((await post(`/reports/${rep.id}/export`, {}, teacher)).status === 402, 'tekshiruvdan oldin yuklab bo‘lmaydi');

    // 4) Username'ni o'g'irlagan boshqa ID — rad etiladi
    queue.push(cb(999, 'Mahmudov567', `ap:${pay.id}`, 101));
    await waitFor(() => calls.some((c) => c.method === 'answerCallbackQuery' && String(c.body.text).includes('Ruxsat')));
    let st = await (await get(`/reports/${rep.id}/payment`, teacher)).json();
    ok(st.payment.status === 'pending', 'boshqa Telegram ID (bir xil username bilan) tasdiqlay olmadi');

    // 5) Admin tasdiqlaydi
    queue.push(cb(777, 'Mahmudov567', `ap:${pay.id}`, 101));
    await waitFor(() => calls.some((c) => c.method === 'editMessageCaption'));
    st = await (await get(`/reports/${rep.id}/payment`, teacher)).json();
    ok(st.payment.status === 'approved' && st.access === 'credit', 'tasdiqlandi — saytda darhol ko‘rindi');
    ok(String(calls.find((c) => c.method === 'editMessageCaption')?.body.caption).includes('Tasdiqlandi'), 'bot xabari yangilandi');
    r = await post(`/reports/${rep.id}/export`, {}, teacher);
    const buf = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && r.headers.get('x-download-mode') === 'paid' && buf.subarray(0, 2).toString() === 'PK', 'to‘lovdan keyin haqiqiy XLSX yuklandi');
    ok(decodeURIComponent(r.headers.get('content-disposition') || '').includes('6-A_Ingliz_tili_CHSB-I.xlsx'), 'fayl nomi');
    r = await post(`/reports/${rep.id}/export`, {}, teacher);
    ok(r.status === 200 && r.headers.get('x-download-mode') === 'redownload', '30 daqiqa ichida qayta yuklash mumkin');
    queue.push(cb(777, 'Mahmudov567', `ap:${pay.id}`, 101));
    await waitFor(() => calls.some((c) => c.method === 'answerCallbackQuery' && String(c.body.text).includes('allaqachon')));
    ok(calls.some((c) => String(c.body.text).includes('allaqachon')), 'ikki marta tasdiqlab bo‘lmaydi');

    // 6) Boshqa hisobot — rad etish va sabab
    const rep2 = (await (await post('/reports', { className: '7-B', subject: 'Fizika', controlType: 'BSB-I', data: { criteria: [{ id: 'a', name: 'L', max: 6, type: 'bilish' }], students: [{ id: 's', name: 'Ali', scores: { a: 5 } }] } }, teacher)).json()).report;
    const pay2 = (await (await post('/payments', { reportId: rep2.id, receipt, mimeType: 'image/png' }, teacher)).json()).payment;
    queue.push(cb(777, 'Mahmudov567', `rj:${pay2.id}`, 102));
    await waitFor(() => calls.some((c) => c.method === 'sendMessage' && String(c.body.text).includes('sababni')));
    ok(calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === 777 && String(c.body.text).includes(`#${pay2.id}`) && String(c.body.text).includes('sababni')), 'rad etilgach bot admindan sabab so‘radi');
    queue.push(msg(777, 'Mahmudov567', 'Summa mos emas'));
    await waitFor(() => calls.some((c) => c.method === 'sendMessage' && String(c.body.text).includes('Sabab saqlandi')));
    st = await (await get(`/reports/${rep2.id}/payment`, teacher)).json();
    ok(st.payment.status === 'rejected' && st.payment.note === 'Summa mos emas', 'rad etildi va sabab saytda ko‘rinadi');
    let inbox = await (await get('/messages', teacher)).json();
    ok(inbox.messages.some((m: { sender: string; text: string }) => m.sender === 'admin' && m.text.includes('Sabab: Summa mos emas')), 'rad etish sababi foydalanuvchiga xabar sifatida bordi');
    ok(inbox.messages.some((m: { sender: string; text: string }) => m.sender === 'admin' && m.text.includes(`To‘lov #${pay.id}`) && m.text.includes('tasdiqlandi')), 'tasdiqlash haqida ham xabar bordi');
    queue.push(msg(777, 'Mahmudov567', `/sabab ${pay2.id} Chek o‘qilmaydi`));
    await waitFor(() => calls.some((c) => c.method === 'sendMessage' && String(c.body.text).includes('sabab saqlandi')));
    ok((await (await get(`/reports/${rep2.id}/payment`, teacher)).json()).payment.note === 'Chek o‘qilmaydi', '/sabab bilan sababni keyin o‘zgartirish');
    ok((await post(`/reports/${rep2.id}/export`, {}, teacher)).status === 402, 'rad etilgandan keyin yuklab bo‘lmaydi');
    ok((await post('/payments', { reportId: rep2.id, receipt, mimeType: 'image/png' }, teacher)).status === 201, 'rad etilgandan keyin yangi chek yuborish mumkin');

    // 7) Bot admin panel: narx, karta, statistika
    queue.push(msg(777, 'Mahmudov567', '/narx 20000'));
    queue.push(msg(777, 'Mahmudov567', '/karta 8600123412341234 Mahmudov Jaloliddin'));
    queue.push(msg(777, 'Mahmudov567', '/stats'));
    await waitFor(() => calls.some((c) => String(c.body.text).includes('Statistika')));
    const cfg = await (await get('/billing/config', teacher)).json();
    ok(cfg.price === 20000 && cfg.cardNumber === '8600 1234 1234 1234' && cfg.cardOwner === 'Mahmudov Jaloliddin', 'narx va karta botdan o‘zgartirildi');
    ok(String(calls.find((c) => String(c.body.text).includes('Statistika'))?.body.text).includes('Jami tushum'), 'statistika');
    queue.push(msg(555, 'boshqa_odam', '/narx 1000'));
    await sleep(800);
    ok((await (await get('/billing/config', teacher)).json()).price === 20000, 'begona profil narxni o‘zgartira olmaydi');

    // 8) Sayt admin paneli
    const ab = await (await get('/admin/billing', admin)).json();
    ok(ab.stats.used === 1 && ab.stats.pending === 1 && ab.stats.rejected === 1 && ab.stats.revenue === 15000, `sayt admin statistikasi ${JSON.stringify(ab.stats)}`);
    ok(ab.bot.adminBound && ab.bot.username === 'EduAnalyzeBot', 'bot holati saytda');
    r = await get(`/admin/payments/${pay.id}/receipt`, admin);
    ok(r.status === 200 && (await r.arrayBuffer()).byteLength === 2000, 'chekni saytdan ko‘rish');
    ok((await get('/admin/billing', teacher)).status === 403, 'o‘qituvchi admin to‘lovlar ro‘yxatini ko‘ra olmaydi');

    // 9) Xabarlar: foydalanuvchi <-> admin
    const me = (await (await get('/auth/me', teacher)).json()).user;
    r = await post('/messages', { text: 'Salom, Excel faylda savolim bor' }, teacher);
    const sent = await r.json();
    ok(r.status === 201 && sent.delivered && sent.message.sender === 'user', 'foydalanuvchi xabari yuborildi');
    const fwd = calls.find((c) => c.method === 'sendMessage' && String(c.body.text).includes('savolim bor'));
    ok(fwd && String(fwd.body.chat_id) === '777' && JSON.stringify(fwd.body.reply_markup).includes(`rp:${me.id}`), 'xabar adminga “Javob berish” tugmasi bilan keldi');
    queue.push(msg(777, 'Mahmudov567', 'Albatta, qaysi hisobot?', fwd!.id));
    await waitFor(() => calls.some((c) => String(c.body.text).includes('Javob yuborildi')));
    ok((await (await get('/messages/unread', teacher)).json()).unread >= 1, 'javob o‘qilmagan sifatida ko‘rinadi');
    inbox = await (await get('/messages', teacher)).json();
    ok(inbox.messages.at(-1).sender === 'admin' && inbox.messages.at(-1).text === 'Albatta, qaysi hisobot?', 'Reply orqali javob foydalanuvchiga keldi');
    ok((await (await get('/messages/unread', teacher)).json()).unread === 0, 'ochilgandan keyin o‘qilgan bo‘ldi');
    calls = [];
    queue.push(cb(777, 'Mahmudov567', `rp:${me.id}`, 0));
    await waitFor(() => calls.some((c) => String(c.body.text).includes('javobingizni yozing')));
    queue.push(msg(777, 'Mahmudov567', '6-A hisobotini tekshirdim, hammasi joyida'));
    await waitFor(() => calls.some((c) => String(c.body.text).includes('Javob yuborildi')));
    inbox = await (await get('/messages', teacher)).json();
    ok(inbox.messages.at(-1).text === '6-A hisobotini tekshirdim, hammasi joyida', '“Javob berish” tugmasi orqali javob keldi');
    queue.push(msg(555, 'boshqa_odam', 'men ham javob beraman'));
    await sleep(700);
    ok((await (await get('/messages', teacher)).json()).messages.length === inbox.messages.length, 'begona profil foydalanuvchiga yoza olmaydi');
    const admMsgs = (await (await get('/messages', admin)).json()).messages;
    ok(!admMsgs.some((m: { text: string }) => m.text.includes('savolim bor')), 'har kim faqat o‘z suhbatini ko‘radi');

    // 10) Sessiya keshi xavfsizligi: o'zgarishlar darhol kuchga kiradi
    const u2 = (await (await post('/users', { username: 'kesh_test', fullName: 'Kesh Test', password: 'secret12', role: 'teacher', school: '' }, admin)).json()).user;
    const t2 = (await (await post('/auth/login', { username: 'kesh_test', password: 'secret12' })).json()).token;
    ok((await get('/auth/me', t2)).status === 200 && (await get('/admin/billing', t2)).status === 403, 'kesh: oddiy o‘qituvchi');
    await fetch(`http://127.0.0.1:${port}/api/users/${u2.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` }, body: JSON.stringify({ role: 'admin' }) });
    ok((await get('/admin/billing', t2)).status === 200, 'kesh: rol o‘zgarishi darhol kuchga kirdi');
    await fetch(`http://127.0.0.1:${port}/api/users/${u2.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` }, body: JSON.stringify({ role: 'teacher' }) });
    ok((await get('/admin/billing', t2)).status === 403, 'kesh: admin huquqi olib tashlanganda darhol yopildi');
    await fetch(`http://127.0.0.1:${port}/api/users/${u2.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } });
    ok((await get('/auth/me', t2)).status === 401, 'kesh: o‘chirilgan foydalanuvchi darhol chiqarildi');
    const t3 = (await (await post('/auth/login', { username: 'teacher', password: 'teacher123' })).json()).token;
    ok((await get('/auth/me', t3)).status === 200, 'kesh: yangi sessiya');
    await post('/auth/logout', {}, t3);
    ok((await get('/auth/me', t3)).status === 401, 'kesh: chiqqan sessiya darhol yaroqsiz');
  } finally {
    srv.kill();
    await sleep(300);
    if (fails && stderr) console.error(stderr.slice(-2000));
  }
}

await runSuite('SQLite', { EDU_DB_PATH: join(tmpdir(), `edu-bill-${Date.now()}.db`) }, 5996);
await runSuite('Postgres (PGlite — Supabase bilan bir xil SQL)', { EDU_PGLITE: '1' }, 5997);
tg.close();
console.log(`\nTo‘lov testlari: ${passes} ta o‘tdi, ${fails} ta xato`);
process.exit(fails ? 1 : 0);
