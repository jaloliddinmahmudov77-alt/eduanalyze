import clsx from 'clsx';
import { Crop, Maximize, RotateCcw, RotateCw, Undo2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { autoDeskew, cloneCanvas, crop, guessDocumentQuad, rotate90, warpPerspective } from '../../lib/scan/imageOps';
import type { Point, Rect, ScanPage } from '../../lib/scan/types';
import { useFeedback } from '../feedback';
import { Button, Modal } from '../ui';

type Mode = 'view' | 'crop' | 'perspective';

/** Sahifa rasmini tahrirlash: aylantirish, kesish, perspektiva, avtomatik tekislash */
export function PageEditor({ page, onClose, onSave }: { page: ScanPage | null; onClose: () => void; onSave: (c: HTMLCanvasElement) => void }) {
  const { toast } = useFeedback();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [history, setHistory] = useState<HTMLCanvasElement[]>([]);
  const [mode, setMode] = useState<Mode>('view');
  const [rect, setRect] = useState<Rect | null>(null);
  const [quad, setQuad] = useState<Point[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'rect' | 'corner'; idx?: number; start?: Point } | null>(null);

  useEffect(() => {
    if (page) { setCanvas(cloneCanvas(page.canvas)); setHistory([]); setMode('view'); setRect(null); }
  }, [page]);
  const url = useMemo(() => canvas?.toDataURL('image/jpeg', 0.9) || '', [canvas]);

  if (!page || !canvas) return null;
  const W = canvas.width, H = canvas.height;
  const apply = (next: HTMLCanvasElement) => { setHistory((h) => [...h.slice(-9), canvas]); setCanvas(next); setMode('view'); setRect(null); };

  const toImg = (e: React.PointerEvent): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) };
  };
  const onDown = (e: React.PointerEvent) => {
    if (mode === 'crop') {
      const p = toImg(e);
      drag.current = { kind: 'rect', start: p };
      setRect({ x: p.x, y: p.y, w: 0, h: 0 });
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toImg(e);
    if (d.kind === 'rect' && d.start) setRect({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) });
    if (d.kind === 'corner' && d.idx !== undefined) setQuad((q) => q.map((c, i) => (i === d.idx ? p : c)));
  };
  const onUp = () => { drag.current = null; };
  const handle = Math.max(W, H) / 45;

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-5xl"
      title={`Sahifani tahrirlash — ${page.name}`}
      description="Jadval aniq o‘qilishi uchun rasmni tekislang va ortiqcha joylarini kesib tashlang"
      footer={
        <>
          <Button onClick={onClose}>Bekor qilish</Button>
          <Button variant="primary" onClick={() => { onSave(canvas); onClose(); }}>Saqlash</Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={() => apply(rotate90(canvas, -1))}>Chapga</Button>
        <Button size="sm" icon={<RotateCw className="size-4" />} onClick={() => apply(rotate90(canvas, 1))}>O‘ngga</Button>
        <Button size="sm" icon={<Wand2 className="size-4" />} onClick={() => {
          const r = autoDeskew(canvas);
          if (Math.abs(r.angle) < 0.2) toast('Rasm allaqachon tekis', 'info');
          else { apply(r.canvas); toast(`Rasm ${Math.abs(r.angle)}° ga tekislandi`); }
        }}>Avto-tekislash</Button>
        <Button size="sm" variant={mode === 'crop' ? 'primary' : 'secondary'} icon={<Crop className="size-4" />} onClick={() => { setMode(mode === 'crop' ? 'view' : 'crop'); setRect(null); }}>Kesish</Button>
        <Button size="sm" variant={mode === 'perspective' ? 'primary' : 'secondary'} icon={<Maximize className="size-4" />} onClick={() => {
          if (mode === 'perspective') { setMode('view'); return; }
          setQuad(guessDocumentQuad(canvas));
          setMode('perspective');
        }}>Perspektiva</Button>
        <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} disabled={!history.length} onClick={() => { setCanvas(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); setMode('view'); }}>Orqaga</Button>
        <Button size="sm" variant="ghost" onClick={() => apply(cloneCanvas(page.original))}>Asl holi</Button>
      </div>

      {mode !== 'view' && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-800">
          {mode === 'crop' ? 'Jadval joylashgan sohani sichqoncha yoki barmoq bilan belgilang.' : 'To‘rt burchakni jadval (varaq) burchaklariga suring.'}
          <Button size="sm" variant="primary" className="ml-auto"
            disabled={mode === 'crop' && (!rect || rect.w < 20 || rect.h < 20)}
            onClick={() => {
              try {
                if (mode === 'crop' && rect) apply(crop(canvas, rect));
                if (mode === 'perspective') apply(warpPerspective(canvas, quad));
              } catch (e) { toast((e as Error).message, 'error'); }
            }}>
            Qo‘llash
          </Button>
        </div>
      )}

      <div className="relative mx-auto w-fit max-w-full select-none touch-none">
        <img src={url} alt="" className="block max-h-[62vh] max-w-full" draggable={false} />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className={clsx('absolute inset-0 h-full w-full', mode === 'crop' && 'cursor-crosshair')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {mode === 'crop' && rect && (
            <>
              <path d={`M0 0H${W}V${H}H0Z M${rect.x} ${rect.y}v${rect.h}h${rect.w}v${-rect.h}Z`} fill="rgba(15,23,42,0.45)" fillRule="evenodd" />
              <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke="#facc15" strokeWidth={handle / 5} />
            </>
          )}
          {mode === 'perspective' && quad.length === 4 && (
            <>
              <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(250,204,21,0.12)" stroke="#facc15" strokeWidth={handle / 5} />
              {quad.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={handle} fill="rgba(36,69,139,0.85)" stroke="#fff" strokeWidth={handle / 5} className="cursor-move"
                  onPointerDown={(e) => { e.stopPropagation(); drag.current = { kind: 'corner', idx: i }; (e.target as Element).setPointerCapture?.(e.pointerId); }} />
              ))}
            </>
          )}
        </svg>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">{W} × {H} px</p>
    </Modal>
  );
}
