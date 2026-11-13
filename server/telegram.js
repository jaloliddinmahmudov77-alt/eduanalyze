// Telegram bot: to'lovlarni tasdiqlash/rad etish va admin panel.
// Faqat TELEGRAM_ADMIN_USERNAME (standart: Mahmudov567) profili boshqaradi:
// birinchi /start da shu username egasining Telegram ID si bazaga bog'lanadi va keyin faqat shu ID qabul qilinadi
// (username o'zgartirilsa yoki boshqaga o'tsa ham boshqa odam boshqara olmaydi).

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_USERNAME = (process.env.TELEGRAM_ADMIN_USERNAME || 'Mahmudov567').replace(/^@/, '');
const TG_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'; // testlar uchun almashtiriladi
const API = (m) => `${TG_BASE}/bot${TOKEN}/${m}`;

let ctx = null; // { store, getSetting, setSetting, onDecision }
let botUsername = '';
let running = false;

export const money = (n) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
const fmtTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

async function tg(method, payload) {
  const res = await fetch(API(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 20_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) {
    const e = new Error(`Telegram ${method}: ${j.description || res.status}`);
    e.code = j.error_code || res.status;
    throw e;
  }
  return j.result;
}

export const botEnabled = () => Boolean(TOKEN);
export async function botStatus() {
  if (!TOKEN || !ctx) return { enabled: false, username: '', adminBound: false, adminUsername: ADMIN_USERNAME };
  return { enabled: true, running, username: botUsername, adminBound: Boolean(await ctx.getSetting('admin_tg_id')), adminUsername: ADMIN_USERNAME };
}

async function adminChatId() {
  return ctx ? (await ctx.getSetting('admin_tg_id')) || '' : '';
}

/** Faqat admin: bog'langan ID bo'yicha; hali bog'lanmagan bo'lsa — username bo'yicha (bind=true bo'lsa bog'laydi) */
async function isAdmin(from, bind = false) {
  if (!from) return false;
  const bound = await ctx.getSetting('admin_tg_id');
  if (bound) return String(from.id) === String(bound);
  const ok = (from.username || '').toLowerCase() === ADMIN_USERNAME.toLowerCase();
  if (ok && bind) await ctx.setSetting('admin_tg_id', String(from.id));
  return ok;
}

export async function notifyAdmin(text, extra = {}) {
  const chat = await adminChatId();
  if (!TOKEN || !chat) return null;
  try { return await tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }); }
  catch (e) { console.error('[bot]', e.message); return null; }
}

export function paymentCaption(p) {
  const status = p.status === 'pending' ? '⏳ Tekshirilmoqda'
    : p.status === 'approved' ? `✅ Tasdiqlandi${p.decided_at ? ` — ${fmtTime(p.decided_at)}` : ''}`
      : p.status === 'used' ? `✅ Tasdiqlandi, fayl yuklab olindi${p.used_at ? ` — ${fmtTime(p.used_at)}` : ''}`
        : `❌ Rad etildi${p.decided_at ? ` — ${fmtTime(p.decided_at)}` : ''}${p.note ? `\nSabab: ${esc(p.note)}` : ''}`;
  return [
    `🧾 <b>To‘lov #${p.id}</b>`,
    `👤 ${esc(p.full_name)} (<code>${esc(p.username)}</code>)`,
    p.school ? `🏫 ${esc(p.school)}` : '',
    `📄 ${esc(p.report_label)}`,
    `💰 <b>${money(p.amount)}</b>`,
    `🕒 ${fmtTime(p.created_at)}`,
    '',
    status,
  ].filter((x) => x !== '').join('\n');
}

// Admin keyingi yozadigan matn nimaga tegishli: rad etish sababi yoki foydalanuvchiga javob
async function getPending() { try { return JSON.parse((await ctx.getSetting('bot_pending')) || 'null'); } catch { return null; } }
const setPending = (v) => ctx.setSetting('bot_pending', v ? JSON.stringify(v) : '');

