import clsx from 'clsx';
import { BookOpen, KeyRound, Pencil, Plus, School, Trash2, UserPlus, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFeedback } from '../components/feedback';
import { Page } from '../components/Layout';
import { PaymentsPanel } from '../components/PaymentsPanel';
import { Badge, Button, Field, Modal, PageHeader, PageLoader, formatDate } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CatalogItem, User } from '../lib/types';

type Tab = 'users' | 'payments' | 'class' | 'subject';

export default function Admin() {
  const [tab, setTab] = useState<Tab>('users');
  const tabs = [
    { id: 'users' as const, label: 'O‘qituvchilar', icon: Users },
    { id: 'payments' as const, label: 'To‘lovlar', icon: Wallet },
    { id: 'class' as const, label: 'Sinflar', icon: School },
    { id: 'subject' as const, label: 'Fanlar', icon: BookOpen },
  ];
  return (
    <Page>
      <PageHeader title="Administrator kabineti" subtitle="Foydalanuvchilar, sinflar va fanlarni boshqarish"
        actions={<Link to="/reports"><Button>Barcha hisobotlar</Button></Link>} />
      <div className="mb-5 inline-flex rounded-lg bg-slate-200/60 p-1">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={clsx('inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium', tab === t.id ? 'bg-white text-navy-800 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
            <t.icon className="size-4" />{t.label}
          </button>
        ))}
      </div>
      {tab === 'users' ? <UsersPanel /> : tab === 'payments' ? <PaymentsPanel /> : <CatalogPanel kind={tab} key={tab} />}
    </Page>
  );
}

function UsersPanel() {
  const { user: me } = useAuth();
  const { toast, confirm } = useFeedback();
  const [users, setUsers] = useState<User[] | null>(null);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [form, setForm] = useState({ username: '', fullName: '', password: '', role: 'teacher', school: '' });
  const [busy, setBusy] = useState(false);

  const load = () => api.users().then((r) => setUsers(r.users)).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (u: User | 'new') => {
    setEditing(u);
    setForm(u === 'new' ? { username: '', fullName: '', password: '', role: 'teacher', school: '' } : { username: u.username, fullName: u.fullName, password: '', role: u.role, school: u.school });
  };
  const submit = async () => {
    setBusy(true);
    try {
      if (editing === 'new') { await api.createUser(form); toast('Foydalanuvchi yaratildi'); }
      else if (editing) {
        await api.updateUser(editing.id, { fullName: form.fullName, role: form.role, school: form.school, ...(form.password ? { password: form.password } : {}) });
        toast('Saqlandi');
      }
      setEditing(null);
      load();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const remove = async (u: User) => {
    if (!(await confirm({ title: 'Foydalanuvchini o‘chirish', text: `${u.fullName} va uning ${u.reportCount ?? 0} ta hisoboti butunlay o‘chiriladi.`, danger: true, confirmText: 'O‘chirish' }))) return;
    try { await api.deleteUser(u.id); toast('O‘chirildi'); load(); } catch (e) { toast((e as Error).message, 'error'); }
  };

  if (!users) return <PageLoader />;
  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">{users.length} ta foydalanuvchi</h2>
        <Button variant="primary" size="sm" icon={<UserPlus className="size-4" />} onClick={() => open('new')}>Yangi foydalanuvchi</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr><th className="px-5 py-3">F.I.O.</th><th className="px-4 py-3">Login</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3 text-right">Hisobotlar</th><th className="px-4 py-3">Qo‘shilgan</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-5 py-3"><div className="font-medium text-slate-900">{u.fullName}</div>{u.school && <div className="text-xs text-slate-500">{u.school}</div>}</td>
                <td className="px-4 py-3 font-mono text-[13px] text-slate-600">{u.username}</td>
                <td className="px-4 py-3">{u.role === 'admin' ? <Badge tone="navy">Administrator</Badge> : <Badge>O‘qituvchi</Badge>}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <Link to={`/reports`} className="text-navy-700 hover:underline">{u.reportCount}</Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-2">
                  <div className="flex justify-end">
                    <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Tahrirlash / parolni tiklash" onClick={() => open(u)}><Pencil className="size-4" /></button>
                    <button className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" disabled={u.id === me?.id} title="O‘chirish" onClick={() => remove(u)}><Trash2 className="size-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Yangi foydalanuvchi' : 'Foydalanuvchini tahrirlash'}
        footer={<><Button onClick={() => setEditing(null)}>Bekor qilish</Button><Button variant="primary" loading={busy} onClick={submit}>Saqlash</Button></>}>
        <div className="grid gap-4">
          <Field label="F.I.O."><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="Login" hint={editing === 'new' ? 'Lotin harflari, raqamlar, . _ - (kamida 3 belgi)' : undefined}>
            <input className="input font-mono" value={form.username} disabled={editing !== 'new'} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label={editing === 'new' ? 'Parol' : 'Yangi parol (o‘zgartirmaslik uchun bo‘sh qoldiring)'} hint="Kamida 6 belgi">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" type="text" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rol">
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="teacher">O‘qituvchi</option><option value="admin">Administrator</option>
              </select>
            </Field>
            <Field label="Maktab"><input className="input" value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CatalogPanel({ kind }: { kind: 'class' | 'subject' }) {
  const { toast } = useFeedback();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [name, setName] = useState('');
  const load = () => api.catalog().then((c) => setItems(kind === 'class' ? c.classes : c.subjects)).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async () => {
    if (!name.trim()) return;
    try { await api.addCatalog(kind, kind === 'class' ? name.trim().toUpperCase() : name.trim()); setName(''); load(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  if (!items) return <PageLoader />;
  return (
    <div className="card p-5">
      <p className="mb-4 text-sm text-slate-500">
        {kind === 'class' ? 'Sinflar ro‘yxati hisobot yaratishda tavsiya sifatida ko‘rsatiladi.' : 'Fanlar ro‘yxati hisobot yaratishda tavsiya sifatida ko‘rsatiladi.'}
      </p>
      <div className="mb-5 flex max-w-md gap-2">
        <input className="input" placeholder={kind === 'class' ? 'Masalan: 7-V' : 'Masalan: Astronomiya'} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={add}>Qo‘shish</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((i) => (
          <span key={i.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-sm text-slate-800">
            {i.name}
            <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="O‘chirish"
              onClick={async () => { await api.deleteCatalog(i.id); load(); }}><Trash2 className="size-3.5" /></button>
          </span>
        ))}
        {!items.length && <span className="text-sm text-slate-500">Ro‘yxat bo‘sh</span>}
      </div>
    </div>
  );
}
