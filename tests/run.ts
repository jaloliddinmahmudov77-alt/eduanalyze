/* EduAnalyze avtomatik testlari: hisob-kitob, Excel eksport va qayta import. */
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeClass, computeStudent, parseScore, validateScore } from '../client/src/lib/calc';
import { buildReportWorkbook, colLetter, parseReportXlsx } from '../client/src/lib/excel';
import { extractNames, namesFromText } from '../client/src/lib/importStudents';
import { updateCriterion } from '../client/src/lib/ops';
import type { ReportData, ReportMeta } from '../client/src/lib/types';

let fails = 0;
let passes = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) passes++;
  else { fails++; console.error('  ✗', msg); }
};
const near = (a: number, b: number, msg: string) => ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

const meta: ReportMeta = {
  school: '12-son maktab', className: '6-A', groupName: 'II', academicYear: '2026/2027',
  subject: 'Ingliz tili', controlType: 'CHSB-I', teacherName: 'Mahmudov Jasurbek Jo‘raboy o‘g‘li',
};
const data: ReportData = {
  criteria: [
    { id: 'L', name: 'Listening', max: 6, type: 'bilish' },
    { id: 'R', name: 'Reading', max: 28, type: 'qollash' },
    { id: 'W', name: 'Writing', max: 6, type: 'mulohaza' },
    { id: 'G', name: 'Grammar', max: 10, type: 'bilish' },
  ],
  students: [
    { id: 'a', name: 'Abdullayev Sardor', scores: { L: 6, R: 28, W: 6, G: 10 } },
    { id: 'b', name: 'Karimova Malika', scores: { L: 3, R: 14, W: 3, G: 5 } },
    { id: 'c', name: 'Toshmatov Bekzod', scores: {} },
    { id: 'd', name: 'O‘ktamova Nilufar', scores: { L: 4.5, R: 20, G: 7 } },
    { id: 'e', name: 'Rahimov Jasur', scores: { L: 0, R: 0, W: 0, G: 0 } },
  ],
};

console.log('1) Hisob-kitoblar');
{
  const d = computeStudent(data.criteria, data.students[3]);
  near(d.total, 31.5, 'D total');
  near(d.percent, (31.5 / 44) * 100, 'D % (bo‘sh Writing hisobga kirmaydi)');
  near(d.comp.bilish, (11.5 / 16) * 100, 'D bilish');
  near(d.comp.qollash, (20 / 28) * 100, 'D qollash');
  near(d.comp.mulohaza, 0, 'D mulohaza');
  ok(!computeStudent(data.criteria, data.students[2]).participated, 'bo‘sh o‘quvchi qatnashmagan');
  ok(computeStudent(data.criteria, data.students[4]).participated, 'nol ballik o‘quvchi qatnashgan');
  const c = computeClass(data);
  ok(c.participants === 4, 'qatnashganlar 4');
  near(c.totalSum, 106.5, 'sinf jami');
  near(c.totalMax, 194, 'sinf max');
  near(c.percent, (106.5 / 194) * 100, 'sinf %');
  near(c.criterionPercent.L, (13.5 / 24) * 100, 'Listening %');
  near(c.compPercent.bilish, ((13.5 + 22) / 64) * 100, 'Bilish sinf %');
  near(c.compPercent.mulohaza, (9 / 18) * 100, 'Mulohaza sinf % (3 ta baholangan)');
  near(c.criterionPercent.W, 50, 'Writing % faqat baholanganlar bo‘yicha');
  // Regressiya: 2 mezon (6 va 10), o'quvchi faqat birinchisidan 5 ball olgan → 5/6, 5/16 emas
  const reg = { criteria: [{ id: 'A', name: 'Bilish', max: 6, type: 'bilish' as const }, { id: 'B', name: 'Mezon 2', max: 10, type: 'bilish' as const }],
    students: [{ id: 'x', name: 'Ali', scores: { A: 5 } }, { id: 'y', name: 'Vali', scores: { A: 6 } }] };
  near(computeStudent(reg.criteria, reg.students[0]).percent, (5 / 6) * 100, 'regressiya: 5/6 = 83%');
  near(computeStudent(reg.criteria, reg.students[0]).comp.bilish, (5 / 6) * 100, 'regressiya: Bilish 83%');
  near(computeClass(reg).percent, (11 / 12) * 100, 'regressiya: sinf 11/12');
  near(computeClass(reg).criterionPercent.B, 0, 'regressiya: baholanmagan mezon 0%');
  near(computeStudent(reg.criteria, { id: 'z', name: 'z', scores: { A: 5, B: 0 } }).percent, (5 / 16) * 100, 'nol ball hisobga kiradi');
  const noMul = { ...data, criteria: data.criteria.filter((x) => x.type !== 'mulohaza') };
  near(computeClass(noMul).compPercent.mulohaza, 0, 'mezoni yo‘q kompetensiya 0');
  ok(validateScore(7, data.criteria[0]) !== null, '>max rad etiladi');
  ok(validateScore(-1, data.criteria[0]) !== null, 'manfiy rad etiladi');
  ok(validateScore(parseScore('4,5'), data.criteria[0]) === null && parseScore('4,5') === 4.5, 'vergulli son');
  ok(Number.isNaN(parseScore('abc') as number), 'matn rad etiladi');
  let threw = false;
  try { updateCriterion(data, 'R', { max: 20 }); } catch { threw = true; }
  ok(threw, 'max balli mavjud balldan kichik qilib bo‘lmaydi');
  const full = { ...data, students: [{ id: 'x', name: 'x', scores: { L: 6, R: 28, W: 6, G: 10 } }] };
  ok(computeClass(full).percent <= 100, 'foiz 100 dan oshmaydi');
}

