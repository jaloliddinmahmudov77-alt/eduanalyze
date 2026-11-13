import { COMPETENCES, getCompetences, type Criterion, type ReportData, type Student } from './types';

/**
 * Hisob-kitob qoidalari (Excel formulalari bilan bir xil, oddiy: BALL / MAKSIMAL BALL):
 *  - O'quvchi foizi = olgan ballari yig'indisi / maksimal ball (Excel: =JAMI/JAMI_MAX).
 *  - Ball qo'yilgan o'quvchining bo'sh katagi 0 deb olinadi.
 *  - Hech kimga ball qo'yilmagan (bo'sh) mezon maksimal ballga qo'shilmaydi — masalan, qo'shilib, hali to'ldirilmagan ustun.
 *  - Kompetensiya foizi = shu kompetensiya mezonlari ballari / ularning maksimal ballari.
 *  - Ball olmagan (jami 0, masalan kelmagan) o'quvchi sinf natijalariga qo'shilmaydi (Excel: COUNTIF(jami,">0")).
 *  - Mezoni bo'lmagan kompetensiya foizi 0.
 */

export const isScore = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const round = (v: number, d = 2) => {
  const p = 10 ** d;
  return Math.round(v * p + 1e-7) / p;
};

// (got*100)/max — float xatosini kamaytiradi: 20.5/40 → 51.25 (51.24999… emas)
const pct = (got: number, max: number) => (max > 0 ? Math.min(100, Math.max(0, (got * 100) / max)) : 0);

export interface StudentResult {
  participated: boolean;
  total: number;
  percent: number;
  comp: Record<string, number>; // foiz
  compRaw: Record<string, number>; // ball
}

export interface ClassResult {
  maxTotal: number; // faol mezonlar maksimal ballari yig'indisi
  compMax: Record<string, number>;
  participants: number;
  criterionSum: Record<string, number>;
  criterionMax: Record<string, number>; // max * qatnashganlar soni
  criterionPercent: Record<string, number>;
  totalSum: number;
  totalMax: number;
  percent: number;
  compSum: Record<string, number>;
  compClassMax: Record<string, number>;
  compPercent: Record<string, number>;
  grades: { five: number; four: number; three: number; two: number };
}

const zeroComp = (ids: string[]): Record<string, number> => Object.fromEntries(ids.map((i) => [i, 0]));
/** Kompetensiya ro'yxati berilmasa: standart uchta + mezonlarda uchraganlar */
const defaultIds = (criteria: Criterion[]) => [...new Set([...COMPETENCES, ...criteria.map((c) => c.type).filter(Boolean)])];

export function maxTotal(criteria: Criterion[]) {
  return round(criteria.reduce((a, c) => a + c.max, 0), 4);
}

export function competenceMax(criteria: Criterion[], ids: string[] = defaultIds(criteria)) {
  const m = zeroComp(ids);
  for (const c of criteria) if (c.type in m) m[c.type] += c.max;
  return m;
}

/** Faol mezonlar: kamida bitta o'quvchiga ball qo'yilganlari (hech biri bo'lmasa — hammasi) */
export function activeCriteria(data: ReportData): Criterion[] {
  const used = data.criteria.filter((c) => data.students.some((s) => isScore(s.scores[c.id])));
  return used.length ? used : data.criteria;
}

/** criteria — maksimal ball hisoblanadigan mezonlar (odatda activeCriteria(data)) */
export function computeStudent(criteria: Criterion[], s: Student, compIds: string[] = defaultIds(criteria)): StudentResult {
  const compRaw = zeroComp(compIds);
  let total = 0;
  for (const c of criteria) {
    const v = s.scores[c.id];
    if (isScore(v)) {
      total += v;
      if (c.type in compRaw) compRaw[c.type] += v;
    }
  }
  const cm = competenceMax(criteria, compIds);
  const comp = zeroComp(compIds);
  for (const k of compIds) comp[k] = pct(compRaw[k], cm[k]);
  // Excel: COUNTIF(jami, ">0") — ball olgan o'quvchilar sinf natijasiga kiradi
  const participated = total > 0;
  return { participated, total: round(total, 4), percent: pct(total, maxTotal(criteria)), comp, compRaw };
}

