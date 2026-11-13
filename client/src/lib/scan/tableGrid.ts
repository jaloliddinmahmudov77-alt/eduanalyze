import { inferKinds, parseNumberToken } from './tableParse';
import type { ColKind, ScanCell, ScanColumn, ScanRow, ScanTable } from './types';

/**
 * Jadval chiziqlari bo'yicha tanib olish ("Smart Table Recognition"):
 *  1) rasmdagi gorizontal va vertikal chiziqlarni topish (rangli fonlar — masalan sariq sarlavha — chiziq hisoblanmaydi);
 *  2) chiziqlar orasidan kataklarni ajratish;
 *  3) har bir katakni alohida o'qish: ism ustuni — matn rejimi, ball kataklari — faqat raqam rejimi;
 *  4) sarlavha (maks. ballar), o'quvchilar va "Jami/Foiz" qatorlarini ajratish.
 * Bu modul platformaga bog'liq emas (brauzer va Node testlarida bir xil ishlaydi).
 */

export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface CellReadResult { text: string; confidence: number } // confidence 0..100
export interface CellReader { read(img: RGBAImage, mode: 'text' | 'digits'): Promise<CellReadResult> }

export interface Grid { xs: number[]; ys: number[] } // chegaralar (o'sish tartibida)

const FOOTER = /^(jami|итого|жами|total|o.?rtacha|ўртача|foizi?|фоизи?|umumiy|сумма)\b/i;
const HEADER = /(t\s*\/\s*r|№|ism|famil|o.?quvchi|ўқувчи|f\.?\s*i\.?\s*sh|ф\.?\s*и\.?\s*ш|\bfio\b|ф\.?и\.?о)/i;
const COMP: [RegExp, ColKind][] = [[/bilish|билиш/i, 'bilish'], [/qo.?llash|қўллаш|кўллаш/i, 'qollash'], [/mulohaza|мулоҳаза|мулохаза/i, 'mulohaza']];

function grayAt(img: RGBAImage, i: number) {
  const d = img.data;
  return (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
}

/**
 * Chiziq piksel maskasi. Chiziq — atrofidagi fondan (chiziqqa perpendikulyar yo'nalishda) sezilarli to'qroq piksel.
 * Shu tufayli sariq/kulrang fonli kataklar orasidagi ingichka chiziqlar ham topiladi, bo'yalgan fonning o'zi esa chiziq hisoblanmaydi.
 * dir='v' — vertikal chiziqlar uchun (chap/o'ng qo'shnilar bilan solishtiriladi), 'h' — gorizontal (yuqori/past).
 */
function lineMask(img: RGBAImage, dir: 'v' | 'h' = 'v') {
  const { width: w, height: h } = img;
  const g = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) g[p] = grayAt(img, i);
  const m = new Uint8Array(w * h);
  const off = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const v = g[p];
      if (v < 110) { m[p] = 1; continue; }
      let a: number, b: number;
      if (dir === 'v') { a = x >= off ? g[p - off] : 255; b = x + off < w ? g[p + off] : 255; }
      else { a = y >= off ? g[p - off * w] : 255; b = y + off < h ? g[p + off * w] : 255; }
      if (v < Math.min(a, b) - 16) m[p] = 1;
    }
  }
  return m;
}

interface Run { pos: number; start: number; end: number }

/** Har bir qator/ustun uchun eng uzun uzluksiz (kichik uzilishlarga yo'l qo'yiladigan) chiziq bo'lagi */
function longestRuns(m: Uint8Array, w: number, h: number, horizontal: boolean, maxGap = 3): Run[] {
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const res: Run[] = [];
  for (let o = 0; o < outer; o++) {
    let best = 0, bs = 0, be = 0, start = -1, last = -1;
    for (let k = 0; k < inner; k++) {
      const v = horizontal ? m[o * w + k] : m[k * w + o];
      if (!v) continue;
      if (start < 0 || k - last > maxGap + 1) start = k;
      last = k;
      if (last - start + 1 > best) { best = last - start + 1; bs = start; be = last; }
    }
    res.push({ pos: o, start: bs, end: be });
  }
  return res;
}

