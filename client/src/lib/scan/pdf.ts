import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { makeCanvas } from './imageOps';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** PDF sahifalarini rasmga (canvas) aylantirish — brauzerning o'zida, hech qayerga yuborilmaydi */
export async function pdfToCanvases(file: Blob, onProgress?: (done: number, total: number) => void, maxPages = 30) {
  let doc: pdfjs.PDFDocumentProxy;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    doc = await task.promise;
  } catch {
    throw new Error('PDF faylni ochib bo‘lmadi. Fayl buzilgan yoki parol bilan himoyalangan bo‘lishi mumkin');
  }
  const total = Math.min(doc.numPages, maxPages);
  const out: HTMLCanvasElement[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 2200 / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const c = makeCanvas(vp.width, vp.height);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
    out.push(c);
    onProgress?.(i, total);
  }
  const truncated = doc.numPages > maxPages;
  await task.destroy();
  return { canvases: out, truncated };
}
