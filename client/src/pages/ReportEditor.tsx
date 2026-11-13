import clsx from 'clsx';
import {
  ArrowLeft, BarChart2, Check, CloudOff, Copy, Download, FileUp, Info, ListChecks, Loader2, Save, ScanLine, Table2, Trash2, Users,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Analysis } from '../components/Analysis';
import { CriteriaEditor } from '../components/CriteriaEditor';
import { useFeedback } from '../components/feedback';
import { Grid } from '../components/Grid';
import { Scanner } from '../components/scan/Scanner';
import { MetaForm } from '../components/MetaForm';
import { StudentsEditor } from '../components/StudentsEditor';
import { Button, ControlBadge, PageLoader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { groupLabel, parseReportXlsx } from '../lib/excel';
import { usePaidDownload } from '../components/PaymentDialog';
import type { Report, ReportData, ReportMeta } from '../lib/types';
import { useHistory } from '../lib/useHistory';

type Tab = 'grid' | 'scan' | 'meta' | 'students' | 'criteria' | 'analysis';
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const tabs: { id: Tab; label: string; icon: typeof Table2 }[] = [
  { id: 'grid', label: 'Baholash jadvali', icon: Table2 },
  { id: 'scan', label: 'AI Skaner', icon: ScanLine },
  { id: 'students', label: 'O‘quvchilar', icon: Users },
  { id: 'criteria', label: 'Mezonlar', icon: ListChecks },
  { id: 'meta', label: 'Ma’lumotlar', icon: Info },
  { id: 'analysis', label: 'Tahlil', icon: BarChart2 },
];

export const pickMeta = (r: ReportMeta): ReportMeta => ({
  school: r.school, className: r.className, groupName: r.groupName, academicYear: r.academicYear,
  subject: r.subject, controlType: r.controlType, teacherName: r.teacherName,
});


export default function ReportEditor() {
  const { id } = useParams();
  const reportId = Number(id);
  const nav = useNavigate();
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const [report, setReport] = useState<Report | null>(null);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const hist = useHistory<ReportData>({ criteria: [], students: [] });
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(tabs.some((t) => t.id === params.get('tab')) ? (params.get('tab') as Tab) : 'grid');
  const [save, setSave] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState('');
  const [exporting, setExporting] = useState(false);
  const paid = usePaidDownload();
  const lastSaved = useRef('');
  const fileRef = useRef<HTMLInputElement>(null);
  const data = hist.value;

  useEffect(() => {
    api.getReport(reportId)
      .then(({ report }) => {
        setReport(report);
        const m = pickMeta(report);
        setMeta(m);
        hist.reset(report.data);
        lastSaved.current = JSON.stringify({ ...m, data: report.data });
      })
      .catch((e) => { toast(e.message, 'error'); nav('/reports'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const doSave = useCallback(async (): Promise<boolean> => {
    if (!meta) return false;
    const payload = { ...meta, data };
    const json = JSON.stringify(payload);
    if (json === lastSaved.current) { setSave('saved'); return true; }
    if (!meta.className.trim() || !meta.subject.trim()) {
      setSave('error');
      setSaveError('Sinf va fan nomini kiriting');
      return false;
    }
    setSave('saving');
    try {
      const r = await api.updateReport(reportId, payload);
      lastSaved.current = json;
      setReport(r.report);
      setSave('saved');
      setSaveError('');
      return true;
    } catch (e) {
      setSave('error');
      setSaveError((e as Error).message);
      return false;
    }
  }, [meta, data, reportId]);

  // Avtomatik saqlash
  useEffect(() => {
    if (!meta) return;
    if (JSON.stringify({ ...meta, data }) === lastSaved.current) return;
    setSave('dirty');
    const t = setTimeout(doSave, 1200);
    return () => clearTimeout(t);
  }, [meta, data, doSave]);

  // Sahifadan chiqishda (boshqa hisobotga o'tish va h.k.) saqlanmagan o'zgarishni darhol saqlash
  const latest = useRef<{ meta: ReportMeta | null; data: ReportData }>({ meta: null, data });
  latest.current = { meta, data };
  useEffect(() => () => {
    const { meta: m, data: d } = latest.current;
    if (!m || !m.className.trim() || !m.subject.trim()) return;
    if (JSON.stringify({ ...m, data: d }) === lastSaved.current) return;
    api.updateReport(reportId, { ...m, data: d }).catch(() => {});
  }, [reportId]);

  // Ctrl+S, saqlanmagan o'zgarishlar haqida ogohlantirish, global undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); doSave().then((ok) => ok && toast('Saqlandi')); }
      const t = e.target as HTMLElement;
      const inField = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      if (!inField && mod && e.key.toLowerCase() === 'z' && !t.closest('[tabindex]')) { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (meta && JSON.stringify({ ...meta, data }) !== lastSaved.current) { e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };
  }, [doSave, meta, data, hist, toast]);

  if (!report || !meta) return <PageLoader />;

  const exportXlsx = async () => {
    if (!data.criteria.length) return toast('Avval kamida bitta baholash mezonini qo‘shing', 'warning');
    if (!data.students.length) return toast('Avval o‘quvchilarni qo‘shing', 'warning');
    const unnamed = data.students.filter((s) => !s.name.trim()).length;
    if (unnamed && !(await confirm({ title: 'Ismsiz qatorlar', text: `${unnamed} ta qatorda o‘quvchi ismi yozilmagan. Baribir yuklab olasizmi?`, confirmText: 'Yuklab olish' }))) return;
    setExporting(true);
    try {
      // Excel serverda yaratiladi (to'lov tekshiruvi bilan) — avval oxirgi o'zgarishlarni saqlaymiz
      if (!(await doSave())) throw new Error(saveError || 'Avval o‘zgarishlarni saqlang');
      await paid.download(reportId, `${meta.className}${meta.groupName ? ` (${groupLabel(meta.groupName)})` : ''} · ${meta.subject} · ${meta.controlType}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const importXlsx = async (f: File) => {
    try {
      const parsed = await parseReportXlsx(await f.arrayBuffer());
      const ok = await confirm({
        title: 'Excel fayldan yangilash',
        text: `Fayldan ${parsed.data.students.length} ta o‘quvchi va ${parsed.data.criteria.length} ta mezon o‘qildi. Joriy jadval fayldagi ma’lumotlar bilan almashtiriladi (Ctrl+Z bilan qaytarish mumkin).`,
        confirmText: 'Almashtirish',
      });
      if (!ok) return;
      hist.set(parsed.data);
      setMeta({ ...meta, ...Object.fromEntries(Object.entries(parsed.meta).filter(([, v]) => v)) } as ReportMeta);
      toast('Jadval Excel fayldan yangilandi');
      if (parsed.warnings.length) toast(`${parsed.warnings.length} ta ogohlantirish: ${parsed.warnings[0]}`, 'warning');
      setTab('grid');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const saveIndicator = (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', save === 'error' ? 'text-red-600' : 'text-slate-500')} title={saveError}>
      {save === 'saving' && <><Loader2 className="size-3.5 animate-spin" />Saqlanmoqda…</>}
      {save === 'saved' && <><Check className="size-3.5 text-emerald-600" />Saqlandi</>}
      {save === 'dirty' && <><span className="size-2 rounded-full bg-amber-500" />O‘zgarishlar bor</>}
      {save === 'error' && <><CloudOff className="size-3.5" />Saqlanmadi</>}
    </span>
  );

  const actions = (
    <>
      {saveIndicator}
      <Button size="sm" icon={<Save className="size-4" />} onClick={() => doSave().then((ok) => ok ? toast('Saqlandi') : toast(saveError || 'Saqlanmadi', 'error'))}>Saqlash</Button>
      <Button size="sm" icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()} title="Avval yuklab olingan Excel faylni qayta yuklash">Excel’dan</Button>
      <Button size="sm" variant="success" icon={<Download className="size-4" />} loading={exporting} onClick={exportXlsx}>Excel yuklab olish</Button>
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-4 pt-4 sm:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/reports" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Orqaga"><ArrowLeft className="size-5" /></Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-slate-900">
                  {meta.className}{meta.groupName ? ` (${groupLabel(meta.groupName)})` : ''} — {meta.subject}
                </h1>
                <ControlBadge type={meta.controlType} />
              </div>
              <p className="truncate text-xs text-slate-500">
                {meta.academicYear && `${meta.academicYear} o‘quv yili · `}{meta.teacherName || 'O‘qituvchi ko‘rsatilmagan'}
                {user?.role === 'admin' && report.ownerId !== user.id && ` · Muallif: ${report.ownerName}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={async () => {
              await doSave();
              const r = await api.duplicateReport(reportId);
              toast('Nusxa yaratildi');
              nav(`/reports/${r.report.id}`);
            }}>Nusxa</Button>
            <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="size-4" />} onClick={async () => {
              if (!(await confirm({ title: 'Hisobotni o‘chirish', text: 'Bu hisobot butunlay o‘chiriladi. Bu amalni qaytarib bo‘lmaydi.', danger: true, confirmText: 'O‘chirish' }))) return;
              await api.deleteReport(reportId);
              lastSaved.current = JSON.stringify({ ...meta, data });
              toast('Hisobot o‘chirildi');
              nav('/reports');
            }}>O‘chirish</Button>
          </div>
        </div>
        <div className="-mb-px mt-3 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx('inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                tab === t.id ? 'border-navy-700 text-navy-800' : 'border-transparent text-slate-500 hover:text-slate-800')}
            >
              <t.icon className="size-4" />{t.label}
              {t.id === 'students' && <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{data.students.length}</span>}
              {t.id === 'criteria' && <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{data.criteria.length}</span>}
            </button>
          ))}
        </div>
      </div>

      {paid.dialog}
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = ''; }} />

      {save === 'error' && saveError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">Saqlashda xato: {saveError}</div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'grid' && (
          <div className="p-2 sm:p-4">
            <div className="card overflow-hidden">
              <Grid data={data} onChange={hist.set} onUndo={hist.undo} onRedo={hist.redo} canUndo={hist.canUndo} canRedo={hist.canRedo} toolbarRight={actions} />
            </div>
          </div>
        )}
        {tab === 'scan' && (
          <div className="mx-auto max-w-[1600px] p-3 sm:p-5">
            <Scanner
              data={data}
              onApply={(res) => {
                hist.set(res.data);
                toast(`Jadvalga qo‘shildi: ${res.added} ta yangi, ${res.updated} ta mavjud o‘quvchi${res.skippedCells ? ` · ${res.skippedCells} ta tekshirilmagan katak bo‘sh qoldirildi` : ''}`);
                setTab('grid');
              }}
            />
          </div>
        )}
        {tab !== 'grid' && tab !== 'scan' && (
          <div className="mx-auto max-w-5xl p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-end gap-2">{actions}</div>
            <div className="card">
              {tab === 'meta' && <div className="p-5"><MetaForm value={meta} onChange={setMeta} /></div>}
              {tab === 'students' && <div className="p-5"><StudentsEditor data={data} onChange={(d) => hist.set(d, 'students')} /></div>}
              {tab === 'criteria' && <div className="p-5"><CriteriaEditor data={data} onChange={(d) => hist.set(d, 'criteria')} /></div>}
              {tab === 'analysis' && <Analysis data={data} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
