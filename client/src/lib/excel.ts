import ExcelJS from 'exceljs';
import { computeClass, computeStudent, isScore, maxTotal, uid, validateScore } from './calc';
import {
  COMPETENCES, COMPETENCE_LABEL, CONTROL_TYPES, type Competence, type ControlType, type Criterion,
  type ReportData, type ReportMeta, type Student,
} from './types';

/*
 * Rasmiy hisobot maketi (o'qituvchi yuborgan namuna asosida):
 *
 *   1–4-qatorlar : B:oxirgi ustun birlashtirilgan kulrang blok — Sinf / Fan / o‘qituvchining FIO
 *   6-qator      : T/r | O‘quvchining ism familiyasi | <mezonlar maks. bali> | <jami maks.> | Foiz % | Bilish | Qo‘llash | Mulohaza
 *                  (mezonlardan oxirigacha sariq, qalin)
 *   7-qator...   : o‘quvchilar (ballar qalin), Foiz/kompetensiyalar 0% formatida
 *   keyin        : Jami, Foizi %, imzolar
 */

const FONT = 'Times New Roman';
const META_SHEET = 'EduAnalyze';
const YELLOW = 'FFFFFF00';
const GRAY = 'FFD9D9D9';
const BLACK = { argb: 'FF000000' };
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: BLACK },
  left: { style: 'thin', color: BLACK },
  bottom: { style: 'thin', color: BLACK },
  right: { style: 'thin', color: BLACK },
};
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function groupLabel(g: string) {
  const t = g.trim();
  if (!t) return '';
  return /guruh/i.test(t) ? t : `${t}-guruh`;
}

export function titleLines(meta: ReportMeta) {
  const group = groupLabel(meta.groupName);
  return {
    sinf: `Sinf: ${meta.className}${group ? ` (${group})` : ''}${meta.academicYear ? ` ${meta.academicYear} o‘quv yili` : ''}`,
    fan: `Fan: ${meta.subject} ${meta.controlType}`,
    fio: `o‘qituvchining FIO: ${meta.teacherName}`,
  };
}

export function reportFileName(meta: ReportMeta) {
  const base = `${meta.className}${meta.groupName ? ' ' + groupLabel(meta.groupName) : ''} ${meta.subject} ${meta.controlType}`;
  return `${base.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_')}.xlsx`;
}

/** Hisobot maketidagi qator raqamlari (testlar va import uchun ham) */
export const LAYOUT = { headerRow: 6, firstDataRow: 7 } as const;

