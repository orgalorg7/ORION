import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { companiesApi } from '@/api/contacts';
import { organizationsApi } from '@/api/organizations';
import { Button, FormField, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { Company } from '@/types';

import { COMPANY_SIZES } from './constants';

interface FormState {
  name: string;
  domain: string;
  industry: string;
  size: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  annual_revenue: string;
  owner: string;
  description: string;
}

const emptyForm: FormState = {
  name: '',
  domain: '',
  industry: '',
  size: '',
  website: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  country: '',
  annual_revenue: '',
  owner: '',
  description: '',
};

export function CompanyFormModal({
  open,
  onClose,
  company,
}: {
  open: boolean;
  onClose: () => void;
  company?: Company | null;
}) {
  const { t } = useTranslation(['companies', 'common']);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (open) {
      setForm(
        company
          ? {
              name: company.name,
              domain: company.domain,
              industry: company.industry,
              size: company.size,
              website: company.website,
              email: company.email,
              phone: company.phone,
              address: company.address,
              city: company.city,
              country: company.country,
              annual_revenue: company.annual_revenue ?? '',
              owner: company.owner ? String(company.owner) : '',
              description: company.description,
            }
          : emptyForm,
      );
    }
  }, [open, company]);

  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<Company> = {
        name: form.name,
        domain: form.domain,
        industry: form.industry,
        size: form.size,
        website: form.website,
        email: form.email,
        phone: form.phone,
        address: form.address,
        city: form.city,
        country: form.country,
        annual_revenue: form.annual_revenue.trim() ? form.annual_revenue.trim() : null,
        owner: form.owner ? Number(form.owner) : null,
        description: form.description,
      };
      return company ? companiesApi.update(company.id, payload) : companiesApi.create(payload);
    },
    onSuccess: () => {
      toast.success(company ? t('common:toast.saved') : t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const set = (key: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={company ? t('companies:form.editTitle') : t('companies:form.createTitle')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.name.trim()}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('common:labels.name')} required className="sm:col-span-2">
          <Input value={form.name} onChange={set('name')} autoFocus />
        </FormField>
        <FormField label={t('companies:fields.domain')}>
          <Input value={form.domain} onChange={set('domain')} dir="ltr" />
        </FormField>
        <FormField label={t('companies:fields.industry')}>
          <Input value={form.industry} onChange={set('industry')} />
        </FormField>
        <FormField label={t('companies:fields.size')}>
          <Select value={form.size} onChange={set('size')}>
            <option value="">{t('common:labels.notSet')}</option>
            {COMPANY_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`companies:sizes.${size}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('companies:fields.website')}>
          <Input type="url" value={form.website} onChange={set('website')} dir="ltr" />
        </FormField>
        <FormField label={t('common:labels.email')}>
          <Input type="email" value={form.email} onChange={set('email')} dir="ltr" />
        </FormField>
        <FormField label={t('common:labels.phone')}>
          <Input type="tel" value={form.phone} onChange={set('phone')} dir="ltr" />
        </FormField>
        <FormField label={t('common:labels.address')}>
          <Input value={form.address} onChange={set('address')} />
        </FormField>
        <FormField label={t('common:labels.city')}>
          <Input value={form.city} onChange={set('city')} />
        </FormField>
        <FormField label={t('common:labels.country')}>
          <Input value={form.country} onChange={set('country')} />
        </FormField>
        <FormField label={t('companies:fields.annualRevenue')}>
          <Input type="number" min="0" value={form.annual_revenue} onChange={set('annual_revenue')} dir="ltr" />
        </FormField>
        <FormField label={t('common:labels.owner')}>
          <Select value={form.owner} onChange={set('owner')}>
            <option value="">{t('common:labels.none')}</option>
            {members?.results.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {`${member.user.first_name} ${member.user.last_name}`.trim() || member.user.email}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('common:labels.description')} className="sm:col-span-2">
          <Textarea value={form.description} onChange={set('description')} />
        </FormField>
      </div>
    </Modal>
  );
}
