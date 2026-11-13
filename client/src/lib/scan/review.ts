import { normalizeName, uid } from '../calc';
import { COMPETENCES, type Competence, type ReportData } from '../types';
import type { ColKind, ScanCell, ScanTable } from './types';

/** AI/OCR natijasini tekshirish oynasi uchun model va uni asosiy jadvalga qo'llash. */

export const LOW_CONFIDENCE = 0.75;

export interface ReviewCell extends ScanCell {
  flag: string | null; // null — muammo yo'q; aks holda tekshirish kerak (sabab)
  alt?: number | null; // ikkinchi dvigatel o'qigan qiymat
}

export interface ReviewRow {
  key: string;
  page: number;
  index: number | null;
  name: string;
  nameFlag: string | null;
  cells: ReviewCell[];
  include: boolean;
  target: string; // mavjud o'quvchi id si yoki 'new'
  rowFlags: string[];
}

export interface ReviewColumn {
  label: string;
  max: number | null;
  kind: ColKind;
  target: string; // mezon id si, 'new' yoki 'ignore'
  newName: string;
  newType: Competence;
}

export interface ReviewState {
  columns: ReviewColumn[];
  rows: ReviewRow[];
  warnings: string[];
}

export interface PageResult {
  page: number;
  table: ScanTable; // asosiy natija
  compare?: ScanTable; // solishtirish uchun ikkinchi dvigatel natijasi
}

