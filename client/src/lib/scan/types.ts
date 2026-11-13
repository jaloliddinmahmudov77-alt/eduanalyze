export type ColKind = 'score' | 'total' | 'percent' | 'bilish' | 'qollash' | 'mulohaza' | 'other';

/** Bitta o'qilgan katak. value=null + raw="" — katak bo'sh; value=null + raw!="" — o'qib bo'lmadi */
export interface ScanCell {
  value: number | null;
  raw: string;
  confidence: number; // 0..1
}

export interface ScanRow {
  index: number | null;
  name: string;
  nameConfidence: number; // 0..1
  cells: ScanCell[];
}

export interface ScanColumn {
  label: string;
  max: number | null;
  kind: ColKind;
}

export interface ScanTable {
  engine: 'ocr' | 'ai';
  columns: ScanColumn[];
  rows: ScanRow[];
  notes?: string;
}

export interface ScanPage {
  id: string;
  name: string;
  source: 'upload' | 'camera' | 'pdf';
  canvas: HTMLCanvasElement; // tahrirlangan (joriy) rasm
  original: HTMLCanvasElement; // asl rasm (qaytarish uchun)
  thumb: string;
}

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
