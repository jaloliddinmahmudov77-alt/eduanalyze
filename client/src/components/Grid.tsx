import clsx from 'clsx';
import {
  ArrowLeftToLine, ArrowRightToLine, ClipboardCopy, ClipboardPaste, Columns3, Eraser, MoreVertical, Redo2,
  Rows3, Trash2, Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeClass, computeStudent, fmtNum, fmtPct, isScore, parseScore, validateScore } from '../lib/calc';
import { addCriterion, addStudents, moveCriterion, removeCriteria, removeStudents, updateCriterion } from '../lib/ops';
import { COMPETENCES, COMPETENCE_LABEL, type Competence, type Criterion, type ReportData } from '../lib/types';
import { competenceTone } from './CriteriaEditor';
import { useFeedback } from './feedback';

type Col =
  | { kind: 'idx' }
  | { kind: 'name' }
  | { kind: 'crit'; crit: Criterion }
  | { kind: 'calc'; calc: 'total' | 'percent' | Competence };

interface Pos { r: number; c: number }
interface EditState { r: number; c: number; value: string; mode: 'enter' | 'edit' }
interface MenuState { x: number; y: number }

const isEditable = (col: Col) => col.kind === 'name' || col.kind === 'crit';
const IDX_W = 48;
const NAME_W = 260;

