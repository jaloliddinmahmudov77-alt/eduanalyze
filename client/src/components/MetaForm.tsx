import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CONTROL_TYPES, type ControlType, type ReportMeta } from '../lib/types';
import { Field } from './ui';

export function currentAcademicYear() {
  const d = new Date();
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${y + 1}`;
}

export function MetaForm({ value, onChange }: { value: ReportMeta; onChange: (m: ReportMeta) => void }) {
  const [classes, setClasses] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  useEffect(() => {
    api.catalog().then((c) => {
      setClasses(c.classes.map((x) => x.name));
      setSubjects(c.subjects.map((x) => x.name));
    }).catch(() => {});
  }, []);
  const set = <K extends keyof ReportMeta>(k: K, v: ReportMeta[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Maktab nomi" className="sm:col-span-2">
        <input className="input" value={value.school} onChange={(e) => set('school', e.target.value)} placeholder="Masalan: 12-son umumiy o‘rta ta’lim maktabi" />
      </Field>
      <Field label="Sinf *" hint="Masalan: 6-A, 7-B, 10-B">
        <input className="input" list="dl-classes" value={value.className} onChange={(e) => set('className', e.target.value.toUpperCase())} placeholder="6-A" required />
        <datalist id="dl-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="Guruh" hint="Masalan: I yoki II (bo‘lmasa bo‘sh qoldiring)">
        <input className="input" value={value.groupName} onChange={(e) => set('groupName', e.target.value)} placeholder="II" />
      </Field>
      <Field label="O‘quv yili">
        <input className="input" value={value.academicYear} onChange={(e) => set('academicYear', e.target.value)} placeholder="2026/2027" />
      </Field>
      <Field label="Fan nomi *">
        <input className="input" list="dl-subjects" value={value.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Ingliz tili" required />
        <datalist id="dl-subjects">{subjects.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="Nazorat turi *">
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
          {CONTROL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set('controlType', t as ControlType)}
              className={`h-8 rounded-md text-[13px] font-medium transition-colors ${value.controlType === t ? 'bg-white text-navy-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>
      <Field label="O‘qituvchining F.I.O.">
        <input className="input" value={value.teacherName} onChange={(e) => set('teacherName', e.target.value)} placeholder="Familiya Ism Otasining ismi" />
      </Field>
    </div>
  );
}