/** Rasmiy hisobot ko'rinishidagi .xlsx (haqiqiy formulalar bilan) */
export async function buildReportWorkbook(meta: ReportMeta, data: ReportData): Promise<ExcelJS.Workbook> {
  const { criteria, students } = data;
  if (!criteria.length) throw new Error('Kamida bitta baholash mezoni bo‘lishi kerak');
  if (!students.length) throw new Error('Kamida bitta o‘quvchi bo‘lishi kerak');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduAnalyze';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet(`${meta.className} ${meta.controlType}`.replace(/[\\/?*[\]:]/g, '-').slice(0, 31), {
    pageSetup: {
      paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      horizontalCentered: true,
    },
  });

  const n = criteria.length;
  const C1 = 3; // birinchi mezon ustuni
  const CN = C1 + n - 1;
  const colT = CN + 1; // jami (sarlavhada umumiy maksimal ball)
  const colP = CN + 2; // Foiz %
  const colComp: Record<Competence, number> = { bilish: CN + 3, qollash: CN + 4, mulohaza: CN + 5 };
  const lastCol = CN + 5;
  const L = colLetter;
  const T = L(colT);

  const hr = LAYOUT.headerRow;
  const ds = LAYOUT.firstDataRow;
  const de = ds + students.length - 1;
  const jr = de + 1; // Jami
  const fr = de + 2; // Foizi %

  const cls = computeClass(data);
  const mt = maxTotal(criteria);
  const compCols = (k: Competence) => criteria.map((c, i) => (c.type === k ? C1 + i : 0)).filter(Boolean);
  const allCols = criteria.map((_c, i) => C1 + i);
  // Bo'sh katak = baholanmagan: maksimal ballga faqat ball kiritilgan mezonlar qo'shiladi
  const rowMaxExpr = (cols: number[], row: number) => cols.map((x) => `IF(${L(x)}${row}="",0,${L(x)}$${hr})`).join('+');
  // Sinf bo'yicha: har mezon maks. bali x shu mezon bo'yicha baholanganlar soni
  const classMaxExpr = (cols: number[]) => cols.map((x) => `${L(x)}$${hr}*COUNT(${L(x)}${ds}:${L(x)}${de})`).join('+');

  // --- Sarlavha bloki (kulrang) ---
  const lines = titleLines(meta);
  ws.mergeCells(1, 2, 4, lastCol);
  const title = ws.getCell(1, 2);
  title.value = `${lines.sinf}\n${lines.fan}\n${lines.fio}`;
  title.font = { name: FONT, size: 12, color: BLACK };
  title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  title.fill = solid(GRAY);
  for (let r = 1; r <= 4; r++) ws.getRow(r).height = 16.5;

  // --- Jadval sarlavhasi (bitta qator) ---
  ws.getCell(hr, 1).value = 'T/r';
  ws.getCell(hr, 2).value = 'O‘quvchining ism familiyasi';
  criteria.forEach((c, i) => {
    const cell = ws.getCell(hr, C1 + i);
    cell.value = c.max;
    cell.note = `${c.name} — ${COMPETENCE_LABEL[c.type]}`;
  });
  ws.getCell(hr, colT).value = { formula: `SUM(${L(C1)}${hr}:${L(CN)}${hr})`, result: mt };
  ws.getCell(hr, colP).value = 'Foiz  %';
  for (const k of COMPETENCES) ws.getCell(hr, colComp[k]).value = COMPETENCE_LABEL[k];

  // --- O'quvchilar ---
  students.forEach((s, i) => {
    const row = ds + i;
    const res = computeStudent(criteria, s);
    const blank = (v: number) => (res.participated ? v : '') as unknown as number;
    ws.getCell(row, 1).value = i + 1;
    ws.getCell(row, 2).value = s.name;
    criteria.forEach((c, j) => {
      const v = s.scores[c.id];
      ws.getCell(row, C1 + j).value = isScore(v) ? v : null;
    });
    const range = `${L(C1)}${row}:${L(CN)}${row}`;
    ws.getCell(row, colT).value = { formula: `IF(COUNT(${range})=0,"",SUM(${range}))`, result: blank(res.total) };
    const rm = `SUMPRODUCT(--(${range}<>""),${L(C1)}$${hr}:${L(CN)}$${hr})`;
    ws.getCell(row, colP).value = {
      formula: `IF(${T}${row}="","",IF(${rm}=0,0,MIN(1,${T}${row}/${rm})))`,
      result: blank(res.percent / 100),
    };
    for (const k of COMPETENCES) {
      const cc = compCols(k);
      const formula = cc.length
        ? `IF(${T}${row}="","",IF((${rowMaxExpr(cc, row)})=0,0,MIN(1,SUM(${cc.map((x) => `${L(x)}${row}`).join(',')})/(${rowMaxExpr(cc, row)}))))`
        : `IF(${T}${row}="","",0)`;
      ws.getCell(row, colComp[k]).value = { formula, result: blank(res.comp[k] / 100) };
    }
  });

  // --- Jami va Foizi % ---
  ws.getCell(jr, 2).value = 'Jami';
  ws.getCell(fr, 2).value = 'Foizi %';
  const pctFormula = (sumRef: string, cols: number[]) => `IF((${classMaxExpr(cols)})=0,0,MIN(1,${sumRef}/(${classMaxExpr(cols)})))`;
  criteria.forEach((c, i) => {
    const X = L(C1 + i);
    ws.getCell(jr, C1 + i).value = { formula: `SUM(${X}${ds}:${X}${de})`, result: cls.criterionSum[c.id] };
    ws.getCell(fr, C1 + i).value = { formula: pctFormula(`${X}${jr}`, [C1 + i]), result: cls.criterionPercent[c.id] / 100 };
  });
  ws.getCell(jr, colT).value = { formula: `SUM(${T}${ds}:${T}${de})`, result: cls.totalSum };
  ws.getCell(fr, colT).value = { formula: pctFormula(`${T}${jr}`, allCols), result: cls.percent / 100 };
  ws.mergeCells(fr, colT, fr, colP); // umumiy foiz "jami" va "Foiz %" ustunlari ostida
  for (const k of COMPETENCES) {
    const col = colComp[k];
    const cc = compCols(k);
    // Jami qatorida — shu kompetensiya bo'yicha to'plangan ballar yig'indisi
    ws.getCell(jr, col).value = cc.length ? { formula: cc.map((x) => `${L(x)}${jr}`).join('+'), result: cls.compSum[k] } : 0;
    ws.getCell(fr, col).value = cc.length
      ? { formula: pctFormula(`${L(col)}${jr}`, cc), result: cls.compPercent[k] / 100 }
      : 0;
  }

  // --- Formatlash ---
  const isPctCol = (col: number) => col === colP || COMPETENCES.some((k) => colComp[k] === col);
  for (let row = hr; row <= fr; row++) {
    for (let col = 1; col <= lastCol; col++) {
      const cell = ws.getCell(row, col);
      const isHeader = row === hr;
      const isFooter = row >= jr;
      const isCrit = col >= C1 && col <= CN;
      cell.border = BORDER;
      cell.fill = solid(isHeader && col >= C1 ? YELLOW : 'FFFFFFFF');
      cell.font = {
        name: FONT, size: 12, color: BLACK,
        bold: (isHeader && col >= C1) || (!isHeader && !isFooter && isCrit) || (isFooter && col >= C1),
      };
      let horizontal: ExcelJS.Alignment['horizontal'] = 'center';
      if (col === 2 && !isHeader) horizontal = 'left';
      else if (!isHeader && !isFooter && isPctCol(col)) horizontal = 'right';
      cell.alignment = { horizontal, vertical: 'middle', wrapText: isHeader, indent: col === 2 && !isHeader ? 1 : 0 };
      if (!isHeader && isPctCol(col) && row !== jr) cell.numFmt = '0%';
      if (row === fr && col >= C1) cell.numFmt = '0%';
    }
  }
  ws.getRow(hr).height = 34;

  // --- Ustun kengliklari ---
  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = Math.min(46, Math.max(30, ...students.map((s) => s.name.length * 1.15 + 4)));
  for (let i = 0; i < n; i++) ws.getColumn(C1 + i).width = 9;
  ws.getColumn(colT).width = 9;
  ws.getColumn(colP).width = 10;
  for (const k of COMPETENCES) ws.getColumn(colComp[k]).width = k === 'mulohaza' ? 15 : 11;

  // --- Imzolar ---
  const sig = (row: number, text: string) => {
    const c = ws.getCell(row, 2);
    c.value = text;
    c.font = { name: FONT, size: 12, bold: true, color: BLACK };
    c.alignment = { horizontal: 'left', vertical: 'middle' };
  };
  sig(fr + 3, 'Metodbirlashma rahbari: __________________');
  sig(fr + 5, 'Fan o‘qituvchisi: __________________');

  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: hr, activeCell: `${L(C1)}${ds}` }];
  ws.pageSetup.printTitlesRow = `${hr}:${hr}`;

  // --- Qayta yuklash uchun yashirin metama'lumot (mezon nomlari va kompetensiyalari) ---
  const metaWs = wb.addWorksheet(META_SHEET, { state: 'veryHidden' });
  metaWs.getCell('A1').value = JSON.stringify({
    app: 'EduAnalyze', version: 2, meta,
    criteria: criteria.map((c) => ({ id: c.id, name: c.name, max: c.max, type: c.type })),
    studentIds: students.map((s) => s.id),
  });
  return wb;
}

