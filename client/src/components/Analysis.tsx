import clsx from 'clsx';
import { useMemo } from 'react';
import { activeCriteria, computeClass, computeStudent, fmtNum, fmtPct, gradeOf } from '../lib/calc';
import { competenceName, getCompetences, type ReportData } from '../lib/types';

const barColor = (p: number) => (p >= 86 ? 'bg-emerald-500' : p >= 71 ? 'bg-navy-500' : p >= 56 ? 'bg-amber-500' : 'bg-red-500');

function Bar({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-medium text-slate-700">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-900">{fmtPct(value)}{sub && <span className="ml-1.5 text-xs text-slate-500">{sub}</span>}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={clsx('h-full rounded-full', barColor(value))} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export function Analysis({ data }: { data: ReportData }) {
  const cls = useMemo(() => computeClass(data), [data]);
  const ranked = useMemo(
    () => data.students.map((s) => ({ s, r: computeStudent(activeCriteria(data), s) })).filter((x) => x.r.participated).sort((a, b) => b.r.percent - a.r.percent),
    [data],
  );
  const absent = data.students.length - cls.participants;
  const quality = cls.participants ? ((cls.grades.five + cls.grades.four) / cls.participants) * 100 : 0;
  const mastery = cls.participants ? ((cls.participants - cls.grades.two) / cls.participants) * 100 : 0;

  if (!data.criteria.length || !data.students.length)
    return <p className="p-6 text-sm text-slate-500">Tahlil uchun o‘quvchilar va mezonlarni kiriting.</p>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Sinf foizi', fmtPct(cls.percent), `${fmtNum(cls.totalSum)} / ${fmtNum(cls.totalMax)} ball`],
          ['Qatnashdi', `${cls.participants} / ${data.students.length}`, absent ? `${absent} ta o‘quvchi baholanmagan` : 'hamma baholangan'],
          ['O‘zlashtirish', fmtPct(mastery), '56% va undan yuqori'],
          ['Sifat', fmtPct(quality), '“4” va “5” baholar ulushi'],
        ].map(([l, v, s]) => (
          <div key={l} className="rounded-xl border border-slate-200 p-4">
            <div className="text-[13px] text-slate-500">{l}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{v}</div>
            <div className="mt-0.5 text-xs text-slate-500">{s}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">Kompetensiyalar bo‘yicha</h3>
          <div className="space-y-4">
            {getCompetences(data).map(({ id: k, name }) => (
              <Bar key={k} label={name} value={cls.compPercent[k] ?? 0} sub={cls.compMax[k] ? `${fmtNum(cls.compSum[k])}/${fmtNum(cls.compClassMax[k])}` : 'mezon yo‘q'} />
            ))}
          </div>
          <h3 className="mb-4 mt-7 text-sm font-semibold text-slate-900">Mezonlar bo‘yicha</h3>
          <div className="space-y-4">
            {data.criteria.map((c) => (
              <Bar key={c.id} label={`${c.name} · ${competenceName(data, c.type)}`} value={cls.criterionPercent[c.id]} sub={`${fmtNum(cls.criterionSum[c.id])}/${fmtNum(cls.criterionMax[c.id])}`} />
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 p-5">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Baholar taqsimoti</h3>
            <div className="grid grid-cols-4 gap-2 text-center">
              {([['5', cls.grades.five, 'bg-emerald-50 text-emerald-700', '86–100%'], ['4', cls.grades.four, 'bg-navy-50 text-navy-700', '71–85%'], ['3', cls.grades.three, 'bg-amber-50 text-amber-700', '56–70%'], ['2', cls.grades.two, 'bg-red-50 text-red-700', '0–55%']] as const).map(([g, n, tone, range]) => (
                <div key={g} className={clsx('rounded-lg py-3', tone)}>
                  <div className="text-xs font-medium">“{g}”</div>
                  <div className="text-2xl font-semibold">{n}</div>
                  <div className="text-[11px] opacity-75">{range}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200">
            <h3 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-900">O‘quvchilar reytingi</h3>
            <ol className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {ranked.map(({ s, r }, i) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="w-6 text-right tabular-nums text-slate-400">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-800">{s.name || 'Nomsiz'}</span>
                  <span className="tabular-nums text-slate-500">{fmtNum(r.total)} ball</span>
                  <span className="w-16 text-right font-medium tabular-nums text-slate-900">{fmtPct(r.percent)}</span>
                  <span className={clsx('w-7 rounded text-center text-xs font-semibold', { 5: 'bg-emerald-100 text-emerald-700', 4: 'bg-navy-100 text-navy-700', 3: 'bg-amber-100 text-amber-700', 2: 'bg-red-100 text-red-700' }[gradeOf(r.percent)])}>{gradeOf(r.percent)}</span>
                </li>
              ))}
              {!ranked.length && <li className="px-5 py-6 text-center text-sm text-slate-500">Hali ball kiritilmagan</li>}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
