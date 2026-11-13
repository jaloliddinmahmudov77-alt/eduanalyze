import { useCallback, useRef, useState } from 'react';

const LIMIT = 200;
const COALESCE_MS = 1200;

/** Undo/redo tarixi. Bir xil "key" bilan ketma-ket o'zgarishlar (masalan, matn yozish) bitta qadam bo'lib birlashtiriladi. */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], present: initial, future: [] as T[] });
  const last = useRef<{ key?: string; at: number }>({ at: 0 });

  const set = useCallback((next: T, key?: string) => {
    setState((s) => {
      if (next === s.present) return s;
      const now = Date.now();
      const coalesce = key && last.current.key === key && now - last.current.at < COALESCE_MS;
      last.current = { key, at: now };
      if (coalesce) return { ...s, present: next, future: [] };
      return { past: [...s.past.slice(-LIMIT + 1), s.present], present: next, future: [] };
    });
  }, []);

  const reset = useCallback((value: T) => {
    last.current = { at: 0 };
    setState({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    last.current = { at: 0 };
    setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    last.current = { at: 0 };
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  return { value: state.present, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
