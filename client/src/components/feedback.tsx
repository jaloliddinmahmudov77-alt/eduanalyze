import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from './ui';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; kind: ToastKind; text: string }
interface ConfirmOpts { title: string; text?: string; confirmText?: string; danger?: boolean }

interface Ctx {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
}
const FeedbackCtx = createContext<Ctx>(null as unknown as Ctx);
export const useFeedback = () => useContext(FeedbackCtx);

const icons = {
  success: <CheckCircle2 className="size-5 text-emerald-600" />,
  error: <XCircle className="size-5 text-red-600" />,
  info: <Info className="size-5 text-navy-600" />,
  warning: <AlertTriangle className="size-5 text-amber-600" />,
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3200);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setDlg({ ...opts, resolve })), []);
  const close = (v: boolean) => { dlg?.resolve(v); setDlg(null); };

  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex w-full sm:w-auto sm:max-w-sm items-start gap-3 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg',
              t.kind === 'error' ? 'border-red-200' : 'border-slate-200',
            )}
            role="status"
          >
            {icons[t.kind]}
            <span className="text-slate-700">{t.text}</span>
          </div>
        ))}
      </div>
      <Modal
        open={!!dlg}
        onClose={() => close(false)}
        title={dlg?.title || ''}
        footer={
          <>
            <Button onClick={() => close(false)}>Bekor qilish</Button>
            <Button variant={dlg?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {dlg?.confirmText || 'Tasdiqlash'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{dlg?.text}</p>
      </Modal>
    </FeedbackCtx.Provider>
  );
}