/** Foydalanuvchi saytdan yozgan xabarni adminga yuborish. Qaytaradi: Telegram message_id yoki null */
export async function sendUserMessageToAdmin(user, text) {
  const chat = await adminChatId();
  if (!TOKEN || !chat) return null;
  try {
    const m = await tg('sendMessage', {
      chat_id: chat, parse_mode: 'HTML', disable_web_page_preview: true,
      text: `💬 <b>${esc(user.full_name)}</b> (<code>${esc(user.username)}</code>)${user.school ? ` · ${esc(user.school)}` : ''}\n\n${esc(text)}`,
      reply_markup: { inline_keyboard: [[{ text: '↩️ Javob berish', callback_data: `rp:${user.id}` }]] },
    });
    return m.message_id;
  } catch (e) {
    console.error('[bot] xabarni yuborib bo‘lmadi:', e.message);
    return null;
  }
}

const decisionKeyboard = (id) => ({ inline_keyboard: [[{ text: '✅ Tasdiqlash', callback_data: `ap:${id}` }, { text: '❌ Rad etish', callback_data: `rj:${id}` }]] });

/** Yangi to'lovni chek bilan adminga yuborish. Qaytaradi: { messageId, fileId, kind } yoki null */
export async function sendPaymentToAdmin(p, receipt) {
  const chat = await adminChatId();
  if (!TOKEN || !chat) return null;
  const caption = paymentCaption(p);
  try {
    if (receipt?.buffer) {
      const isPdf = receipt.mimeType === 'application/pdf';
      const fd = new FormData();
      fd.append('chat_id', chat);
      fd.append('caption', caption);
      fd.append('parse_mode', 'HTML');
      fd.append('reply_markup', JSON.stringify(decisionKeyboard(p.id)));
      fd.append(isPdf ? 'document' : 'photo', new Blob([receipt.buffer], { type: receipt.mimeType }), isPdf ? `chek-${p.id}.pdf` : `chek-${p.id}.jpg`);
      const res = await fetch(API(isPdf ? 'sendDocument' : 'sendPhoto'), { method: 'POST', body: fd, signal: AbortSignal.timeout(30_000) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.description);
      const m = j.result;
      const fileId = isPdf ? m.document?.file_id : m.photo?.[m.photo.length - 1]?.file_id;
      return { messageId: m.message_id, fileId: fileId || '', kind: isPdf ? 'document' : 'photo' };
    }
    // chek fayli yo'q (qayta yuborish): saqlangan file_id bilan
    const method = p.receipt_kind === 'document' ? 'sendDocument' : 'sendPhoto';
    const m = await tg(method, { chat_id: chat, [p.receipt_kind === 'document' ? 'document' : 'photo']: p.receipt_file_id, caption, parse_mode: 'HTML', reply_markup: decisionKeyboard(p.id) });
    return { messageId: m.message_id, fileId: p.receipt_file_id, kind: p.receipt_kind };
  } catch (e) {
    console.error('[bot] to‘lovni yuborib bo‘lmadi:', e.message);
    return null;
  }
}

/** Tasdiqlash/rad etishdan keyin xabar matnini yangilash va tugmalarni olib tashlash */
export async function refreshPaymentMessage(p) {
  const chat = await adminChatId();
  if (!TOKEN || !chat || !p.tg_message_id) return;
  try {
    await tg('editMessageCaption', { chat_id: chat, message_id: p.tg_message_id, caption: paymentCaption(p), parse_mode: 'HTML', reply_markup: p.status === 'pending' ? decisionKeyboard(p.id) : { inline_keyboard: [] } });
  } catch (e) {
    if (!/not modified/i.test(e.message)) console.error('[bot]', e.message);
  }
}

/** Chek faylini Telegram'dan olish (sayt admin paneli uchun) */
export async function fetchReceipt(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  const res = await fetch(`${TG_BASE}/file/bot${TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error('Chekni yuklab bo‘lmadi');
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: /\.pdf$/i.test(f.file_path) ? 'application/pdf' : 'image/jpeg' };
}

const MENU = {
  keyboard: [
    [{ text: '📊 Statistika' }, { text: '⏳ Kutilayotgan to‘lovlar' }],
    [{ text: '🧾 Oxirgi to‘lovlar' }, { text: '👥 Foydalanuvchilar' }],
    [{ text: '💬 Xabarlar' }, { text: '💳 To‘lov sozlamalari' }],
    [{ text: 'ℹ️ Yordam' }],
  ],
  resize_keyboard: true,
};

const HELP = `<b>EduAnalyze admin panel</b>

📊 /stats — statistika va tushum
⏳ /pending — kutilayotgan to‘lovlar (tasdiqlash tugmalari bilan)
🧾 /tolovlar — oxirgi 15 ta to‘lov
👥 /users — oxirgi foydalanuvchilar
💳 /sozlamalar — narx va karta
💰 /narx 15000 — bitta yuklash narxini o‘zgartirish
🏦 /karta 8600123412341234 Ism Familiya — to‘lov kartasini o‘zgartirish
✍️ /sabab 12 Chek noto‘g‘ri — rad etilgan to‘lovga sabab yozish
💬 /xabarlar — foydalanuvchilardan kelgan oxirgi xabarlar
🚫 /bekor — kutilayotgan javob/sababni bekor qilish

To‘lov kelganda chek rasmi ✅ Tasdiqlash / ❌ Rad etish tugmalari bilan yuboriladi. ❌ bosilganda bot sababni so‘raydi va u foydalanuvchiga yuboriladi.
Foydalanuvchi saytdan xabar yozsa, shu yerga keladi: “↩️ Javob berish” tugmasini bosing yoki xabarga Reply qiling.`;

async function handleCommand(chatId, text) {
  const { store, getSetting, setSetting } = ctx;
  const [cmdRaw, ...rest] = text.trim().split(/\s+/);
  const alias = {
    '📊': '/stats', '⏳': '/pending', '🧾': '/tolovlar', '👥': '/users', '💳': '/sozlamalar', 'ℹ️': '/help', '💬': '/xabarlar',
  };
  const cmd = (alias[cmdRaw] || cmdRaw).split('@')[0].toLowerCase();
  const reply = (t, extra = {}) => tg('sendMessage', { chat_id: chatId, text: t, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

  if (cmd === '/start' || cmd === '/help') return reply(HELP, { reply_markup: MENU });

  if (cmd === '/stats') {
    const c = await store.get(`SELECT
      (SELECT CAST(COUNT(*) AS INTEGER) FROM users) AS users,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM users WHERE role = 'teacher') AS teachers,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM reports) AS reports`);
    const p = await store.all(`SELECT status, CAST(COUNT(*) AS INTEGER) AS n, CAST(COALESCE(SUM(amount), 0) AS INTEGER) AS s FROM payments GROUP BY status`);
    const by = Object.fromEntries(p.map((r) => [r.status, r]));
    const paid = (by.approved?.s || 0) + (by.used?.s || 0);
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const today = await store.get(`SELECT CAST(COALESCE(SUM(amount), 0) AS INTEGER) AS s, CAST(COUNT(*) AS INTEGER) AS n FROM payments WHERE status IN ('approved','used') AND decided_at >= ?`, [since.toISOString()]);
    return reply([
      '📊 <b>Statistika</b>',
      `👥 Foydalanuvchilar: <b>${c.users}</b> (o‘qituvchi: ${c.teachers})`,
      `📄 Hisobotlar: <b>${c.reports}</b>`,
      '',
      `⏳ Kutilmoqda: <b>${by.pending?.n || 0}</b>`,
      `✅ Tasdiqlangan: <b>${(by.approved?.n || 0) + (by.used?.n || 0)}</b> (yuklab olingan: ${by.used?.n || 0})`,
      `❌ Rad etilgan: <b>${by.rejected?.n || 0}</b>`,
      '',
      `💰 Jami tushum: <b>${money(paid)}</b>`,
      `📅 Bugun: <b>${money(today.s)}</b> (${today.n} ta)`,
    ].join('\n'));
  }

  if (cmd === '/pending') {
    const list = await ctx.listPayments(`p.status = 'pending'`, 10);
    if (!list.length) return reply('✅ Kutilayotgan to‘lov yo‘q');
    await reply(`⏳ Kutilayotgan to‘lovlar: <b>${list.length}</b>`);
    for (const p of list) {
      const sent = await sendPaymentToAdmin(p, null);
      if (sent) await store.run('UPDATE payments SET tg_message_id = ? WHERE id = ?', [sent.messageId, p.id]);
      else await reply(paymentCaption(p), { reply_markup: decisionKeyboard(p.id) });
    }
    return;
  }

  if (cmd === '/tolovlar') {
    const list = await ctx.listPayments('1=1', 15);
    if (!list.length) return reply('To‘lovlar hali yo‘q');
    const icon = { pending: '⏳', approved: '✅', used: '✅', rejected: '❌' };
    return reply(['🧾 <b>Oxirgi to‘lovlar</b>', ...list.map((p) => `${icon[p.status]} #${p.id} · ${esc(p.full_name)} · ${esc(p.report_label)} · ${money(p.amount)} · ${fmtTime(p.created_at)}`)].join('\n'));
  }

  if (cmd === '/users') {
    const list = await store.all(`SELECT u.full_name, u.username, u.role, u.created_at,
      (SELECT CAST(COUNT(*) AS INTEGER) FROM reports r WHERE r.owner_id = u.id) AS reports
      FROM users u ORDER BY u.id DESC LIMIT 15`);
    return reply(['👥 <b>Oxirgi foydalanuvchilar</b>', ...list.map((u) => `${u.role === 'admin' ? '🛡' : '👤'} ${esc(u.full_name)} (<code>${esc(u.username)}</code>) · ${u.reports} ta hisobot · ${fmtTime(u.created_at)}`)].join('\n'));
  }

  if (cmd === '/sozlamalar') {
    const price = Number(await getSetting('price')) || 15000;
    const card = (await getSetting('card_number')) || '—';
    const owner = (await getSetting('card_owner')) || '—';
    return reply(`💳 <b>To‘lov sozlamalari</b>\n\n💰 Bitta yuklash: <b>${money(price)}</b>\n🏦 Karta: <code>${esc(card)}</code>\n👤 Egasi: ${esc(owner)}\n\nO‘zgartirish:\n/narx 15000\n/karta 8600123412341234 Ism Familiya`);
  }

  if (cmd === '/narx') {
    const n = Number((rest[0] || '').replace(/\D/g, ''));
    if (!n || n < 1000 || n > 10_000_000) return reply('Foydalanish: /narx 15000 (1 000 dan 10 000 000 so‘mgacha)');
    await setSetting('price', String(n));
    return reply(`✅ Yangi narx: <b>${money(n)}</b>. Saytda darhol qo‘llandi.`);
  }

  if (cmd === '/karta') {
    const num = (rest[0] || '').replace(/\D/g, '');
    const owner = rest.slice(1).join(' ').trim();
    if (num.length < 16 || num.length > 19) return reply('Foydalanish: /karta 8600123412341234 Ism Familiya');
    const pretty = num.replace(/(\d{4})(?=\d)/g, '$1 ');
    await setSetting('card_number', pretty);
    if (owner) await setSetting('card_owner', owner.slice(0, 80));
    return reply(`✅ To‘lov kartasi yangilandi:\n<code>${pretty}</code>${owner ? `\n${esc(owner)}` : ''}`);
  }

  if (cmd === '/sabab') {
    const id = Number(rest[0]);
    const note = rest.slice(1).join(' ').trim().slice(0, 300);
    if (!id || !note) return reply('Foydalanish: /sabab 12 Chek summasi mos emas');
    const p = await ctx.getPayment(id);
    if (!p) return reply('To‘lov topilmadi');
    if (p.status !== 'rejected') return reply('Sabab faqat rad etilgan to‘lovga yoziladi');
    await store.run('UPDATE payments SET note = ? WHERE id = ?', [note, id]);
    await refreshPaymentMessage(await ctx.getPayment(id));
    return reply(`✍️ #${id} uchun sabab saqlandi. Foydalanuvchi uni saytda ko‘radi.`);
  }

  if (cmd === '/xabarlar') {
    const list = await store.all(`SELECT m.text, m.created_at, u.id AS uid, u.full_name, u.username FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.sender = 'user' ORDER BY m.id DESC LIMIT 10`);
    if (!list.length) return reply('💬 Hali xabar yo‘q');
    await reply('💬 <b>Oxirgi xabarlar</b> (javob berish uchun tugmani bosing)');
    for (const m of list.reverse()) {
      await reply(`<b>${esc(m.full_name)}</b> (<code>${esc(m.username)}</code>) · ${fmtTime(m.created_at)}\n${esc(m.text)}`,
        { reply_markup: { inline_keyboard: [[{ text: '↩️ Javob berish', callback_data: `rp:${m.uid}` }]] } });
    }
    return;
  }

  if (cmd === '/bekor') {
    await setPending(null);
    return reply('🚫 Bekor qilindi');
  }

  if (cmd === '/skip') {
    const p = await getPending();
    if (p?.type === 'reject') {
      await setPending(null);
      const pay = await ctx.getPayment(p.paymentId);
      if (pay) await ctx.addAdminMessage(pay.user_id, `❌ To‘lov #${pay.id} (${pay.report_label}) rad etildi. Iltimos, to‘g‘ri chekni qayta yuboring.`);
      return reply(`✅ #${p.paymentId} sababsiz rad etildi, foydalanuvchiga xabar yuborildi.`);
    }
    await setPending(null);
    return reply('Kutilayotgan amal yo‘q');
  }

  return reply('Noma’lum buyruq. /help');
}

