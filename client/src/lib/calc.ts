import { COMPETENCES, type Competence, type Criterion, type ReportData, type Student } from './types';

/**
 * Hisob-kitob qoidalari (Excel formulalari bilan bir xil):
 *  - Bo'sh katak = baholanmagan: na balli, na maksimal bali hisobga kirmaydi. 0 = nol ball (hisobga kiradi).
 *  - O'quvchi foizi = kiritilgan ballar yig'indisi / shu mezonlar maksimal ballari yig'indisi.
 *  - Kompetensiya foizi — faqat shu kompetensiyaga tegishli va ball kiritilgan mezonlar bo'yicha.
 *  - Hech qanday ball kiritilmagan o'quvchi (masalan, kelmagan) sinf natijalariga qo'shilmaydi.
 *  - Mezoni (yoki baholangan mezoni) bo'lmagan kompetensiya foizi 0.
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
  comp: Record<Competence, number>; // foiz
  compRaw: Record<Competence, number>; // ball
  max: number; // baholangan mezonlarning maksimal ballari yig'indisi
  compMaxRaw: Record<Competence, number>;
}

export interface ClassResult {
  maxTotal: number;
  compMax: Record<Competence, number>;
  participants: number;
  criterionSum: Record<string, number>;
  criterionMax: Record<string, number>; // max * shu mezon bo'yicha baholanganlar soni
  criterionPercent: Record<string, number>;
  totalSum: number;
  totalMax: number;
  percent: number;
  compSum: Record<Competence, number>;
  compClassMax: Record<Competence, number>;
  compPercent: Record<Competence, number>;
  grades: { five: number; four: number; three: number; two: number };
}

const zeroComp = (): Record<Competence, number> => ({ bilish: 0, qollash: 0, mulohaza: 0 });

export function maxTotal(criteria: Criterion[]) {
  return round(criteria.reduce((a, c) => a + c.max, 0), 4);
}

export function competenceMax(criteria: Criterion[]) {
  const m = zeroComp();
  for (const c of criteria) m[c.type] += c.max;
  return m;
}

export function computeStudent(criteria: Criterion[], s: Student): StudentResult {
  const participated = criteria.some((c) => isScore(s.scores[c.id]));
  const compRaw = zeroComp();
  const compMaxRaw = zeroComp();
  let total = 0;
  let max = 0;
  for (const c of criteria) {
    const v = s.scores[c.id];
    if (isScore(v)) {
      total += v;
      max += c.max;
      compRaw[c.type] += v;
      compMaxRaw[c.type] += c.max;
    }
  }
  const comp = zeroComp();
  for (const k of COMPETENCES) comp[k] = pct(compRaw[k], compMaxRaw[k]);
  return { participated, total: round(total, 4), percent: pct(total, max), comp, compRaw, max: round(max, 4), compMaxRaw };
}

/** 5 baholik shkala: 86–100 → 5, 71–85 → 4, 56–70 → 3, 0–55 → 2 */
export function gradeOf(percent: number) {
  if (percent >= 86) return 5;
  if (percent >= 71) return 4;
  if (percent >= 56) return 3;
  return 2;
}

export function computeClass(data: ReportData): ClassResult {
  const { criteria, students } = data;
  const mt = maxTotal(criteria);
  const cm = competenceMax(criteria);
  const results = students.map((s) => computeStudent(criteria, s));
  const participants = results.filter((r) => r.participated).length;
  const criterionSum: Record<string, number> = {};
  const criterionMax: Record<string, number> = {};
  const criterionPercent: Record<string, number> = {};
  for (const c of criteria) {
    let sum = 0;
    let graded = 0;
    for (const s of students) {
      const v = s.scores[c.id];
      if (isScore(v)) { sum += v; graded++; }
    }
    criterionSum[c.id] = round(sum, 4);
    criterionMax[c.id] = round(c.max * graded, 4);
    criterionPercent[c.id] = pct(sum, c.max * graded);
  }
  const totalSum = round(results.reduce((a, r) => a + (r.participated ? r.total : 0), 0), 4);
  const totalMax = round(results.reduce((a, r) => a + r.max, 0), 4);
  const compSum = zeroComp();
  const compClassMax = zeroComp();
  const compPercent = zeroComp();
  for (const k of COMPETENCES) {
    compSum[k] = round(results.reduce((a, r) => a + (r.participated ? r.compRaw[k] : 0), 0), 4);
    compClassMax[k] = round(results.reduce((a, r) => a + r.compMaxRaw[k], 0), 4);
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
