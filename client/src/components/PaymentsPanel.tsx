import clsx from 'clsx';
import { Bot, Database, Eye, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, fetchReceipt, type AdminBilling } from '../lib/api';
import type { PaymentStatus } from '../lib/types';
import { useFeedback } from './feedback';
import { formatMoney } from './PaymentDialog';
import { Badge, Button, Modal, PageLoader, formatDate } from './ui';

const STATUS: Record<PaymentStatus, { label: string; tone: 'amber' | 'green' | 'red' | 'navy' }> = {
  pending: { label: 'Tekshirilmoqda', tone: 'amber' },
  approved: { label: 'Tasdiqlangan', tone: 'green' },
  used: { label: 'Yuklab olingan', tone: 'navy' },
  rejected: { label: 'Rad etilgan', tone: 'red' },
};

/** Sayt admin paneli: to'lovlar va bot holati (ko'rish). Tasdiqlash/rad etish — faqat Telegram bot orqali. */
export function PaymentsPanel() {
  const { toast } = useFeedback();
  const [d, setD] = useState<AdminBilling | null>(null);
  const [filter, setFilter] = useState<PaymentStatus | ''>('');
  const [receipt, setReceipt] = useState<{ url: string; pdf: boolean; id: number } | null>(null);

  const load = useCallback(() => api.adminBilling().then(setD).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);
  useEffect(() => () => { if (receipt) URL.revokeObjectURL(receipt.url); }, [receipt]);

  if (!d) return <PageLoader />;
  const list = d.payments.filter((p) => !filter || p.status === filter);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Jami tushum', formatMoney(d.stats.revenue)],
          ['Tekshirilmoqda', String(d.stats.pending)],
          ['Tasdiqlangan', `${d.stats.approved} (yuklangan: ${d.stats.used})`],
          ['Rad etilgan', String(d.stats.rejected)],
        ].map(([l, v]) => (
          <div key={l} className="card p-4">
            <div className="text-[13px] text-slate-500">{l}</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card flex items-start gap-3 p-4">
          <Bot className={clsx('mt-0.5 size-5', d.bot.adminBound ? 'text-emerald-600' : 'text-amber-600')} />
          <div className="text-sm">
            <div className="font-medium text-slate-900">Telegram bot {d.bot.username ? `@${d.bot.username}` : ''}</div>
            {!d.bot.enabled ? <div className="text-slate-500">Sozlanmagan (TELEGRAM_BOT_TOKEN yo‘q)</div>
              : d.bot.adminBound ? <div className="text-slate-500">Ishlayapti. To‘lovlarni faqat <b>@{d.bot.adminUsername}</b> Telegram orqali tasdiqlaydi yoki rad etadi.</div>
                : <div className="text-amber-700">@{d.bot.adminUsername} hali ulanmagan: Telegram’da botga /start yuboring.</div>}
            <div className="mt-1 text-xs text-slate-500">Narx: {formatMoney(d.config.price)} · Karta: {d.config.cardNumber || 'sozlanmagan'}{d.config.cardOwner ? ` (${d.config.cardOwner})` : ''} — botda /narx va /karta bilan o‘zgartiriladi</div>
          </div>
        </div>
        <div className="card flex items-start gap-3 p-4">
          <Database className="mt-0.5 size-5 text-navy-600" />
          <div className="text-sm">
            <div className="font-medium text-slate-900">Ma’lumotlar bazasi</div>
            <div className="text-slate-500">{d.database}</div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <h2 className="mr-auto text-sm font-semibold text-slate-900">To‘lovlar</h2>
          <select className="input h-8 w-44 text-[13px]" value={filter} onChange={(e) => setFilter(e.target.value as PaymentStatus | '')}>
            <option value="">Barchasi</option>
            {(Object.keys(STATUS) as PaymentStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
          <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={load}>Yangilash</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2.5">#</th><th className="px-4 py-2.5">O‘qituvchi</th><th className="px-4 py-2.5">Hisobot</th><th className="px-4 py-2.5 text-right">Summa</th><th className="px-4 py-2.5">Holat</th><th className="px-4 py-2.5">Sana</th><th className="px-4 py-2.5"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 tabular-nums text-slate-500">{p.id}</td>
                  <td className="px-4 py-2.5"><div className="font-medium text-slate-900">{p.userName}</div><div className="font-mono text-xs text-slate-500">{p.username}</div></td>
                  <td className="px-4 py-2.5 text-slate-700">{p.reportLabel}{p.reportId === null && <span className="ml-1 text-xs text-slate-400">(o‘chirilgan)</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(p.amount)}</td>
                  <td className="px-4 py-2.5"><Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>{p.note && <div className="mt-0.5 text-xs text-slate-500">{p.note}</div>}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatDate(p.createdAt)}</td>
                  <td className="px-4 py-2">
                    {p.hasReceipt && (
                      <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Chekni ko‘rish" onClick={async () => {
                        try { const b = await fetchReceipt(p.id); setReceipt({ url: URL.createObjectURL(b), pdf: b.type === 'application/pdf', id: p.id }); }
                        catch (e) { toast((e as Error).message, 'error'); }
                      }}><Eye className="size-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">To‘lovlar yo‘q</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!receipt} onClose={() => setReceipt(null)} title={`To‘lov #${receipt?.id} cheki`} width="max-w-2xl">
        {receipt && (receipt.pdf
          ? <iframe src={receipt.url} title="Chek" className="h-[70vh] w-full rounded" />
          : <img src={receipt.url} alt="Chek" className="mx-auto max-h-[70vh] rounded" />)}
      </Modal>
    </div>
  );
}