/** Buyruq bo'lmagan matn: Reply orqali javob, rad etish sababi yoki "Javob berish" dan keyingi matn */
async function handleFreeText(m) {
  const text = (m.text || '').trim().slice(0, 2000);
  const chatId = m.chat.id;
  const reply = (t, extra = {}) => tg('sendMessage', { chat_id: chatId, text: t, parse_mode: 'HTML', ...extra });
  if (!text) return;

  // 1) Foydalanuvchi xabariga Telegram'dagi "Reply" orqali javob
  const repliedId = m.reply_to_message?.message_id;
  if (repliedId) {
    const orig = await ctx.findMessageByTg(repliedId);
    if (orig) {
      await ctx.addAdminMessage(orig.user_id, text);
      return reply(`✅ Javob yuborildi: <b>${esc(orig.full_name)}</b>`);
    }
  }

  const p = await getPending();
  // 2) Rad etish sababi
  if (p?.type === 'reject') {
    await setPending(null);
    const pay = await ctx.getPayment(p.paymentId);
    if (!pay) return reply('To‘lov topilmadi');
    await ctx.store.run('UPDATE payments SET note = ? WHERE id = ?', [text.slice(0, 300), pay.id]);
    await refreshPaymentMessage(await ctx.getPayment(pay.id));
    await ctx.addAdminMessage(pay.user_id, `❌ To‘lov #${pay.id} (${pay.report_label}) rad etildi.\nSabab: ${text.slice(0, 300)}\n\nIltimos, to‘g‘ri chekni qayta yuboring.`);
    return reply(`✅ Sabab saqlandi va <b>${esc(pay.full_name)}</b> ga yuborildi.`);
  }
  // 3) "Javob berish" tugmasidan keyingi matn
  if (p?.type === 'reply') {
    await setPending(null);
    const u = await ctx.getUserBrief(p.userId);
    if (!u) return reply('Foydalanuvchi topilmadi');
    await ctx.addAdminMessage(u.id, text);
    return reply(`✅ Javob yuborildi: <b>${esc(u.full_name)}</b>`);
  }
  return reply('Buyruq tushunilmadi. Foydalanuvchiga javob yozish uchun uning xabaridagi “↩️ Javob berish” tugmasini bosing yoki xabarga Reply qiling. /help');
}