export async function exportReportXlsx(meta: ReportMeta, data: ReportData): Promise<Blob> {
  const wb = await buildReportWorkbook(meta, data);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ======================= Import (qayta yuklash) =======================

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

function cellNumber(v: ExcelJS.CellValue): number | null {
  const t = cellText(v).trim().replace(',', '.');
  if (t === '') return null;
  const num = Number(t);
  return Number.isFinite(num) ? num : Number.NaN;
}

function noteText(cell: ExcelJS.Cell): string {
  const nt = cell.note as unknown;
  if (!nt) return '';
  if (typeof nt === 'string') return nt;
  const texts = (nt as { texts?: { text: string }[] }).texts;
  return texts ? texts.map((t) => t.text).join('') : '';
}

function toCompetence(t: string): Competence | null {
  const s = t.toLowerCase().replace(/[‘’ʻʼ`´']/g, '');
  if (s.includes('bilish')) return 'bilish';
  if (s.includes('qollash') || s.includes('qo llash')) return 'qollash';
  if (s.includes('mulohaza')) return 'mulohaza';
  return null;
}

export interface ParsedReport {
  meta: Partial<ReportMeta>;
  data: ReportData;
  warnings: string[];
}

export async function parseReportXlsx(buffer: ArrayBuffer): Promise<ParsedReport> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('Faylni o‘qib bo‘lmadi. Iltimos, .xlsx formatidagi faylni tanlang');
  }
  const warnings: string[] = [];
  let stored: { meta?: ReportMeta; criteria?: Criterion[]; studentIds?: string[] } = {};
  const metaWs = wb.getWorksheet(META_SHEET);
  if (metaWs) {
    try { stored = JSON.parse(cellText(metaWs.getCell('A1').value)); } catch { /* ignore */ }
  }
  const ws = wb.worksheets.find((w) => w.name !== META_SHEET);
  if (!ws) throw new Error('Faylda varaq topilmadi');

  // "T/r" katagini topish
  let hr = 0;
  for (let row = 1; row <= Math.min(40, ws.rowCount); row++) {
    if (/^t\s*\/\s*r$/i.test(cellText(ws.getCell(row, 1).value).trim())) { hr = row; break; }
  }
  if (!hr) throw new Error('Jadval sarlavhasi (T/r) topilmadi. Bu BSB/CHSB hisobot fayli emasga o‘xshaydi');

  const criteria: Criterion[] = [];
  let dataStart: number;
  const firstHeader = cellText(ws.getCell(hr, 3).value).trim();
  const legacy = firstHeader !== '' && Number.isNaN(Number(firstHeader.replace(',', '.')));

  if (legacy) {
    // Eski maket: nomlar / kompetensiya / maksimal ball — uch qatorli sarlavha
    for (let col = 3; col <= ws.columnCount; col++) {
      const name = cellText(ws.getCell(hr, col).value).trim();
      if (!name || /^umumiy/i.test(name)) break;
      const max = cellNumber(ws.getCell(hr + 2, col).value);
      if (max === null || Number.isNaN(max) || max <= 0) throw new Error(`"${name}" mezonining maksimal bali noto‘g‘ri`);
      const type = toCompetence(cellText(ws.getCell(hr + 1, col).value)) || 'bilish';
      criteria.push({ id: '', name, max, type });
    }
    dataStart = hr + 3;
  } else {
    // Namuna maketi: sarlavhada mezonlarning maksimal bali, keyin jami, "Foiz %"
    let foizCol = 0;
    for (let col = 3; col <= ws.columnCount; col++) {
      if (/^foiz/i.test(cellText(ws.getCell(hr, col).value).trim())) { foizCol = col; break; }
    }
    if (!foizCol || foizCol < 5) throw new Error('“Foiz %” ustuni topilmadi');
    const nCrit = foizCol - 4; // C .. (jami ustunidan oldingi)
    for (let i = 0; i < nCrit; i++) {
      const cell = ws.getCell(hr, 3 + i);
      const max = cellNumber(cell.value);
      if (max === null || Number.isNaN(max) || max <= 0) throw new Error(`${colLetter(3 + i)}${hr} katagidagi maksimal ball noto‘g‘ri`);
      const prev = stored.criteria?.length === nCrit ? stored.criteria[i] : undefined;
      const note = noteText(cell);
      const [noteName, noteType] = note.split(' — ');
      let type: Competence | null = prev?.type ?? toCompetence(noteType || '');
      if (!type && nCrit === 3) type = COMPETENCES[i]; // namunadagi kabi: 1-Bilish, 2-Qo‘llash, 3-Mulohaza
      criteria.push({ id: prev?.id ?? '', name: prev?.name ?? (noteName?.trim() || `${i + 1}-topshiriq`), max, type: type || 'bilish' });
    }
    if (!stored.criteria && nCrit !== 3 && !criteria.some((_c, i) => noteText(ws.getCell(hr, 3 + i)))) {
      warnings.push('Mezonlarning kompetensiya turi fayldan aniqlanmadi — “Mezonlar” bo‘limida tekshiring');
    }
    dataStart = hr + 1;
  }
  if (!criteria.length) throw new Error('Baholash mezonlari topilmadi');
  const used = new Set<string>();
  for (const c of criteria) {
    if (!c.id || used.has(c.id)) c.id = uid('c');
    used.add(c.id);
  }

  const students: Student[] = [];
  for (let row = dataStart; row <= ws.rowCount; row++) {
    const a = cellText(ws.getCell(row, 1).value).trim();
    const name = cellText(ws.getCell(row, 2).value).trim().replace(/\s+/g, ' ');
    if (/^jami$/i.test(a) || /^jami$/i.test(name)) break;
    const scores: Student['scores'] = {};
    let any = false;
    criteria.forEach((c, j) => {
      const v = cellNumber(ws.getCell(row, 3 + j).value);
      if (v === null) return;
      const err = validateScore(v, c);
      if (err) {
        warnings.push(`${row}-qator (${name || 'nomsiz'}): ${err} — katak bo‘sh qoldirildi`);
        return;
      }
      scores[c.id] = v;
      any = true;
    });
    if (!name && !any) continue; // bo'sh zaxira qatorlar
    const prevId = stored.studentIds?.[students.length];
    students.push({ id: prevId && !students.some((s) => s.id === prevId) ? prevId : uid('s'), name, scores });
  }

  // Meta: yashirin varaqdan, keyin sarlavha matnidan (birlashtirilgan blok, bir nechta qator)
  const meta: Partial<ReportMeta> = stored.meta ? { ...stored.meta } : {};
  const titleText: string[] = [];
  for (let row = 1; row < hr; row++) {
    for (const col of [1, 2]) {
      const t = cellText(ws.getCell(row, col).value);
      if (t) titleText.push(...t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
    }
  }
  for (const t of [...new Set(titleText)]) {
    let m = t.match(/^Sinf:\s*(\S+)(?:\s*\(([^)]+)\))?(?:\s+(\d{4}\s*\/\s*\d{4}))?/i);
    if (m) {
      meta.className = m[1];
      if (m[2]) meta.groupName = m[2].trim();
      if (m[3]) meta.academicYear = m[3].replace(/\s/g, '');
      continue;
    }
    m = t.match(/^Fan:\s*(.+?)\s+(BSB-I{1,2}|CHSB-I{1,2})\s*$/i);
    if (m) { meta.subject = m[1].trim(); meta.controlType = m[2].toUpperCase() as ControlType; continue; }
    m = t.match(/FIO:\s*(.*)$/i);
    if (m) meta.teacherName = m[1].trim();
  }
  if (meta.controlType && !CONTROL_TYPES.includes(meta.controlType)) delete meta.controlType;
  return { meta, data: { criteria, students }, warnings };
}
