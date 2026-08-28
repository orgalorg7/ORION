import { api } from '@/lib/api';
import type { Paginated, Ticket, TicketComment } from '@/types';
import type { ListParams } from './contacts';

export const ticketsApi = {
  list: (params?: ListParams) => api.get<Paginated<Ticket>>('/tickets/', { params }).then((r) => r.data),
  get: (id: number) => api.get<Ticket>(`/tickets/${id}/`).then((r) => r.data),
  create: (payload: Partial<Ticket>) => api.post<Ticket>('/tickets/', payload).then((r) => r.data),
  update: (id: number, payload: Partial<Ticket>) =>
    api.patch<Ticket>(`/tickets/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => api.delete(`/tickets/${id}/`),
  comments: (ticketId: number) =>
    api.get<TicketComment[]>(`/tickets/${ticketId}/comments/`).then((r) => r.data),
  addComment: (ticketId: number, payload: { body: string; is_internal?: boolean }) =>
    api.post<TicketComment>(`/tickets/${ticketId}/comments/`, payload).then((r) => r.data),
};
