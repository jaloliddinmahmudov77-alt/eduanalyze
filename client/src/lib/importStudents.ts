import * as XLSX from 'xlsx';

export interface ImportedName {
  name: string;
  row: number; // fayldagi qator raqami (1 dan)
}

const HEADER_FULL = /(f\.?\s*i\.?\s*sh|f\.?\s*i\.?\s*o|ism.*famil|famil.*ism|o.?quvchi|full\s*name|^name$|^ф\.?и\.?о|ученик)/i;
const HEADER_SURNAME = /^(familiya|familiyasi|surname|last\s*name|фамилия)$/i;
const HEADER_NAME = /^(ismi?|first\s*name|имя)$/i;
const HEADER_PATRONYMIC = /^(otasining\s*ismi|sharifi|patronymic|отчество)$/i;
const SKIP_ROW = /^(jami|итого|total|o.?rtacha|foiz)$/i;

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const looksLikeName = (s: string) => /^[\p{L}][\p{L}‘’ʻʼ'`.\- ]{2,}$/u.test(s) && !/^\d/.test(s);

export async function readSheetRows(file: File): Promise<unknown[][]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext || '')) throw new Error('Faqat XLSX, XLS yoki CSV fayllar qabul qilinadi');
  const buf = await file.arrayBuffer();
  let wb: XLSX.WorkBook;
  try {
    if (ext === 'csv') {
      // CSV uchun UTF-8 matn sifatida o'qish (kirill/lotin harflari buzilmasligi uchun)
      const text = new TextDecoder('utf-8').decode(buf);
      wb = XLSX.read(text, { type: 'string' });
    } else {
      wb = XLSX.read(buf, { type: 'array' });
    }
  } catch {
    throw new Error('Faylni o‘qib bo‘lmadi. Fayl buzilgan yoki noto‘g‘ri formatda');
  }
  const sheetName = wb.SheetNames.find((n) => n !== 'EduAnalyze') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false, raw: false });
}

/** Jadvaldan o'quvchilarning F.I.Sh. ustunini (yoki familiya + ism ustunlarini) aniqlaydi */
export function extractNames(rows: unknown[][]): { names: ImportedName[]; detected: string } {
  const top = rows.slice(0, 15);
  // 1) Sarlavha bo'yicha qidirish
  for (let r = 0; r < top.length; r++) {
    const cells = top[r].map(clean);
    const full = cells.findIndex((c) => HEADER_FULL.test(c));
    const sur = cells.findIndex((c) => HEADER_SURNAME.test(c));
    const nam = cells.findIndex((c) => HEADER_NAME.test(c));
    const pat = cells.findIndex((c) => HEADER_PATRONYMIC.test(c));
    if (sur >= 0 && nam >= 0) {
      return {
        names: collect(rows, r + 1, (row) => [row[sur], row[nam], pat >= 0 ? row[pat] : ''].map(clean).filter(Boolean).join(' ')),
        detected: `“${cells[sur]}” + “${cells[nam]}”${pat >= 0 ? ` + “${cells[pat]}”` : ''} ustunlari`,
      };
    }
    if (full >= 0) {
      return { names: collect(rows, r + 1, (row) => clean(row[full])), detected: `“${cells[full]}” ustuni` };
    }
  }
  // 2) Sarlavha yo'q: ismga o'xshash matnlar eng ko'p bo'lgan ustun
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best = -1;
  let bestScore = 0;
  for (let c = 0; c < width; c++) {
    let score = 0;
    for (const row of rows) {
      const v = clean(row[c]);
      if (looksLikeName(v)) score += v.includes(' ') ? 2 : 1;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best < 0) return { names: [], detected: 'ism-familiya topilmadi' };
  return { names: collect(rows, 0, (row) => clean(row[best])), detected: `${best + 1}-ustun (avtomatik aniqlandi)` };
}

function collect(rows: unknown[][], from: number, pick: (row: unknown[]) => string): ImportedName[] {
  const out: ImportedName[] = [];
  for (let r = from; r < rows.length; r++) {
    const name = pick(rows[r]);
    if (!name || SKIP_ROW.test(name) || !looksLikeName(name)) continue;
    out.push({ name, row: r + 1 });
  }
  return out;
}

/** Qo'lda yozilgan/joylashtirilgan matndan: har qatorda bitta o'quvchi */
export function namesFromText(text: string): ImportedName[] {
  return text
    .split(/\r?\n/)
    .map((l, i) => ({ name: clean(l.replace(/^\s*\d+[.)]?\s*/, '').split('\t')[0]), row: i + 1 }))
    .filter((x) => x.name);
}
