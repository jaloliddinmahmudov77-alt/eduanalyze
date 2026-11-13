import { useState } from 'react';
import { useFeedback } from '../components/feedback';
import { Page } from '../components/Layout';
import { Button, Field, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Settings() {
  const { user, setUser } = useAuth();
  const { toast } = useFeedback();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [school, setSchool] = useState(user?.school || '');
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [busy, setBusy] = useState<'p' | 'w' | null>(null);

  const saveProfile = async () => {
    setBusy('p');
    try { const r = await api.updateProfile(fullName, school); setUser(r.user); toast('Profil saqlandi'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const savePw = async () => {
    if (pw.next !== pw.repeat) return toast('Yangi parollar mos kelmadi', 'error');
    setBusy('w');
    try { await api.changePassword(pw.current, pw.next); setPw({ current: '', next: '', repeat: '' }); toast('Parol o‘zgartirildi'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };

  return (
    <Page>
      <PageHeader title="Sozlamalar" subtitle={`Login: ${user?.username}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Profil</h2>
          <p className="mb-4 text-sm text-slate-500">Bu ma’lumotlar yangi hisobotlarda avtomatik to‘ldiriladi.</p>
          <div className="space-y-4">
            <Field label="F.I.O."><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
            <Field label="Maktab nomi"><input className="input" value={school} onChange={(e) => setSchool(e.target.value)} /></Field>
            <Button variant="primary" loading={busy === 'p'} onClick={saveProfile}>Saqlash</Button>
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Parolni o‘zgartirish</h2>
          <p className="mb-4 text-sm text-slate-500">Boshqa qurilmalardagi sessiyalar yopiladi.</p>
          <div className="space-y-4">
            <Field label="Joriy parol"><input type="password" className="input" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="Yangi parol" hint="Kamida 6 belgi"><input type="password" className="input" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Yangi parolni takrorlang"><input type="password" className="input" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
            <Button variant="primary" loading={busy === 'w'} onClick={savePw} disabled={!pw.current || !pw.next}>Parolni o‘zgartirish</Button>
          </div>
        </div>
      </div>
    </Page>
  );
}
