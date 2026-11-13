import type { CatalogItem, Report, ReportData, ReportMeta, ReportSummary, User } from './types';

const TOKEN_KEY = 'eduanalyze.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Server bilan aloqa yo‘q. Internet yoki serverni tekshiring');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/register')) onUnauthorized?.();
    throw new ApiError(res.status, json.error || `Xatolik (${res.status})`);
  }
  return json as T;
}

export type ReportPayload = ReportMeta & { data: ReportData };

export interface Stats {
  classes: number;
  students: number;
  bsb: number;
  chsb: number;
  teachers?: number;
  recent: ReportSummary[];
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/login', { username, password }),
  register: (u: { username: string; password: string; fullName: string; school: string }) =>
    request<{ token: string; user: User }>('POST', '/api/auth/register', u),
  authConfig: () => request<{ allowRegister: boolean }>('GET', '/api/auth/config'),
  aiStatus: () => request<{ gemini: boolean; model: string | null }>('GET', '/api/ai/status'),
  aiExtract: (image: string, mimeType: string) => request<{ result: unknown }>('POST', '/api/ai/extract', { image, mimeType }),
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  logout: () => request('POST', '/api/auth/logout'),
  updateProfile: (fullName: string, school: string) => request<{ user: User }>('PUT', '/api/auth/profile', { fullName, school }),
  changePassword: (current: string, next: string) => request('POST', '/api/auth/password', { current, next }),

  stats: () => request<Stats>('GET', '/api/stats'),
  listReports: (params: { type?: string; q?: string; owner?: string }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    return request<{ reports: ReportSummary[] }>('GET', `/api/reports?${qs}`);
  },
  getReport: (id: number) => request<{ report: Report }>('GET', `/api/reports/${id}`),
  createReport: (p: ReportPayload) => request<{ report: Report }>('POST', '/api/reports', p),
  updateReport: (id: number, p: ReportPayload) => request<{ report: Report }>('PUT', `/api/reports/${id}`, p),
  duplicateReport: (id: number) => request<{ report: Report }>('POST', `/api/reports/${id}/duplicate`),
  deleteReport: (id: number) => request('DELETE', `/api/reports/${id}`),

  catalog: () => request<{ classes: CatalogItem[]; subjects: CatalogItem[] }>('GET', '/api/catalog'),
  addCatalog: (kind: 'class' | 'subject', name: string) => request<{ item: CatalogItem }>('POST', '/api/catalog', { kind, name }),
  deleteCatalog: (id: number) => request('DELETE', `/api/catalog/${id}`),

  users: () => request<{ users: User[] }>('GET', '/api/users'),
  createUser: (u: { username: string; fullName: string; password: string; role: string; school: string }) =>
    request<{ user: User }>('POST', '/api/users', u),
  updateUser: (id: number, u: { fullName?: string; role?: string; school?: string; password?: string }) =>
    request<{ user: User }>('PUT', `/api/users/${id}`, u),
  deleteUser: (id: number) => request('DELETE', `/api/users/${id}`),
};
