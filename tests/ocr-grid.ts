// Jadvalni kataklar bo'yicha tanib olishni haqiqiy rasm ustida sinash:
//   npx tsx tests/ocr-grid.ts tests/fixtures/sample-11B.png
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { detectGrid, recognizeGridTable, type CellReader, type RGBAImage } from '../client/src/lib/scan/tableGrid';

export async function nodeReader() {
  const langPath = join(import.meta.dirname, '..', 'client', 'public', 'ocr', 'lang');
  const text = await createWorker(['uzb', 'eng'], OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none' });
  await text.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: '1' });
  const cyr = await createWorker(['uzb_cyrl', 'rus'], OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none' });
  await cyr.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, preserve_interword_spaces: '1' });
  const digits = await createWorker(['eng'], OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none' });
  await digits.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789.,%' });
  const char = await createWorker(['eng'], OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none' });
  await char.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD, tessedit_char_whitelist: '0123456789.,%' });
  const reader: CellReader = {
    async read(img, mode) {
      const png = new PNG({ width: img.width, height: img.height });
      png.data = Buffer.from(img.data);
      const buf = PNG.sync.write(png);
      if (mode === 'digits') {
        const r = await digits.recognize(buf);
        const t = r.data.text.trim();
        if (/\d/.test(t)) return { text: t, confidence: r.data.confidence };
        const r2 = await char.recognize(buf);
        const t2 = r2.data.text.trim();
        return /\d/.test(t2) ? { text: t2, confidence: Math.min(70, r2.data.confidence) } : { text: t, confidence: r.data.confidence };
      }
      const [a, b] = await Promise.all([text.recognize(buf), cyr.recognize(buf)]);
      const best = b.data.confidence > a.data.confidence ? b : a;
      return { text: best.data.text.trim(), confidence: best.data.confidence };
    },
  };
  return { reader, close: async () => { await text.terminate(); await cyr.terminate(); await digits.terminate(); await char.terminate(); } };
}

export function loadPng(file: string): RGBAImage {
  const png = PNG.sync.read(readFileSync(file));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const img = loadPng(process.argv[2] || 'tests/fixtures/sample-11B.png');
  const t0 = Date.now();
  const grid = detectGrid(img);
  console.log('grid:', grid ? `${grid.xs.length - 1} ustun x ${grid.ys.length - 1} qator` : 'topilmadi', grid?.xs.join(','), '|', grid?.ys.join(','));
  if (grid) {
    const { reader, close } = await nodeReader();
    const t = await recognizeGridTable(img, grid, reader);
    await close();
    console.log('columns:', t.columns.map((c) => `${c.label}[${c.kind}${c.max !== null ? ' max ' + c.max : ''}]`).join(' | '));
    for (const r of t.rows) console.log(String(r.index ?? '-').padStart(2), r.name.padEnd(24), r.cells.map((c) => (c.value === null ? (c.raw ? `?${c.raw}` : '·') : c.value) + (c.confidence < 0.75 ? '*' : '')).join('\t'));
    console.log(`vaqt: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
}
