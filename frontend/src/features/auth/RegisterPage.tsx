import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { authApi } from '@/api/auth';
import { Button, Card, FormField, Input } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export function RegisterPage() {
  const { t, i18n } = useTranslation('auth');
  const navigate = useNavigate();
  const { setTokens, setSession } = useAuthStore();

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    organization_name: '',
    email: '',
    password: '',
    confirm_password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.first_name.trim() || !form.organization_name.trim() || !form.email.trim() || !form.password) {
      setError(t('common:errors.required'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError(t('common:errors.invalidEmail'));
      return;
    }
    if (form.password.length < 8) {
      setError(t('common:errors.passwordTooShort'));
      return;
    }
    if (form.password !== form.confirm_password) {
      setError(t('register.passwordMismatch'));
      return;
    }
    setLoading(true);
    try {
      const result = await authApi.register({
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        password: form.password,
        organization_name: form.organization_name,
        language: i18n.language === 'ar' ? 'ar' : 'en',
      });
      setTokens(result.access, result.refresh);
      const session = await authApi.me();
      setSession(session.user, session.memberships);
      navigate('/app');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="relative w-full max-w-md overflow-hidden p-7 sm:p-9">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-primary-400" />
      <h1 className="font-display text-2xl font-semibold tracking-[-0.035em] text-gray-900 dark:text-gray-50">
        {t('register.title')}
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('register.subtitle')}</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('register.firstName')} required>
            <Input value={form.first_name} onChange={set('first_name')} required autoFocus />
          </FormField>
          <FormField label={t('register.lastName')}>
            <Input value={form.last_name} onChange={set('last_name')} />
          </FormField>
        </div>
        <FormField label={t('register.organizationName')} required>
          <Input value={form.organization_name} onChange={set('organization_name')} required />
        </FormField>
        <FormField label={t('register.email')} required>
          <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" dir="ltr" required />
        </FormField>
        <FormField label={t('register.password')} required>
          <Input
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            dir="ltr"
            required
            minLength={8}
          />
        </FormField>
        <FormField label={t('register.confirmPassword')} required>
          <Input
            type="password"
            value={form.confirm_password}
            onChange={set('confirm_password')}
            autoComplete="new-password"
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
          {loading ? t('register.submitting') : t('register.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('register.hasAccount')}{' '}
        <Link to="/login" className="font-semibold text-primary-700 hover:underline dark:text-primary-300">
          {t('register.loginLink')}
        </Link>
      </p>
    </Card>
  );
}
