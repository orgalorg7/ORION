import axios, { AxiosError } from 'axios';

import { demoAdapter } from '@/demo/adapter';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth';

/** Demo builds run entirely in the browser against an emulated backend. */
export const IS_DEMO: boolean = import.meta.env.VITE_DEMO_MODE === '1';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';

export const api = axios.create({ baseURL: API_URL });

if (IS_DEMO) {
  api.defaults.adapter = demoAdapter;
}

api.interceptors.request.use((config) => {
  const { access, orgId } = useAuthStore.getState();
  if (access) {
    config.headers.Authorization = `Bearer ${access}`;
  }
  if (orgId) {
    config.headers['X-Organization'] = String(orgId);
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refresh } = useAuthStore.getState();
  if (!refresh) return null;
  try {
    const response = await axios.post<{ access: string }>(`${API_URL}/auth/token/refresh/`, { refresh });
    useAuthStore.getState().setTokens(response.data.access, refresh);
    return response.data.access;
  } catch {
    useAuthStore.getState().logout();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retried && useAuthStore.getState().refresh) {
      original._retried = true;
      refreshPromise = refreshPromise ?? refreshAccessToken();
      const access = await refreshPromise;
      refreshPromise = null;
      if (access) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${access}`;
        return api.request(original);
      }
    }
    return Promise.reject(error);
  },
);

export function apiErrorStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

function translatedBackendMessage(message: string): string {
  if (i18n.dir() !== 'rtl') return message;
  const normalized = message.toLowerCase();
  if (/required/.test(normalized)) return i18n.t('common:errors.required');
  if (/valid email|valid e-mail/.test(normalized)) return i18n.t('common:errors.invalidEmail');
  if (/already exists|already a member|already pending/.test(normalized)) {
    return i18n.t('common:errors.alreadyExists');
  }
  if (/user with this email|email.*exists/.test(normalized)) return i18n.t('common:errors.emailExists');
  if (/permission|admin role|not allowed|forbidden/.test(normalized)) {
    return i18n.t('common:errors.permissionDenied');
  }
  if (/not found|does not exist/.test(normalized)) return i18n.t('common:errors.notFound');
  if (/invalid|not a valid choice/.test(normalized)) return i18n.t('common:errors.invalidSelection');
  if (/password.*short|at least 8 character/.test(normalized)) {
    return i18n.t('common:errors.passwordTooShort');
  }
  return i18n.t('common:errors.requestFailed');
}

/** Extract a localized, user-safe message from a DRF error response. */
export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return i18n.t('common:errors.unauthorized');
    if (error.response?.status === 403) return i18n.t('common:errors.permissionDenied');
    if (error.response?.status === 404) return i18n.t('common:errors.notFound');
    const data = error.response?.data as Record<string, unknown> | undefined;
    if (data) {
      if (typeof data.detail === 'string') return translatedBackendMessage(data.detail);
      const firstKey = Object.keys(data)[0];
      if (firstKey) {
        const value = data[firstKey];
        const text = Array.isArray(value) ? String(value[0]) : String(value);
        const translated = translatedBackendMessage(text);
        return firstKey === 'non_field_errors' || i18n.dir() === 'rtl'
          ? translated
          : `${firstKey}: ${translated}`;
      }
    }
    if (error.message === 'Network Error') return i18n.t('common:errors.network');
    return i18n.dir() === 'rtl' ? i18n.t('common:errors.requestFailed') : error.message;
  }
  return i18n.t('common:errors.requestFailed');
}
