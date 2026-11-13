import clsx from 'clsx';
import { Headset, Loader2, Send } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFeedback } from '../components/feedback';
import { Page } from '../components/Layout';
import { PageHeader } from '../components/ui';
import { api } from '../lib/api';
import type { ChatMessage } from '../lib/types';

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Administrator bilan suhbat (xabarlar Telegram bot orqali administratorga yetkaziladi) */
export default function Messages() {
  const { toast } = useFeedback();
  const [list, setList] = useState<ChatMessage[] | null>(null);
  const [online, setOnline] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api.messages();
      setList(r.messages);
      setOnline(r.adminOnline);
      window.dispatchEvent(new Event('eduanalyze:messages-read'));
    } catch (e) { toast((e as Error).message, 'error'); }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useLayoutEffect(() => {
    if (list && list.length !== lastCount.current) {
      lastCount.current = list.length;
      bottom.current?.scrollIntoView({ block: 'end' });
    }
  }, [list]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      const r = await api.sendMessage(t);
      setText('');
      setList((l) => [...(l || []), r.message]);
      if (!r.delivered) toast('Xabar saqlandi. Administrator ulanganda yetkaziladi', 'info');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <Page>
      <PageHeader title="Xabarlar" subtitle="Administrator bilan suhbat: to‘lovlar, hisobotlar va boshqa savollar" />
      <div className="card flex h-[calc(100vh-220px)] min-h-[420px] flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-navy-700 text-white"><Headset className="size-4" /></div>
          <div>
            <div className="text-sm font-semibold text-slate-900">EduAnalyze administratori</div>
            <div className={clsx('text-xs', online ? 'text-emerald-600' : 'text-slate-500')}>{online ? 'Xabarlar Telegram orqali darhol yetkaziladi' : 'Administrator hozircha ulanmagan — xabaringiz saqlanadi'}</div>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-5">
          {!list ? (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-navy-600" /></div>
          ) : list.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">Hali xabar yo‘q. Savolingizni pastda yozing — administrator javob beradi.</div>
          ) : (
            list.map((m) => (
              <div key={m.id} className={clsx('flex', m.sender === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={clsx('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%]',
                  m.sender === 'user' ? 'rounded-br-md bg-navy-700 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800')}>
                  {m.sender === 'admin' && <div className="mb-0.5 text-[11px] font-semibold text-navy-700">Administrator</div>}
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                  <div className={clsx('mt-1 text-right text-[10px]', m.sender === 'user' ? 'text-navy-200' : 'text-slate-400')}>{time(m.createdAt)}</div>
                </div>
              </div>
            ))
          )}
          <div ref={bottom} />
        </div>

        <form className="flex items-end gap-2 border-t border-slate-200 bg-white p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            className="input min-h-10 flex-1 resize-none py-2"
            rows={Math.min(5, Math.max(1, text.split('\n').length))}
            maxLength={2000}
            placeholder="Xabar yozing…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button type="submit" disabled={sending || !text.trim()} aria-label="Yuborish"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-navy-700 text-white hover:bg-navy-800 disabled:opacity-40">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </form>
      </div>
    </Page>
  );
}
