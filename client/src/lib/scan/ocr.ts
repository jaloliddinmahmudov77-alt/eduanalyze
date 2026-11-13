import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { detectSkew, enhance, makeCanvas, rotateDeg } from './imageOps';
import { detectGrid, recognizeGridTable, type CellReader, type RGBAImage } from './tableGrid';
import { parseTableFromWords, type OcrWord } from './tableParse';
import type { ScanTable } from './types';

/**
 * Mahalliy OCR (Tesseract, WebAssembly) — brauzerning o'zida ishlaydi.
 * Model va worker fayllari o'z serverimizdan (/ocr/) yuklanadi: rasm hech qayerga yuborilmaydi.
 */

type Progress = (p: number, status: string) => void;

const OPTS = { workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang', gzip: true, cacheMethod: 'write' as const };

let textW: Promise<Worker> | null = null; // lotin (o'zbek lotin + ingliz)
let cyrW: Promise<Worker> | null = null; // kirill (o'zbek kirill + rus)
let digitW: Promise<Worker> | null = null;
let sparseW: Promise<Worker> | null = null;
let charW: Promise<Worker> | null = null; // bitta belgili kataklar uchun (masalan, qalin "0")

function make(langs: string[], params: Record<string, string>, ref: 'text' | 'cyr' | 'digit' | 'sparse' | 'char') {
  return createWorker(langs, OEM.LSTM_ONLY, OPTS)
    .then(async (w) => { await w.setParameters(params); return w; })
    .catch((e) => {
      if (ref === 'text') textW = null; else if (ref === 'cyr') cyrW = null; else if (ref === 'digit') digitW = null; else if (ref === 'char') charW = null; else sparseW = null;
      throw new Error(`OCR ishga tushmadi: ${(e as Error)?.message || e}`);
    });
}
const LINE = { tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: '1' };
const getText = () => (textW ??= make(['uzb', 'eng'], LINE, 'text'));
const getCyr = () => (cyrW ??= make(['uzb_cyrl', 'rus'], LINE, 'cyr'));
const getDigits = () => (digitW ??= make(['eng'], { tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789.,%' }, 'digit'));
const getChar = () => (charW ??= make(['eng'], { tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: '0123456789.,%' }, 'char'));
const getSparse = () => (sparseW ??= make(['uzb_cyrl', 'uzb', 'eng'], { tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' }, 'sparse'));

function rgbaToCanvas(img: RGBAImage) {
  const c = makeCanvas(img.width, img.height);
  const ctx = c.getContext('2d')!;
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  return c;
}

function canvasToRGBA(c: HTMLCanvasElement): RGBAImage {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: d.data };
}

/** Modellarni oldindan yuklash (birinchi tahlil tezroq bo'lishi uchun) */
export function warmUpOcr() {
  getText().catch(() => {});
  getCyr().catch(() => {});
  getDigits().catch(() => {});
}

/** Chiziqsiz jadvallar uchun zaxira: so'zlar koordinatasi bo'yicha */
async function sparseTable(canvas: HTMLCanvasElement): Promise<ScanTable> {
  const w = await getSparse();
  const img = enhance(canvas);
  const scale = img.width / canvas.width;
  const res = await w.recognize(img, {}, { blocks: true });
  const words: OcrWord[] = [];
  for (const b of res.data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words)
    words.push({ text: wd.text, confidence: wd.confidence, x0: wd.bbox.x0 / scale, y0: wd.bbox.y0 / scale, x1: wd.bbox.x1 / scale, y1: wd.bbox.y1 / scale });
  return parseTableFromWords(words);
}

export interface OcrOutcome { table: ScanTable; method: 'grid' | 'sparse'; deskew: number }

export async function ocrTable(canvas: HTMLCanvasElement, onProgress?: Progress): Promise<OcrOutcome> {
  onProgress?.(0, 'OCR modellari tayyorlanmoqda');
  const [tw, cw, dw, chw] = await Promise.all([getText(), getCyr(), getDigits(), getChar()]);
  // 1) qiyshiqlikni avtomatik tekislash
  const angle = detectSkew(canvas);
  const straight = Math.abs(angle) >= 0.3 ? rotateDeg(canvas, angle) : canvas;
  // 2) jadval chiziqlari bo'yicha kataklarga ajratish
  const rgba = canvasToRGBA(straight);
  const grid = detectGrid(rgba);
  if (grid) {
    const reader: CellReader = {
      async read(img, mode) {
        const canvasImg = rgbaToCanvas(img);
        if (mode === 'digits') {
          const r = await dw.recognize(canvasImg);
          const text = r.data.text.trim();
          if (/\d/.test(text)) return { text, confidence: r.data.confidence };
          // raqam topilmadi — "bitta so'z" rejimida qayta o'qish; ishonch pasaytiriladi (tekshirishga tushadi)
          const r2 = await chw.recognize(canvasImg);
          const t2 = r2.data.text.trim();
          return /\d/.test(t2) ? { text: t2, confidence: Math.min(70, r2.data.confidence) } : { text, confidence: r.data.confidence };
        }
        // matn: lotin va kirill modellarida o'qib, ishonchi yuqorisini olish
        const [a, b] = await Promise.all([tw.recognize(canvasImg), cw.recognize(canvasImg)]);
        const best = b.data.confidence > a.data.confidence ? b : a;
        return { text: best.data.text.trim(), confidence: best.data.confidence };
      },
    };
    const table = await recognizeGridTable(rgba, grid, reader, (d, t) => onProgress?.(t ? d / t : 0, `Kataklar o‘qilmoqda: ${d}/${t}`));
    if (table.rows.length) return { table, method: 'grid', deskew: angle };
  }
  // 3) chiziq topilmasa — so'zlar joylashuvi bo'yicha
  onProgress?.(0.5, 'Jadval chiziqlari topilmadi — matn joylashuvi bo‘yicha o‘qilmoqda');
  return { table: await sparseTable(straight), method: 'sparse', deskew: angle };
}
