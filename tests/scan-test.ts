// Skaner mantiqi testlari: ko'p sahifa, takrorlar, AI/OCR solishtirish, jadvalga qo'llash, backend AI (mock Gemini).
//   npm run test:scan
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeStudent } from '../client/src/lib/calc';
import { applyReview, buildReview, normalizeAiTable, unresolvedCount } from '../client/src/lib/scan/review';
import { parseNumberToken } from '../client/src/lib/scan/tableParse';
import type { ScanTable } from '../client/src/lib/scan/types';
import type { ReportData } from '../client/src/lib/types';

let fails = 0, passes = 0;
const ok = (c: unknown, m: string) => { if (c) passes++; else { fails++; console.error('  ✗', m); } };
const cell = (v: number | null, conf = 0.95, raw?: string) => ({ value: v, raw: raw ?? (v === null ? '' : String(v)), confidence: conf });
const cols = [{ label: '6', max: 6, kind: 'score' as const }, { label: '28', max: 28, kind: 'score' as const }, { label: '34', max: 34, kind: 'total' as const }];

console.log('1) Raqam tokenlari');
ok(parseNumberToken('14').value === 14 && !parseNumberToken('14').fixed, 'oddiy son');
ok(parseNumberToken('4,5').value === 4.5, 'vergulli');
ok(parseNumberToken('75%').pct && parseNumberToken('75%').value === 75, 'foiz');
ok(parseNumberToken('l4').value === 14 && parseNumberToken('l4').fixed, 'l→1 tuzatiladi, lekin belgilanadi');
ok(parseNumberToken('abc').value === null, 'matn son emas');

console.log('2) Ko‘p sahifa va takrorlar');
const page1: ScanTable = { engine: 'ocr', columns: cols, rows: [
  { index: 1, name: 'Aliyev Ali', nameConfidence: 0.95, cells: [cell(6), cell(14), cell(20)] },
  { index: 2, name: 'Valiyeva Madina', nameConfidence: 0.95, cells: [cell(4), cell(null, 0.1, '?'), cell(24)] },
] };
const page2: ScanTable = { engine: 'ocr', columns: cols, rows: [
  { index: 3, name: 'Karimov Aziz', nameConfidence: 0.95, cells: [cell(5), cell(25), cell(31)] },
  { index: 4, name: 'Aliyev  Ali', nameConfidence: 0.95, cells: [cell(6), cell(14), cell(20)] }, // takror
  { index: 5, name: 'Karimova Aziza', nameConfidence: 0.95, cells: [cell(9), cell(10, 0.5), cell(19)] }, // 9 > max 6
] };
const empty: ReportData = { criteria: [], students: [] };
let rv = buildReview([{ page: 1, table: page1 }, { page: 2, table: page2 }], empty);
ok(rv.rows.length === 5, 'barcha qatorlar birlashtirildi');
ok(rv.rows.map((r) => r.page).join() === '1,1,2,2,2', 'qaysi sahifadan olingani saqlanadi');
const dup = rv.rows[3];
ok(!dup.include && dup.rowFlags.some((f) => f.includes('1-sahifada')), 'takror o‘quvchi aniqlandi va chiqarildi');
ok(rv.rows[4].include && rv.rows[4].name === 'Karimova Aziza', 'o‘xshash, lekin boshqa ism birlashtirilmadi');
ok(rv.rows[1].cells[1].flag?.startsWith('O‘qib bo‘lmadi'), 'o‘qilmagan katak belgilandi');
ok(rv.rows[4].cells[0].flag?.startsWith('Maksimal ball'), 'maksimaldan katta ball belgilandi');
ok(rv.rows[4].cells[1].flag === 'Ishonch past — tekshiring', 'ishonchi past katak belgilandi');
ok(rv.rows[1].cells[0].flag === null, 'yaxshi katak belgilanmagan');
ok(rv.columns.map((c) => c.target).join() === 'new,new,ignore', 'ball ustunlari yangi mezon, jami — e’tiborsiz');
ok(rv.columns[0].newType === 'bilish' && rv.columns[1].max === 28, 'max ball sarlavhadan olindi');
ok(rv.rows[2].rowFlags.some((f) => f.startsWith('Jami mos emas')), 'rasmdagi jami bilan nomuvofiqlik (5+25≠31)');
ok(unresolvedCount(rv) === 3, `tekshirilmagan kataklar: ${unresolvedCount(rv)}`);