/** Ketma-ket chiziq kandidatlarini bitta chiziqqa birlashtirish; qalin "bo'yalgan" zonalar chiziq emas */
function clusterLines(cands: Run[], maxThick = 9) {
  const out: { pos: number; start: number; end: number }[] = [];
  let group: Run[] = [];
  const flush = () => {
    if (!group.length) return;
    if (group.length <= maxThick) {
      const pos = group.reduce((a, r) => a + r.pos, 0) / group.length;
      out.push({ pos, start: Math.min(...group.map((r) => r.start)), end: Math.max(...group.map((r) => r.end)) });
    }
    group = [];
  };
  for (const r of cands) {
    if (group.length && r.pos - group[group.length - 1].pos > 1) flush();
    group.push(r);
  }
  flush();
  return out;
}

export function detectGrid(img: RGBAImage): Grid | null {
  const { width: w, height: h } = img;
  const m = lineMask(img, 'v');
  const vRuns = longestRuns(m, w, h, false);
  // jadval sahifaning kichik qismini egallashi mumkin (PDF, telefon surati) — past chegara
  const vLines = clusterLines(vRuns.filter((r) => r.end - r.start + 1 >= Math.max(h * 0.05, 50)));
  if (vLines.length < 2) return null;
  // jadvalning vertikal chegaralari: eng ko'p chiziq qoplagan oraliq (eng uzun chiziqlar bo'yicha)
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const longest = Math.max(...vLines.map((l) => l.end - l.start));
  const main = vLines.filter((l) => l.end - l.start >= longest * 0.5);
  const ty0 = med(main.map((l) => l.start));
  const ty1 = med(main.map((l) => l.end));
  // jadval balandligining kamida 60% ini qoplagan chiziqlar (birlashtirilgan "Jami" kataklarida uzilishi mumkin)
  const strong = vLines.filter((l) => {
    const cover = Math.min(l.end, ty1) - Math.max(l.start, ty0);
    return cover >= (ty1 - ty0) * 0.6;
  });
  if (strong.length < 2) return null;
  const tx0 = Math.min(...strong.map((l) => l.pos));
  const tx1 = Math.max(...strong.map((l) => l.pos));
  const tableW = Math.max(1, tx1 - tx0);

  const hRuns = longestRuns(lineMask(img, 'h'), w, h, true, 6);
  const hLines = clusterLines(hRuns.filter((r) => r.pos >= ty0 - 4 && r.pos <= ty1 + 4 && r.end - r.start + 1 >= tableW * 0.55));
  if (hLines.length < 2) return null;

  const xs = strong.map((l) => Math.round(l.pos));
  const ys = hLines.map((l) => Math.round(l.pos));
  // rasm chetida kesilgan ustun/qator (masalan, screenshot chap chegarasiz) — rasm chetini chegara sifatida qo'shish
  const inkBetween = (x0: number, x1: number, y0: number, y1: number) => {
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y += 2)
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x += 2) if (grayAt(img, (y * w + x) * 4) < 140) n++;
    return n > 6;
  };
  if (xs[0] > 14 && inkBetween(0, xs[0] - 2, ys[0], ys[ys.length - 1])) xs.unshift(0);
  if (w - xs[xs.length - 1] > 14 && inkBetween(xs[xs.length - 1] + 2, w, ys[0], ys[ys.length - 1])) xs.push(w - 1);
  const dedupe = (a: number[], minGap: number) => a.filter((v, i) => i === 0 || v - a[i - 1] >= minGap);
  const X = dedupe(xs, 10);
  const Y = dedupe(ys, 10);
  if (X.length < 3 || Y.length < 3) return null;
  return { xs: X, ys: Y };
}

