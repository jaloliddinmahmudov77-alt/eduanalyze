// Brauzerdagi Excel moduli (client/src/lib/excel.ts) ni server uchun bundle qiladi.
// To'lov majburiy bo'lishi uchun rasmiy XLSX faqat serverda yaratiladi — kod esa bitta.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [join(root, 'client', 'src', 'lib', 'excel.ts')],
  outfile: join(root, 'server', 'gen', 'excel.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['exceljs'],
  logLevel: 'warning',
});
console.log('server/gen/excel.mjs tayyor');
