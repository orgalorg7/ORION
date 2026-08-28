import { api } from '@/lib/api';
import type { Company, Contact, Paginated, Tag } from '@/types';

export type ListParams = Record<string, string | number | boolean | undefined>;

export const contactsApi = {
  list: (params?: ListParams) =>
    api.get<Paginated<Contact>>('/contacts/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Contact>(`/contacts/${id}/`).then((r) => r.data),
  create: (payload: Partial<Contact>) => api.post<Contact>('/contacts/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Contact>) =>
    api.patch<Contact>(`/contacts/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/contacts/${id}/`),
};

export const companiesApi = {
  list: (params?: ListParams) =>
    api.get<Paginated<Company>>('/companies/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Company>(`/companies/${id}/`).then((r) => r.data),
  create: (payload: Partial<Company>) => api.post<Company>('/companies/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Company>) =>
    api.patch<Company>(`/companies/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/companies/${id}/`),
};

export const tagsApi = {
  list: () => api.get<Tag[]>('/tags/').then((r) => r.data),
  create: (payload: { name: string; color?: string }) =>
    api.post<Tag>('/tags/', payload).then((r) => r.data),
  update: (id: number, payload: { name?: string; color?: string }) =>
    api.patch<Tag>(`/tags/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/tags/${id}/`),
};