async function handleUpdate(u) {
  if (u.message) {
    const m = u.message;
    if (m.chat?.type !== 'private') return;
    const text = m.text || '';
    const isStart = /^\/start\b/.test(text);
    if (!(await isAdmin(m.from, isStart))) {
      await tg('sendMessage', { chat_id: m.chat.id, text: '⛔ Bu bot faqat EduAnalyze administratori uchun. Sizda ruxsat yo‘q.' }).catch(() => {});
      return;
    }
    if (isStart) {
      const pending = await ctx.store.get(`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM payments WHERE status = 'pending'`);
      await tg('sendMessage', {
        chat_id: m.chat.id, parse_mode: 'HTML', reply_markup: MENU,
        text: `👋 Xush kelibsiz! Siz EduAnalyze administratori sifatida bog‘landingiz.\nEndi bu botni faqat sizning Telegram profilingiz boshqaradi.\n\n⏳ Kutilayotgan to‘lovlar: <b>${pending.n}</b>${pending.n ? ' — /pending' : ''}`,
      });
      return;
    }
    const isMenu = /^(📊|⏳|🧾|👥|💳|ℹ️|💬)/.test(text);
    if (text.startsWith('/') || isMenu) await handleCommand(m.chat.id, text);
    else await handleFreeText(m);
    return;
  }
  if (u.callback_query) {
    const q = u.callback_query;
    if (!(await isAdmin(q.from))) {
      await tg('answerCallbackQuery', { callback_query_id: q.id, text: '⛔ Ruxsat yo‘q', show_alert: true }).catch(() => {});
      return;
    }
    const [action, idStr] = String(q.data || '').split(':');
    const id = Number(idStr);
    if (action === 'rp' && id) {
      const u = await ctx.getUserBrief(id);
      await tg('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
      if (!u) return;
      await setPending({ type: 'reply', userId: id });
      await tg('sendMessage', { chat_id: q.from.id, parse_mode: 'HTML', text: `✍️ <b>${esc(u.full_name)}</b> ga javobingizni yozing.\nBekor qilish: /bekor`, reply_markup: { force_reply: true, input_field_placeholder: 'Javob matni' } });
      return;
    }
    if (!id || !['ap', 'rj'].includes(action)) return tg('answerCallbackQuery', { callback_query_id: q.id });
    const result = await ctx.onDecision(id, action === 'ap' ? 'approved' : 'rejected', q.message?.message_id);
    await tg('answerCallbackQuery', {
      callback_query_id: q.id,
      text: result.ok ? (action === 'ap' ? '✅ Tasdiqlandi' : '❌ Rad etildi') : result.error,
      show_alert: !result.ok,
    }).catch(() => {});
    if (result.ok && action === 'rj') {
      await setPending({ type: 'reject', paymentId: id });
      await tg('sendMessage', {
        chat_id: q.from.id, parse_mode: 'HTML',
        text: `❌ To‘lov #${id} rad etildi.\n✍️ Foydalanuvchiga yuboriladigan <b>sababni</b> yozing.\nSababsiz yuborish: /skip`,
        reply_markup: { force_reply: true, input_field_placeholder: 'Rad etish sababi' },
      });
    }
  }
}

async function poll() {
  let offset = Number(await ctx.getSetting('tg_offset')) || 0;
  while (running) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        try { await handleUpdate(u); } catch (e) { console.error('[bot] update xatosi:', e.message); }
      }
      if (updates.length) await ctx.setSetting('tg_offset', String(offset));
    } catch (e) {
      if (!running) break;
      // 409 — boshqa nusxa (masalan, ikkinchi server) ham so'rov yubormoqda
      console.error('[bot]', e.code === 409 ? 'boshqa server nusxasi botni ishlatmoqda — kutilmoqda' : e.message);
      await new Promise((r) => setTimeout(r, e.code === 409 ? 15_000 : 5_000));
    }
  }
}

export async function startBot(context) {
  ctx = context;
  if (!TOKEN || process.env.EDU_BOT_DISABLED === '1') return;
  try {
    const me = await tg('getMe');
    botUsername = me.username;
    await tg('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
    await tg('setMyCommands', { commands: [
      { command: 'stats', description: 'Statistika va tushum' },
      { command: 'pending', description: 'Kutilayotgan to‘lovlar' },
      { command: 'tolovlar', description: 'Oxirgi to‘lovlar' },
      { command: 'users', description: 'Foydalanuvchilar' },
      { command: 'sozlamalar', description: 'Narx va karta' },
      { command: 'help', description: 'Yordam' },
    ] }).catch(() => {});
    running = true;
    console.log(`Telegram bot: @${botUsername} (admin: @${ADMIN_USERNAME})`);
    poll();
  } catch (e) {
    console.error('[bot] ishga tushmadi:', e.message);
  }
}

export function stopBot() { running = false; }
