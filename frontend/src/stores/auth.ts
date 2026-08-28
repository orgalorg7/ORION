import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { MembershipBrief, User } from '@/types';

interface AuthState {
  access: string | null;
  refresh: string | null;
  user: User | null;
  memberships: MembershipBrief[];
  orgId: number | null;
  setTokens: (access: string, refresh: string) => void;
  setSession: (user: User, memberships: MembershipBrief[]) => void;
  setUser: (user: User) => void;
  setOrg: (orgId: number) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      access: null,
      refresh: null,
      user: null,
      memberships: [],
      orgId: null,
      setTokens: (access, refresh) => set({ access, refresh }),
      setSession: (user, memberships) => {
        const current = get().orgId;
        const stillValid = memberships.some((m) => m.organization.id === current);
        set({
          user,
          memberships,
          orgId: stillValid ? current : (memberships[0]?.organization.id ?? null),
        });
      },
      setUser: (user) => set({ user }),
      setOrg: (orgId) => set({ orgId }),
      logout: () => set({ access: null, refresh: null, user: null, memberships: [], orgId: null }),
    }),
    { name: 'crm-auth' },
  ),
);

/** The active membership (role + organization) for the selected org. */
export function useActiveMembership(): MembershipBrief | null {
  const { memberships, orgId } = useAuthStore();
  return memberships.find((m) => m.organization.id === orgId) ?? memberships[0] ?? null;
}

export function useIsAdmin(): boolean {
  const membership = useActiveMembership();
  return membership?.role === 'owner' || membership?.role === 'admin';
}