console.log('3) Jadvalga qo‘llash');
let res = applyReview(empty, rv);
ok(res.data.criteria.length === 2 && res.data.criteria[1].max === 28, 'mezonlar yaratildi');
ok(res.added === 4 && res.data.students.length === 4, 'takror qo‘shilmadi (4 o‘quvchi)');
ok(res.skippedCells === 3, 'belgilangan kataklar avtomatik tasdiqlanmadi');
const [c1, c2] = res.data.criteria;
const madina = res.data.students.find((s) => s.name === 'Valiyeva Madina')!;
ok(madina.scores[c1.id] === 4 && madina.scores[c2.id] === undefined, 'o‘qilmagan ball taxmin qilinmadi');
const aziza = res.data.students.find((s) => s.name === 'Karimova Aziza')!;
ok(aziza.scores[c1.id] === undefined, 'maksimaldan katta ball qo‘shilmadi');
const ali = res.data.students.find((s) => s.name === 'Aliyev Ali')!;
ok(Math.abs(computeStudent(res.data.criteria, ali).percent - (20 / 34) * 100) < 1e-9, 'foiz avtomatik hisoblanadi');
// mavjud o'quvchilarga ism bo'yicha biriktirish (ikkinchi skan)
rv = buildReview([{ page: 1, table: page1 }], res.data);
ok(rv.rows[0].target === ali.id && rv.columns[0].target === c1.id, 'mavjud o‘quvchi va mezonga moslandi');
rv.rows[1].cells[1] = { value: 27, raw: '27', confidence: 1, flag: null }; // o'qituvchi tuzatdi
const res2 = applyReview(res.data, rv);
ok(res2.added === 0 && res2.updated === 2, 'yangi o‘quvchi qo‘shilmadi, mavjudlar yangilandi');
ok(res2.data.students.find((s) => s.id === madina.id)!.scores[c2.id] === 27, 'tuzatilgan qiymat to‘g‘ri o‘quvchiga yozildi');
let threw = '';
rv.columns[0].target = c2.id; rv.columns[1].target = c2.id;
try { applyReview(res.data, rv); } catch (e) { threw = (e as Error).message; }
ok(threw.includes('bitta mezonga'), 'ikki ustun bitta mezonga moslanmaydi');

{
  // Yangi mezon so'ralmaydi: mavjud mezonlar bo'lsa ortiqcha ustun e'tiborsiz, maks. bal yo'q bo'lsa avtomatik
  const extra: ScanTable = { engine: 'ocr', columns: [...cols.slice(0, 2), { label: '10', max: 10, kind: 'score' }, cols[2]], rows: [
    { index: 1, name: 'Aliyev Ali', nameConfidence: 0.95, cells: [cell(6), cell(14), cell(9), cell(29)] }] };
  const rvx = buildReview([{ page: 1, table: extra }], res.data);
  ok(rvx.columns.map((c) => c.target).join() === `${c1.id},${c2.id},ignore,ignore`, 'mavjud mezonlar bor — ortiqcha ustun yangi mezon bo‘lmaydi');
  ok(!rvx.columns.some((c) => c.target === 'new'), 'yangi mezon taklif qilinmadi');
  const noMax: ScanTable = { engine: 'ocr', columns: [{ label: '1-ustun', max: null, kind: 'score' }, { label: '2-ustun', max: 20, kind: 'score' }], rows: [
    { index: 1, name: 'Ali', nameConfidence: 0.95, cells: [cell(7), cell(15)] }, { index: 2, name: 'Vali', nameConfidence: 0.95, cells: [cell(9), cell(18)] }] };
  const rvn = buildReview([{ page: 1, table: noMax }], empty);
  const resn = applyReview(empty, rvn);
  ok(resn.data.criteria.length === 2 && resn.data.criteria[0].max === 9 && resn.data.criteria[1].max === 20, 'maks. bal yo‘q bo‘lsa so‘ralmaydi — avtomatik olinadi');
  ok(resn.warnings.some((w) => w.includes('9 deb olindi')), 'bu haqda ogohlantirish beriladi');
}