console.log('2) Excel eksport');
const out = join(import.meta.dirname, 'out');
mkdirSync(out, { recursive: true });
const wb = await buildReportWorkbook(meta, data);
const ws = wb.worksheets[0];
const file = join(out, 'sample.xlsx');
writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()));
const hr = 6, ds = 7, jr = 12, fr = 13;
const fill = (a: number, b: number) => (ws.getCell(a, b).fill as { fgColor?: { argb?: string } }).fgColor?.argb;
ok(ws.getCell('B1').value === ['Sinf: 6-A (II-guruh) 2026/2027 o‘quv yili', 'Fan: Ingliz tili CHSB-I', 'o‘qituvchining FIO: Mahmudov Jasurbek Jo‘raboy o‘g‘li'].join('\n'), `sarlavha: ${ws.getCell('B1').value}`);
ok(fill(1, 2) === 'FFD9D9D9' && ws.getCell('K4').isMerged, 'kulrang birlashtirilgan sarlavha');
ok(ws.getCell(hr, 1).value === 'T/r' && ws.getCell(hr, 3).value === 6 && ws.getCell(hr, 4).value === 28, 'sarlavhada maksimal ballar');
ok(ws.getCell(hr, 8).value === 'Foiz  %' && ws.getCell(hr, 9).value === 'Bilish' && ws.getCell(hr, 10).value === 'Qo‘llash' && ws.getCell(hr, 11).value === 'Mulohaza', 'kompetensiya ustunlari');
ok(String(ws.getCell(hr, 3).note) === 'Listening — Bilish', 'mezon nomi izohda');
ok(ws.getCell(ds, 2).value === 'Abdullayev Sardor' && ws.getCell(ds + 2, 3).value === null, 'ism va bo‘sh katak');
ok(ws.getCell(jr, 2).value === 'Jami' && ws.getCell(fr, 2).value === 'Foizi %', 'Jami / Foizi % qatorlari');
ok(ws.getCell(ds, 3).font?.name === 'Times New Roman', 'Times New Roman');
ok(fill(hr, 3) === 'FFFFFF00' && fill(hr, 11) === 'FFFFFF00' && fill(hr, 2) === 'FFFFFFFF', 'sarlavha sariq (mezondan oxirigacha)');
ok(fill(ds, 3) === 'FFFFFFFF', 'ma’lumotlar oq');
ok(ws.getCell(ds, 3).font?.bold && !ws.getCell(ds, 7).font?.bold, 'ballar qalin');
ok(ws.getCell(ds, 3).border?.top?.style === 'thin', 'chegaralar');
ok(ws.getCell(ds, 2).alignment?.horizontal === 'left' && ws.getCell(ds, 8).alignment?.horizontal === 'right', 'tekislash');
ok(ws.getCell(jr, 3).font?.bold && ws.getCell(fr, 3).font?.bold, 'Jami va Foiz qalin');
ok(ws.getCell(ds, 8).numFmt === '0%' && ws.getCell(fr, 3).numFmt === '0%', 'foiz formati');
ok(typeof (ws.getCell(ds, 7).value as { formula?: string }).formula === 'string', 'formula mavjud');
ok(wb.getWorksheet('EduAnalyze')?.state === 'veryHidden', 'yashirin meta varaq');

