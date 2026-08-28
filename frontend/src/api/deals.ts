import { api } from '@/lib/api';
import type { Deal, Paginated, Pipeline, Stage } from '@/types';
import type { ListParams } from './contacts';

export const dealsApi = {
  list: (params?: ListParams) => api.get<Paginated<Deal>>('/deals/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Deal>(`/deals/${id}/`).then((r) => r.data),
  create: (payload: Partial<Deal>) => api.post<Deal>('/deals/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Deal>) =>
    api.patch<Deal>(`/deals/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/deals/${id}/`),
  /** Move a deal to another stage (kanban drag & drop). */
  move: (id: number, stage: number) =>
    api.post<Deal>(`/deals/${id}/move/`, { stage }).then((r) => r.data),
  markWon: (id: number) => api.post<Deal>(`/deals/${id}/mark-won/`).then((r) => r.data),
  markLost: (id: number, lostReason?: string) =>
    api.post<Deal>(`/deals/${id}/mark-lost/`, { lost_reason: lostReason ?? '' }).then((r) => r.data),
  reopen: (id: number) => api.post<Deal>(`/deals/${id}/reopen/`).then((r) => r.data),
};

export const pipelinesApi = {
  list: () => api.get<Pipeline[]>('/pipelines/').then((r) => r.data),
  create: (payload: { name: string; is_default?: boolean }) =>
    api.post<Pipeline>('/pipelines/', payload).then((r) => r.data),
  update: (id: number, payload: { name?: string; is_default?: boolean }) =>
    api.patch<Pipeline>(`/pipelines/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/pipelines/${id}/`),
};

export const stagesApi = {
  create: (payload: { pipeline: number; name: string; order?: number; probability?: number; color?: string }) =>
    api.post<Stage>('/stages/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Pick<Stage, 'name' | 'order' | 'probability' | 'color'>>) =>
    api.patch<Stage>(`/stages/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/stages/${id}/`),
};
