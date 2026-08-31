import { api } from '@/lib/api';
import type { Activity, ActivityAttendee, ActivityHistory, ActivityOutcomeDefinition, ActivityPriority, Note, Paginated } from '@/types';
import type { ListParams } from './contacts';

export interface MyDayPayload {
  timezone: string;
  scope: 'mine' | 'team';
  overdue: Activity[];
  today: Activity[];
  upcoming: Activity[];
  counts: { overdue: number; today: number; upcoming: number };
}

export const activitiesApi = {
  list: (params?: ListParams) =>
    api.get<Paginated<Activity>>('/activities/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Activity>(`/activities/${id}/`).then((r) => r.data),
  create: (payload: Partial<Activity> & { reminder_configurations?: Array<Record<string, unknown>> }) =>
    api.post<Activity>('/activities/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Activity>) =>
    api.patch<Activity>(`/activities/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/activities/${id}/`),
  archive: (id: number) => api.post<Activity>(`/activities/${id}/archive/`).then((r) => r.data),
  restore: (id: number) => api.post<Activity>(`/activities/${id}/restore/`).then((r) => r.data),
  complete: (id: number, completed = true, payload: Record<string, unknown> = {}) =>
    api.post<Activity>(`/activities/${id}/complete/`, { completed, ...payload }).then((r) => r.data),
  start: (id: number, expectedVersion?: number) =>
    api.post<Activity>(`/activities/${id}/start/`, { expected_version: expectedVersion }).then((r) => r.data),
  cancel: (id: number, reason = '', expectedVersion?: number) =>
    api.post<Activity>(`/activities/${id}/cancel/`, { reason, expected_version: expectedVersion }).then((r) => r.data),
  reopen: (id: number, expectedVersion?: number) =>
    api.post<Activity>(`/activities/${id}/reopen/`, { expected_version: expectedVersion }).then((r) => r.data),
  reschedule: (id: number, payload: Record<string, unknown>) =>
    api.post<Activity>(`/activities/${id}/reschedule/`, payload).then((r) => r.data),
  snooze: (id: number, until: string, expectedVersion?: number) =>
    api.post<Activity>(`/activities/${id}/snooze/`, { until, expected_version: expectedVersion }).then((r) => r.data),
  assign: (id: number, assignedTo: number | null, team: number | null, expectedVersion?: number) =>
    api.post<Activity>(`/activities/${id}/assign/`, {
      assigned_to: assignedTo, team, expected_version: expectedVersion,
    }).then((r) => r.data),
  myDay: (params?: ListParams) =>
    api.get<MyDayPayload>('/activities/my-day/', { params }).then((r) => r.data),
  calendar: (from: string, to: string, params?: ListParams) =>
    api.get<Paginated<Activity>>('/activities/calendar/', { params: { ...params, from, to, page_size: 100 } }).then((r) => r.data),
  bulk: (ids: number[], action: string, values: { assigned_to?: number | null; team?: number | null; priority?: ActivityPriority; due_at?: string; reason?: string } = {}) =>
    api.post<{ updated: number }>('/activities/bulk/', { ids, action, ...values }).then((r) => r.data),
  addAttendee: (id: number, payload: { user?: number; contact?: number; external_email?: string }) =>
    api.post<ActivityAttendee>(`/activities/${id}/attendees/`, payload).then((r) => r.data),
  history: (id: number, params?: ListParams) =>
    api.get<Paginated<ActivityHistory>>(`/activities/${id}/history/`, { params }).then((r) => r.data),
};

export const activityOutcomesApi = {
  list: (category?: 'call' | 'meeting' | 'general') =>
    api.get<Paginated<ActivityOutcomeDefinition>>('/activity-outcomes/', { params: { category, active: true, page_size: 100 } }).then((r) => r.data),
};

export const notesApi = {
  list: (params?: ListParams) => api.get<Paginated<Note>>('/notes/', { params }).then((r) => r.data),
  create: (payload: Partial<Note>) => api.post<Note>('/notes/', payload).then((r) => r.data),
  update: (id: number, payload: { body: string }) =>
    api.patch<Note>(`/notes/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/notes/${id}/`),
};
