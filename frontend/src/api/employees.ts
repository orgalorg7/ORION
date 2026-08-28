import { api } from '@/lib/api';
import type { Department, Employee, Paginated } from '@/types';
import type { ListParams } from './contacts';

export const employeesApi = {
  list: (params?: ListParams) =>
    api.get<Paginated<Employee>>('/employees/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Employee>(`/employees/${id}/`).then((r) => r.data),
  create: (payload: Partial<Employee>) => api.post<Employee>('/employees/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Employee>) =>
    api.patch<Employee>(`/employees/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/employees/${id}/`),
};

export const departmentsApi = {
  list: () => api.get<Department[]>('/departments/').then((r) => r.data),
  create: (payload: { name: string; description?: string }) =>
    api.post<Department>('/departments/', payload).then((r) => r.data),
  update: (id: number, payload: { name?: string; description?: string }) =>
    api.patch<Department>(`/departments/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/departments/${id}/`),
};