/** Katak rasmini tayyorlash: chegara chiziqlarini kesib tashlash, kulrang, kontrast, kattalashtirish, oq hoshiya */
export function prepareCell(img: RGBAImage, x0: number, y0: number, x1: number, y1: number): { cell: RGBAImage; ink: number } | null {
  const inset = 3;
  let ax = Math.round(x0 + inset), ay = Math.round(y0 + inset), bx = Math.round(x1 - inset), by = Math.round(y1 - inset);
  if (bx - ax < 4 || by - ay < 4) return null;
  // katak ichidagi qolgan chiziq qoldiqlarini qirqish (to'liq to'q qator/ustunlar)
  const isDark = (x: number, y: number) => grayAt(img, (y * img.width + x) * 4) < 150;
  const fullRow = (y: number) => { let n = 0; for (let x = ax; x <= bx; x++) n += isDark(x, y) ? 1 : 0; return n > (bx - ax) * 0.8; };
  const fullCol = (x: number) => { let n = 0; for (let y = ay; y <= by; y++) n += isDark(x, y) ? 1 : 0; return n > (by - ay) * 0.8; };
  while (ay < by && fullRow(ay)) ay++;
  while (by > ay && fullRow(by)) by--;
  while (ax < bx && fullCol(ax)) ax++;
  while (bx > ax && fullCol(bx)) bx--;
  const cw = bx - ax + 1, ch = by - ay + 1;
  if (cw < 4 || ch < 4) return null;
  // siyoh miqdori
  let ink = 0, lo = 255, hi = 0;
  const gray = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const g = grayAt(img, ((ay + y) * img.width + ax + x) * 4);
    gray[y * cw + x] = g;
    if (g < 140) ink++;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  if (ink < Math.max(6, cw * ch * 0.004)) return { cell: { width: 0, height: 0, data: new Uint8ClampedArray() }, ink: 0 };
  const scale = Math.max(1, Math.min(4, 64 / ch));
  const pad = 14;
  const W = Math.round(cw * scale) + pad * 2, H = Math.round(ch * scale) + pad * 2;
  const out = new Uint8ClampedArray(W * H * 4).fill(255);
  const span = Math.max(1, hi - lo);
  for (let y = 0; y < H - pad * 2; y++) {
    const sy = Math.min(ch - 1, y / scale);
    const y0i = Math.floor(sy), y1i = Math.min(ch - 1, y0i + 1), fy = sy - y0i;
    for (let x = 0; x < W - pad * 2; x++) {
      const sx = Math.min(cw - 1, x / scale);
      const x0i = Math.floor(sx), x1i = Math.min(cw - 1, x0i + 1), fx = sx - x0i;
      const g = (gray[y0i * cw + x0i] * (1 - fx) + gray[y0i * cw + x1i] * fx) * (1 - fy) + (gray[y1i * cw + x0i] * (1 - fx) + gray[y1i * cw + x1i] * fx) * fy;
      const v = Math.max(0, Math.min(255, ((g - lo) * 255) / span));
      const o = ((y + pad) * W + x + pad) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
    }
  }
  return { cell: { width: W, height: H, data: out }, ink };
}

/** Ikki rangli (qora-oq) variant — ikkinchi tekshiruv o'qishi uchun */
function binarize(img: RGBAImage): RGBAImage {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i] < 160 ? 0 : 255;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

