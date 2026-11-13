import clsx from 'clsx';
import { ArrowDown, ArrowUp, Camera, Cpu, FileText, ImageUp, Loader2, Pencil, ScanLine, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { uid } from '../../lib/calc';
import { cloneCanvas, fileToCanvas, thumbnail, toBase64Jpeg } from '../../lib/scan/imageOps';
import { buildReview, normalizeAiTable, type ApplyResult, type PageResult, type ReviewState } from '../../lib/scan/review';
import type { ScanPage } from '../../lib/scan/types';
import type { ReportData } from '../../lib/types';
import { useFeedback } from '../feedback';
import { Button } from '../ui';
import { CameraCapture } from './CameraCapture';
import { PageEditor } from './PageEditor';
import { ScanReview } from './ScanReview';

type Engine = 'ocr' | 'ai' | 'both';
type Step = 'pages' | 'analyzing' | 'review';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PAGES = 20;

export function Scanner({ data, onApply }: { data: ReportData; onApply: (r: ApplyResult) => void }) {
  const { toast } = useFeedback();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [step, setStep] = useState<Step>('pages');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [editing, setEditing] = useState<ScanPage | null>(null);
  const [engine, setEngine] = useState<Engine>('ocr');
  const [ai, setAi] = useState<{ gemini: boolean; model: string | null }>({ gemini: false, model: null });
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<{ page: number; total: number; p: number; status: string }>({ page: 0, total: 0, p: 0, status: '' });
  const [review, setReview] = useState<ReviewState | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const imgInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    api.aiStatus().then(setAi).catch(() => {});
    import('../../lib/scan/ocr').then((m) => m.warmUpOcr()).catch(() => {});
  }, []);

  const addCanvas = (c: HTMLCanvasElement, name: string, source: ScanPage['source']) => {
    setPages((ps) => {
      if (ps.length >= MAX_PAGES) { toast(`Bir martada ko‘pi bilan ${MAX_PAGES} ta sahifa`, 'warning'); return ps; }
      return [...ps, { id: uid('p'), name, source, canvas: c, original: cloneCanvas(c), thumb: thumbnail(c) }];
    });
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setLoadingFiles(true);
    try {
      for (const f of files) {
        const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        if (isPdf) {
          const { pdfToCanvases } = await import('../../lib/scan/pdf');
          const { canvases, truncated } = await pdfToCanvases(f);
          canvases.forEach((c, i) => addCanvas(c, `${f.name} — ${i + 1}-bet`, 'pdf'));
          if (truncated) toast('PDF’ning faqat birinchi 30 sahifasi olindi', 'warning');
        } else if (IMAGE_TYPES.includes(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)) {
          addCanvas(await fileToCanvas(f), f.name, 'upload');
        } else {
          toast(`${f.name}: faqat JPG, JPEG, PNG, WEBP yoki PDF qabul qilinadi`, 'error');
        }
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoadingFiles(false);
    }
  };

  // Ctrl+V — buferdagi screenshotni joylash
  useEffect(() => {
    if (step !== 'pages') return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const files = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean) as File[];
      if (files.length) { e.preventDefault(); addFiles(files.map((f, i) => new File([f], `screenshot-${Date.now()}-${i}.png`, { type: f.type }))); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const move = (i: number, d: -1 | 1) => setPages((ps) => {
    const j = i + d;
    if (j < 0 || j >= ps.length) return ps;
    const n = [...ps];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const analyze = async () => {
    if (!pages.length) return toast('Avval kamida bitta rasm yoki PDF qo‘shing', 'warning');
    if (engine !== 'ocr' && !consent) return toast('AI tahlili uchun rozilik belgisini qo‘ying', 'warning');
    cancelled.current = false;
    setStep('analyzing');
    const results: PageResult[] = [];
    const warnings: string[] = [];
    const { ocrTable } = engine !== 'ai' ? await import('../../lib/scan/ocr') : { ocrTable: null };
    for (let i = 0; i < pages.length; i++) {
      if (cancelled.current) { setStep('pages'); return; }
      const page = pages[i];
      const setP = (p: number, status: string) => setProgress({ page: i + 1, total: pages.length, p, status });
      try {
        let ocr: Awaited<ReturnType<NonNullable<typeof ocrTable>>> | null = null;
        let aiTable = null;
        if (engine !== 'ocr') {
          setP(0.1, 'AI tahlil qilmoqda…');
          try {
            const img = toBase64Jpeg(page.canvas);
            aiTable = normalizeAiTable((await api.aiExtract(img.data, img.mimeType)).result);
          } catch (e) {
            if (engine === 'ai') throw e;
            warnings.push(`${i + 1}-sahifa: AI xatosi (${(e as Error).message}) — faqat mahalliy OCR natijasi ishlatildi`);
          }
        }
        if (ocrTable) {
          ocr = await ocrTable(page.canvas, setP);
          if (Math.abs(ocr.deskew) >= 0.3) warnings.push(`${i + 1}-sahifa ${Math.abs(ocr.deskew)}° ga avtomatik tekislandi`);
          if (ocr.method === 'sparse') warnings.push(`${i + 1}-sahifada jadval chiziqlari topilmadi — natijani ayniqsa diqqat bilan tekshiring`);
        }
        if (aiTable && ocr) results.push({ page: i + 1, table: aiTable, compare: ocr.table });
        else if (aiTable) results.push({ page: i + 1, table: aiTable });
        else if (ocr) results.push({ page: i + 1, table: ocr.table });
      } catch (e) {
        warnings.push(`${i + 1}-sahifani tahlil qilib bo‘lmadi: ${(e as Error).message}`);
      }
    }
    const r = buildReview(results, data);
    r.warnings.unshift(...warnings);
    setReview(r);
    setStep('review');
  };

  if (step === 'review' && review)
    return (
      <ScanReview
        pages={pages}
        review={review}
        setReview={setReview}
        data={data}
        onBack={() => setStep('pages')}
        onApply={(res) => { onApply(res); setPages([]); setReview(null); setStep('pages'); }}
      />
    );

  if (step === 'analyzing')
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <Loader2 className="mx-auto size-10 animate-spin text-navy-600" />
        <h3 className="mt-4 text-base font-semibold text-slate-900">Hujjat tahlil qilinmoqda</h3>
        <p className="mt-1 text-sm text-slate-500">{progress.total ? `${progress.page}/${progress.total}-sahifa · ` : ''}{progress.status || 'Tayyorlanmoqda…'}</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-navy-600 transition-all" style={{ width: `${Math.round((((progress.page || 1) - 1 + progress.p) / (progress.total || 1)) * 100)}%` }} />
        </div>
        <p className="mt-4 text-xs text-slate-400">Birinchi marta OCR modellari yuklanadi (bir necha soniya). Keyin tezroq ishlaydi.</p>
        <Button className="mt-5" onClick={() => { cancelled.current = true; }}>Bekor qilish</Button>
      </div>
    );

  const bigBtn = 'card flex flex-col items-center justify-center gap-2 px-4 py-6 text-center transition-colors hover:border-navy-300 hover:bg-navy-50/40 disabled:opacity-50';

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-navy-700 text-white"><ScanLine className="size-5" /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">AI Smart Scanner</h2>
            <p className="text-sm text-slate-500">Jadval rasmini, Excel screenshotini, telefon suratini yoki PDF’ni yuklang — o‘quvchilar va ballar avtomatik o‘qiladi. Natija tasdiqlashingizdan oldin tekshirish oynasida ko‘rsatiladi.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <button className={bigBtn} onClick={() => imgInput.current?.click()} disabled={loadingFiles}>
            <ImageUp className="size-8 text-navy-700" />
            <span className="text-sm font-semibold text-slate-900">Screenshot yuklash</span>
            <span className="text-xs text-slate-500">JPG, PNG, WEBP · galereyadan ham · yoki Ctrl+V</span>
          </button>
          <button className={bigBtn} onClick={() => setCameraOpen(true)}>
            <Camera className="size-8 text-navy-700" />
            <span className="text-sm font-semibold text-slate-900">Kamerani ochish</span>
            <span className="text-xs text-slate-500">Varaqni suratga oling · bir nechta sahifa</span>
          </button>
          <button className={bigBtn} onClick={() => docInput.current?.click()} disabled={loadingFiles}>
            <FileText className="size-8 text-navy-700" />
            <span className="text-sm font-semibold text-slate-900">PDF yoki hujjat yuklash</span>
            <span className="text-xs text-slate-500">Ko‘p sahifali PDF · skaner qilingan hujjat</span>
          </button>
        </div>
        <input ref={imgInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <input ref={docInput} type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
        <div
          className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-center text-xs text-slate-500"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}
        >
          {loadingFiles ? <span className="inline-flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" />Fayllar o‘qilmoqda…</span> : 'Fayllarni shu yerga tashlashingiz ham mumkin'}
        </div>
      </div>

      {pages.length > 0 && (
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Sahifalar ({pages.length})</h3>
            <button className="text-xs font-medium text-red-600 hover:underline" onClick={() => setPages([])}>Hammasini olib tashlash</button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {pages.map((p, i) => (
              <div key={p.id} className="group overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button className="block aspect-[4/3] w-full bg-slate-100" onClick={() => setEditing(p)} title="Tahrirlash">
                  <img src={p.thumb} alt={p.name} className="h-full w-full object-contain" />
                </button>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={p.name}>{i + 1}. {p.name}</span>
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Oldinga"><ArrowUp className="size-3.5" /></button>
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={i === pages.length - 1} onClick={() => move(i, 1)} aria-label="Orqaga"><ArrowDown className="size-3.5" /></button>
                  <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setEditing(p)} aria-label="Tahrirlash"><Pencil className="size-3.5" /></button>
                  <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))} aria-label="O‘chirish"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {([
              ['ocr', <Cpu className="size-4" />, 'Mahalliy OCR', 'Brauzerning o‘zida ishlaydi. Rasm hech qayerga yuborilmaydi.', true],
              ['ai', <Sparkles className="size-4" />, 'AI Vision', ai.gemini ? `Google Gemini (${ai.model})` : 'Administrator sozlamagan', ai.gemini],
              ['both', <ShieldCheck className="size-4" />, 'AI + OCR solishtirish', 'Eng aniq: farqli kataklar tekshirishga belgilanadi', ai.gemini],
            ] as const).map(([id, icon, title, sub, enabled]) => (
              <button key={id} disabled={!enabled} onClick={() => setEngine(id)}
                className={clsx('rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  engine === id ? 'border-navy-600 bg-navy-50 ring-2 ring-navy-100' : 'border-slate-200 hover:bg-slate-50')}>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">{icon}{title}</div>
                <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
              </button>
            ))}
          </div>
          {engine !== 'ocr' && (
            <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <input type="checkbox" className="mt-0.5 size-4 accent-navy-700" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Rasmlar (o‘quvchilar ismi va ballari bilan) tahlil uchun maktab serveri orqali <b>Google Gemini</b> xizmatiga yuboriladi. Bunga roziman.</span>
            </label>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="primary" icon={<ScanLine className="size-4" />} onClick={analyze}>
              {pages.length} ta sahifani tahlil qilish
            </Button>
          </div>
        </div>
      )}

      <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(c) => addCanvas(c, `Kamera — ${new Date().toLocaleTimeString('uz-UZ')}`, 'camera')} />
      <PageEditor
        page={editing}
        onClose={() => setEditing(null)}
        onSave={(c) => setPages((ps) => ps.map((p) => (p.id === editing?.id ? { ...p, canvas: c, thumb: thumbnail(c) } : p)))}
      />
    </div>
  );
}
