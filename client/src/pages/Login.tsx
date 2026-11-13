import clsx from 'clsx';
import { BarChart3, Lock, School, User, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'register';

function IconInput({ id, label, icon, hint, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; icon: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>
        <input id={id} className="input pl-9" {...rest} />
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [allowRegister, setAllowRegister] = useState(true);
  const [form, setForm] = useState({ username: '', password: '', repeat: '', fullName: '', school: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authConfig().then((c) => setAllowRegister(c.allowRegister)).catch(() => {});
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const switchMode = (m: Mode) => { setMode(m); setError(''); setForm({ ...form, password: '', repeat: '' }); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register') {
      if (!form.fullName.trim()) return setError('F.I.O. ni kiriting');
      if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(form.username.trim())) return setError('Login kamida 3 ta lotin harfi, raqam yoki . _ - belgilaridan iborat bo‘lsin');
      if (form.password.length < 6) return setError('Parol kamida 6 belgidan iborat bo‘lsin');
      if (form.password !== form.repeat) return setError('Parollar mos kelmadi');
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(form.username.trim(), form.password);
      else await register({ username: form.username.trim(), password: form.password, fullName: form.fullName.trim(), school: form.school.trim() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    // Oddiy, toza kirish sahifasi: o'rtada bitta karta — logotip tepada, forma ostida (logotip ustiga hech narsa tushmaydi)
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm" noValidate>
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-white shadow-sm">
            <BarChart3 className="size-6" />
          </div>
          <div className="text-xl font-semibold leading-none tracking-tight text-slate-900">EduAnalyze</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
          {allowRegister && (
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium">
              {(['login', 'register'] as const).map((m) => (
                <button key={m} type="button" onClick={() => switchMode(m)}
                  className={clsx('h-9 rounded-md transition-colors', mode === m ? 'bg-white text-navy-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900')}>
                  {m === 'login' ? 'Kirish' : 'Ro‘yxatdan o‘tish'}
                </button>
              ))}
            </div>
          )}

          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{mode === 'login' ? 'Tizimga kirish' : 'Yangi hisob yaratish'}</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {mode === 'login' ? 'Login va parolingizni kiriting' : 'O‘qituvchi sifatida ro‘yxatdan o‘ting — hisob darhol ochiladi'}
          </p>

          <div className="mt-7 space-y-4">
            {mode === 'register' && (
              <>
                <IconInput id="fn" label="F.I.O." icon={<UserRound className="size-4" />} value={form.fullName} onChange={set('fullName')} placeholder="Familiya Ism Otasining ismi" autoComplete="name" autoFocus />
                <IconInput id="sc" label="Maktab (ixtiyoriy)" icon={<School className="size-4" />} value={form.school} onChange={set('school')} placeholder="Masalan: 12-son maktab" autoComplete="organization" />
              </>
            )}
            <IconInput id="u" label="Login" icon={<User className="size-4" />} value={form.username} onChange={set('username')} autoComplete="username"
              autoFocus={mode === 'login'} hint={mode === 'register' ? 'Lotin harflari, raqamlar va . _ - (kamida 3 belgi)' : undefined} />
            <IconInput id="p" label="Parol" type="password" icon={<Lock className="size-4" />} value={form.password} onChange={set('password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} hint={mode === 'register' ? 'Kamida 6 belgi' : undefined} />
            {mode === 'register' && (
              <IconInput id="p2" label="Parolni takrorlang" type="password" icon={<Lock className="size-4" />} value={form.repeat} onChange={set('repeat')} autoComplete="new-password" />
            )}
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {mode === 'login' ? 'Kirish' : 'Ro‘yxatdan o‘tish'}
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-slate-500">
            {!allowRegister ? 'Hisobingiz yo‘qmi? Maktab administratoriga murojaat qiling.'
              : mode === 'login'
                ? <>Hisobingiz yo‘qmi? <button type="button" className="font-medium text-navy-700 hover:underline" onClick={() => switchMode('register')}>Ro‘yxatdan o‘ting</button></>
                : <>Hisobingiz bormi? <button type="button" className="font-medium text-navy-700 hover:underline" onClick={() => switchMode('login')}>Kirish</button></>}
          </p>
        </div>
      </form>
    </div>
  );
}
