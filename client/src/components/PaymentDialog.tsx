import { CheckCircle2, Clock, Copy, CreditCard, Download, FileUp, Loader2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, exportReportFile } from '../lib/api';
import { downloadBlob } from '../lib/excel';
import { fileToCanvas, toBase64Jpeg } from '../lib/scan/imageOps';
import type { PaymentState } from '../lib/types';
import { useFeedback } from './feedback';
import { Button, Modal } from './ui';

export const formatMoney = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;

async function fileToBase64(f: File): Promise<{ data: string; mimeType: string }> {
  if (f.type === 'application/pdf') {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(bin), mimeType: 'application/pdf' };
  }
  // rasm: hajmini kichraytirib JPEG ga aylantirish
  return toBase64Jpeg(await fileToCanvas(f), 1800, 0.85);
}

/**
 * Pullik Excel yuklab olish. download(reportId) — avval serverdan so'raydi;
 * to'lov kerak bo'lsa (402) to'lov oynasini ochadi, tasdiqlangach faylni avtomatik yuklab beradi.
 */
export function usePaidDownload() {
  const { toast } = useFeedback();
  const [target, setTarget] = useState<{ id: number; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchFile = useCallback(async (id: number) => {
    const r = await exportReportFile(id);
    if ('blob' in r) {
      downloadBlob(r.blob, r.filename);
      return true;
    }
    return false;
  }, []);

  const download = useCallback(async (id: number, label: string) => {
    setBusy(true);
    try {
      if (await fetchFile(id)) toast('Excel hisobot yuklab olindi');
      else setTarget({ id, label });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }, [fetchFile, toast]);

  const dialog = target ? (
    <PaymentDialog
      reportId={target.id}
      label={target.label}
      onClose={() => setTarget(null)}
      onDownload={async () => {
        const ok = await fetchFile(target.id);
        if (ok) { toast('To‘lov tasdiqlandi — Excel hisobot yuklab olindi'); setTarget(null); }
        return ok;
      }}
    />
  ) : null;

  return { download, busy, dialog };
}

function PaymentDialog({ reportId, label, onClose, onDownload }: { reportId: number; label: string; onClose: () => void; onDownload: () => Promise<boolean> }) {
  const { toast } = useFeedback();
  const [state, setState] = useState<PaymentState | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const autoDone = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setState(await api.paymentState(reportId)); } catch (e) { toast((e as Error).message, 'error'); }
  }, [reportId, toast]);
  useEffect(() => { load(); }, [load]);

  // tekshirilayotgan bo'lsa — har 4 soniyada holatni yangilash (admin Telegram'da qaror qiladi)
  const pending = state?.payment?.status === 'pending' && state.access === 'none';
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [pending, load]);

  const canDownload = state && state.access !== 'none';
  useEffect(() => {
    if (!canDownload || autoDone.current || state?.payment?.status !== 'approved') return;
    autoDone.current = true;
    setDownloading(true);
    onDownload().finally(() => setDownloading(false));
  }, [canDownload, state, onDownload]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(f.type)) return toast('Chek rasm (JPG, PNG, WEBP) yoki PDF bo‘lishi kerak', 'error');
    if (f.size > 10 * 1024 * 1024) return toast('Fayl 10 MB dan oshmasligi kerak', 'error');
    setFile(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
  };

  const send = async () => {
    if (!file) return;
    setSending(true);
    try {
      const { data, mimeType } = await fileToBase64(file);
      const r = await api.createPayment(reportId, data, mimeType);
      toast(r.delivered ? 'Chek administratorga yuborildi. Tasdiqlanishini kuting' : 'Chek qabul qilindi. Administrator tez orada ko‘rib chiqadi', 'success');
      setFile(null);
      setPreview('');
      await load();
    } catch (e) {
      toast((e as Error).message, 'error');
      load();
    } finally {
      setSending(false);
    }
  };

  const cfg = state?.config;
  const p = state?.payment;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t.replace(/\s/g, '')); toast('Karta raqami nusxalandi'); } catch { toast('Nusxalab bo‘lmadi', 'warning'); } };

  return (
    <Modal open onClose={onClose} title="Excel hisobotni yuklab olish" description={label} width="max-w-lg"
      footer={<Button onClick={onClose}>Yopish</Button>}>
      {!state || !cfg ? (
        <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-navy-600" /></div>
      ) : canDownload ? (
        <div className="py-4 text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
          <h3 className="mt-3 text-base font-semibold text-slate-900">To‘lov tasdiqlangan</h3>
          <p className="mt-1 text-sm text-slate-500">
            {state.access === 'redownload' ? `Fayl yaqinda yuklab olingan — ${cfg.redownloadMinutes} daqiqa ichida qayta yuklab olishingiz mumkin.` : 'Rasmiy Excel hisobotni yuklab oling.'}
          </p>
          <Button className="mt-5" variant="success" loading={downloading} icon={<Download className="size-4" />}
            onClick={async () => { setDownloading(true); try { await onDownload(); } catch (e) { toast((e as Error).message, 'error'); } finally { setDownloading(false); } }}>
            Yuklab olish
          </Button>
        </div>
      ) : pending ? (
        <div className="py-4 text-center">
          <div className="relative mx-auto flex size-14 items-center justify-center rounded-full bg-amber-50">
            <Clock className="size-7 text-amber-600" />
          </div>
          <h3 className="mt-3 text-base font-semibold text-slate-900">Chek tekshirilmoqda</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            To‘lovingiz administratorga yuborildi. Tasdiqlanishi bilan fayl avtomatik yuklab olinadi — oynani yopsangiz, keyin “Excel yuklab olish” tugmasini qayta bosing.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
            <Loader2 className="size-3.5 animate-spin" /> To‘lov #{p?.id} · {formatMoney(p?.amount || 0)}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {p?.status === 'rejected' && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <div>Oldingi to‘lov (#{p.id}) rad etildi.{p.note ? ` Sabab: ${p.note}.` : ''} Iltimos, to‘g‘ri chekni qayta yuboring. Savollar bo‘lsa — <a href="/messages" className="font-medium underline">Xabarlar</a> bo‘limida administratorga yozing.</div>
            </div>
          )}
          <div className="rounded-xl bg-navy-900 p-5 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm text-navy-200">Bitta hisobotni yuklab olish</span>
              <CreditCard className="size-5 text-navy-200" />
            </div>
            <div className="mt-1 text-3xl font-semibold tracking-tight">{formatMoney(cfg.price)}</div>
            {cfg.cardNumber ? (
              <div className="mt-4 rounded-lg bg-white/10 px-3 py-2.5">
                <div className="text-xs text-navy-200">Quyidagi kartaga o‘tkazing</div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="font-mono text-lg tracking-wider">{cfg.cardNumber}</span>
                  <button onClick={() => copy(cfg.cardNumber)} className="rounded-md p-1.5 text-navy-100 hover:bg-white/15" aria-label="Nusxalash"><Copy className="size-4" /></button>
                </div>
                {cfg.cardOwner && <div className="text-sm text-navy-100">{cfg.cardOwner}</div>}
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-amber-400/20 px-3 py-2 text-sm text-amber-100">To‘lov kartasi hali sozlanmagan. Administratorga murojaat qiling.</div>
            )}
          </div>

          <ol className="space-y-1.5 text-sm text-slate-600">
            <li>1. Click, Payme yoki bank ilovasi orqali <b>{formatMoney(cfg.price)}</b> ni yuqoridagi kartaga o‘tkazing.</li>
            <li>2. To‘lov chekining skrinshotini yoki PDF’ini yuklang.</li>
            <li>3. Administrator tasdiqlagach, fayl avtomatik yuklab olinadi.</li>
          </ol>

          <div
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-center hover:border-navy-400 hover:bg-slate-50"
          >
            {preview ? <img src={preview} alt="Chek" className="max-h-48 rounded-md object-contain" />
              : file ? <div className="text-sm font-medium text-slate-800">{file.name}</div>
                : <><FileUp className="size-7 text-slate-400" /><div className="mt-2 text-sm font-medium text-slate-800">Chekni yuklang</div><div className="text-xs text-slate-500">JPG, PNG, WEBP yoki PDF · 10 MB gacha</div></>}
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {!cfg.botReady && <p className="text-xs text-amber-700">Eslatma: administrator boti hali ulanmagan — chek saqlanadi va bot ulangach ko‘rib chiqiladi.</p>}
          <Button variant="primary" className="w-full" loading={sending} disabled={!file || !cfg.cardNumber} onClick={send}>
            Chekni yuborish
          </Button>
        </div>
      )}
    </Modal>
  );
}
