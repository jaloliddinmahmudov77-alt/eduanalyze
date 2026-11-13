import type { Point, Rect } from './types';

/** Canvas'da rasm bilan ishlash: aylantirish, kesish, perspektiva, qiyshiqlikni tekislash, sifatni oshirish. */

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

export function cloneCanvas(src: HTMLCanvasElement) {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

/** Juda katta rasmlarni kichraytirish (telefon kamerasi 4000px+ bo'lishi mumkin) */
export function limitSize(src: HTMLCanvasElement, maxSide = 2600) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (s >= 1) return src;
  const c = makeCanvas(src.width * s, src.height * s);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Rasmni o‘qib bo‘lmadi. JPG, PNG yoki WEBP fayl tanlang');
  }
  const c = makeCanvas(bmp.width, bmp.height);
  const x = ctx2d(c);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0);
  bmp.close();
  return limitSize(c);
}

export function rotate90(src: HTMLCanvasElement, dir: 1 | -1) {
  const c = makeCanvas(src.height, src.width);
  const x = ctx2d(c);
  x.translate(c.width / 2, c.height / 2);
  x.rotate((dir * Math.PI) / 2);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Ixtiyoriy burchakka aylantirish (oq fon bilan, o'lcham saqlanadi) */
export function rotateDeg(src: HTMLCanvasElement, deg: number) {
  if (Math.abs(deg) < 0.01) return src;
  const c = makeCanvas(src.width, src.height);
  const x = ctx2d(c);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2);
  x.rotate((deg * Math.PI) / 180);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export function crop(src: HTMLCanvasElement, r: Rect) {
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const w = Math.min(src.width - x0, Math.round(r.w));
  const h = Math.min(src.height - y0, Math.round(r.h));
  if (w < 10 || h < 10) return src;
  const c = makeCanvas(w, h);
  ctx2d(c).drawImage(src, x0, y0, w, h, 0, 0, w, h);
  return c;
}

/** 8x8 chiziqli tenglamalar sistemasi (Gauss usuli) */
function solve(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-12) throw new Error('Burchaklar noto‘g‘ri tanlangan');
    for (let k = col; k <= n; k++) M[col][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f) for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row) => row[n]);
}

/** from[i] -> to[i] proyektiv o'zgartirish matritsasi (3x3, h33=1) */
function homography(from: Point[], to: Point[]) {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Perspektivani to'g'rilash: quad = [chap-yuqori, o'ng-yuqori, o'ng-past, chap-past] */
export function warpPerspective(src: HTMLCanvasElement, quad: Point[]) {
  const [tl, tr, br, bl] = quad;
  const W = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  const H = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  const out = makeCanvas(W, H);
  // chiqish piksellaridan manba piksellariga (teskari xaritalash)
  const m = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], quad);
  const sctx = ctx2d(src);
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const octx = ctx2d(out);
  const od = octx.createImageData(W, H);
  const sw = src.width, sh = src.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = m[6] * x + m[7] * y + 1;
      const sx = (m[0] * x + m[1] * y + m[2]) / den;
      const sy = (m[3] * x + m[4] * y + m[5]) / den;
      const o = (y * W + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        od.data[o] = od.data[o + 1] = od.data[o + 2] = 255; od.data[o + 3] = 255;
        continue;
      }
      // bilinear interpolatsiya
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let k = 0; k < 3; k++) {
        const top = sd[i00 + k] * (1 - fx) + sd[i10 + k] * fx;
        const bot = sd[i01 + k] * (1 - fx) + sd[i11 + k] * fx;
        od.data[o + k] = top * (1 - fy) + bot * fy;
      }
      od.data[o + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

function grayData(src: HTMLCanvasElement) {
  const d = ctx2d(src).getImageData(0, 0, src.width, src.height).data;
  const g = new Uint8ClampedArray(src.width * src.height);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return g;
}

function otsu(g: Uint8ClampedArray) {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v]++;
  const total = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; th = t; }
  }
  return th;
}

