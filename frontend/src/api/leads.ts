import { api } from '@/lib/api';
import type { DomainEvent, DuplicateCandidate, Lead, Paginated } from '@/types';
import type { ListParams } from './contacts';

export interface ConvertLeadPayload {
  create_contact?: boolean;
  existing_contact?: number;
  create_company?: boolean;
  existing_company?: number;
  allow_duplicates?: boolean;
  create_deal?: boolean;
  deal_title?: string;
  deal_value?: number;
  pipeline?: number;
  stage?: number;
}

export interface ConvertLeadResult {
  lead: Lead;
  contact_id: number;
  company_id: number | null;
  deal_id: number | null;
  duplicate_candidates: DuplicateCandidate[];
}

export const leadsApi = {
  list: (params?: ListParams) => api.get<Paginated<Lead>>('/leads/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Lead>(`/leads/${id}/`).then((r) => r.data),
  create: (payload: Partial<Lead>) => api.post<Lead>('/leads/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Lead>) =>
    api.patch<Lead>(`/leads/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/leads/${id}/`),
  archive: (id: number) => api.post<Lead>(`/leads/${id}/archive/`).then((r) => r.data),
  restore: (id: number) => api.post<Lead>(`/leads/${id}/restore/`).then((r) => r.data),
  duplicateCheck: (payload: Partial<Lead>) =>
    api.post<{ candidates: DuplicateCandidate[] }>('/leads/duplicate-check/', payload).then((r) => r.data),
  bulk: (payload: Record<string, unknown>) => api.post('/leads/bulk/', payload).then((r) => r.data),
  timeline: (id: number, params?: ListParams) => api.get<Paginated<DomainEvent>>(`/leads/${id}/timeline/`, { params }).then((r) => r.data),
  changeTags: (id: number, operation: 'attach' | 'detach', tag_ids: number[]) => api.post<Lead>(`/leads/${id}/tags/`, { operation, tag_ids }).then((r) => r.data),
  convert: (id: number, payload: ConvertLeadPayload) =>
    api.post<ConvertLeadResult>(`/leads/${id}/convert/`, payload).then((r) => r.data),
};
