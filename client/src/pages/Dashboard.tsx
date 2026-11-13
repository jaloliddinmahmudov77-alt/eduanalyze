import { ArrowRight, ClipboardCheck, FilePlus2, FileSpreadsheet, GraduationCap, School, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, ControlBadge, EmptyState, PageHeader, PageLoader, formatDate } from '../components/ui';
import { useFeedback } from '../components/feedback';
import { api, type Stats } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtPct } from '../lib/calc';
import { groupLabel } from '../lib/excel';

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const nav = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const cards = stats
    ? [
        { label: 'Jami sinflar', value: stats.classes, icon: School },
        { label: 'Jami o‘quvchilar', value: stats.students, icon: Users },
        { label: 'BSB hisobotlari', value: stats.bsb, icon: ClipboardCheck },
        { label: 'CHSB hisobotlari', value: stats.chsb, icon: FileSpreadsheet },
      ]
    : [];

  return (
    <Page>
      <PageHeader
        title={`Xush kelibsiz, ${user?.fullName.split(' ')[1] || user?.fullName}`}
        subtitle={user?.role === 'admin' ? 'Maktab bo‘yicha barcha hisobotlar statistikasi' : 'Sizning sinflaringiz va hisobotlaringiz'}
        actions={<Button variant="primary" icon={<FilePlus2 className="size-4" />} onClick={() => nav('/reports/new')}>Yangi hisobot yaratish</Button>}
      />
      {!stats ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {cards.map((c) => (
              <div key={c.label} className="card p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-slate-500">{c.label}</span>
                  <c.icon className="size-4 text-slate-400" />
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{c.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-slate-900">Oxirgi tayyorlangan hisobotlar</h2>
                <Link to="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-navy-700 hover:text-navy-900">
                  Barchasi <ArrowRight className="size-4" />
                </Link>
              </div>
              {stats.recent.length === 0 ? (
                <EmptyState
                  icon={<FileSpreadsheet className="size-6" />}
                  title="Hali hisobot yo‘q"
                  text="Birinchi BSB yoki CHSB hisobotingizni yarating — sinf ma’lumotlari, o‘quvchilar va mezonlarni kiriting."
                  action={<Button variant="primary" onClick={() => nav('/reports/new')}>Hisobot yaratish</Button>}
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {stats.recent.map((r) => (
                    <li key={r.id}>
                      <Link to={`/reports/${r.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-sm font-semibold text-navy-700">
                          {r.className}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-900">{r.subject}</span>
                            <ControlBadge type={r.controlType} />
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-500">
                            {r.className}{r.groupName ? ` · ${groupLabel(r.groupName)}` : ''} · {r.studentCount} o‘quvchi · {formatDate(r.updatedAt)}
                            {user?.role === 'admin' ? ` · ${r.ownerName}` : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-slate-900">{fmtPct(r.classPercent)}</div>
                          <div className="text-[11px] text-slate-500">sinf foizi</div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-4">
              <div className="card p-5">
                <div className="flex size-10 items-center justify-center rounded-lg bg-navy-700 text-white"><GraduationCap className="size-5" /></div>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">Hisobot qanday tayyorlanadi?</h3>
                <ol className="mt-3 space-y-2.5 text-sm text-slate-600">
                  {['Sinf, fan va nazorat turini kiriting', 'O‘quvchilarni Excel’dan yuklang yoki yozing', 'Mezonlar, maksimal ball va kompetensiyani belgilang', 'Ballarni jadvalga kiriting — hammasi avtomatik hisoblanadi', 'Rasmiy Excel hisobotni yuklab oling'].map((t, i) => (
                    <li key={t} className="flex gap-2.5">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{i + 1}</span>
                      {t}
                    </li>
                  ))}
                </ol>
              </div>
              {user?.role === 'admin' && (
                <Link to="/admin" className="card flex items-center justify-between p-5 hover:bg-slate-50">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Administrator kabineti</div>
                    <div className="mt-0.5 text-xs text-slate-500">{stats.teachers ?? 0} o‘qituvchi · sinflar va fanlar</div>
                  </div>
                  <ArrowRight className="size-4 text-slate-400" />
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
