import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, FileUp, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CriteriaEditor } from '../components/CriteriaEditor';
import { useFeedback } from '../components/feedback';
import { Page } from '../components/Layout';
import { currentAcademicYear, MetaForm } from '../components/MetaForm';
import { StudentsEditor } from '../components/StudentsEditor';
import { Button, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { uid } from '../lib/calc';
import { parseReportXlsx } from '../lib/excel';
import type { ReportData, ReportMeta } from '../lib/types';

const steps = ['Sinf va fan', 'O‘quvchilar', 'Baholash mezonlari'];

export default function NewReport() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { toast } = useFeedback();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState<ReportMeta>({
    school: user?.school || '', className: '', groupName: '', academicYear: currentAcademicYear(),
    subject: '', controlType: 'CHSB-I', teacherName: user?.role === 'teacher' ? user.fullName : '',
  });
  const [data, setData] = useState<ReportData>({ criteria: [], students: [] });

  const validate = (s: number): string | null => {
    if (s === 0) {
      if (!meta.className.trim()) return 'Sinf nomini kiriting (masalan, 6-A)';
      if (!meta.subject.trim()) return 'Fan nomini kiriting';
    }
    if (s === 1 && !data.students.some((x) => x.name.trim())) return 'Kamida bitta o‘quvchi qo‘shing';
    if (s === 2 && !data.criteria.length) return 'Kamida bitta baholash mezonini qo‘shing';
    return null;
  };

  const next = () => {
    const err = validate(step);
    if (err) return toast(err, 'warning');
    setStep(step + 1);
  };

  const create = async () => {
    for (let s = 0; s < 3; s++) {
      const err = validate(s);
      if (err) { setStep(s); return toast(err, 'warning'); }
    }
    setBusy(true);
    try {
      const clean = { ...data, students: data.students.filter((s) => s.name.trim()) };
      const r = await api.createReport({ ...meta, data: clean });
      toast('Hisobot yaratildi. Endi ballarni kiriting');
      nav(`/reports/${r.report.id}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openFromExcel = async (f: File) => {
    setBusy(true);
    try {
      const parsed = await parseReportXlsx(await f.arrayBuffer());
      const m: ReportMeta = { ...meta, ...Object.fromEntries(Object.entries(parsed.meta).filter(([, v]) => v)) } as ReportMeta;
      if (!m.className || !m.subject) {
        setMeta(m);
        setData(parsed.data);
        setStep(0);
        toast('Fayl o‘qildi. Sinf va fan nomini to‘ldiring', 'info');
        return;
      }
      const r = await api.createReport({ ...m, data: parsed.data });
      toast('Excel fayldan hisobot ochildi');
      if (parsed.warnings.length) toast(`${parsed.warnings.length} ta ogohlantirish: ${parsed.warnings[0]}`, 'warning');
      nav(`/reports/${r.report.id}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const preset = () =>
    setData({
      ...data,
      criteria: [
        { id: uid('c'), name: 'Listening', max: 6, type: 'bilish' },
        { id: uid('c'), name: 'Reading', max: 28, type: 'qollash' },
        { id: uid('c'), name: 'Writing', max: 6, type: 'mulohaza' },
      ],
    });

  return (
    <Page>
      <PageHeader
        title="Yangi hisobot yaratish"
        subtitle="Uch qadamda: sinf ma’lumotlari, o‘quvchilar ro‘yxati va baholash mezonlari"
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()} loading={busy && step === 0}>Tayyor Excel hisobotni ochish</Button>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) openFromExcel(f); e.target.value = ''; }} />
          </>
        }
      />

      <ol className="mb-6 grid grid-cols-3 gap-2">
        {steps.map((s, i) => (
          <li key={s}>
            <button
              onClick={() => (i < step || !validate(step)) && i <= step + 1 && setStep(i)}
              className={clsx('flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors sm:px-4',
                i === step ? 'border-navy-600 bg-white ring-3 ring-navy-100' : 'border-slate-200 bg-white hover:bg-slate-50')}
            >
              <span className={clsx('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-navy-700 text-white' : 'bg-slate-100 text-slate-500')}>
                {i < step ? <Check className="size-4" /> : i + 1}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block text-[11px] uppercase tracking-wide text-slate-400">{i + 1}-qadam</span>
                <span className="block truncate text-sm font-medium text-slate-800">{s}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="card p-5 sm:p-6">
        <h2 className="mb-5 text-base font-semibold text-slate-900">{steps[step]}</h2>
        {step === 0 && <MetaForm value={meta} onChange={setMeta} />}
        {step === 1 && <StudentsEditor data={data} onChange={setData} />}
        {step === 2 && (
          <>
            {data.criteria.length === 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-sm text-navy-800">
                <Sparkles className="size-4" /> Ingliz tili uchun namunaviy mezonlar: Listening (6), Reading (28), Writing (6)
                <Button size="sm" className="ml-auto" onClick={preset}>Namunani qo‘llash</Button>
              </div>
            )}
            <CriteriaEditor data={data} onChange={setData} />
          </>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button icon={<ArrowLeft className="size-4" />} onClick={() => (step ? setStep(step - 1) : nav(-1))}>{step ? 'Orqaga' : 'Bekor qilish'}</Button>
        {step < 2 ? (
          <Button variant="primary" onClick={next}>Keyingi <ArrowRight className="size-4" /></Button>
        ) : (
          <Button variant="primary" loading={busy} icon={<Check className="size-4" />} onClick={create}>Yaratish va jadvalni ochish</Button>
        )}
      </div>
    </Page>
  );
}