/** Qiyshiqlik burchagini aniqlash (proyeksiya profili usuli), gradusda. Matn qatorlari gorizontal bo'lishi uchun shu burchakka aylantirish kerak. */
export function detectSkew(src: HTMLCanvasElement, range = 12): number {
  const small = limitSize(src, 900);
  const w = small.width, h = small.height;
  const g = grayData(small);
  const th = otsu(g);
  const pts: number[] = [];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 2) if (g[y * w + x] < th) pts.push(x, y);
  if (pts.length < 200) return 0;
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180, s = Math.sin(a), c = Math.cos(a);
    const bins = new Float64Array(Math.ceil(h + w) + 2);
    const off = w;
    for (let i = 0; i < pts.length; i += 2) {
      const y2 = pts[i] * s + pts[i + 1] * c + off;
      bins[y2 | 0]++;
    }
    let acc = 0;
    for (let i = 1; i < bins.length; i++) { const d = bins[i] - bins[i - 1]; acc += d * d; }
    return acc;
  };
  let best = 0, bestS = -1;
  for (let d = -range; d <= range; d += 0.5) { const v = score(d); if (v > bestS) { bestS = v; best = d; } }
  const base = best;
  for (let d = base - 0.5; d <= base + 0.5; d += 0.1) { const v = score(d); if (v > bestS) { bestS = v; best = d; } }
  return Math.round(best * 10) / 10;
}

/** Avtomatik tekislash: aniqlangan burchakka aylantiradi */
export function autoDeskew(src: HTMLCanvasElement) {
  const a = detectSkew(src);
  return { canvas: Math.abs(a) >= 0.2 ? rotateDeg(src, a) : src, angle: a };
}

/** Sifatni oshirish: kulrang, kontrastni cho'zish, kichik rasmni kattalashtirish */
export function enhance(src: HTMLCanvasElement) {
  const scale = Math.max(src.width, src.height) < 1400 ? 2 : 1;
  const c = makeCanvas(src.width * scale, src.height * scale);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  const img = x.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Array(256).fill(0);
  const gray = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    gray[j] = v;
    hist[v | 0]++;
  }
  const n = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  x.putImageData(img, 0, 0);
  return c;
}

export function thumbnail(src: HTMLCanvasElement, max = 240) {
  return limitSize(src, max).toDataURL('image/jpeg', 0.7);
}

/** AI'ga yuborish uchun: JPEG base64 (prefikssiz) */
export function toBase64Jpeg(src: HTMLCanvasElement, maxSide = 2200, quality = 0.9) {
  const c = limitSize(src, maxSide);
  const url = c.toDataURL('image/jpeg', quality);
  return { data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' };
}

/** Rasmdagi hujjat chegaralarini taxminiy topish (perspektiva uchun boshlang'ich burchaklar) */
export function guessDocumentQuad(src: HTMLCanvasElement): Point[] {
  const small = limitSize(src, 500);
  const s = src.width / small.width;
  const w = small.width, h = small.height;
  const g = grayData(small);
  const th = otsu(g);
  // och (qog'oz) piksellarning tashqi chegarasi bo'yicha burchaklar
  let tl = { x: 0, y: 0, v: Infinity }, tr = { x: w, y: 0, v: -Infinity }, br = { x: w, y: h, v: -Infinity }, bl = { x: 0, y: h, v: Infinity };
  let found = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (g[y * w + x] <= th) continue;
    found++;
    if (x + y < tl.v) tl = { x, y, v: x + y };
    if (x - y > tr.v) tr = { x, y, v: x - y };
    if (x + y > br.v) br = { x, y, v: x + y };
    if (x - y < bl.v) bl = { x, y, v: x - y };
  }
  const area = Math.abs((tr.x - tl.x) * (bl.y - tl.y));
  if (found < 100 || area < w * h * 0.2) {
    const m = 0.04;
    return [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }].map((p) => ({ x: p.x * s, y: p.y * s }));
  }
  return [tl, tr, br, bl].map((p) => ({ x: p.x * s, y: p.y * s }));
}
