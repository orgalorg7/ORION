import { api } from '@/lib/api';
import type {
  Deal, DealLineItem, DealParticipant, DomainEvent, LostReason, Paginated, Pipeline, Product, Stage,
} from '@/types';
import type { ListParams } from './contacts';

export interface BoardColumn {
  stage: Stage;
  deals: Deal[];
  totals: Array<{ stage_id: number; currency: string; count: number; value: string; weighted_value: string }>;
  has_more: boolean;
}

export interface PipelineAnalytics {
  open_pipeline: Array<{ currency: string; count: number; value: string; weighted_value: string }>;
  won: Array<{ currency: string; count: number; value: string; weighted_value: string }>;
  lost: Array<{ currency: string; count: number; value: string; weighted_value: string }>;
  abandoned: Array<{ currency: string; count: number; value: string; weighted_value: string }>;
  by_stage: Array<{ stage_id: number; stage__name: string; currency: string; count: number; value: string; weighted_value: string }>;
  win_rate: string | null;
  average_sales_cycle_days: number | null;
  closing_soon: number;
  overdue: number;
}

export const dealsApi = {
  list: (params?: ListParams) => api.get<Paginated<Deal>>('/deals/', { params }).then((r) => r.data),
  board: (pipeline: number, params?: ListParams) =>
    api.get<{ pipeline: Pipeline; columns: BoardColumn[]; limit: number }>('/deals/board/', {
      params: { ...params, pipeline },
    }).then((r) => r.data),
  get: (id: number) => api.get<Deal>(`/deals/${id}/`).then((r) => r.data),
  create: (payload: Partial<Deal>) => api.post<Deal>('/deals/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Deal>) => api.patch<Deal>(`/deals/${id}/`, payload).then((r) => r.data),
  archive: (id: number) => api.post<Deal>(`/deals/${id}/archive/`).then((r) => r.data),
  restore: (id: number) => api.post<Deal>(`/deals/${id}/restore/`).then((r) => r.data),
  remove: (id: number) => api.delete(`/deals/${id}/`),
  moveStage: (id: number, stage: number, expected_version?: number) =>
    api.post<Deal>(`/deals/${id}/move-stage/`, { stage, expected_version }).then((r) => r.data),
  movePipeline: (id: number, stage: number, expected_version?: number) =>
    api.post<Deal>(`/deals/${id}/move-pipeline/`, { stage, expected_version }).then((r) => r.data),
  move: (id: number, stage: number, expected_version?: number) =>
    api.post<Deal>(`/deals/${id}/move-stage/`, { stage, expected_version }).then((r) => r.data),
  markWon: (id: number, payload: { actual_close_date?: string; expected_version?: number } = {}) =>
    api.post<Deal>(`/deals/${id}/mark-won/`, payload).then((r) => r.data),
  markLost: (id: number, payload: { lost_reason?: number; lost_reason_text?: string; expected_version?: number }) =>
    api.post<Deal>(`/deals/${id}/mark-lost/`, payload).then((r) => r.data),
  markAbandoned: (id: number, payload: { lost_reason?: number; lost_reason_text?: string; expected_version?: number }) =>
    api.post<Deal>(`/deals/${id}/mark-abandoned/`, payload).then((r) => r.data),
  reopen: (id: number, stage: number, expected_version?: number) =>
    api.post<Deal>(`/deals/${id}/reopen/`, { stage, expected_version }).then((r) => r.data),
  bulk: (payload: Record<string, unknown>) => api.post('/deals/bulk/', payload).then((r) => r.data),
  timeline: (id: number, params?: ListParams) =>
    api.get<Paginated<DomainEvent>>(`/deals/${id}/timeline/`, { params }).then((r) => r.data),
  history: (id: number, params?: ListParams) =>
    api.get<Paginated<Record<string, unknown>>>(`/deals/${id}/stage-history/`, { params }).then((r) => r.data),
  changeTags: (id: number, operation: 'attach' | 'detach', tag_ids: number[]) =>
    api.post<Deal>(`/deals/${id}/tags/`, { operation, tag_ids }).then((r) => r.data),
  addContact: (id: number, payload: { contact: number; role: DealParticipant['role']; is_primary: boolean }) =>
    api.post<DealParticipant>(`/deals/${id}/contacts/`, payload).then((r) => r.data),
  removeContact: (id: number, participant: number) => api.delete(`/deals/${id}/contacts/${participant}/`),
  addLineItem: (id: number, payload: Partial<DealLineItem>) =>
    api.post<DealLineItem>(`/deals/${id}/line-items/`, payload).then((r) => r.data),
  updateLineItem: (id: number, item: number, payload: Partial<DealLineItem>) =>
    api.patch<DealLineItem>(`/deals/${id}/line-items/${item}/`, payload).then((r) => r.data),
  removeLineItem: (id: number, item: number) => api.delete(`/deals/${id}/line-items/${item}/`),
  analytics: (params?: ListParams) =>
    api.get<PipelineAnalytics>('/pipeline-analytics/', { params }).then((r) => r.data),
};

export const pipelinesApi = {
  list: () => api.get<Pipeline[]>('/pipelines/').then((r) => r.data),
  create: (payload: Partial<Pipeline>) => api.post<Pipeline>('/pipelines/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Pipeline>) => api.patch<Pipeline>(`/pipelines/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/pipelines/${id}/`),
  reorderStages: (id: number, stage_ids: number[], expected_version: number) =>
    api.post<Stage[]>(`/pipelines/${id}/reorder-stages/`, { stage_ids, expected_version }).then((r) => r.data),
  reorder: (pipeline_ids: number[]) => api.post('/pipelines/reorder/', { pipeline_ids }).then((r) => r.data),
};

export const stagesApi = {
  create: (payload: Partial<Stage> & { pipeline: number; name: string }) => api.post<Stage>('/stages/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Stage>) => api.patch<Stage>(`/stages/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/stages/${id}/`),
};

export const lostReasonsApi = {
  list: () => api.get<Paginated<LostReason>>('/lost-reasons/', { params: { page_size: 100, active: true } }).then((r) => r.data),
  create: (payload: Partial<LostReason>) => api.post<LostReason>('/lost-reasons/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<LostReason>) => api.patch<LostReason>(`/lost-reasons/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/lost-reasons/${id}/`),
  reorder: (reason_ids: number[]) => api.post('/lost-reasons/reorder/', { reason_ids }).then((r) => r.data),
};

export const productsApi = {
  list: (params?: ListParams) => api.get<Paginated<Product>>('/products/', { params }).then((r) => r.data),
  create: (payload: Partial<Product>) => api.post<Product>('/products/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Product>) => api.patch<Product>(`/products/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/products/${id}/`),
};
