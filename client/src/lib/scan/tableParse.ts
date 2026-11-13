import type { ColKind, ScanCell, ScanColumn, ScanRow, ScanTable } from './types';

/**
 * OCR so'zlari (matn + koordinata + ishonch) dan jadval tuzilishini tiklash.
 *  1) so'zlarni Y bo'yicha qatorlarga guruhlash;
 *  2) ism zonasini (harfli so'zlar) va undan o'ngdagi raqamli ustunlarni X bo'yicha klasterlash;
 *  3) ism yo'q, faqat raqamli qator (talabalardan oldin) — maksimal ballar qatori;
 *  4) "Jami"/"Foiz" kabi yakuniy qatorlarni chiqarib tashlash;
 *  5) qolgan ustunlar sum'ga teng bo'lsa — "umumiy ball", % bo'lsa — foiz.
 * Taxmin qilinmaydi: o'qib bo'lmagan katak value=null bo'lib, tekshirishga belgilanadi.
 */

export interface OcrWord {
  text: string;
  confidence: number; // 0..100
  x0: number; y0: number; x1: number; y1: number;
}

interface Tok extends OcrWord { xc: number; yc: number; h: number; clean: string; num: number | null; numFixed: boolean; isPct: boolean; letters: boolean }

const FOOTER = /^(jami|итого|жами|total|o.?rtacha|ўртача|foizi?|фоизи?|umumiy|сумма|%)$/i;
const HEADER_WORD = /^(t\/?r|№|ism|ismi|familiya|familiyasi|o.?quvchi\w*|ўқувчи\w*|f\.?i\.?sh\.?|ф\.?и\.?ш\.?|fio|ф\.?и\.?о)$/i;
const COMP: Record<string, ColKind> = { bilish: 'bilish', 'билиш': 'bilish', qollash: 'qollash', 'қўллаш': 'qollash', mulohaza: 'mulohaza', 'мулоҳаза': 'mulohaza' };

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Raqamga o'xshash tokenni o'qish. OCR'ning tipik adashishlari (O→0, l→1, S→5) tuzatiladi, lekin bunday katak tekshirishga belgilanadi. */
export function parseNumberToken(raw: string): { value: number | null; fixed: boolean; pct: boolean } {
  let t = raw.trim().replace(/^[|[\](){}_.,:;'"`~-]+|[|[\](){}_:;'"`~-]+$/g, '');
  const pct = /%$/.test(t);
  t = t.replace(/%$/, '').replace(',', '.');
  if (/^\d{1,4}(\.\d{1,2})?$/.test(t)) return { value: Number(t), fixed: false, pct };
  if (t.length && t.length <= 4 && /\d/.test(t)) {
    const f = t.replace(/[Oo]/g, '0').replace(/[lI|!]/g, '1').replace(/[Ss]/g, '5').replace(/[B]/g, '8').replace(/[Z]/g, '2');
    if (/^\d{1,4}(\.\d{1,2})?$/.test(f)) return { value: Number(f), fixed: true, pct };
  }
  return { value: null, fixed: false, pct };
}

const normWord = (s: string) => s.toLowerCase().replace(/[‘’ʻʼ`´'.:,]/g, '');

export function parseTableFromWords(words: OcrWord[]): ScanTable {
  const toks: Tok[] = words
    .filter((w) => w.text && w.text.trim() && !/^[|_\-—=.,:;'"`~[\]()]+$/.test(w.text.trim()))
    .map((w) => {
      const clean = w.text.trim();
      const n = parseNumberToken(clean);
      const letters = /\p{L}{2,}/u.test(clean) && n.value === null;
      return { ...w, clean, xc: (w.x0 + w.x1) / 2, yc: (w.y0 + w.y1) / 2, h: w.y1 - w.y0, num: n.value, numFixed: n.fixed, isPct: n.pct, letters };
    });
  if (!toks.length) return { engine: 'ocr', columns: [], rows: [], notes: 'Rasmda matn topilmadi' };

  // 1) qatorlarga guruhlash
  const medH = median(toks.map((t) => t.h)) || 10;
  const sorted = [...toks].sort((a, b) => a.yc - b.yc);
  const lines: Tok[][] = [];
  for (const t of sorted) {
    const last = lines[lines.length - 1];
    if (last) {
      const yc = last.reduce((a, b) => a + b.yc, 0) / last.length;
      if (Math.abs(t.yc - yc) < medH * 0.6) { last.push(t); continue; }
    }
    lines.push([t]);
  }
  lines.forEach((l) => l.sort((a, b) => a.x0 - b.x0));

  // 2) ism zonasining o'ng chegarasi
  const nameLines = lines.filter((l) => l.filter((t) => t.letters).length >= 1 && l.some((t) => t.num !== null));
  const nameRight = median(nameLines.map((l) => Math.max(...l.filter((t) => t.letters).map((t) => t.x1))));
  const firstLetterX = (l: Tok[]) => Math.min(...l.filter((t) => t.letters).map((t) => t.x0), Infinity);

  // sarlavha bloki (Sinf:, Fan:, FIO) va imzo qatorlari jadvalga tegishli emas
  const TITLE = /^(sinf|синф|fan|фан|fio|фио|o.?qituvchining|ўқитувчининг|metodbirlashma|методбирлашма|rahbari|раҳбари|o.?qituvchisi|ўқитувчиси)/i;
  const isTitle = (l: Tok[]) => l.some((t) => t.letters && TITLE.test(normWord(t.clean)));
  const isFooter = (l: Tok[]) => l.some((t) => t.letters && FOOTER.test(normWord(t.clean))) && l.filter((t) => t.letters).length <= 2;
  const isHeaderText = (l: Tok[]) => l.some((t) => HEADER_WORD.test(normWord(t.clean)));

  // ustun nomzodlari: ism zonasidan o'ngdagi raqamlar (va sarlavhadagi foiz/kompetensiya so'zlari)
  const scoreToks = (l: Tok[]) => l.filter((t) => t.num !== null && t.x0 > nameRight - medH * 0.5);
  const candidateLines = lines.filter((l) => !isFooter(l) && !isTitle(l));
  const xs = candidateLines.flatMap((l) => scoreToks(l).map((t) => t.xc)).sort((a, b) => a - b);
  if (!xs.length) return { engine: 'ocr', columns: [], rows: [], notes: 'Jadvalda raqamli ustunlar topilmadi' };

  // 3) X bo'yicha klasterlash
  const gap = Math.max(medH * 1.4, 14);
  const clusters: number[][] = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && x - last[last.length - 1] < gap) last.push(x);
    else clusters.push([x]);
  }
  const support = Math.max(2, Math.floor(candidateLines.filter((l) => scoreToks(l).length).length * 0.25));
  const centers = clusters.filter((c) => c.length >= support).map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  if (!centers.length) return { engine: 'ocr', columns: [], rows: [], notes: 'Ustunlar aniqlanmadi' };
  const colOf = (x: number) => {
    let best = -1, bd = Infinity;
    centers.forEach((c, i) => { const d = Math.abs(c - x); if (d < bd) { bd = d; best = i; } });
    const neighbor = Math.min(...centers.filter((_, i) => i !== best).map((c) => Math.abs(c - centers[best])), Infinity);
    return bd <= Math.min(gap * 1.5, neighbor / 2) ? best : -1;
  };

  // 4) sarlavha / max qatori va o'quvchi qatorlari
  const columns: ScanColumn[] = centers.map((_, i) => ({ label: `${i + 1}-ustun`, max: null, kind: 'score' as ColKind }));
  const rows: ScanRow[] = [];
  let seenStudent = false;
  for (const l of lines) {
    if (isTitle(l)) continue;
    const letterToks = l.filter((t) => t.letters && t.xc < nameRight + medH);
    const nums = scoreToks(l);
    // sarlavhadagi so'zlar (Bilish, Foiz %, mezon nomlari)
    const headerish = !seenStudent && (isHeaderText(l) || (letterToks.length === 0 && nums.length >= Math.ceil(centers.length / 2)));
    if (headerish) {
      for (const t of l) {
        const ci = colOf(t.xc);
        if (ci < 0) continue;
        if (t.num !== null && !t.isPct) { if (columns[ci].max === null) columns[ci].max = t.num; }
        else if (t.letters) {
          const w = normWord(t.clean);
          columns[ci].label = t.clean;
          if (COMP[w]) columns[ci].kind = COMP[w];
          else if (/^(foiz|фоиз)/.test(w)) columns[ci].kind = 'percent';
        }
        if (t.isPct) columns[ci].kind = 'percent';
      }
      continue;
    }
    if (isFooter(l)) continue;
    if (!letterToks.length || letterToks.every((t) => HEADER_WORD.test(normWord(t.clean)))) continue;
    const nameToks = letterToks.filter((t) => !HEADER_WORD.test(normWord(t.clean)));
    const nameStr = nameToks.map((t) => t.clean.replace(/[|[\]{}]/g, '')).join(' ').replace(/\s+/g, ' ').trim();
    if (nameStr.replace(/[^\p{L}]/gu, '').length < 3) continue;
    seenStudent = true;
    const idxTok = l.find((t) => t.num !== null && t.x1 <= firstLetterX(l) + 2 && Number.isInteger(t.num));
    const cells: ScanCell[] = centers.map(() => ({ value: null, raw: '', confidence: 1 }));
    for (const t of nums) {
      const ci = colOf(t.xc);
      if (ci < 0) continue;
      const prev = cells[ci];
      if (prev.raw) { // ikkita token bitta katakka tushdi — shubhali
        cells[ci] = { value: null, raw: `${prev.raw} ${t.clean}`, confidence: 0.2 };
        continue;
      }
      cells[ci] = { value: t.num, raw: t.clean, confidence: Math.min(t.confidence / 100, t.numFixed ? 0.4 : 1) };
      if (t.isPct) columns[ci].kind = columns[ci].kind === 'score' ? 'percent' : columns[ci].kind;
    }
    // ism zonasidan o'ngdagi, lekin raqam bo'lmagan "chiqindi" tokenlar — o'qib bo'lmagan katak
    for (const t of l) {
      if (t.num !== null || t.letters || t.x0 <= nameRight) continue;
      const ci = colOf(t.xc);
      if (ci >= 0 && !cells[ci].raw) cells[ci] = { value: null, raw: t.clean, confidence: 0.1 };
    }
    rows.push({
      index: idxTok?.num ?? null,
      name: nameStr,
      nameConfidence: Math.min(...nameToks.map((t) => t.confidence / 100)),
      cells,
    });
  }

  inferKinds(columns, rows);
  return { engine: 'ocr', columns, rows };
}