const letters = (s: string) => s.replace(/[^\p{L}]/gu, '').length;
const cleanText = (s: string) => s.replace(/[|[\]{}_~"“”«»]/g, ' ').replace(/\s+/g, ' ').trim();

export async function recognizeGridTable(
  img: RGBAImage,
  grid: Grid,
  reader: CellReader,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanTable> {
  const nCols = grid.xs.length - 1;
  const nRows = grid.ys.length - 1;
  const cellImg = (r: number, c: number) => prepareCell(img, grid.xs[c], grid.ys[r], grid.xs[c + 1], grid.ys[r + 1]);

  // Ism ustuni: eng keng ustun (odatda), keyin matn tekshiruvi bilan tasdiqlanadi
  const widths = Array.from({ length: nCols }, (_, c) => grid.xs[c + 1] - grid.xs[c]);
  const order = widths.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);

  let done = 0;
  let total = nRows * nCols;
  const tick = () => onProgress?.(++done, total);

  const texts: (CellReadResult | null)[][] = Array.from({ length: nRows }, () => Array(nCols).fill(null));
  const empty: boolean[][] = Array.from({ length: nRows }, () => Array(nCols).fill(false));
  const readCell = async (r: number, c: number, mode: 'text' | 'digits') => {
    const p = cellImg(r, c);
    if (!p || !p.ink) { empty[r][c] = true; texts[r][c] = { text: '', confidence: 100 }; tick(); return texts[r][c]!; }
    const res = await reader.read(p.cell, mode);
    texts[r][c] = res;
    tick();
    return res;
  };

  let nameCol = order[0];
  for (const cand of order.slice(0, 2)) {
    for (let r = 0; r < nRows; r++) await readCell(r, cand, 'text');
    const lettered = texts.filter((row) => letters(row[cand]?.text || '') >= 3).length;
    if (lettered >= Math.max(2, nRows * 0.3)) { nameCol = cand; break; }
  }

  // qatorlarni turlash
  type Kind = 'header' | 'student' | 'footer' | 'empty';
  const kinds: Kind[] = [];
  let seenStudent = false;
  for (let r = 0; r < nRows; r++) {
    const t = cleanText(texts[r][nameCol]?.text || '');
    if (!t || empty[r][nameCol]) { kinds.push(seenStudent ? 'empty' : 'header'); continue; }
    if (FOOTER.test(t)) { kinds.push('footer'); continue; }
    if (!seenStudent && (HEADER.test(t) || letters(t) < 3)) { kinds.push('header'); continue; }
    if (letters(t) < 3) { kinds.push('empty'); continue; }
    kinds.push('student');
    seenStudent = true;
  }
  const lastStudent = kinds.lastIndexOf('student');
  const dataCols = Array.from({ length: nCols }, (_, c) => c).filter((c) => c > nameCol);
  total = done + kinds.filter((k) => k === 'header' || k === 'student').length * dataCols.length;

  // sarlavha kataklari (matn: maks. ball, "Foiz %", "Bilish" ...)
  const columns: ScanColumn[] = dataCols.map((_, i) => ({ label: `${i + 1}-ustun`, max: null, kind: 'score' as ColKind }));
  for (let r = 0; r < nRows && r < (kinds.indexOf('student') < 0 ? nRows : kinds.indexOf('student')); r++) {
    if (kinds[r] !== 'header') continue;
    for (let k = 0; k < dataCols.length; k++) {
      const res = await readCell(r, dataCols[k], 'text');
      const t = cleanText(res.text);
      if (!t) continue;
      const n = parseNumberToken(t);
      const col = columns[k];
      if (n.value !== null && !n.pct) { if (col.max === null) col.max = n.value; if (col.label.endsWith('-ustun')) col.label = String(n.value); continue; }
      col.label = col.label.endsWith('-ustun') || /^\d/.test(col.label) ? t : `${col.label} ${t}`;
      const comp = COMP.find(([re]) => re.test(t));
      if (comp) col.kind = comp[1];
      else if (/foiz|фоиз|%/i.test(t)) { col.kind = 'percent'; col.label = 'Foiz %'; }
      else if (/jami|umumiy|жами/i.test(t)) col.kind = 'total';
    }
  }

  // o'quvchi qatorlari: ball kataklari — faqat raqam rejimi
  const rows: ScanRow[] = [];
  for (let r = 0; r <= lastStudent; r++) {
    if (kinds[r] !== 'student') continue;
    const nameRes = texts[r][nameCol]!;
    const index: number | null = null; // tartib raqami o'qilmaydi (ishonchsiz) — moslash ism bo'yicha
    const cells: ScanCell[] = [];
    for (let k = 0; k < dataCols.length; k++) {
      const res = await readCell(r, dataCols[k], 'digits');
      if (empty[r][dataCols[k]]) { cells.push({ value: null, raw: '', confidence: 1 }); continue; }
      const raw = res.text.replace(/\s+/g, '');
      const n = parseNumberToken(raw);
      let value = n.value;
      // foiz belgisi "90"/"96" bo'lib o'qilgan bo'lishi mumkin: 10090 -> 100%
      let conf = res.confidence / 100;
      if (value !== null && value > 1000 && /9[06]$/.test(raw)) { value = Number(raw.slice(0, -2)); conf = Math.min(conf, 0.5); }
      // ikkinchi o'qish (ikki rangli/binar variant): natijalar farq qilsa — tekshirishga belgilanadi
      if (value !== null && columns[k].kind === 'score') {
        const p = cellImg(r, dataCols[k]);
        if (p && p.ink) {
          const second = parseNumberToken((await reader.read(binarize(p.cell), 'digits')).text.replace(/\s+/g, ''));
          if (second.value !== value) conf = Math.min(conf, 0.3);
        }
      }
      if (n.pct) columns[k].kind = columns[k].kind === 'score' ? 'percent' : columns[k].kind;
      cells.push(value === null ? { value: null, raw: raw || '?', confidence: 0.1 } : { value, raw, confidence: n.fixed ? Math.min(conf, 0.4) : conf });
    }
    // "Jami" qatori (ismi noto'g'ri o'qilgan bo'lsa ham): ballarning ko'pi maksimaldan katta
    const withMax = cells.map((c, k) => ({ c, col: columns[k] })).filter(({ c, col }) => col.kind === 'score' && col.max !== null && c.value !== null);
    if (withMax.length >= 2 && withMax.filter(({ c, col }) => (c.value as number) > (col.max as number)).length >= Math.ceil(withMax.length / 2)) break;
    rows.push({ index, name: cleanText(nameRes.text), nameConfidence: nameRes.confidence / 100, cells });
  }
  inferKinds(columns, rows);
  return { engine: 'ocr', columns, rows };
}

/** Diagnostika uchun (testlar) */
export const __gridInternals = { lineMask, longestRuns, clusterLines };
