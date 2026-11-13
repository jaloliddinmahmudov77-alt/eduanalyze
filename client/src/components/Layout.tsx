import clsx from 'clsx';
import {
  BarChart3, FilePlus2, FileSpreadsheet, LayoutDashboard, LogOut, Menu, MessageCircle, ScanLine, Settings, ShieldCheck, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const nav = [
  { to: '/', label: 'Bosh sahifa', icon: LayoutDashboard, end: true },
  { to: '/reports/new', label: 'Yangi hisobot', icon: FilePlus2 },
  { to: '/scan', label: 'AI Skaner', icon: ScanLine },
  { to: '/reports', label: 'Hisobotlar', icon: FileSpreadsheet, end: true },
  { to: '/messages', label: 'Xabarlar', icon: MessageCircle },
  { to: '/settings', label: 'Sozlamalar', icon: Settings },
];

export function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
        <BarChart3 className={clsx('size-5', light ? 'text-white' : 'text-navy-700')} />
      </div>
      <div className="leading-tight">
        <div className={clsx('text-[15px] font-semibold tracking-tight', light ? 'text-white' : 'text-slate-900')}>EduAnalyze</div>
        <div className={clsx('text-[11px]', light ? 'text-navy-200' : 'text-slate-500')}>BSB / CHSB tahlili</div>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  // administrator javoblari: o'qilmaganlar soni (har 20 soniyada)
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const check = () => api.unreadMessages().then((r) => setUnread(r.unread)).catch(() => {});
    check();
    const t = setInterval(check, 20_000);
    const onRead = () => setUnread(0);
    window.addEventListener('eduanalyze:messages-read', onRead);
    return () => { clearInterval(t); window.removeEventListener('eduanalyze:messages-read', onRead); };
  }, []);

  const items = user?.role === 'admin' ? [...nav.slice(0, 5), { to: '/admin', label: 'Administrator', icon: ShieldCheck }, nav[5]] : nav;
  const initials = (user?.fullName || '?').split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 text-navy-100">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo light />
        <button className="lg:hidden rounded-md p-1 text-navy-200 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Yopish">
          <X className="size-5" />
        </button>
      </div>
      <nav className="mt-2 flex-1 space-y-0.5 px-3">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive ? 'bg-white text-navy-900' : 'text-navy-100 hover:bg-white/8 hover:text-white',
              )
            }
          >
            <it.icon className="size-[18px]" />
            {it.label}
            {it.to === '/messages' && unread > 0 && (
              <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-navy-950">{unread}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-600 text-xs font-semibold text-white">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">{user?.fullName}</div>
            <div className="text-xs text-navy-300">{user?.role === 'admin' ? 'Administrator' : 'O‘qituvchi'}</div>
          </div>
          <button onClick={logout} className="rounded-md p-2 text-navy-200 hover:bg-white/10 hover:text-white" title="Chiqish" aria-label="Chiqish">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Menyu">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold text-slate-900">EduAnalyze</span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={clsx('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8', wide ? 'max-w-[1600px]' : 'max-w-6xl')}>{children}</div>;
}
