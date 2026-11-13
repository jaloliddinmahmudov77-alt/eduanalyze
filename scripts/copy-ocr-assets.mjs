// Mahalliy OCR (Tesseract) fayllarini client/public/ocr ga ko'chiradi — CDN'siz, oflayn ishlashi uchun.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'client', 'public', 'ocr');
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

const copy = (from, to) => {
  if (!existsSync(to)) copyFileSync(from, to);
};

copy(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'));
for (const f of readdirSync(join(nm, 'tesseract.js-core'))) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copy(join(nm, 'tesseract.js-core', f), join(out, 'core', f));
}
for (const lang of ['uzb', 'uzb_cyrl', 'eng', 'rus']) {
  const base = join(nm, '@tesseract.js-data', lang);
  const dir = existsSync(join(base, '4.0.0_best_int')) ? '4.0.0_best_int' : '4.0.0';
  copy(join(base, dir, `${lang}.traineddata.gz`), join(out, 'lang', `${lang}.traineddata.gz`));
}
console.log('OCR assets ->', out);
