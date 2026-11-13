import clsx from 'clsx';
import { AlertTriangle, FileUp, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { normalizeName } from '../lib/calc';
import { extractNames, namesFromText, readSheetRows, type ImportedName } from '../lib/importStudents';
import { Badge, Button, Modal } from './ui';

interface Row extends ImportedName { key: number; include: boolean }

export function StudentImportDialog({
  open, onClose, existing, onImport,
}: { open: boolean; onClose: () => void; existing: string[]; onImport: (names: string[], replace: boolean) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [detected, setDetected] = useState('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setDetected(''); setError(''); setFileName(''); setText(''); };
  const close = () => { reset(); onClose(); };
  const toRows = (names: ImportedName[]) => names.map((n, i) => ({ ...n, key: i, include: true }));

  const handleFile = async (f: File) => {
    setError('');
    setFileName(f.name);
    try {
      const data = await readSheetRows(f);
      const res = extractNames(data);
      if (!res.names.length) throw new Error('Faylda o‘quvchilarning ism-familiyasi topilmadi');
      setDetected(res.detected);
      setRows(toRows(res.names));
    } catch (e) {
      setRows([]);
      setError((e as Error).message);
    }
  };

  // Takrorlar: fayl ichida va mavjud ro'yxat bilan
  const dup = useMemo(() => {
    const existingSet = new Set(existing.map(normalizeName));
    const counts = new Map<string, number>();
    rows.forEach((r) => counts.set(normalizeName(r.name), (counts.get(normalizeName(r.name)) || 0) + 1));
    const m = new Map<number, string>();
    rows.forEach((r) => {
      const k = normalizeName(r.name);
      if ((counts.get(k) || 0) > 1) m.set(r.key, 'Faylda takrorlangan');
      else if (!replace && existingSet.has(k)) m.set(r.key, 'Ro‘yxatda mavjud');
    });
    return m;
  }, [rows, existing, replace]);

  const removeDuplicates = () => {
    const seen = new Set(replace ? [] : existing.map(normalizeName));
    setRows((rs) => rs.map((r) => {
      const k = normalizeName(r.name);
      if (seen.has(k)) return { ...r, include: false };
      seen.add(k);
      return r;
    }));
  };

  const selected = rows.filter((r) => r.include && r.name.trim());

  return (
    <Modal
      open={open}
      onClose={close}
      width="max-w-2xl"
      title="O‘quvchilarni import qilish"
      description="XLSX, XLS yoki CSV fayldan F.I.Sh. ustuni avtomatik aniqlanadi. Importdan oldin ro‘yxatni tekshiring."
      footer={
        <>
          <Button onClick={close}>Bekor qilish</Button>
          <Button
            variant="primary"
            disabled={!selected.length}
            onClick={() => { onImport(selected.map((r) => r.name.trim()), replace); close(); }}
          >
            {selected.length} ta o‘quvchini qo‘shish
          </Button>
        </>
      }
    >
      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1 text-[13px] font-medium">
        {(['file', 'text'] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); reset(); }} className={clsx('rounded-md px-3 py-1.5', mode === m ? 'bg-white shadow-sm text-navy-800' : 'text-slate-600')}>
            {m === 'file' ? 'Excel / CSV fayl' : 'Matndan joylashtirish'}
          </button>
        ))}
      </div>

      {mode === 'file' && !rows.length && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => input.current?.click()}
          className={clsx('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragOver ? 'border-navy-500 bg-navy-50' : 'border-slate-300 hover:border-navy-400 hover:bg-slate-50')}
        >
          <FileUp className="size-8 text-slate-400" />
          <p className="mt-3 text-sm font-medium text-slate-800">Faylni shu yerga tashlang yoki tanlash uchun bosing</p>
          <p className="mt-1 text-xs text-slate-500">.xlsx, .xls, .csv — “F.I.Sh.”, “Ism familiya”, yoki “Familiya” + “Ism” ustunlari</p>
          <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </div>
      )}

      {mode === 'text' && !rows.length && (
        <div>
          <textarea
            className="input h-48 py-2 font-mono text-[13px]"
            placeholder={'Har bir qatorga bitta o‘quvchi:\nAbdullayev Sardor\nKarimova Malika\n...'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex justify-end">
            <Button icon={<Upload className="size-4" />} disabled={!text.trim()} onClick={() => { setDetected('matndan'); setRows(toRows(namesFromText(text))); }}>
              Ro‘yxatni ko‘rish
            </Button>
          </div>
        </div>
      )}

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {rows.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {fileName && <Badge>{fileName}</Badge>}
            <span className="text-slate-500">Aniqlandi: {detected}</span>
            <span className="text-slate-500">· {rows.length} ta qator</span>
            <button className="ml-auto text-[13px] font-medium text-navy-700 hover:underline" onClick={reset}>Boshqa fayl</button>
          </div>
          {dup.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="size-4" /> {dup.size} ta takroriy ism aniqlandi
              <Button size="sm" className="ml-auto" onClick={removeDuplicates}>Takrorlarni chiqarish</Button>
            </div>
          )}
          {existing.length > 0 && (
            <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="size-4 accent-navy-700" />
              Mavjud ro‘yxatni ({existing.length} ta) almashtirish
            </label>
          )}
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2"><input type="checkbox" className="size-4 accent-navy-700" checked={rows.every((r) => r.include)} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, include: e.target.checked })))} /></th>
                  <th className="w-12 px-2 py-2">№</th>
                  <th className="px-2 py-2">F.I.Sh. (tahrirlash mumkin)</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={r.key} className={clsx(!r.include && 'opacity-50')}>
                    <td className="px-3 py-1.5"><input type="checkbox" className="size-4 accent-navy-700" checked={r.include} onChange={(e) => setRows((rs) => rs.map((x) => x.key === r.key ? { ...x, include: e.target.checked } : x))} /></td>
                    <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                    <td className="px-2 py-1">
                      <input className="w-full rounded border border-transparent px-2 py-1 hover:border-slate-200 focus:border-navy-400 focus:outline-none" value={r.name}
                        onChange={(e) => setRows((rs) => rs.map((x) => x.key === r.key ? { ...x, name: e.target.value } : x))} />
                    </td>
                    <td className="px-2 py-1.5 text-right">{dup.has(r.key) && <Badge tone="amber">{dup.get(r.key)}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
