import { Camera, Check, RefreshCcw, RotateCcw, SwitchCamera, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fileToCanvas, limitSize, makeCanvas } from '../../lib/scan/imageOps';
import { Button } from '../ui';

/** Sayt ichidagi hujjat skaneri: kamerani yoqish, almashtirish, suratga olish, qayta olish, ketma-ket bir nechta sahifa */
export function CameraCapture({ open, onClose, onCapture }: { open: boolean; onClose: () => void; onCapture: (c: HTMLCanvasElement) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [cams, setCams] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [shot, setShot] = useState<HTMLCanvasElement | null>(null);
  const [count, setCount] = useState(0);
  const fallbackRef = useRef<HTMLInputElement>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (mode: 'environment' | 'user') => {
    stop();
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Bu brauzer yoki ulanish kamerani qo‘llab-quvvatlamaydi (kamera faqat HTTPS yoki localhost’da ishlaydi).');
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCams(devices.filter((d) => d.kind === 'videoinput').length);
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === 'NotAllowedError' ? 'Kameraga ruxsat berilmadi. Brauzer sozlamalarida ruxsat bering yoki rasmni fayl sifatida yuklang.'
          : name === 'NotFoundError' ? 'Qurilmada kamera topilmadi.'
            : name === 'NotReadableError' ? 'Kamera boshqa dastur tomonidan band qilingan.'
              : `Kamerani ochib bo‘lmadi: ${(e as Error).message}`,
      );
    } finally {
      setStarting(false);
    }
  }, [stop]);

  useEffect(() => {
    if (open) { setShot(null); setCount(0); start(facing); }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = makeCanvas(v.videoWidth, v.videoHeight);
    c.getContext('2d')!.drawImage(v, 0, 0);
    setShot(limitSize(c));
  };
  const accept = (close: boolean) => {
    if (!shot) return;
    onCapture(shot);
    setCount((n) => n + 1);
    setShot(null);
    if (close) { stop(); onClose(); }
  };
  const switchCam = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    start(next);
  };
  const close = () => { stop(); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-sm font-medium">Hujjatni suratga olish {count > 0 && <span className="ml-2 rounded bg-white/15 px-2 py-0.5 text-xs">{count} ta sahifa qo‘shildi</span>}</div>
        <button onClick={close} className="rounded-full p-2 hover:bg-white/10" aria-label="Yopish"><X className="size-6" /></button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {/* video doim DOM'da turadi — qayta olishda oqim uzilmasligi uchun */}
        <video ref={videoRef} playsInline muted className={shot || error ? 'hidden' : 'max-h-full max-w-full object-contain'} />
        {error ? (
          <div className="max-w-sm p-6 text-center">
            <Camera className="mx-auto size-10 text-white/60" />
            <p className="mt-4 text-sm text-white/85">{error}</p>
            <div className="mt-5 flex flex-col gap-2">
              <Button variant="primary" onClick={() => fallbackRef.current?.click()}>Telefon kamerasi / galereyadan yuklash</Button>
              <Button onClick={() => start(facing)} icon={<RefreshCcw className="size-4" />}>Qayta urinish</Button>
            </div>
            <input ref={fallbackRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
              onChange={async (e) => {
                for (const f of Array.from(e.target.files || [])) { try { onCapture(await fileToCanvas(f)); setCount((n) => n + 1); } catch { /* ignore */ } }
                e.target.value = '';
              }} />
          </div>
        ) : shot ? (
          <img src={shot.toDataURL('image/jpeg', 0.85)} alt="Olingan surat" className="max-h-full max-w-full object-contain" />
        ) : (
          <>
            {/* hujjatni joylashtirish uchun yo'riqnoma ramkasi */}
            <div className="pointer-events-none absolute inset-[8%] rounded-lg border-2 border-dashed border-white/50" />
            <div className="pointer-events-none absolute bottom-4 left-0 right-0 text-center text-xs text-white/80">Jadvalni ramka ichiga to‘liq va tekis joylashtiring, yorug‘lik yetarli bo‘lsin</div>
            {starting && <div className="absolute text-sm text-white/80">Kamera ishga tushirilmoqda…</div>}
          </>
        )}
      </div>

      {!error && (
        <div className="flex items-center justify-center gap-6 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {shot ? (
            <>
              <Button onClick={() => setShot(null)} icon={<RotateCcw className="size-4" />}>Qayta olish</Button>
              <Button onClick={() => accept(false)} icon={<Check className="size-4" />}>Qo‘shish va davom etish</Button>
              <Button variant="primary" onClick={() => accept(true)} icon={<Check className="size-4" />}>Qo‘shish va yopish</Button>
            </>
          ) : (
            <>
              <div className="w-12">
                {cams > 1 && (
                  <button onClick={switchCam} className="rounded-full bg-white/10 p-3 hover:bg-white/20" aria-label="Kamerani almashtirish" title="Old / orqa kamera">
                    <SwitchCamera className="size-6" />
                  </button>
                )}
              </div>
              <button onClick={capture} disabled={starting} aria-label="Suratga olish"
                className="flex size-18 items-center justify-center rounded-full border-4 border-white/80 bg-white/10 transition hover:bg-white/25 active:scale-95 disabled:opacity-40">
                <span className="size-13 rounded-full bg-white" />
              </button>
              <div className="w-12">
                {count > 0 && <button onClick={close} className="rounded-full bg-white/10 px-3 py-2 text-xs hover:bg-white/20">Tayyor</button>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
