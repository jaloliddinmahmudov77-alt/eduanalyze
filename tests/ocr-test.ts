// OCR regressiya testi: haqiqiy screenshot (11-B Informatika) -> kutilgan jadval.  npm run test:ocr
import { existsSync, readFileSync } from 'node:fs';
import { detectGrid, recognizeGridTable } from '../client/src/lib/scan/tableGrid';
import { buildReview, unresolvedCount } from '../client/src/lib/scan/review';
import { loadPng, nodeReader } from './ocr-grid';

let fails = 0, passes = 0;
const ok = (c: unknown, m: string) => { if (c) passes++; else { fails++; console.error('  ✗', m); } };

// Rasmda haqiqiy o'quvchilar ma'lumoti bor, shuning uchun u repozitoriyga qo'shilmagan (faqat mahalliy).
if (!existsSync('tests/fixtures/sample-11B.png') || !existsSync('tests/fixtures/sample-11B.expected.json')) {
  console.log('OCR testi o‘tkazib yuborildi: tests/fixtures/sample-11B.png topilmadi (shaxsiy ma’lumot — repozitoriyda yo‘q)');
  process.exit(0);
}
const img = loadPng('tests/fixtures/sample-11B.png');
const grid = detectGrid(img);
ok(grid && grid.xs.length - 1 === 10, `ustunlar soni 10 (${grid && grid.xs.length - 1})`);
const { reader, close } = await nodeReader();
const t = await recognizeGridTable(img, grid!, reader);
await close();
// kutilgan natija ham shaxsiy ma'lumot — mahalliy faylda (repozitoriyda yo'q)
const expected: [string, number, number, number][] = JSON.parse(readFileSync('tests/fixtures/sample-11B.expected.json', 'utf8'));
ok(t.columns.slice(0, 3).map((c) => `${c.kind}${c.max}`).join() === 'score6,score24,score10', `mezon ustunlari va max: ${t.columns.slice(0, 3).map((c) => c.kind + c.max)}`);
ok(t.columns[3].kind === 'total', 'jami ustuni aniqlandi');
ok(t.columns.slice(5).map((c) => c.kind).join() === 'bilish,qollash,mulohaza', 'kompetensiya ustunlari');
ok(t.rows.length === 14, `o‘quvchilar soni 14 (${t.rows.length})`);
let correct = 0, wrongUnflagged = 0;
expected.forEach(([name, a, b, c], i) => {
  const r = t.rows[i];
  if (!r) return;
  ok(r.name === name, `ism: ${r.name} != ${name}`);
  [a, b, c].forEach((v, j) => {
    const cell = r.cells[j];
    if (cell.value === v) correct++;
    else if (cell.confidence >= 0.75) wrongUnflagged++;
  });
});
ok(wrongUnflagged === 0, `belgilanmagan xato ballar: ${wrongUnflagged}`);
ok(correct >= 40, `to‘g‘ri o‘qilgan ballar: ${correct}/42`);
const review = buildReview([{ page: 1, table: t }], { criteria: [], students: [] });
ok(unresolvedCount(review) >= 42 - correct, 'xato ballar tekshirishga belgilangan');
ok(review.rows.some((r) => r.rowFlags.some((f) => f.startsWith('Jami mos emas'))), 'rasmdagi jami bilan nomuvofiqlik topildi');
console.log(`OCR testi: ${passes} ta o‘tdi, ${fails} ta xato (to‘g‘ri ballar ${correct}/42)`);
process.exit(fails ? 1 : 0);