/** "Umumiy ball" ustunini aniqlash: qiymati oldingi ball ustunlari yig'indisiga teng bo'lsa */
export function inferKinds(columns: ScanColumn[], rows: ScanRow[]) {
  // foiz ustunlari: qiymatlar % bilan yoki sarlavha "Foiz"
  for (let j = 0; j < columns.length; j++) {
    if (columns[j].kind !== 'score') continue;
    const prevScores = columns.slice(0, j).map((c, i) => (c.kind === 'score' ? i : -1)).filter((i) => i >= 0);
    if (prevScores.length < 2) continue;
    let checked = 0, equal = 0;
    for (const r of rows) {
      const v = r.cells[j]?.value;
      const parts = prevScores.map((i) => r.cells[i]?.value);
      if (v === null || v === undefined || parts.some((p) => p === null || p === undefined)) continue;
      checked++;
      if (Math.abs((parts as number[]).reduce((a, b) => a + b, 0) - v) < 0.01) equal++;
    }
    const maxSum = prevScores.every((i) => columns[i].max !== null) && columns[j].max !== null
      && Math.abs(prevScores.reduce((a, i) => a + (columns[i].max as number), 0) - (columns[j].max as number)) < 0.01;
    if ((checked >= 1 && equal / checked >= 0.7) || maxSum) {
      columns[j].kind = 'total';
      if (columns[j].label.endsWith('-ustun')) columns[j].label = 'Jami';
      // jami ustunidan keyingi raqamli ustunlar odatda foiz/kompetensiyalar
      for (let k = j + 1; k < columns.length; k++) if (columns[k].kind === 'score') columns[k].kind = 'other';
      break;
    }
  }
}
