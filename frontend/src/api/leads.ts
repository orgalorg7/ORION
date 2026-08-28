import { api } from '@/lib/api';
import type { Lead, Paginated } from '@/types';
import type { ListParams } from './contacts';

export interface ConvertLeadPayload {
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
}

export const leadsApi = {
  list: (params?: ListParams) => api.get<Paginated<Lead>>('/leads/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Lead>(`/leads/${id}/`).then((r) => r.data),
  create: (payload: Partial<Lead>) => api.post<Lead>('/leads/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Lead>) =>
    api.patch<Lead>(`/leads/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/leads/${id}/`),
  convert: (id: number, payload: ConvertLeadPayload) =>
    api.post<ConvertLeadResult>(`/leads/${id}/convert/`, payload).then((r) => r.data),
};
