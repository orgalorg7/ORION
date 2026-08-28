import { api } from '@/lib/api';
import type { MembershipBrief, User } from '@/types';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  organization_name: string;
  language?: 'en' | 'ar';
}

export const authApi = {
  login: (payload: LoginPayload) =>
    api.post<{ access: string; refresh: string }>('/auth/token/', payload).then((r) => r.data),

  register: (payload: RegisterPayload) =>
    api
      .post<{ user: User; access: string; refresh: string; organization: { id: number; name: string } }>(
        '/auth/register/',
        payload,
      )
      .then((r) => r.data),

  me: () =>
    api.get<{ user: User; memberships: MembershipBrief[] }>('/auth/me/').then((r) => r.data),

  updateProfile: (payload: Partial<Pick<User, 'first_name' | 'last_name' | 'phone' | 'language'>>) =>
    api.patch<User>('/auth/me/', payload).then((r) => r.data),

  changePassword: (payload: { current_password: string; new_password: string }) =>
    api.post('/auth/change-password/', payload).then((r) => r.data),
};