console.log('4) AI natijasi va solishtirish');
const aiRaw = { columns: [{ label: '6', max: 6, kind: 'score' }, { label: '28', max: 28, kind: 'score' }, { label: 'x', kind: 'weird' }],
  rows: [{ name: 'Aliyev Ali', cells: [{ value: 6, raw: '6', confidence: 0.98 }, { value: 18, raw: '18', confidence: 0.9 }] },
    { name: 'Valiyeva Madina', cells: [{ value: 4, raw: '4', confidence: 0.97 }, { value: null, raw: '?', confidence: 0.2 }] },
    { name: '', cells: [] }] };
const aiTable = normalizeAiTable(aiRaw);
ok(aiTable.rows.length === 2 && aiTable.columns[2].kind === 'other', 'AI javobi tozalandi (noma’lum tur, ismsiz qator)');
ok(aiTable.rows[0].cells.length === 3, 'kataklar soni ustunlarga tenglashtirildi');
rv = buildReview([{ page: 1, table: aiTable, compare: page1 }], empty);
ok(rv.rows[0].cells[1].flag?.includes('farq') && rv.rows[0].cells[1].alt === 14, 'AI (18) va OCR (14) farqi belgilandi');
ok(rv.rows[0].cells[0].flag === null, 'mos kelgan katak belgilanmadi');
ok(rv.rows[1].cells[1].flag !== null, 'AI ham o‘qimagan katak belgilangan');

console.log('5) Backend AI (mock Gemini)');
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    const okReq = req.headers['x-goog-api-key'] === 'test-key' && j.contents?.[0]?.parts?.[1]?.inline_data?.mime_type === 'image/jpeg' && j.generationConfig?.responseMimeType === 'application/json';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(okReq ? { candidates: [{ content: { parts: [{ text: JSON.stringify(aiRaw) }] } }] } : { error: { message: 'bad request' } }));
  });
}).listen(0);
const mockPort = (mock.address() as { port: number }).port;
const port = 5995;
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
  env: { ...process.env, EDU_PORT: String(port), EDU_DB_PATH: join(tmpdir(), `edu-scan-${Date.now()}.db`), GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: `http://127.0.0.1:${mockPort}` },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 1500));
try {
  const B = `http://127.0.0.1:${port}/api`;
  const login = await (await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'teacher', password: 'teacher123' }) })).json();
  const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
  const st = await (await fetch(`${B}/ai/status`, { headers: H })).json();
  ok(st.gemini === true && typeof st.model === 'string', 'AI holati: yoqilgan');
  ok(!JSON.stringify(st).includes('test-key'), 'API kalit frontendga chiqmaydi');
  const r1 = await fetch(`${B}/ai/extract`, { method: 'POST', headers: H, body: JSON.stringify({ image: 'aGVsbG8=', mimeType: 'image/jpeg' }) });
  const j1 = await r1.json();
  ok(r1.ok && j1.result?.rows?.length === 3, `AI orqali jadval olindi (${r1.status})`);
  const r2 = await fetch(`${B}/ai/extract`, { method: 'POST', headers: H, body: JSON.stringify({ image: 'aGVsbG8=', mimeType: 'application/pdf' }) });
  ok(r2.status === 400, 'faqat rasm turlari qabul qilinadi');
  const r3 = await fetch(`${B}/ai/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: 'x', mimeType: 'image/jpeg' }) });
  ok(r3.status === 401, 'kirmagan foydalanuvchi AI’dan foydalana olmaydi');
} finally {
  srv.kill();
  mock.close();
}

console.log(`\nSkaner testlari: ${passes} ta o‘tdi, ${fails} ta xato`);
process.exit(fails ? 1 : 0);