console.log('3) Qayta import');
const parsed = await parseReportXlsx((await wb.xlsx.writeBuffer()) as ArrayBuffer);
ok(parsed.data.criteria.map((c) => c.id).join() === 'L,R,W,G', 'mezonlar va id lar');
ok(parsed.data.criteria.map((c) => c.name + c.type).join() === 'Listeningbilish,Readingqollash,Writingmulohaza,Grammarbilish', 'nom va tur');
ok(parsed.data.criteria[1].max === 28, 'max');
ok(parsed.data.students.length === 5, `o‘quvchilar soni ${parsed.data.students.length}`);
ok(parsed.data.students[3].scores.L === 4.5 && parsed.data.students[3].scores.W === undefined, 'ballar');
ok(parsed.meta.className === '6-A' && parsed.meta.subject === 'Ingliz tili' && parsed.meta.controlType === 'CHSB-I', 'meta');
near(computeClass(parsed.data).percent, (106.5 / 194) * 100, 'importdan keyin sinf %');
{
  // O'qituvchining o'z namunasi kabi fayl (yashirin varaqsiz, izohsiz) — qayta yuklash
  const w2 = new ExcelJS.Workbook();
  const s2 = w2.addWorksheet('11-B');
  s2.mergeCells('B1:I4');
  s2.getCell('B1').value = ['Sinf: 11-B (II-guruh) 2026/2027 o‘quv yili', 'Fan: Informatika CHSB-I', "o‘qituvchining FIO: Ergashev To'lqin"].join('\n');
  s2.getRow(6).values = ['T/r', 'O`quvchining ism familiyasi', 6, 24, 10, 40, 'Foiz  %', 'Bilish', "Qo'llash", 'Mulohaza'];
  s2.getRow(7).values = [1, 'Тошматов Ўткирбек', 6, 20, 4, { formula: 'SUM(C7:E7)' }, 0.75];
  s2.getRow(8).values = [2, 'Қодирова Гулноза', 6, 24, 10];
  s2.getRow(9).values = [3];
  s2.getRow(10).values = [4];
  s2.getRow(11).values = [null, 'Jami', 12, 44, 14];
  const p2 = await parseReportXlsx((await w2.xlsx.writeBuffer()) as ArrayBuffer);
  ok(p2.data.criteria.map((c) => c.max + c.type).join() === '6bilish,24qollash,10mulohaza', `namuna mezonlari ${p2.data.criteria.map((c) => c.max + c.type)}`);
  ok(p2.data.students.length === 2 && p2.data.students[0].name === 'Тошматов Ўткирбек', 'namuna o‘quvchilari (bo‘sh qatorlar tashlandi)');
  ok(p2.meta.className === '11-B' && p2.meta.groupName === 'II-guruh' && p2.meta.subject === 'Informatika' && p2.meta.teacherName === "Ergashev To'lqin", `namuna meta ${JSON.stringify(p2.meta)}`);
  near(computeStudent(p2.data.criteria, p2.data.students[0]).comp.mulohaza, 40, 'namuna: Mulohaza 40%');
  near(computeStudent(p2.data.criteria, p2.data.students[0]).comp.qollash, (20 / 24) * 100, 'namuna: Qo‘llash 83%');
}

