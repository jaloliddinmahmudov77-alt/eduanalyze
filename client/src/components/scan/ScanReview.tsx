import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseScore } from '../../lib/calc';
import { applyReview, unresolvedCount, validateRows, type ApplyResult, type ReviewState } from '../../lib/scan/review';
import type { ColKind, ScanPage } from '../../lib/scan/types';
import { COMPETENCES, COMPETENCE_LABEL, type Competence, type ReportData } from '../../lib/types';
import { useFeedback } from '../feedback';
import { Badge, Button } from '../ui';

const KIND_LABEL: Record<ColKind, string> = {
  score: 'Ball', total: 'Umumiy ball', percent: 'Foiz', bilish: 'Bilish %', qollash: 'Qo‘llash %', mulohaza: 'Mulohaza %', other: 'Boshqa',
};

export function ScanReview({ pages, review, setReview, data, onApply, onBack }: {
  pages: ScanPage[];
  review: ReviewState;
  setReview: (r: ReviewState) => void;
  data: ReportData;
  onApply: (r: ApplyResult) => void;
  onBack: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [pageIdx, setPageIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const pageUrls = useMemo(() => pages.map((p) => p.canvas.toDataURL('image/jpeg', 0.85)), [pages]);

  const mutate = (fn: (r: ReviewState) => void) => {
    const next = structuredClone(review);
    fn(next);
    validateRows(next);
    setReview(next);
  };

  const used = review.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.target !== 'ignore');
  const included = review.rows.filter((r) => r.include);
  const unresolved = unresolvedCount(review);
  const filledCells = included.reduce((a, r) => a + used.filter(({ i }) => r.cells[i].value !== null && !r.cells[i].flag).length, 0);
  const dupCount = review.rows.filter((r) => r.rowFlags.some((f) => f.startsWith('Takror'))).length;
  const rowsShown = review.rows.filter((r) => !onlyFlagged || r.nameFlag || r.rowFlags.length || used.some(({ i }) => r.cells[i].flag));

  const confirmApply = async () => {
    if (unresolved > 0) {
      const ok = await confirm({
        title: 'Tekshirilmagan kataklar bor',
        text: `${unresolved} ta katak hali tekshirilmagan. Ular jadvalga qo‘shilmaydi (bo‘sh qoldiriladi) — keyin qo‘lda kiritishingiz mumkin. Davom etasizmi?`,
        confirmText: 'Ha, davom etish',
      });
      if (!ok) return;
    }
    try {
      onApply(applyReview(data, review));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
      {/* Chap: asl rasm */}
      <div className="card flex min-h-0 flex-col overflow-hidden xl:sticky xl:top-2 xl:max-h-[calc(100vh-190px)]">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
          <div className="flex flex-1 gap-1 overflow-x-auto">
            {pages.map((p, i) => (
              <button key={p.id} onClick={() => setPageIdx(i)}
                className={clsx('shrink-0 rounded-md px-2.5 py-1 text-xs font-medium', i === pageIdx ? 'bg-navy-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                {i + 1}-sahifa
              </button>
            ))}
          </div>
          <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Kichraytirish"><ZoomOut className="size-4" /></button>
          <span className="w-10 text-center text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
          <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Kattalashtirish"><ZoomIn className="size-4" /></button>
        </div>
        <div className="min-h-[260px] flex-1 overflow-auto bg-slate-100 p-2">
          {pageUrls[pageIdx] && <img src={pageUrls[pageIdx]} alt={`${pageIdx + 1}-sahifa`} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="mx-auto block bg-white shadow-sm" />}
        </div>
      </div>

      {/* O'ng: aniqlangan jadval */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone="navy">{included.length} ta o‘quvchi</Badge>
          <Badge tone="green">{filledCells} ta ball tayyor</Badge>
          {unresolved > 0 ? <Badge tone="amber">{unresolved} ta katak tekshirish kerak</Badge> : <Badge tone="green">Shubhali katak yo‘q</Badge>}
          {dupCount > 0 && <Badge tone="red">{dupCount} ta takror</Badge>}
        </div>

        {review.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {review.warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</div>)}
          </div>
        )}

        {/* Ustunlarni moslashtirish */}
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Ustunlarni moslashtirish</h3>
            <p className="text-xs text-slate-500">Rasmdagi har bir ustun platformadagi qaysi mezonga tegishli? Umumiy ball va foizlar platformada qayta hisoblanadi.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-3 py-2">Rasmdagi ustun</th><th className="px-3 py-2">Aniqlangan turi</th><th className="px-3 py-2">Platformadagi mezon</th><th className="px-3 py-2">Nomi</th><th className="w-24 px-3 py-2">Maks. ball</th><th className="w-36 px-3 py-2">Kompetensiya</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {review.columns.map((c, i) => {
                  const crit = data.criteria.find((x) => x.id === c.target);
                  return (
                    <tr key={i} className={clsx(c.target === 'ignore' && 'text-slate-400')}>
                      <td className="px-3 py-1.5 font-medium">{c.label}{c.max !== null && c.target === 'ignore' ? ` (max ${c.max})` : ''}</td>
                      <td className="px-3 py-1.5 text-xs">{KIND_LABEL[c.kind]}</td>
                      <td className="px-3 py-1.5">
                        <select className="input h-8 text-[13px]" value={c.target}
                          onChange={(e) => mutate((r) => {
                            const col = r.columns[i];
                            col.target = e.target.value;
                            const cr = data.criteria.find((x) => x.id === col.target);
                            if (cr) col.max = cr.max;
                          })}>
                          <option value="ignore">— E’tiborsiz qoldirish —</option>
                          <option value="new">+ Yangi mezon</option>
                          {data.criteria.map((cr) => <option key={cr.id} value={cr.id}>{cr.name} (max {cr.max})</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        {c.target === 'new'
                          ? <input className="input h-8 text-[13px]" value={c.newName} onChange={(e) => mutate((r) => { r.columns[i].newName = e.target.value; })} />
                          : <span className="text-xs">{crit?.name || ''}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        {c.target === 'new'
                          ? <input className={clsx('input h-8 text-center text-[13px]', !c.max && 'border-amber-400 bg-amber-50')} inputMode="decimal" value={c.max ?? ''} placeholder="?"
                              onChange={(e) => mutate((r) => { const v = parseScore(e.target.value); r.columns[i].max = v === null || Number.isNaN(v) || v <= 0 ? null : v; })} />
                          : <span className="text-xs tabular-nums">{crit?.max ?? ''}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        {c.target === 'new' && (
                          <select className="input h-8 text-[13px]" value={c.newType} onChange={(e) => mutate((r) => { r.columns[i].newType = e.target.value as Competence; })}>
                            {COMPETENCES.map((k) => <option key={k} value={k}>{COMPETENCE_LABEL[k]}</option>)}
                          </select>
                        )}
                        {crit && <span className="text-xs">{COMPETENCE_LABEL[crit.type]}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Aniqlangan qatorlar */}
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-900">Aniqlangan ma’lumotlar</h3>
            <span className="text-xs text-slate-500">Sariq kataklar — tekshirish kerak. Qiymatni tuzating yoki ✓ bilan tasdiqlang.</span>
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" className="size-4 accent-navy-700" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
              Faqat muammoli qatorlar
            </label>
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-8 px-2 py-2"><input type="checkbox" className="size-4 accent-navy-700" checked={review.rows.every((r) => r.include)} onChange={(e) => mutate((r) => r.rows.forEach((x) => { x.include = e.target.checked; }))} /></th>
                  <th className="w-10 px-1 py-2">Sah.</th>
                  <th className="min-w-[220px] px-2 py-2">O‘quvchi</th>
                  {used.map(({ c, i }) => (
                    <th key={i} className="min-w-[72px] px-1 py-2 text-center">
                      {c.target === 'new' ? c.newName : data.criteria.find((x) => x.id === c.target)?.name}
                      <div className="font-normal text-slate-400">max {c.max ?? '?'}</div>
                    </th>
                  ))}
                  <th className="min-w-[150px] px-2 py-2">Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rowsShown.map((row) => {
                  const ri = review.rows.indexOf(row);
                  const flags = used.filter(({ i }) => row.cells[i].flag).length;
                  return (
                    <tr key={row.key} className={clsx(!row.include && 'bg-slate-50 opacity-50')} onClick={() => setPageIdx(Math.max(0, row.page - 1))}>
                      <td className="px-2 py-1"><input type="checkbox" className="size-4 accent-navy-700" checked={row.include} onChange={(e) => mutate((r) => { r.rows[ri].include = e.target.checked; })} /></td>
                      <td className="px-1 py-1 text-xs text-slate-500">{row.page}</td>
                      <td className="px-2 py-1">
                        <input className={clsx('h-8 w-full rounded border px-2 text-[13px] focus:border-navy-400 focus:outline-none', row.nameFlag ? 'border-amber-300 bg-amber-50' : 'border-transparent hover:border-slate-200')}
                          title={row.nameFlag || ''} value={row.name} onChange={(e) => mutate((r) => { r.rows[ri].name = e.target.value; r.rows[ri].nameFlag = null; })} />
                        <select className="mt-0.5 h-6 w-full rounded border-0 bg-transparent px-1 text-[11px] text-slate-500 focus:outline-none"
                          value={row.target} onChange={(e) => mutate((r) => { r.rows[ri].target = e.target.value; })}>
                          <option value="new">+ Yangi o‘quvchi sifatida qo‘shish</option>
                          {data.students.filter((s) => s.name).map((s) => <option key={s.id} value={s.id}>Mavjud: {s.name}</option>)}
                        </select>
                      </td>
                      {used.map(({ i }) => {
                        const cell = row.cells[i];
                        return (
                          <td key={i} className="px-1 py-1 text-center">
                            <div className={clsx('flex items-center rounded border', cell.flag ? 'border-amber-400 bg-amber-50' : 'border-transparent')} title={cell.flag || ''}>
                              <input className="h-8 w-full min-w-0 bg-transparent px-1 text-center text-[13px] tabular-nums focus:outline-none"
                                inputMode="decimal"
                                value={cell.value ?? (cell.flag ? '' : '')}
                                placeholder={cell.flag ? '?' : ''}
                                onChange={(e) => mutate((r) => {
                                  const c = r.rows[ri].cells[i];
                                  const v = parseScore(e.target.value);
                                  c.value = v === null || Number.isNaN(v) ? null : v;
                                  c.raw = e.target.value;
                                  c.flag = v !== null && Number.isNaN(v) ? 'Faqat son kiriting' : null;
                                })} />
                              {cell.flag && (
                                <button className="mr-0.5 rounded p-0.5 text-amber-700 hover:bg-amber-200" title={`${cell.flag}. Qiymatni tasdiqlash`}
                                  onClick={(e) => { e.stopPropagation(); mutate((r) => { r.rows[ri].cells[i].flag = null; }); }}>
                                  <Check className="size-3.5" />
                                </button>
                              )}
                            </div>
                            {cell.alt !== undefined && cell.flag && <div className="text-[10px] text-amber-700">ikkinchi: {cell.alt ?? '—'}</div>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-xs">
                        {flags === 0 && !row.nameFlag && !row.rowFlags.length
                          ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-3.5" />Tekshirildi</span>
                          : <div className="space-y-0.5 text-amber-700">
                              {flags > 0 && <div>Tekshirish kerak ({flags})</div>}
                              {row.nameFlag && <div>{row.nameFlag}</div>}
                              {row.rowFlags.map((f) => <div key={f}>{f}</div>)}
                            </div>}
                      </td>
                    </tr>
                  );
                })}
                {!rowsShown.length && <tr><td colSpan={used.length + 4} className="px-4 py-8 text-center text-sm text-slate-500">{review.rows.length ? 'Muammoli qator yo‘q' : 'O‘quvchilar aniqlanmadi'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button icon={<ArrowLeft className="size-4" />} onClick={onBack}>Sahifalarga qaytish</Button>
          <Button variant="success" icon={<Check className="size-4" />} onClick={confirmApply} disabled={!included.length || !used.length}>
            Tasdiqlash va jadvalga qo‘shish
          </Button>
        </div>
      </div>
    </div>
  );
}
