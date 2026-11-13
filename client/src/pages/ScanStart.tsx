import { ArrowRight, FilePlus2, ScanLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeedback } from '../components/feedback';
import { Page } from '../components/Layout';
import { currentAcademicYear, MetaForm } from '../components/MetaForm';
import { Button, ControlBadge, PageHeader, PageLoader, formatDate } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { groupLabel } from '../lib/excel';
import type { ReportMeta, ReportSummary } from '../lib/types';

/** AI Skaner kirish sahifasi: mavjud hisobotga skanerlash yoki rasmdan yangi hisobot boshlash */
export default function ScanStart() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { toast } = useFeedback();
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<ReportMeta>({
    school: user?.school || '', className: '', groupName: '', academicYear: currentAcademicYear(),
    subject: '', controlType: 'CHSB-I', teacherName: user?.role === 'teacher' ? user.fullName : '',
  });

  useEffect(() => { api.listReports({}).then((r) => setReports(r.reports)).catch((e) => toast(e.message, 'error')); }, [toast]);

  const createAndScan = async () => {
    if (!meta.className.trim() || !meta.subject.trim()) return toast('Sinf va fan nomini kiriting', 'warning');
    setBusy(true);
    try {
      const r = await api.createReport({ ...meta, data: { criteria: [], students: [] } });
      nav(`/reports/${r.report.id}?tab=scan`);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Page>
      <PageHeader title="AI Smart Scanner" subtitle="Screenshot, telefon kamerasi yoki PDF orqali o‘quvchilar va ballarni avtomatik kiritish" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2"><FilePlus2 className="size-5 text-navy-700" /><h2 className="text-sm font-semibold text-slate-900">Rasmdan yangi hisobot</h2></div>
          <p className="mb-4 text-sm text-slate-500">Sinf ma’lumotlarini kiriting — o‘quvchilar ro‘yxati, mezonlar (maksimal ballar) va ballar rasmdan olinadi.</p>
          <MetaForm value={meta} onChange={setMeta} />
          <div className="mt-5 flex justify-end">
            <Button variant="primary" loading={busy} icon={<ScanLine className="size-4" />} onClick={createAndScan}>Yaratish va skanerlash</Button>
          </div>
        </div>
        <div className="card">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Mavjud hisobotga qo‘shish</h2>
            <p className="mt-0.5 text-sm text-slate-500">Ballar mavjud o‘quvchilar bilan ism bo‘yicha moslashtiriladi</p>
          </div>
          {!reports ? <PageLoader /> : reports.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Hali hisobot yo‘q</p>
          ) : (
            <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {reports.map((r) => (
                <li key={r.id}>
                  <button className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50" onClick={() => nav(`/reports/${r.id}?tab=scan`)}>
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-sm font-semibold text-navy-700">{r.className}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="truncate text-sm font-medium text-slate-900">{r.subject}</span><ControlBadge type={r.controlType} /></div>
                      <div className="truncate text-xs text-slate-500">{r.groupName ? `${groupLabel(r.groupName)} · ` : ''}{r.studentCount} o‘quvchi · {formatDate(r.updatedAt)}</div>
                    </div>
                    <ArrowRight className="size-4 text-slate-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Page>
  );
}
