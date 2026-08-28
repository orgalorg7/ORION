import { api } from '@/lib/api';
import type { DashboardData } from '@/types';

export const analyticsApi = {
  dashboard: (params?: { pipeline?: number }) =>
    api.get<DashboardData>('/analytics/dashboard/', { params }).then((r) => r.data),
};
