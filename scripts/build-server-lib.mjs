// Brauzerdagi Excel moduli (client/src/lib/excel.ts) ni server uchun bundle qiladi.
// To'lov majburiy bo'lishi uchun rasmiy XLSX faqat serverda yaratiladi — kod esa bitta.
//   node scripts/build-server-lib.mjs          — bir marta
//   node scripts/build-server-lib.mjs --watch  — dev rejimida o'zgarishlarni kuzatib qayta yig'adi
import { context } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = await context({
  entryPoints: [join(root, 'client', 'src', 'lib', 'excel.ts')],
  outfile: join(root, 'server', 'gen', 'excel.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['exceljs'],
  logLevel: 'warning',
});
if (process.argv.includes('--watch')) {
  await ctx.watch();
  console.log('server/gen/excel.mjs — o‘zgarishlar kuzatilmoqda');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('server/gen/excel.mjs tayyor');
}
