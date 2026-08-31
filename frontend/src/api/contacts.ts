import { api } from '@/lib/api';
import type { Company, Contact, DomainEvent, Paginated, Tag } from '@/types';

export type ListParams = Record<string, string | number | boolean | undefined>;

export const contactsApi = {
  list: (params?: ListParams) =>
    api.get<Paginated<Contact>>('/contacts/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Contact>(`/contacts/${id}/`).then((r) => r.data),
  create: (payload: Partial<Contact>) => api.post<Contact>('/contacts/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Contact>) =>
    api.patch<Contact>(`/contacts/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/contacts/${id}/`),
  archive: (id: number) => api.post<Contact>(`/contacts/${id}/archive/`).then((r) => r.data),
  restore: (id: number) => api.post<Contact>(`/contacts/${id}/restore/`).then((r) => r.data),
  duplicateCheck: (payload: Partial<Contact>) =>
    api.post('/contacts/duplicate-check/', payload).then((r) => r.data),
  bulk: (payload: Record<string, unknown>) => api.post('/contacts/bulk/', payload).then((r) => r.data),
  timeline: (id: number, params?: ListParams) => api.get<Paginated<DomainEvent>>(`/contacts/${id}/timeline/`, { params }).then((r) => r.data),
  changeTags: (id: number, operation: 'attach' | 'detach', tag_ids: number[]) => api.post<Contact>(`/contacts/${id}/tags/`, { operation, tag_ids }).then((r) => r.data),
};

export const companiesApi = {
  list: (params?: ListParams) =>
    api.get<Paginated<Company>>('/companies/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Company>(`/companies/${id}/`).then((r) => r.data),
  create: (payload: Partial<Company>) => api.post<Company>('/companies/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Company>) =>
    api.patch<Company>(`/companies/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/companies/${id}/`),
  archive: (id: number) => api.post<Company>(`/companies/${id}/archive/`).then((r) => r.data),
  restore: (id: number) => api.post<Company>(`/companies/${id}/restore/`).then((r) => r.data),
  duplicateCheck: (payload: Partial<Company>) =>
    api.post('/companies/duplicate-check/', payload).then((r) => r.data),
  bulk: (payload: Record<string, unknown>) => api.post('/companies/bulk/', payload).then((r) => r.data),
  timeline: (id: number, params?: ListParams) => api.get<Paginated<DomainEvent>>(`/companies/${id}/timeline/`, { params }).then((r) => r.data),
  changeTags: (id: number, operation: 'attach' | 'detach', tag_ids: number[]) => api.post<Company>(`/companies/${id}/tags/`, { operation, tag_ids }).then((r) => r.data),
};

export const tagsApi = {
  list: (params?: ListParams) => api.get<Paginated<Tag>>('/tags/', { params }).then((r) => r.data),
  create: (payload: { name: string; color?: string }) =>
    api.post<Tag>('/tags/', payload).then((r) => r.data),
  update: (id: number, payload: { name?: string; color?: string }) =>
    api.patch<Tag>(`/tags/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/tags/${id}/`),
  restore: (id: number) => api.post<Tag>(`/tags/${id}/restore/`).then((r) => r.data),
};
