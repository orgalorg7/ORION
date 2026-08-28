import { api } from '@/lib/api';
import type { Activity, Note, Paginated } from '@/types';
import type { ListParams } from './contacts';

export const activitiesApi = {
  list: (params?: ListParams) =>
    api.get<Paginated<Activity>>('/activities/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Activity>(`/activities/${id}/`).then((r) => r.data),
  create: (payload: Partial<Activity>) =>
    api.post<Activity>('/activities/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Activity>) =>
    api.patch<Activity>(`/activities/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/activities/${id}/`),
  /** Toggle completion. */
  complete: (id: number, completed: boolean) =>
    api.post<Activity>(`/activities/${id}/complete/`, { completed }).then((r) => r.data),
};

export const notesApi = {
  list: (params?: ListParams) => api.get<Paginated<Note>>('/notes/', { params }).then((r) => r.data),
  create: (payload: Partial<Note>) => api.post<Note>('/notes/', payload).then((r) => r.data),
  update: (id: number, payload: { body: string }) =>
    api.patch<Note>(`/notes/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/notes/${id}/`),
};
