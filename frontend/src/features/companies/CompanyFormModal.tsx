import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { companiesApi } from '@/api/contacts';
import { organizationsApi } from '@/api/organizations';
import { CustomFieldsEditor } from '@/components/shared/CustomFieldsEditor';
import { Button, FormField, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { Company, DuplicateCandidate } from '@/types';

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
  custom_fields: Record<string, unknown>;
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
  custom_fields: {},
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
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);

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
              custom_fields: company.custom_fields,
            }
          : emptyForm,
      );
      setDuplicates([]);
    }
  }, [open, company]);

  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async (createAnyway: boolean) => {
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
        custom_fields: form.custom_fields,
      };
      if (!company && !createAnyway) {
        const result = await companiesApi.duplicateCheck(payload);
        if (result.candidates.length) { setDuplicates(result.candidates); return null; }
      }
      return company ? companiesApi.update(company.id, payload) : companiesApi.create(payload);
    },
    onSuccess: (result) => {
      if (!result) return;
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
            onClick={() => mutation.mutate(false)}
            loading={mutation.isPending}
            disabled={!form.name.trim()}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {duplicates.length > 0 && <div className="sm:col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-500/10"><p className="font-semibold">{t('common:customerCore.possibleDuplicate')}</p><p className="mt-1 text-sm">{t('common:customerCore.duplicateExplanation')}</p>{duplicates.slice(0, 3).map((candidate) => <div key={candidate.candidate_id} className="mt-3 flex items-center justify-between border-t border-amber-200 pt-3 dark:border-amber-800"><div><p className="text-sm font-semibold">{candidate.display_name}</p><p className="text-xs">{t('common:customerCore.matched', { reasons: candidate.match_reasons.join(', ') })}</p></div><Button size="sm" variant="outline" onClick={() => navigate(`/app/companies/${candidate.candidate_id}`)}>{t('common:customerCore.viewExisting')}</Button></div>)}<Button className="mt-4" size="sm" onClick={() => mutation.mutate(true)}>{t('common:customerCore.createAnyway')}</Button></div>}
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
        <CustomFieldsEditor target="company" values={form.custom_fields} onChange={(custom_fields) => setForm((current) => ({ ...current, custom_fields }))} />
      </div>
    </Modal>
  );
}
