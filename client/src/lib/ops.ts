import { isScore, normalizeName, uid } from './calc';
import { COMPETENCE_LABEL, getCompetences, type Competence, type CompetenceDef, type Criterion, type ReportData, type Student } from './types';

/** Ma'lumotlar ustidagi o'zgarmas (immutable) amallar. Xatolikda Error tashlanadi. */

export function addStudents(d: ReportData, names: string[], at = d.students.length): ReportData {
  const add: Student[] = names.map((name) => ({ id: uid('s'), name, scores: {} }));
  const students = [...d.students];
  students.splice(at, 0, ...add);
  return { ...d, students };
}

export function replaceStudents(d: ReportData, names: string[]): ReportData {
  return { ...d, students: names.map((name) => ({ id: uid('s'), name, scores: {} })) };
}

export function removeStudents(d: ReportData, ids: Set<string>): ReportData {
  return { ...d, students: d.students.filter((s) => !ids.has(s.id)) };
}

export function renameStudent(d: ReportData, id: string, name: string): ReportData {
  return { ...d, students: d.students.map((s) => (s.id === id ? { ...s, name } : s)) };
}

export function moveStudent(d: ReportData, id: string, dir: -1 | 1): ReportData {
  const i = d.students.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.students.length) return d;
  const students = [...d.students];
  [students[i], students[j]] = [students[j], students[i]];
  return { ...d, students };
}

export function sortStudents(d: ReportData): ReportData {
  return { ...d, students: [...d.students].sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), 'uz')) };
}

export function setScore(d: ReportData, studentId: string, critId: string, v: number | null): ReportData {
  return {
    ...d,
    students: d.students.map((s) => {
      if (s.id !== studentId) return s;
      const scores = { ...s.scores };
      if (v === null) delete scores[critId];
      else scores[critId] = v;
      return { ...s, scores };
    }),
  };
}

export function addCriterion(d: ReportData, c?: Partial<Criterion>, at = d.criteria.length): ReportData {
  const crit: Criterion = {
    id: uid('c'),
    name: c?.name ?? `Mezon ${d.criteria.length + 1}`,
    max: c?.max ?? 10,
    type: c?.type ?? 'bilish',
  };
  const criteria = [...d.criteria];
  criteria.splice(at, 0, crit);
  return { ...d, criteria };
}

export function removeCriteria(d: ReportData, ids: Set<string>): ReportData {
  return {
    ...d,
    criteria: d.criteria.filter((c) => !ids.has(c.id)),
    students: d.students.map((s) => {
      const scores = { ...s.scores };
      ids.forEach((id) => delete scores[id]);
      return { ...s, scores };
    }),
  };
}

export function updateCriterion(d: ReportData, id: string, patch: Partial<Pick<Criterion, 'name' | 'max' | 'type'>>): ReportData {
  const c = d.criteria.find((x) => x.id === id);
  if (!c) return d;
  if (patch.max !== undefined) {
    if (!Number.isFinite(patch.max) || patch.max <= 0) throw new Error('Maksimal ball musbat son bo‘lishi kerak');
    if (patch.max > 1000) throw new Error('Maksimal ball juda katta');
    const over = d.students.filter((s) => isScore(s.scores[id]) && (s.scores[id] as number) > patch.max!);
    if (over.length)
      throw new Error(`${over.length} ta o‘quvchining “${c.name}” bo‘yicha bali ${patch.max} dan katta. Avval ballarni tuzating`);
  }
  return { ...d, criteria: d.criteria.map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}

export function moveCriterion(d: ReportData, id: string, dir: -1 | 1): ReportData {
  const i = d.criteria.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.criteria.length) return d;
  const criteria = [...d.criteria];
  [criteria[i], criteria[j]] = [criteria[j], criteria[i]];
  return { ...d, criteria };
}

export function parseCompetence(t: string): Competence | null {
  const s = t.trim().toLowerCase();
  for (const [k, v] of Object.entries(COMPETENCE_LABEL)) if (v.toLowerCase() === s || k === s) return k as Competence;
  if (s.startsWith('bil')) return 'bilish';
  if (s.startsWith('qo')) return 'qollash';
  if (s.startsWith('mul')) return 'mulohaza';
  return null;
}

// ---------- kompetensiya ustunlari (Bilish, Qo'llash, Mulohaza ...) ----------

/** Yangi kompetensiya ustuni qo'shish (at — joylashadigan o'rin) */
export function addCompetence(d: ReportData, name = 'Yangi kompetensiya', at?: number): ReportData {
  const list = [...getCompetences(d)];
  const def: CompetenceDef = { id: uid('k'), name: name.trim().slice(0, 40) || 'Yangi kompetensiya' };
  list.splice(at ?? list.length, 0, def);
  return { ...d, competences: list };
}

export function renameCompetence(d: ReportData, id: string, name: string): ReportData {
  return { ...d, competences: getCompetences(d).map((c) => (c.id === id ? { ...c, name: name.slice(0, 40) } : c)) };
}

export function moveCompetence(d: ReportData, id: string, dir: -1 | 1): ReportData {
  const list = [...getCompetences(d)];
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return d;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...d, competences: list };
}

/** Kompetensiyani o'chirish: unga biriktirilgan mezonlar hech qaysi kompetensiyaga hisoblanmaydi (keyin boshqasiga biriktirish mumkin) */
export function removeCompetence(d: ReportData, id: string): ReportData {
  return {
    ...d,
    competences: getCompetences(d).filter((c) => c.id !== id),
    criteria: d.criteria.map((c) => (c.type === id ? { ...c, type: '' } : c)),
  };
}
