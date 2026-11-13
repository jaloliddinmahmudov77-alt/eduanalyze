export type Role = 'teacher' | 'admin';
export type Competence = 'bilish' | 'qollash' | 'mulohaza';
export type ControlType = 'BSB-I' | 'BSB-II' | 'CHSB-I' | 'CHSB-II';

export const CONTROL_TYPES: ControlType[] = ['BSB-I', 'BSB-II', 'CHSB-I', 'CHSB-II'];
export const COMPETENCES: Competence[] = ['bilish', 'qollash', 'mulohaza'];
export const COMPETENCE_LABEL: Record<Competence, string> = {
  bilish: 'Bilish',
  qollash: 'Qo‘llash',
  mulohaza: 'Mulohaza',
};

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  school: string;
  createdAt: string;
  reportCount?: number;
}

export interface Criterion {
  id: string;
  name: string;
  max: number;
  type: Competence;
}

export interface Student {
  id: string;
  name: string;
  scores: Record<string, number | null | undefined>;
}

export interface ReportData {
  criteria: Criterion[];
  students: Student[];
}

export interface ReportMeta {
  school: string;
  className: string;
  groupName: string;
  academicYear: string;
  subject: string;
  controlType: ControlType;
  teacherName: string;
}

export interface ReportSummary extends ReportMeta {
  id: number;
  ownerId: number;
  ownerName: string;
  studentCount: number;
  classPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface Report extends ReportSummary {
  data: ReportData;
}

export interface CatalogItem {
  id: number;
  kind: 'class' | 'subject';
  name: string;
}
