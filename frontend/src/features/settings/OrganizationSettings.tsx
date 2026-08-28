import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { organizationsApi } from '@/api/organizations';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormField,
  Input,
  Select,
  Spinner,
  toast,
} from '@/components/ui';
import { LANGUAGES } from '@/i18n';
import { apiErrorMessage } from '@/lib/api';
import { useIsAdmin } from '@/stores/auth';

const SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'EGP', 'KWD', 'QAR'] as const;

interface FormState {
  name: string;
  industry: string;
  size: string;
  country: string;
  website: string;
  currency: string;
  default_language: string;
}

export function OrganizationSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);

  const { data: organization, isLoading } = useQuery({
    queryKey: ['organization'],
    queryFn: () => organizationsApi.current(),
    enabled: isAdmin,
  });

  useEffect(() => {
    if (organization) {
      setForm({
        name: organization.name,
        industry: organization.industry,
        size: organization.size,
        country: organization.country,
        website: organization.website,
        currency: organization.currency,
        default_language: organization.default_language,
      });
    }
  }, [organization]);

  const mutation = useMutation({
    mutationFn: (payload: FormState) => organizationsApi.update(payload),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (!isAdmin) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  if (isLoading || !form) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8 text-primary-600" />
      </div>
    );
  }

  const set = (key: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => (prev ? { ...prev, [key]: event.target.value } : prev));

  return (
    <Card>
      <CardHeader title={t('settings:organization.title')} subtitle={t('settings:organization.subtitle')} />
      <CardBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('common:labels.name')} required>
            <Input value={form.name} onChange={set('name')} />
          </FormField>
          <FormField label={t('settings:organization.fields.industry')}>
            <Input value={form.industry} onChange={set('industry')} />
          </FormField>
          <FormField label={t('settings:organization.fields.size')}>
            <Select value={form.size} onChange={set('size')}>
              <option value="">{t('common:labels.notSet')}</option>
              {SIZES.map((size) => (
                <option key={size} value={size}>
                  {t(`settings:organization.sizes.${size}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('common:labels.country')}>
            <Input value={form.country} onChange={set('country')} />
          </FormField>
          <FormField label={t('settings:organization.fields.website')}>
            <Input value={form.website} onChange={set('website')} dir="ltr" placeholder="https://" />
          </FormField>
          <FormField label={t('settings:organization.fields.currency')}>
            <Select value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t('settings:organization.fields.defaultLanguage')}>
            <Select value={form.default_language} onChange={set('default_language')}>
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
            onClick={() => mutation.mutate(form)}
            loading={mutation.isPending}
            disabled={!form.name.trim()}
          >
            {t('common:actions.save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
