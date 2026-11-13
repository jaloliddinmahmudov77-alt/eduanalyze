import clsx from 'clsx';
import { ArrowDown, ArrowDownAZ, ArrowUp, FileUp, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { duplicateIds } from '../lib/calc';
import { addStudents, moveStudent, removeStudents, renameStudent, replaceStudents, sortStudents } from '../lib/ops';
import type { ReportData } from '../lib/types';
import { useFeedback } from './feedback';
import { StudentImportDialog } from './StudentImportDialog';
import { Badge, Button, EmptyState } from './ui';

export function StudentsEditor({ data, onChange }: { data: ReportData; onChange: (d: ReportData) => void }) {
  const { toast, confirm } = useFeedback();
  const [importOpen, setImportOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const dups = duplicateIds(data.students);

  const add = () => {
    const names = newName.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    onChange(addStudents(data, names));
    setNewName('');
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 gap-2">
          <input
            className="input"
            placeholder="O‘quvchining familiyasi va ismi"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={add} disabled={!newName.trim()}>Qo‘shish</Button>
        </div>
        <div className="flex gap-2">
          <Button icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>Excel’dan import</Button>
          <Button icon={<ArrowDownAZ className="size-4" />} onClick={() => onChange(sortStudents(data))} disabled={data.students.length < 2} title="Alifbo bo‘yicha">A–Z</Button>
        </div>
      </div>

      {dups.size > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ro‘yxatda {dups.size} ta takrorlangan ism bor (sariq bilan belgilangan). Tekshirib chiqing.
        </div>
      )}

      {data.students.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300">
          <EmptyState icon={<Users className="size-6" />} title="O‘quvchilar ro‘yxati bo‘sh" text="Excel/CSV fayldan import qiling yoki yuqoridagi maydonga ism-familiya yozib qo‘shing." />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
            <span>Jami: {data.students.length} ta o‘quvchi</span>
            <button
              className="text-red-600 hover:underline"
              onClick={async () => {
                if (await confirm({ title: 'Ro‘yxatni tozalash', text: 'Barcha o‘quvchilar va ularning ballari o‘chiriladi. Davom etasizmi?', danger: true, confirmText: 'Tozalash' }))
                  onChange({ ...data, students: [] });
              }}
            >
              Hammasini o‘chirish
            </button>
          </div>
          <ul className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
            {data.students.map((s, i) => (
              <li key={s.id} className={clsx('group flex items-center gap-2 px-3 py-1.5', dups.has(s.id) && 'bg-amber-50')}>
                <span className="w-8 text-right text-sm tabular-nums text-slate-400">{i + 1}.</span>
                <input
                  className="h-8 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-slate-200 focus:border-navy-400 focus:bg-white focus:outline-none"
                  value={s.name}
                  placeholder="Ism familiya"
                  onChange={(e) => onChange(renameStudent(data, s.id, e.target.value))}
                />
                {dups.has(s.id) && <Badge tone="amber">Takror</Badge>}
                <div className="flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => onChange(moveStudent(data, s.id, -1))} aria-label="Yuqoriga"><ArrowUp className="size-4" /></button>
                  <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30" disabled={i === data.students.length - 1} onClick={() => onChange(moveStudent(data, s.id, 1))} aria-label="Pastga"><ArrowDown className="size-4" /></button>
                  <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => onChange(removeStudents(data, new Set([s.id])))} aria-label="O‘chirish"><Trash2 className="size-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <StudentImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existing={data.students.map((s) => s.name)}
        onImport={(names, replace) => {
          onChange(replace ? replaceStudents(data, names) : addStudents(data, names));
          toast(`${names.length} ta o‘quvchi qo‘shildi`);
        }}
      />
    </div>
  );
}
