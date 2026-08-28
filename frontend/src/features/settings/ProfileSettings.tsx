import { useMutation } from '@tanstack/react-query';
import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authApi } from '@/api/auth';
import { Button, Card, CardBody, CardHeader, FormField, Input, Select, toast } from '@/components/ui';
import { LANGUAGES } from '@/i18n';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useUiStore, type Theme } from '@/stores/ui';

const THEMES: { value: Theme; icon: typeof Sun }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
];

export function ProfileSettings() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { user, setUser } = useAuthStore();
  const { theme, setTheme } = useUiStore();

  const [form, setForm] = useState<{
    first_name: string;
    last_name: string;
    phone: string;
    language: string;
  }>({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    phone: user?.phone ?? '',
    language: user?.language ?? 'en',
  });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });

  const profileMutation = useMutation({
    mutationFn: () =>
      authApi.updateProfile({
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        language: form.language as 'en' | 'ar',
      }),
    onSuccess: (result) => {
      setUser(result);
      if (result.language !== i18n.language) {
        void i18n.changeLanguage(result.language);
      }
      toast.success(t('common:toast.saved'));
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const passwordMutation = useMutation({
    mutationFn: () =>
      authApi.changePassword({ current_password: passwords.current, new_password: passwords.next }),
    onSuccess: () => {
      setPasswords({ current: '', next: '', confirm: '' });
      toast.success(t('settings:profile.password.changed'));
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const mismatch = passwords.confirm.length > 0 && passwords.next !== passwords.confirm;
  const passwordReady =
    passwords.current.length > 0 && passwords.next.length > 0 && passwords.next === passwords.confirm;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t('settings:profile.title')} subtitle={t('settings:profile.subtitle')} />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('common:labels.firstName')} required>
              <Input
                value={form.first_name}
                onChange={(event) => setForm((prev) => ({ ...prev, first_name: event.target.value }))}
              />
            </FormField>
            <FormField label={t('common:labels.lastName')}>
              <Input
                value={form.last_name}
                onChange={(event) => setForm((prev) => ({ ...prev, last_name: event.target.value }))}
              />
            </FormField>
            <FormField label={t('common:labels.phone')}>
              <Input
                type="tel"
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                dir="ltr"
              />
            </FormField>
            <FormField label={t('common:labels.language')}>
              <Select
                value={form.language}
                onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="mt-5 flex justify-end">
            <Button
              onClick={() => profileMutation.mutate()}
              loading={profileMutation.isPending}
              disabled={!form.first_name.trim()}
            >
              {t('common:actions.save')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('settings:profile.appearance.title')}
          subtitle={t('settings:profile.appearance.subtitle')}
        />
        <CardBody>
          <div className="flex flex-col gap-3 sm:flex-row" role="radiogroup" aria-label={t('common:labels.theme')}>
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                onClick={() => setTheme(option.value)}
                className={cn(
                  'flex flex-1 items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition-colors sm:max-w-56',
                  theme === option.value
                    ? 'border-primary-600 bg-primary-50 text-primary-700 dark:border-primary-500 dark:bg-primary-500/10 dark:text-primary-300'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800',
                )}
              >
                <option.icon className="h-4 w-4 shrink-0" />
                {t(`common:theme.${option.value}`)}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('settings:profile.password.title')}
          subtitle={t('settings:profile.password.subtitle')}
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('settings:profile.password.current')} required className="sm:col-span-2">
              <Input
                type="password"
                autoComplete="current-password"
                value={passwords.current}
                onChange={(event) => setPasswords((prev) => ({ ...prev, current: event.target.value }))}
                dir="ltr"
                className="sm:max-w-sm"
              />
            </FormField>
            <FormField label={t('settings:profile.password.new')} required>
              <Input
                type="password"
                autoComplete="new-password"
                value={passwords.next}
                onChange={(event) => setPasswords((prev) => ({ ...prev, next: event.target.value }))}
                dir="ltr"
              />
            </FormField>
            <FormField
              label={t('settings:profile.password.confirm')}
              required
              error={mismatch ? t('settings:profile.password.mismatch') : undefined}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={passwords.confirm}
                onChange={(event) => setPasswords((prev) => ({ ...prev, confirm: event.target.value }))}
                dir="ltr"
              />
            </FormField>
          </div>
          <div className="mt-5 flex justify-end">
            <Button
              onClick={() => passwordMutation.mutate()}
              loading={passwordMutation.isPending}
              disabled={!passwordReady}
            >
              {t('settings:profile.password.submit')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