console.log('4) O‘quvchilar ro‘yxatini aniqlash');
{
  const r1 = extractNames([['№', 'F.I.Sh.', 'Yil'], [1, 'Abdullayev Sardor', 2014], [2, 'Karimova Malika', 2014], ['Jami', '', '']]);
  ok(r1.names.length === 2 && r1.names[1].name === 'Karimova Malika', 'F.I.Sh. sarlavhasi');
  const r2 = extractNames([['Sinf ro‘yxati'], ['T/r', 'Familiya', 'Ism'], [1, 'Abdullayev', 'Sardor'], [2, 'Karimova', 'Malika']]);
  ok(r2.names.map((n) => n.name).join('|') === 'Abdullayev Sardor|Karimova Malika', 'Familiya + Ism ustunlari');
  const r3 = extractNames([[1, 'Abdullayev Sardor', 5], [2, 'Karimova Malika', 4]]);
  ok(r3.names.length === 2, 'sarlavhasiz ro‘yxat');
  ok(namesFromText('1. Ali Valiyev\n2) Vali Aliyev\n\n').length === 2, 'matndan');
}

// Haqiqiy Excel'da tekshirish uchun kutilgan qiymatlar (tests/excel-verify.ps1)
const T = colLetter(7), P = colLetter(8), B = colLetter(9), Q = colLetter(10), M = colLetter(11);
const c = computeClass(data);
const res = data.students.map((s) => computeStudent(data.criteria, s));
const expect: Record<string, number | string> = {
  [`${T}${hr}`]: 50,
  [`${T}${ds}`]: 50, [`${P}${ds}`]: 1,
  [`${T}${ds + 1}`]: 25, [`${P}${ds + 1}`]: 0.5,
  [`${T}${ds + 2}`]: '', [`${P}${ds + 2}`]: '',
  [`${T}${ds + 3}`]: 31.5, [`${P}${ds + 3}`]: 31.5 / 44, [`${B}${ds + 3}`]: res[3].comp.bilish / 100,
  [`${Q}${ds + 3}`]: res[3].comp.qollash / 100, [`${M}${ds + 3}`]: 0,
  [`${T}${ds + 4}`]: 0,
  [`C${jr}`]: 13.5, [`${T}${jr}`]: 106.5, [`${B}${jr}`]: 35.5, [`${M}${jr}`]: 9,
  [`C${fr}`]: c.criterionPercent.L / 100, [`${T}${fr}`]: c.percent / 100, [`D${fr}`]: c.criterionPercent.R / 100, [`E${fr}`]: 0.5,
  [`${B}${fr}`]: c.compPercent.bilish / 100, [`${Q}${fr}`]: c.compPercent.qollash / 100, [`${M}${fr}`]: c.compPercent.mulohaza / 100,
};
const d2: ReportData = JSON.parse(JSON.stringify(data));
d2.students[1].scores.R = 28;
d2.students[2].scores.L = 6;
const c2 = computeClass(d2);
const mutate = {
  set: { [`D${ds + 1}`]: 28, [`C${ds + 2}`]: 6 },
  expect: {
    [`${T}${ds + 1}`]: 39, [`${P}${ds + 1}`]: 0.78, [`${T}${ds + 2}`]: 6, [`${P}${ds + 2}`]: 1,
    [`${T}${jr}`]: c2.totalSum, [`${T}${fr}`]: c2.percent / 100, [`${Q}${fr}`]: c2.compPercent.qollash / 100,
  },
};
writeFileSync(join(out, 'expect.json'), JSON.stringify({ file, expect, mutate }, null, 1));

console.log(`\nNatija: ${passes} ta o‘tdi, ${fails} ta xato`);
process.exit(fails ? 1 : 0);
