import { api } from '@/lib/api';
import type { Invitation, Membership, Organization, Paginated, Plan, Role, Subscription } from '@/types';

export const organizationsApi = {
  current: () => api.get<Organization>('/organization/').then((r) => r.data),

  update: (payload: Partial<Organization>) =>
    api.patch<Organization>('/organization/', payload).then((r) => r.data),

  members: (params?: Record<string, unknown>) =>
    api.get<Paginated<Membership>>('/memberships/', { params }).then((r) => r.data),

  updateMember: (id: number, payload: { role?: Role; is_active?: boolean }) =>
    api.patch<Membership>(`/memberships/${id}/`, payload).then((r) => r.data),

  invitations: () => api.get<Paginated<Invitation>>('/invitations/').then((r) => r.data),

  invite: (payload: { email: string; role: Role }) =>
    api.post('/invitations/', payload).then((r) => r.data),

  revokeInvitation: (id: number) => api.delete(`/invitations/${id}/`),

  plans: () => api.get<Plan[]>('/plans/').then((r) => r.data),

  subscription: () => api.get<Subscription>('/subscription/').then((r) => r.data),

  changePlan: (planId: number) =>
    api.post<Subscription>('/subscription/', { plan_id: planId }).then((r) => r.data),
};
