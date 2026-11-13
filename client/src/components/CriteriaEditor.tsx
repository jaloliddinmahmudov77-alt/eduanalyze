import clsx from 'clsx';
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { competenceMax, fmtNum, maxTotal } from '../lib/calc';
import { addCriterion, moveCriterion, removeCriteria, updateCriterion } from '../lib/ops';
import { COMPETENCES, COMPETENCE_LABEL, type Competence, type Criterion, type ReportData } from '../lib/types';
import { useFeedback } from './feedback';
import { Button, EmptyState } from './ui';

export const competenceTone: Record<Competence, string> = {
  bilish: 'bg-sky-50 text-sky-800 ring-sky-200',
  qollash: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  mulohaza: 'bg-violet-50 text-violet-800 ring-violet-200',
};

function MaxInput({ c, onCommit }: { c: Criterion; onCommit: (v: number) => boolean }) {
  const [v, setV] = useState(String(c.max));
  useEffect(() => setV(String(c.max)), [c.max]);
  const commit = () => {
    const n = Number(v.replace(',', '.'));
    if (!onCommit(n)) setV(String(c.max));
  };
  return (
    <input
      className="input h-9 w-full text-center tabular-nums"
      inputMode="decimal"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label="Maksimal ball"
    />
  );
}

export function CriteriaEditor({ data, onChange }: { data: ReportData; onChange: (d: ReportData) => void }) {
  const { toast, confirm } = useFeedback();
  const cm = competenceMax(data.criteria);
  const tryChange = (fn: () => ReportData) => {
    try { onChange(fn()); return true; } catch (e) { toast((e as Error).message, 'error'); return false; }
  };
  const hasScores = (id: string) => data.students.some((s) => typeof s.scores[id] === 'number');

  return (
    <div>
      {data.criteria.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300">
          <EmptyState icon={<ListChecks className="size-6" />} title="Mezonlar hali qo‘shilmagan"
            text="Masalan: Listening (6, Bilish), Reading (28, Qo‘llash), Writing (6, Mulohaza)"
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => onChange(addCriterion(data))}>Mezon qo‘shish</Button>} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="w-10 px-3 py-2.5">№</th>
                <th className="px-2 py-2.5">Mezon nomi</th>
                <th className="w-28 px-2 py-2.5 text-center">Maksimal ball</th>
                <th className="w-44 px-2 py-2.5">Kompetensiya</th>
                <th className="w-28 px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.criteria.map((c, i) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 text-slate-400 tabular-nums">{i + 1}</td>
                  <td className="px-2 py-2">
                    <input className="input h-9" value={c.name} onChange={(e) => tryChange(() => updateCriterion(data, c.id, { name: e.target.value }))} aria-label="Mezon nomi" />
                  </td>
                  <td className="px-2 py-2">
                    <MaxInput c={c} onCommit={(n) => n === c.max || tryChange(() => updateCriterion(data, c.id, { max: n }))} />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      className={clsx('input h-9 font-medium ring-1 ring-inset', competenceTone[c.type])}
                      value={c.type}
                      onChange={(e) => tryChange(() => updateCriterion(data, c.id, { type: e.target.value as Competence }))}
                    >
                      {COMPETENCES.map((k) => <option key={k} value={k}>{COMPETENCE_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end">
                      <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => onChange(moveCriterion(data, c.id, -1))} aria-label="Chapga"><ArrowUp className="size-4" /></button>
                      <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={i === data.criteria.length - 1} onClick={() => onChange(moveCriterion(data, c.id, 1))} aria-label="O‘ngga"><ArrowDown className="size-4" /></button>
                      <button
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label="O‘chirish"
                        onClick={async () => {
                          if (hasScores(c.id) && !(await confirm({ title: 'Mezonni o‘chirish', text: `“${c.name}” mezoni va unga kiritilgan barcha ballar o‘chiriladi.`, danger: true, confirmText: 'O‘chirish' }))) return;
                          onChange(removeCriteria(data, new Set([c.id])));
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {data.criteria.length > 0 && (
          <Button icon={<Plus className="size-4" />} onClick={() => onChange(addCriterion(data))}>Mezon qo‘shish</Button>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-lg bg-navy-900 px-3 py-1.5 font-medium text-white">Umumiy maksimal ball: {fmtNum(maxTotal(data.criteria))}</span>
          {COMPETENCES.map((k) => (
            <span key={k} className={clsx('rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset', competenceTone[k])}>
              {COMPETENCE_LABEL[k]}: {fmtNum(cm[k])}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