export interface GridProps {
  data: ReportData;
  onChange: (d: ReportData, coalesceKey?: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  toolbarRight?: ReactNode;
}

export function Grid({ data, onChange, onUndo, onRedo, canUndo, canRedo, toolbarRight }: GridProps) {
  const { toast } = useFeedback();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 2 });
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 2 });
  const [edit, setEdit] = useState<EditState | null>(null);
  const [errorCell, setErrorCell] = useState<Pos | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [colMenu, setColMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragging = useRef(false);

  const { criteria, students } = data;
  const cols: Col[] = useMemo(
    () => [
      { kind: 'idx' }, { kind: 'name' },
      ...criteria.map((crit) => ({ kind: 'crit' as const, crit })),
      { kind: 'calc', calc: 'total' }, { kind: 'calc', calc: 'percent' },
      ...COMPETENCES.map((k) => ({ kind: 'calc' as const, calc: k })),
    ],
    [criteria],
  );
  const results = useMemo(() => students.map((s) => computeStudent(criteria, s)), [students, criteria]);
  const cls = useMemo(() => computeClass(data), [data]);
  const rowCount = students.length;
  const colCount = cols.length;

  const clampPos = useCallback(
    (p: Pos): Pos => ({ r: Math.max(0, Math.min(rowCount - 1, p.r)), c: Math.max(1, Math.min(colCount - 1, p.c)) }),
    [rowCount, colCount],
  );

  // Ma'lumotlar o'zgarganda tanlov chegaradan chiqmasin
  useEffect(() => {
    setFocus((f) => clampPos(f));
    setAnchor((a) => clampPos(a));
  }, [clampPos]);

  const range = {
    r1: Math.min(anchor.r, focus.r), r2: Math.max(anchor.r, focus.r),
    c1: Math.min(anchor.c, focus.c), c2: Math.max(anchor.c, focus.c),
  };
  const inRange = (r: number, c: number) => r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;

  const flashError = (p: Pos, msg: string) => {
    setErrorCell(p);
    toast(msg, 'error');
    setTimeout(() => setErrorCell((e) => (e && e.r === p.r && e.c === p.c ? null : e)), 1600);
  };

  const rawValue = (r: number, c: number): string => {
    const s = students[r];
    const col = cols[c];
    if (!s || !col) return '';
    if (col.kind === 'idx') return String(r + 1);
    if (col.kind === 'name') return s.name;
    if (col.kind === 'crit') { const v = s.scores[col.crit.id]; return isScore(v) ? String(v).replace('.', ',') : ''; }
    const res = results[r];
    if (!res.participated) return '';
    if (col.calc === 'total') return fmtNum(res.total);
    if (col.calc === 'percent') return fmtPct(res.percent);
    return fmtPct(res.comp[col.calc]);
  };

  /** Bitta katak qiymatini qo'llash (validatsiya bilan). Xato bo'lsa — matn qaytaradi */
  const applyCell = (d: ReportData, r: number, c: number, text: string): { d: ReportData; error?: string } => {
    const col = cols[c];
    const s = d.students[r];
    if (!s || !col || !isEditable(col)) return { d };
    if (col.kind === 'name') {
      return { d: { ...d, students: d.students.map((x, i) => (i === r ? { ...x, name: text.replace(/\s+/g, ' ').trim() } : x)) } };
    }
    if (col.kind !== 'crit') return { d };
    const v = parseScore(text);
    const err = validateScore(v, col.crit);
    if (err) return { d, error: err };
    return {
      d: {
        ...d,
        students: d.students.map((x, i) => {
          if (i !== r) return x;
          const scores = { ...x.scores };
          if (v === null) delete scores[col.crit.id];
          else scores[col.crit.id] = v;
          return { ...x, scores };
        }),
      },
    };
  };

  // Tahrirlash holatining sinxron nusxasi (blur hodisasi qayta commit qilmasligi uchun)
  const editRef = useRef<EditState | null>(null);
  editRef.current = edit;
  const focusGrid = () => wrapRef.current?.focus({ preventScroll: true });

  const scrollIntoView = (p: Pos) => {
    setTimeout(() => {
      const el = wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${p.r}-${p.c}"]`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 0);
  };

  const moveTo = (p: Pos, extend = false) => {
    const np = clampPos(p);
    setFocus(np);
    if (!extend) setAnchor(np);
    scrollIntoView(np);
  };

  const startEdit = (p: Pos, initial?: string) => {
    if (!isEditable(cols[p.c]) || !students[p.r]) return;
    const ne: EditState = { r: p.r, c: p.c, value: initial ?? rawValue(p.r, p.c), mode: initial !== undefined ? 'enter' : 'edit' };
    editRef.current = ne;
    setEdit(ne);
  };

  const commitEdit = (move?: Pos): boolean => {
    const ed = editRef.current;
    if (!ed) return true;
    const { d, error } = applyCell(data, ed.r, ed.c, ed.value);
    if (error) {
      flashError({ r: ed.r, c: ed.c }, error);
      return false;
    }
    editRef.current = null;
    if (d !== data && ed.value !== rawValue(ed.r, ed.c)) onChange(d);
    setEdit(null);
    if (move) moveTo(move);
    focusGrid();
    return true;
  };

  const cancelEdit = () => { editRef.current = null; setEdit(null); focusGrid(); };

  // ---------- Clipboard ----------
  const selectionTSV = () => {
    const lines: string[] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const cells: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) cells.push(rawValue(r, c));
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  };

  const clearRange = () => {
    let d = data;
    for (let r = range.r1; r <= range.r2; r++)
      for (let c = range.c1; c <= range.c2; c++) {
        const col = cols[c];
        if (col.kind === 'crit') d = applyCell(d, r, c, '').d;
      }
    if (d !== data) onChange(d);
  };

  const pasteText = (text: string) => {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    if (!lines.length) return;
    let d = data;
    const errors: string[] = [];
    const single = lines.length === 1 && lines[0].length === 1;
    const rows = single ? range.r2 - range.r1 + 1 : lines.length;
    const width = single ? range.c2 - range.c1 + 1 : Math.max(...lines.map((l) => l.length));
    // Ism ustuniga ko'proq qator joylansa, yangi o'quvchilar qo'shiladi
    const need = range.r1 + rows - d.students.length;
    if (need > 0) {
      if (cols[range.c1]?.kind === 'name') d = addStudents(d, Array(need).fill(''));
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < width; j++) {
        const r = range.r1 + i;
        const c = range.c1 + j;
        if (r >= d.students.length || c >= colCount) continue;
        const val = single ? lines[0][0] : (lines[i]?.[j] ?? '');
        const res = applyCell(d, r, c, val.trim());
        if (res.error) errors.push(`${r + 1}-qator: ${res.error}`);
        else d = res.d;
      }
    }
    if (d !== data) onChange(d);
    setAnchor({ r: range.r1, c: range.c1 });
    setFocus({ r: Math.max(0, Math.min(d.students.length - 1, range.r1 + rows - 1)), c: Math.min(colCount - 1, range.c1 + width - 1) });
    if (errors.length) toast(`${errors.length} ta katak joylanmadi. ${errors[0]}`, 'warning');
  };

  useEffect(() => {
    const active = () => document.activeElement === wrapRef.current && !edit;
    const onCopy = (e: ClipboardEvent) => {
      if (!active()) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', selectionTSV());
    };
    const onCut = (e: ClipboardEvent) => {
      if (!active()) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', selectionTSV());
      clearRange();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!active()) return;
      e.preventDefault();
      pasteText(e.clipboardData?.getData('text/plain') || '');
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  });

  useEffect(() => {
    const up = () => (dragging.current = false);
    const close = () => { setMenu(null); setColMenu(null); };
    window.addEventListener('mouseup', up);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('scroll', close, true); };
  }, []);

  // ---------- Keyboard ----------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit || e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) onRedo(); else onUndo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); onRedo(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); setAnchor({ r: 0, c: 1 }); setFocus({ r: rowCount - 1, c: colCount - 1 }); return; }
    if (mod) return; // Ctrl+C / Ctrl+V / Ctrl+X — clipboard hodisalari orqali
    if (!rowCount) return;
    const ext = e.shiftKey;
    const step: Record<string, Pos> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } };
    if (step[k]) { e.preventDefault(); moveTo({ r: focus.r + step[k].r, c: focus.c + step[k].c }, ext); return; }
    switch (k) {
      case 'Tab': e.preventDefault(); moveTo({ r: focus.r, c: focus.c + (e.shiftKey ? -1 : 1) }); return;
      case 'Enter': e.preventDefault(); if (e.shiftKey) moveTo({ r: focus.r - 1, c: focus.c }); else startEdit(focus); return;
      case 'F2': e.preventDefault(); startEdit(focus); return;
      case 'Home': e.preventDefault(); moveTo({ r: focus.r, c: 1 }, ext); return;
      case 'End': e.preventDefault(); moveTo({ r: focus.r, c: colCount - 1 }, ext); return;
      case 'PageDown': e.preventDefault(); moveTo({ r: focus.r + 10, c: focus.c }, ext); return;
      case 'PageUp': e.preventDefault(); moveTo({ r: focus.r - 10, c: focus.c }, ext); return;
      case 'Delete': case 'Backspace': e.preventDefault(); clearRange(); return;
      case 'Escape': setAnchor(focus); return;
    }
    if (k.length === 1 && !e.altKey) {
      e.preventDefault();
      setAnchor(focus);
      startEdit(focus, k);
    }
  };

  const onEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!edit) return;
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); commitEdit({ r: edit.r + (e.shiftKey ? -1 : 1), c: edit.c }); }
    else if (k === 'Tab') { e.preventDefault(); commitEdit({ r: edit.r, c: edit.c + (e.shiftKey ? -1 : 1) }); }
    else if (k === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (edit.mode === 'enter' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      e.preventDefault();
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k]!;
      commitEdit({ r: edit.r + d[0], c: edit.c + d[1] });
    }
  };

  // ---------- Row / column operations ----------
  const selectedStudentIds = () => new Set(students.slice(range.r1, range.r2 + 1).map((s) => s.id));
  const selectedCritIds = () => {
    const ids = new Set<string>();
    for (let c = range.c1; c <= range.c2; c++) { const col = cols[c]; if (col.kind === 'crit') ids.add(col.crit.id); }
    return ids;
  };
  const insertRow = (below: boolean, atEnd = false) => {
    const at = atEnd ? students.length : below ? range.r2 + 1 : range.r1;
    onChange(addStudents(data, [''], at));
    // yangi qator hali render qilinmagan — chegaralashsiz to'g'ridan-to'g'ri o'rnatamiz
    const p = { r: at, c: 1 };
    setFocus(p); setAnchor(p); scrollIntoView(p);
    focusGrid();
  };
  const deleteRows = () => {
    const ids = selectedStudentIds();
    if (!ids.size) return;
    onChange(removeStudents(data, ids));
    toast(`${ids.size} ta qator o‘chirildi (Ctrl+Z — qaytarish)`, 'info');
  };
  const critIndexAt = (c: number) => {
    const col = cols[c];
    if (col?.kind === 'crit') return criteria.findIndex((x) => x.id === col.crit.id);
    return c <= 1 ? -1 : criteria.length - 1;
  };
  const insertCol = (right: boolean, critId?: string) => {
    const idx = critId ? criteria.findIndex((x) => x.id === critId) : critIndexAt(right ? range.c2 : range.c1);
    const at = right ? idx + 1 : Math.max(0, idx);
    onChange(addCriterion(data, undefined, at));
    const p = { r: Math.max(0, focus.r), c: 2 + at };
    setFocus(p); setAnchor(p); scrollIntoView(p);
  };
  const deleteCols = (ids = selectedCritIds()) => {
    if (!ids.size) { toast('O‘chirish uchun baholash ustunini tanlang', 'warning'); return; }
    onChange(removeCriteria(data, ids));
    toast(`${ids.size} ta ustun o‘chirildi (Ctrl+Z — qaytarish)`, 'info');
  };
  const tryCrit = (fn: () => ReportData, key?: string) => {
    try { onChange(fn(), key); return true; } catch (e) { toast((e as Error).message, 'error'); return false; }
  };

  const copyToClipboard = async () => {
    try { await navigator.clipboard.writeText(selectionTSV()); toast('Nusxalandi'); } catch { toast('Ctrl+C dan foydalaning', 'warning'); }
  };
  const pasteFromClipboard = async () => {
    try { pasteText(await navigator.clipboard.readText()); } catch { toast('Brauzer ruxsat bermadi — Ctrl+V dan foydalaning', 'warning'); }
  };

  // ---------- Rendering helpers ----------
  const stickyLeft = (c: number) =>
    c === 0 ? { position: 'sticky' as const, left: 0, zIndex: 2 } : c === 1 ? { position: 'sticky' as const, left: IDX_W, zIndex: 2 } : undefined;

  const calcHeader = (k: 'total' | 'percent' | Competence) =>
    k === 'total' ? 'Umumiy ball' : k === 'percent' ? 'Foiz %' : COMPETENCE_LABEL[k];

  const menuItem = (icon: ReactNode, label: string, fn: () => void, danger?: boolean, disabled?: boolean) => (
    <button
      disabled={disabled}
      onClick={() => { setMenu(null); setColMenu(null); fn(); }}
      className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent', danger ? 'text-red-600' : 'text-slate-700')}
    >
      {icon}{label}
    </button>
  );

  const tb = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent';
  const hasCritSel = selectedCritIds().size > 0;

  return (
    <div className="flex min-h-0 flex-col">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5">
        <button className={tb} onClick={onUndo} disabled={!canUndo} title="Bekor qilish (Ctrl+Z)"><Undo2 className="size-4" /><span className="hidden md:inline">Bekor</span></button>
        <button className={tb} onClick={onRedo} disabled={!canRedo} title="Qaytarish (Ctrl+Y)"><Redo2 className="size-4" /></button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button className={tb} onClick={() => insertRow(true, true)} title="Qator qo‘shish"><Rows3 className="size-4" /><span className="hidden sm:inline">+ Qator</span></button>
        <button className={tb} onClick={deleteRows} disabled={!rowCount} title="Tanlangan qatorlarni o‘chirish"><Trash2 className="size-4" /><span className="hidden sm:inline">Qator</span></button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button className={tb} onClick={() => insertCol(true)} title="Baholash ustuni qo‘shish"><Columns3 className="size-4" /><span className="hidden sm:inline">+ Ustun</span></button>
        <button className={tb} onClick={() => deleteCols()} disabled={!hasCritSel} title="Tanlangan ustunni o‘chirish"><Trash2 className="size-4" /><span className="hidden sm:inline">Ustun</span></button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button className={tb} onClick={copyToClipboard} disabled={!rowCount} title="Nusxalash (Ctrl+C)"><ClipboardCopy className="size-4" /></button>
        <button className={tb} onClick={pasteFromClipboard} disabled={!rowCount} title="Joylashtirish (Ctrl+V)"><ClipboardPaste className="size-4" /></button>
        <button className={tb} onClick={clearRange} disabled={!rowCount} title="Tozalash (Delete)"><Eraser className="size-4" /></button>
        <div className="ml-auto flex flex-wrap items-center gap-2">{toolbarRight}</div>
      </div>

      {/* Formula bar */}
      <div className="no-print flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1 text-[13px]">
        <span className="w-24 shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-center font-mono text-xs text-slate-600">
          {rowCount ? `${range.r1 + 1}:${cols[focus.c]?.kind === 'crit' ? (cols[focus.c] as { crit: Criterion }).crit.name.slice(0, 8) : cols[focus.c]?.kind === 'name' ? 'Ism' : 'Hisob'}` : '—'}
        </span>
        <span className="truncate text-slate-600">
          {rowCount ? (students[focus.r]?.name || 'Nomsiz') + ' — ' + (rawValue(focus.r, focus.c) || '∅') : 'O‘quvchi qo‘shing'}
          {cols[focus.c]?.kind === 'crit' && <span className="ml-2 text-slate-400">(max {(cols[focus.c] as { crit: Criterion }).crit.max})</span>}
          {cols[focus.c]?.kind === 'calc' && <span className="ml-2 text-slate-400">(avtomatik hisoblanadi)</span>}
        </span>
        <span className="ml-auto hidden text-xs text-slate-400 lg:inline">Enter/F2 — tahrirlash · Strelkalar — harakat · Shift — tanlash · Ctrl+C/V · Del · Ctrl+Z</span>
      </div>

      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative min-h-[320px] flex-1 overflow-auto bg-white outline-none focus-visible:ring-0"
        style={{ maxHeight: 'calc(100vh - 230px)' }}
        onContextMenu={(e) => { e.preventDefault(); setColMenu(null); setMenu({ x: e.clientX, y: e.clientY }); }}
        onMouseDown={() => { setMenu(null); setColMenu(null); }}
      >
        <table className="grid-table select-none text-[13px]" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
            <tr>
              <th rowSpan={3} style={{ ...stickyLeft(0), width: IDX_W, minWidth: IDX_W, zIndex: 3 }} className="bg-slate-100 px-1 text-xs font-semibold">T/r</th>
              <th rowSpan={3} style={{ ...stickyLeft(1), width: NAME_W, minWidth: NAME_W, zIndex: 3 }} className="bg-slate-100 px-3 text-left text-xs font-semibold">O‘quvchining ism familiyasi</th>
              {criteria.map((c) => (
                <th key={c.id} className="min-w-[104px] bg-amber-100 p-0 align-middle">
                  <div className="flex items-center">
                    <input
                      className="h-8 w-full min-w-0 bg-transparent px-2 text-center text-xs font-semibold text-slate-800 focus:bg-white focus:outline-none"
                      value={c.name}
                      onChange={(e) => tryCrit(() => updateCriterion(data, c.id, { name: e.target.value }), `name-${c.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), focusGrid())}
                      aria-label="Mezon nomi"
                    />
                    <button
                      className="mr-0.5 rounded p-0.5 text-slate-500 hover:bg-amber-200 hover:text-slate-800"
                      onClick={(e) => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu(null); setColMenu({ id: c.id, x: b.left, y: b.bottom + 4 }); }}
                      aria-label="Ustun amallari"
                    >
                      <MoreVertical className="size-3.5" />
                    </button>
                  </div>
                </th>
              ))}
              {(['total', 'percent', ...COMPETENCES] as const).map((k) => (
                <th key={k} rowSpan={2} className="min-w-[92px] bg-slate-200/70 px-2 text-xs font-semibold">{calcHeader(k)}</th>
              ))}
            </tr>
            <tr>
              {criteria.map((c) => (
                <th key={c.id} className="bg-amber-100 p-0.5">
                  <select
                    className={clsx('h-7 w-full rounded px-1 text-center text-[11px] font-medium ring-1 ring-inset focus:outline-none', competenceTone[c.type])}
                    value={c.type}
                    onChange={(e) => tryCrit(() => updateCriterion(data, c.id, { type: e.target.value as Competence }))}
                    aria-label="Kompetensiya"
                  >
                    {COMPETENCES.map((k) => <option key={k} value={k}>{COMPETENCE_LABEL[k]}</option>)}
                  </select>
                </th>
              ))}
            </tr>
            <tr>
              {criteria.map((c) => (
                <th key={c.id} className="bg-amber-100 p-0">
                  <HeaderMax c={c} onCommit={(n) => n === c.max || tryCrit(() => updateCriterion(data, c.id, { max: n }))} onDone={focusGrid} />
                </th>
              ))}
              <th className="bg-slate-200/70 px-2 text-xs font-semibold tabular-nums">{fmtNum(cls.maxTotal)}</th>
              <th className="bg-slate-200/70 px-2 text-xs font-semibold">100%</th>
              {COMPETENCES.map((k) => <th key={k} className="bg-slate-200/70 px-2 text-xs font-semibold tabular-nums">{fmtNum(cls.compMax[k])}</th>)}
            </tr>
          </thead>
          <tbody>
            {students.map((s, r) => (
              <tr key={s.id}>
                {cols.map((col, c) => {
                  const isFocus = focus.r === r && focus.c === c;
                  const isEditing = edit && edit.r === r && edit.c === c;
                  const err = errorCell && errorCell.r === r && errorCell.c === c;
                  const value = rawValue(r, c);
                  return (
                    <td
                      key={c}
                      data-cell={`${r}-${c}`}
                      style={stickyLeft(c)}
                      className={clsx(
                        'h-8 whitespace-nowrap px-2',
                        col.kind === 'idx' && 'bg-slate-50 text-center text-xs text-slate-500',
                        col.kind === 'name' && 'max-w-[260px] truncate bg-white text-left',
                        col.kind === 'crit' && 'bg-amber-50/60 text-center tabular-nums',
                        col.kind === 'calc' && 'bg-slate-50 text-center font-medium tabular-nums text-slate-700',
                        col.kind === 'name' && !s.name && 'text-slate-400 italic',
                        inRange(r, c) && c > 0 && 'grid-cell-selected',
                        isFocus && !isEditing && 'grid-cell-focus',
                        err && 'grid-cell-error',
                        isEditing && 'p-0',
                      )}
                      onMouseDown={(e) => {
                        if (e.button !== 0 && inRange(r, c)) return;
                        if (c === 0) { // qator raqami — butun qatorni tanlash
                          setAnchor({ r: e.shiftKey ? anchor.r : r, c: 1 }); setFocus({ r, c: colCount - 1 }); dragging.current = false; return;
                        }
                        if (edit && !(edit.r === r && edit.c === c)) { if (!commitEdit()) return; }
                        if (isFocus && !e.shiftKey && !edit && e.button === 0 && isEditable(col) && e.detail === 1 && range.r1 === range.r2 && range.c1 === range.c2) {
                          // allaqachon tanlangan katakni bosish — tahrirlash (mobil uchun qulay)
                          e.preventDefault();
                          startEdit({ r, c });
                          return;
                        }
                        if (e.shiftKey) setFocus({ r, c });
                        else { setAnchor({ r, c }); setFocus({ r, c }); }
                        dragging.current = true;
                        if (!isEditing) wrapRef.current?.focus({ preventScroll: true });
                      }}
                      onMouseEnter={() => { if (dragging.current && c > 0) setFocus({ r, c }); }}
                      onDoubleClick={() => startEdit({ r, c })}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          className={clsx('h-8 w-full border-0 px-2 outline-none ring-2 ring-inset ring-navy-600', col.kind === 'crit' ? 'text-center' : 'text-left')}
                          style={{ minWidth: col.kind === 'name' ? NAME_W - 2 : 90 }}
                          inputMode={col.kind === 'crit' ? 'decimal' : 'text'}
                          value={edit!.value}
                          onChange={(e) => { const ne = { ...edit!, value: e.target.value }; editRef.current = ne; setEdit(ne); }}
                          onKeyDown={onEditKeyDown}
                          onBlur={() => { if (editRef.current && !commitEdit()) cancelEdit(); }}
                          onFocus={(e) => { if (edit!.mode === 'enter') { const l = e.target.value.length; e.target.setSelectionRange(l, l); } else e.target.select(); }}
                        />
                      ) : (
                        value || (col.kind === 'name' ? 'Ism kiriting' : '')
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rowCount === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-slate-500">
                  Jadvalda o‘quvchi yo‘q. <button className="font-medium text-navy-700 hover:underline" onClick={() => insertRow(true, true)}>Qator qo‘shish</button> yoki “O‘quvchilar” bo‘limidan import qiling.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 text-slate-800">
            {([
              ['Jami', (id: string) => fmtNum(cls.criterionSum[id]), fmtNum(cls.totalSum), '', (k: Competence) => fmtNum(cls.compSum[k]), true],
              ['Maksimal ball', (id: string) => fmtNum(cls.criterionMax[id]), fmtNum(cls.totalMax), '', (k: Competence) => fmtNum(cls.compClassMax[k]), false],
              ['Foiz', (id: string) => fmtPct(cls.criterionPercent[id]), fmtPct(cls.percent), fmtPct(cls.percent), (k: Competence) => fmtPct(cls.compPercent[k]), true],
            ] as const).map(([label, crit, total, percent, comp, bold]) => (
              <tr key={label} className={clsx(bold ? 'font-semibold' : 'text-slate-600')}>
                <td colSpan={2} style={{ position: 'sticky', left: 0, zIndex: 2 }} className="h-8 bg-slate-100 px-3 text-left">{label}</td>
                {criteria.map((c) => <td key={c.id} className="bg-slate-100 px-2 text-center tabular-nums">{crit(c.id)}</td>)}
                <td className="bg-slate-200/70 px-2 text-center tabular-nums">{total}</td>
                <td className="bg-slate-200/70 px-2 text-center tabular-nums">{percent}</td>
                {COMPETENCES.map((k) => <td key={k} className="bg-slate-200/70 px-2 text-center tabular-nums">{comp(k)}</td>)}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
        <span>{rowCount} ta o‘quvchi · {cls.participants} ta qatnashgan</span>
        <span>{criteria.length} ta mezon · max {fmtNum(cls.maxTotal)} ball</span>
        <span className="font-medium text-slate-700">Sinf foizi: {fmtPct(cls.percent)}</span>
        <span className="ml-auto text-slate-400">Bo‘sh katak — baholanmagan (foizga kirmaydi) · 0 — nol ball</span>
        {range.r2 > range.r1 || range.c2 > range.c1 ? <span>Tanlangan: {(range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)} katak</span> : null}
      </div>

      {/* Context menu */}
      {menu && (
        <div className="fixed z-50 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl" style={{ left: Math.min(menu.x, window.innerWidth - 250), top: Math.min(menu.y, window.innerHeight - 380) }} onMouseDown={(e) => e.stopPropagation()}>
          {menuItem(<ClipboardCopy className="size-4" />, 'Nusxalash', copyToClipboard)}
          {menuItem(<ClipboardPaste className="size-4" />, 'Joylashtirish', pasteFromClipboard)}
          {menuItem(<Eraser className="size-4" />, 'Ballarni tozalash', clearRange)}
          <div className="my-1 h-px bg-slate-100" />
          {menuItem(<Rows3 className="size-4" />, 'Yuqoriga qator qo‘shish', () => insertRow(false))}
          {menuItem(<Rows3 className="size-4" />, 'Pastga qator qo‘shish', () => insertRow(true))}
          {menuItem(<Trash2 className="size-4" />, `Qatorni o‘chirish (${range.r2 - range.r1 + 1})`, deleteRows, true, !rowCount)}
          <div className="my-1 h-px bg-slate-100" />
          {menuItem(<ArrowLeftToLine className="size-4" />, 'Chapga ustun qo‘shish', () => insertCol(false))}
          {menuItem(<ArrowRightToLine className="size-4" />, 'O‘ngga ustun qo‘shish', () => insertCol(true))}
          {menuItem(<Trash2 className="size-4" />, 'Ustunni o‘chirish', () => deleteCols(), true, !hasCritSel)}
        </div>
      )}
      {colMenu && (
        <div className="fixed z-50 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl" style={{ left: Math.min(colMenu.x, window.innerWidth - 240), top: colMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menuItem(<ArrowLeftToLine className="size-4" />, 'Chapga ustun qo‘shish', () => insertCol(false, colMenu.id))}
          {menuItem(<ArrowRightToLine className="size-4" />, 'O‘ngga ustun qo‘shish', () => insertCol(true, colMenu.id))}
          {menuItem(<ArrowLeftToLine className="size-4" />, 'Chapga surish', () => onChange(moveCriterion(data, colMenu.id, -1)), false, criteria[0]?.id === colMenu.id)}
          {menuItem(<ArrowRightToLine className="size-4" />, 'O‘ngga surish', () => onChange(moveCriterion(data, colMenu.id, 1)), false, criteria[criteria.length - 1]?.id === colMenu.id)}
          <div className="my-1 h-px bg-slate-100" />
          {menuItem(<Trash2 className="size-4" />, 'Ustunni o‘chirish', () => deleteCols(new Set([colMenu.id])), true)}
        </div>
      )}
    </div>
  );
}

function HeaderMax({ c, onCommit, onDone }: { c: Criterion; onCommit: (n: number) => boolean; onDone: () => void }) {
  const [v, setV] = useState(String(c.max));
  useEffect(() => setV(String(c.max)), [c.max]);
  return (
    <input
      className="h-8 w-full bg-transparent text-center text-xs font-bold tabular-nums text-slate-900 focus:bg-white focus:outline-none"
      inputMode="decimal"
      value={v}
      title="Maksimal ball"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (!onCommit(Number(v.replace(',', '.')))) setV(String(c.max)); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); onDone(); } if (e.key === 'Escape') { setV(String(c.max)); onDone(); } }}
      aria-label="Maksimal ball"
    />
  );
}