function levenshtein(a: string, b: string) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export function nameSimilarity(a: string, b: string) {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

const scoreIdx = (kinds: ColKind[]) => kinds.map((k, i) => (k === 'score' ? i : -1)).filter((i) => i >= 0);

/** Ikkinchi dvigatel (OCR) natijasi bilan solishtirib, farqli kataklarni belgilash */
function compareInto(rows: ReviewRow[], baseKinds: ColKind[], other: ScanTable) {
  const baseScore = scoreIdx(baseKinds);
  const otherScore = scoreIdx(other.columns.map((c) => c.kind));
  const used = new Set<number>();
  for (const r of rows) {
    let best = -1, bestSim = 0;
    other.rows.forEach((o, i) => {
      if (used.has(i)) return;
      let sim = nameSimilarity(r.name, o.name);
      if (r.index !== null && o.index === r.index) sim += 0.3;
      if (sim > bestSim) { bestSim = sim; best = i; }
    });
    if (best < 0 || bestSim < 0.6) continue;
    used.add(best);
    const o = other.rows[best];
    baseScore.forEach((ci, k) => {
      const oi = otherScore[k];
      if (oi === undefined) return;
      const cell = r.cells[ci];
      const ov = o.cells[oi]?.value ?? null;
      if (cell.value === null && ov === null) return;
      if (cell.value !== ov) {
        cell.alt = ov;
        cell.flag = cell.value === null ? `Asosiy natija o‘qimadi, ikkinchisi: ${ov}` : `Natijalar farq qiladi: ${cell.value} / ${ov ?? '—'}`;
      }
    });
  }
}

export function buildReview(pages: PageResult[], data: ReportData): ReviewState {
  const warnings: string[] = [];
  const valid = pages.filter((p) => p.table.columns.length && p.table.rows.length);
  if (!valid.length) return { columns: [], rows: [], warnings: ['Rasmlardan jadval aniqlanmadi. Rasmni tekislab yoki aniqroq suratga olib qayta urinib ko‘ring'] };

  const base = valid.reduce((a, b) => (b.table.columns.length > a.table.columns.length ? b : a));
  const kinds = base.table.columns.map((c) => c.kind);
  const scoreCols = scoreIdx(kinds);
  const nScores = scoreCols.length;

  const columns: ReviewColumn[] = base.table.columns.map((c, i) => {
    const k = scoreCols.indexOf(i);
    // maks. ballni boshqa sahifalardan ham olishga harakat
    const max = c.max ?? valid.map((p) => p.table.columns[i]?.max ?? null).find((m) => m !== null) ?? null;
    let target = 'ignore';
    if (k >= 0) {
      const crit = data.criteria[k];
      target = crit && (max === null || Math.abs(crit.max - max) < 1e-9) ? crit.id : 'new';
    }
    const numericLabel = /^\d+([.,]\d+)?$/.test(c.label) || /-ustun$/.test(c.label);
    return {
      label: c.label,
      max: k >= 0 && target !== 'new' && target !== 'ignore' ? data.criteria[k].max : max,
      kind: c.kind,
      target,
      newName: numericLabel ? `${k + 1}-topshiriq` : c.label,
      newType: nScores === 3 && k >= 0 ? COMPETENCES[k] : 'bilish',
    };
  });

  const rows: ReviewRow[] = [];
  const seen = new Map<string, number>();
  for (const p of valid) {
    if (p.table.columns.length !== columns.length)
      warnings.push(`${p.page}-sahifada ustunlar soni (${p.table.columns.length}) boshqacha — kataklarni diqqat bilan tekshiring`);
    const pageRows: ReviewRow[] = p.table.rows.map((r) => {
      const cells: ReviewCell[] = columns.map((_, i) => {
        const c = r.cells[i] ?? { value: null, raw: '', confidence: 1 };
        let flag: string | null = null;
        if (c.value === null && c.raw) flag = `O‘qib bo‘lmadi: “${c.raw}”`;
        else if (c.value !== null && c.confidence < LOW_CONFIDENCE) flag = 'Ishonch past — tekshiring';
        return { ...c, flag };
      });
      return {
        key: uid('r'), page: p.page, index: r.index, name: r.name.trim(),
        nameFlag: r.nameConfidence < 0.6 ? 'Ism aniq o‘qilmadi' : null,
        cells, include: true, target: 'new', rowFlags: [],
      };
    });
    if (p.compare) compareInto(pageRows, kinds, p.compare);
    for (const r of pageRows) {
      const k = normalizeName(r.name);
      if (k && seen.has(k)) {
        r.include = false;
        r.rowFlags.push(`Takror: ${seen.get(k)}-sahifada ham bor`);
      } else if (k) seen.set(k, p.page);
      rows.push(r);
    }
  }

  // mavjud o'quvchilar bilan moslash
  for (const r of rows) {
    let best: string | null = null, bestSim = 0;
    for (const s of data.students) {
      const sim = nameSimilarity(r.name, s.name);
      if (sim > bestSim) { bestSim = sim; best = s.id; }
    }
    if (best && bestSim >= 0.999) r.target = best;
    else if (best && bestSim >= 0.85) { r.target = best; r.rowFlags.push('Ism ro‘yxatdagiga o‘xshash — mosligini tekshiring'); }
  }
  validateRows({ columns, rows, warnings });
  return { columns, rows, warnings };
}

/** Maksimaldan oshgan ball va "Jami" mos kelmasligini tekshirish (tahrirdan keyin ham chaqiriladi) */
export function validateRows(st: ReviewState) {
  const totalCol = st.columns.findIndex((c) => c.kind === 'total');
  const scoreCols = st.columns.map((c, i) => (c.target !== 'ignore' ? i : -1)).filter((i) => i >= 0);
  for (const r of st.rows) {
    r.rowFlags = r.rowFlags.filter((f) => !f.startsWith('Jami mos emas'));
    r.cells.forEach((c, i) => {
      const col = st.columns[i];
      if (col.target === 'ignore') return;
      const over = c.value !== null && col.max !== null && c.value > col.max;
      if (over) c.flag = `Maksimal ball (${col.max}) dan katta`;
      else if (c.flag?.startsWith('Maksimal ball')) c.flag = null;
      if (c.value !== null && c.value < 0) c.flag = 'Manfiy ball';
    });
    if (totalCol >= 0) {
      const t = r.cells[totalCol]?.value;
      const parts = scoreCols.map((i) => r.cells[i].value);
      if (t !== null && t !== undefined && parts.length && parts.every((v) => v !== null)) {
        const sum = (parts as number[]).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - t) > 0.01) r.rowFlags.push(`Jami mos emas: rasmda ${t}, ballar yig‘indisi ${Math.round(sum * 100) / 100}`);
      }
    }
  }
}

export function unresolvedCount(st: ReviewState) {
  let n = 0;
  for (const r of st.rows) {
    if (!r.include) continue;
    st.columns.forEach((c, i) => { if (c.target !== 'ignore' && r.cells[i].flag) n++; });
  }
  return n;
}