/** 5 baholik shkala: 86–100 → 5, 71–85 → 4, 56–70 → 3, 0–55 → 2 */
export function gradeOf(percent: number) {
  if (percent >= 86) return 5;
  if (percent >= 71) return 4;
  if (percent >= 56) return 3;
  return 2;
}

export function computeClass(data: ReportData): ClassResult {
  const { students } = data;
  const active = activeCriteria(data);
  const activeIds = new Set(active.map((c) => c.id));
  const compIds = getCompetences(data).map((c) => c.id);
  const mt = maxTotal(active);
  const cm = competenceMax(active, compIds);
  const results = students.map((s) => computeStudent(active, s, compIds));
  const participants = results.filter((r) => r.participated).length;
  const criterionSum: Record<string, number> = {};
  const criterionMax: Record<string, number> = {};
  const criterionPercent: Record<string, number> = {};
  for (const c of data.criteria) {
    let sum = 0;
    students.forEach((s, i) => {
      const v = s.scores[c.id];
      if (results[i].participated && isScore(v)) sum += v;
    });
    const max = activeIds.has(c.id) ? c.max * participants : 0;
    criterionSum[c.id] = round(sum, 4);
    criterionMax[c.id] = round(max, 4);
    criterionPercent[c.id] = pct(sum, max);
  }
  const totalSum = round(results.reduce((a, r) => a + (r.participated ? r.total : 0), 0), 4);
  const totalMax = round(mt * participants, 4);
  const compSum = zeroComp(compIds);
  const compClassMax = zeroComp(compIds);
  const compPercent = zeroComp(compIds);
  for (const k of compIds) {
    compSum[k] = round(results.reduce((a, r) => a + (r.participated ? r.compRaw[k] : 0), 0), 4);
    compClassMax[k] = round(cm[k] * participants, 4);
    compPercent[k] = pct(compSum[k], compClassMax[k]);
  }
  const grades = { five: 0, four: 0, three: 0, two: 0 };
  for (const r of results) {
    if (!r.participated) continue;
    const g = gradeOf(r.percent);
    if (g === 5) grades.five++;
    else if (g === 4) grades.four++;
    else if (g === 3) grades.three++;
    else grades.two++;
  }
  return {
    maxTotal: mt, compMax: cm, participants, criterionSum, criterionMax, criterionPercent,
    totalSum, totalMax, percent: pct(totalSum, totalMax), compSum, compClassMax, compPercent, grades,
  };
}

export const fmtPct = (v: number) => `${round(v, 1).toFixed(1).replace(/\.0$/, '').replace('.', ',')}%`;
export const fmtNum = (v: number) => String(round(v, 2)).replace('.', ',');

/** Ballni matndan o'qish: "4,5" → 4.5; bo'sh → null; noto'g'ri → NaN */
export function parseScore(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return Number.NaN;
  return Number(t);
}

export function validateScore(v: number | null, c: Criterion): string | null {
  if (v === null) return null;
  if (Number.isNaN(v)) return 'Faqat son kiriting';
  if (v < 0) return 'Manfiy ball kiritib bo‘lmaydi';
  if (v > c.max) return `“${c.name}” uchun maksimal ball — ${c.max}`;
  return null;
}

let idCounter = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const normalizeName = (s: string) =>
  s.toLowerCase().replace(/[‘’ʻʼ`´']/g, "'").replace(/\s+/g, ' ').trim();

/** Takroriy ismlar: normalizatsiyadan keyin bir xil bo'lganlar */
export function duplicateIds(students: Student[]) {
  const seen = new Map<string, string[]>();
  for (const s of students) {
    const k = normalizeName(s.name);
    if (!k) continue;
    seen.set(k, [...(seen.get(k) || []), s.id]);
  }
  const out = new Set<string>();
  for (const ids of seen.values()) if (ids.length > 1) ids.forEach((i) => out.add(i));
  return out;
}
