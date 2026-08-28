import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { authApi } from '@/api/auth';
import { Spinner } from '@/components/ui';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth';

export function ProtectedRoute() {
  const { access, user, setSession, logout } = useAuthStore();
  const [loading, setLoading] = useState(Boolean(access) && !user);

  useEffect(() => {
    if (access && !user) {
      authApi
        .me()
        .then((session) => {
          setSession(session.user, session.memberships);
          try {
            if (!localStorage.getItem('crm-lang') && session.user.language) {
              void i18n.changeLanguage(session.user.language);
            }
          } catch {
            // Storage can be unavailable in privacy mode; keep the active locale.
          }
        })
        .catch(() => logout())
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!access) return <Navigate to="/login" replace />;
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Spinner className="h-8 w-8 text-primary-600" />
      </div>
    );
  }
  return <Outlet />;
}
