import clsx from 'clsx';
import { Copy, Download, FilePlus2, FileSpreadsheet, FileUp, Pencil, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFeedback } from '../components/feedback';
import { Page } from '../components/Layout';
import { Button, ControlBadge, EmptyState, PageHeader, PageLoader, formatDate } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtPct } from '../lib/calc';
import { groupLabel, parseReportXlsx } from '../lib/excel';
import type { ReportMeta, ReportSummary, User } from '../lib/types';
import { downloadReport, pickMeta } from './ReportEditor';

const filters = [
  { id: '', label: 'Barchasi' },
  { id: 'BSB', label: 'BSB' },
  { id: 'CHSB', label: 'CHSB' },
];

export default function Reports() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const nav = useNavigate();
  const { toast, confirm } = useFeedback();
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [teachers, setTeachers] = useState<User[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.listReports({ type, q, owner }).then((r) => setReports(r.reports)).catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, q, owner]);
  useEffect(() => { if (isAdmin) api.users().then((r) => setTeachers(r.users)).catch(() => {}); }, [isAdmin]);

  const download = async (r: ReportSummary) => {
    setBusyId(r.id);
    try {
      const { report } = await api.getReport(r.id);
      await downloadReport(pickMeta(report), report.data);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusyId(null); }
  };
  const duplicate = async (r: ReportSummary) => {
    try { await api.duplicateReport(r.id); toast('Nusxa yaratildi'); load(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const remove = async (r: ReportSummary) => {
    if (!(await confirm({ title: 'Hisobotni o‘chirish', text: `${r.className} — ${r.subject} (${r.controlType}) hisoboti butunlay o‘chiriladi.`, danger: true, confirmText: 'O‘chirish' }))) return;
    try { await api.deleteReport(r.id); toast('O‘chirildi'); load(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const importFile = async (f: File) => {
    try {
      const parsed = await parseReportXlsx(await f.arrayBuffer());
      const meta = { school: '', className: '', groupName: '', academicYear: '', subject: '', controlType: 'CHSB-I', teacherName: '', ...parsed.meta } as ReportMeta;
      if (!meta.className || !meta.subject) throw new Error('Fayl sarlavhasidan sinf yoki fan aniqlanmadi. “Yangi hisobot” sahifasidan oching');
      const r = await api.createReport({ ...meta, data: parsed.data });
      toast('Excel fayldan hisobot yaratildi');
      nav(`/reports/${r.report.id}`);
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const iconBtn = 'rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40';

  return (
    <Page wide>
      <PageHeader
        title={isAdmin ? 'Barcha hisobotlar' : 'Hisobotlar'}
        subtitle="Saqlangan BSB va CHSB hisobotlari — ochish, tahrirlash, nusxa olish va Excel’ga yuklab olish"
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>Excel’dan ochish</Button>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
            <Button variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => nav('/reports/new')}>Yangi hisobot</Button>
          </>
        }
      />

      <div className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            {filters.map((f) => (
              <button key={f.id} onClick={() => setType(f.id)} className={clsx('rounded-md px-3.5 py-1.5 text-[13px] font-medium', type === f.id ? 'bg-white text-navy-800 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 md:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Sinf yoki fan bo‘yicha qidirish…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {isAdmin && (
            <select className="input md:w-64" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Barcha o‘qituvchilar</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
            </select>
          )}
        </div>

        {!reports ? <PageLoader /> : reports.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet className="size-6" />} title={q || type ? 'Hech narsa topilmadi' : 'Hali hisobot yo‘q'}
            text={q || type ? 'Qidiruv yoki filtr shartlarini o‘zgartirib ko‘ring.' : 'Yangi hisobot yarating yoki avval yuklab olingan Excel faylni oching.'}
            action={!q && !type ? <Button variant="primary" onClick={() => nav('/reports/new')}>Hisobot yaratish</Button> : undefined} />
        ) : (
          <>
            {/* Desktop jadval */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Sinf</th>
                    <th className="px-4 py-3">Fan</th>
                    <th className="px-4 py-3">Nazorat</th>
                    <th className="px-4 py-3">O‘quv yili</th>
                    <th className="px-4 py-3 text-right">O‘quvchi</th>
                    <th className="px-4 py-3 text-right">Sinf foizi</th>
                    {isAdmin && <th className="px-4 py-3">O‘qituvchi</th>}
                    <th className="px-4 py-3">Yangilangan</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900"><Link to={`/reports/${r.id}`} className="hover:underline">{r.className}</Link>{r.groupName && <span className="ml-1.5 text-xs font-normal text-slate-500">{groupLabel(r.groupName)}</span>}</td>
                      <td className="px-4 py-3 text-slate-700">{r.subject}</td>
                      <td className="px-4 py-3"><ControlBadge type={r.controlType} /></td>
                      <td className="px-4 py-3 text-slate-600">{r.academicYear}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{r.studentCount}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">{fmtPct(r.classPercent)}</td>
                      {isAdmin && <td className="max-w-[200px] truncate px-4 py-3 text-slate-600">{r.ownerName}</td>}
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(r.updatedAt)}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end">
                          <button className={iconBtn} title="Ochish va tahrirlash" onClick={() => nav(`/reports/${r.id}`)}><Pencil className="size-4" /></button>
                          <button className={iconBtn} title="Excel yuklab olish" disabled={busyId === r.id} onClick={() => download(r)}><Download className="size-4" /></button>
                          <button className={iconBtn} title="Nusxa olish" onClick={() => duplicate(r)}><Copy className="size-4" /></button>
                          <button className={clsx(iconBtn, 'hover:bg-red-50 hover:text-red-600')} title="O‘chirish" onClick={() => remove(r)}><Trash2 className="size-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobil kartalar */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {reports.map((r) => (
                <li key={r.id} className="p-4">
                  <Link to={`/reports/${r.id}`} className="block">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{r.className}</span>
                      <span className="text-slate-700">{r.subject}</span>
                      <ControlBadge type={r.controlType} />
                      <span className="ml-auto font-semibold tabular-nums">{fmtPct(r.classPercent)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{r.studentCount} o‘quvchi · {formatDate(r.updatedAt)}{isAdmin ? ` · ${r.ownerName}` : ''}</div>
                  </Link>
                  <div className="mt-2 flex gap-1">
                    <Button size="sm" icon={<Download className="size-4" />} onClick={() => download(r)} loading={busyId === r.id}>Excel</Button>
                    <Button size="sm" icon={<Copy className="size-4" />} onClick={() => duplicate(r)}>Nusxa</Button>
                    <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => remove(r)}>O‘chirish</Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Page>
  );
}