export interface ApplyResult { data: ReportData; added: number; updated: number; skippedCells: number }

/** Tasdiqlangan natijani asosiy jadvalga qo'llash. Tekshirilmagan (belgili) kataklar bo'sh qoldiriladi. */
export function applyReview(data: ReportData, st: ReviewState): ApplyResult {
  const used = st.columns.filter((c) => c.target !== 'ignore');
  if (!used.length) throw new Error('Kamida bitta ustunni mezonga moslang');
  for (const c of used) {
    if (c.target === 'new' && (!c.max || c.max <= 0)) throw new Error(`“${c.newName || c.label}” ustuni uchun maksimal ballni kiriting`);
  }
  const targets = used.filter((c) => c.target !== 'new').map((c) => c.target);
  if (new Set(targets).size !== targets.length) throw new Error('Ikki ustun bitta mezonga moslangan. Har bir mezonni faqat bitta ustunga tanlang');

  const criteria = [...data.criteria];
  const colCrit = st.columns.map((c) => {
    if (c.target === 'ignore') return null;
    if (c.target === 'new') {
      const crit = { id: uid('c'), name: c.newName.trim() || c.label, max: c.max as number, type: c.newType };
      criteria.push(crit);
      return crit;
    }
    return criteria.find((x) => x.id === c.target) || null;
  });

  let added = 0, updated = 0, skippedCells = 0;
  const students = data.students.map((s) => ({ ...s, scores: { ...s.scores } }));
  for (const r of st.rows) {
    if (!r.include) continue;
    if (!r.name.trim()) throw new Error(`${r.page}-sahifadagi qatorlardan birida ism yo‘q`);
    let s = r.target !== 'new' ? students.find((x) => x.id === r.target) : undefined;
    if (!s) {
      s = { id: uid('s'), name: r.name.trim(), scores: {} };
      students.push(s);
      added++;
    } else updated++;
    r.cells.forEach((cell, i) => {
      const crit = colCrit[i];
      if (!crit) return;
      if (cell.flag) { skippedCells++; return; }
      if (cell.value === null) return;
      if (cell.value < 0 || cell.value > crit.max) throw new Error(`${r.name}: “${crit.name}” bo‘yicha ${cell.value} ball noto‘g‘ri (max ${crit.max})`);
      s!.scores[crit.id] = cell.value;
    });
  }
  return { data: { criteria, students }, added, updated, skippedCells };
}

/** Server AI javobini ScanTable ko'rinishiga keltirish (noto'g'ri shakldagi javobdan himoya) */
export function normalizeAiTable(raw: unknown): ScanTable {
  const r = (raw || {}) as { columns?: unknown[]; rows?: unknown[]; notes?: string };
  const kinds: ColKind[] = ['score', 'total', 'percent', 'bilish', 'qollash', 'mulohaza', 'other'];
  const columns = (Array.isArray(r.columns) ? r.columns : []).map((c, i) => {
    const o = (c || {}) as { label?: unknown; max?: unknown; kind?: unknown };
    const kind = kinds.includes(o.kind as ColKind) ? (o.kind as ColKind) : 'other';
    const max = typeof o.max === 'number' && o.max > 0 ? o.max : null;
    return { label: String(o.label ?? `${i + 1}-ustun`), max, kind };
  });
  const clamp01 = (v: unknown) => (typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 0);
  const rows = (Array.isArray(r.rows) ? r.rows : []).map((x) => {
    const o = (x || {}) as { index?: unknown; name?: unknown; nameConfidence?: unknown; cells?: unknown[] };
    const cells = columns.map((_, i) => {
      const c = ((Array.isArray(o.cells) ? o.cells[i] : null) || {}) as { value?: unknown; raw?: unknown; confidence?: unknown };
      const value = typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : null;
      return { value, raw: String(c.raw ?? (value ?? '')), confidence: clamp01(c.confidence ?? (value === null ? 1 : 0.5)) };
    });
    return {
      index: typeof o.index === 'number' ? o.index : null,
      name: String(o.name ?? '').trim(),
      nameConfidence: clamp01(o.nameConfidence ?? 0.9),
      cells,
    };
  }).filter((x) => x.name);
  return { engine: 'ai', columns, rows, notes: r.notes };
}
