import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { authApi } from '@/api/auth';
import { Button, Card, FormField, Input } from '@/components/ui';
import { apiErrorMessage, apiErrorStatus } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { setTokens, setSession } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError(t('common:errors.required'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('common:errors.invalidEmail'));
      return;
    }
    setLoading(true);
    try {
      const tokens = await authApi.login({ email, password });
      setTokens(tokens.access, tokens.refresh);
      const session = await authApi.me();
      setSession(session.user, session.memberships);
      navigate('/app');
    } catch (err) {
      setError(apiErrorStatus(err) === 401 ? t('login.invalidCredentials') : apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="relative w-full max-w-md overflow-hidden p-7 sm:p-9">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-primary-400" />
      <h1 className="font-display text-2xl font-semibold tracking-[-0.035em] text-gray-900 dark:text-gray-50">
        {t('login.title')}
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('login.subtitle')}</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <FormField label={t('login.email')} required>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            dir="ltr"
            required
            autoFocus
          />
        </FormField>
        <FormField label={t('login.password')} required>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            dir="ltr"
            required
          />
        </FormField>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" loading={loading}>
          {loading ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('login.noAccount')}{' '}
        <Link to="/register" className="font-semibold text-primary-700 hover:underline dark:text-primary-300">
          {t('login.registerLink')}
        </Link>
      </p>
    </Card>
  );
}
