// Mahalliy OCR + jadval parserini haqiqiy rasm ustida sinash: npx tsx tests/ocr-run.ts <rasm>
import { createWorker, OEM, PSM } from 'tesseract.js';
import { join } from 'node:path';
import { parseTableFromWords, type OcrWord } from '../client/src/lib/scan/tableParse';

const file = process.argv[2] || 'tests/fixtures/sample-11B.png';
const worker = await createWorker(['uzb', 'uzb_cyrl', 'eng'], OEM.LSTM_ONLY, { langPath: join(import.meta.dirname, '..', 'client', 'public', 'ocr', 'lang'), gzip: true, cacheMethod: 'none' });
await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
const res = await worker.recognize(file, {}, { blocks: true });
const words: OcrWord[] = [];
for (const b of res.data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words)
  words.push({ text: w.text, confidence: w.confidence, ...w.bbox });
await worker.terminate();
const t = parseTableFromWords(words);
console.log('columns:', t.columns.map((c) => `${c.label}[${c.kind}${c.max !== null ? ' max ' + c.max : ''}]`).join(' | '));
for (const r of t.rows) console.log(String(r.index ?? '-').padStart(2), r.name.padEnd(24), r.cells.map((c) => (c.value === null ? (c.raw ? `?${c.raw}` : '·') : c.value) + (c.confidence < 0.75 ? '*' : '')).join('\t'));
if (process.env.WORDS) console.log(words.map((w) => `${w.text}@${Math.round(w.x0)},${Math.round(w.y0)}`).join(' '));
