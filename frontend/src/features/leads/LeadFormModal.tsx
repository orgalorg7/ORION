import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { customerCoreApi } from '@/api/customerCore';
import { leadsApi } from '@/api/leads';
import { organizationsApi } from '@/api/organizations';
import { CustomFieldsEditor } from '@/components/shared/CustomFieldsEditor';
import { Button, FormField, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { DuplicateCandidate, Lead, LeadSource, LeadStatus } from '@/types';

import { EDITABLE_LEAD_STATUSES } from './leadShared';

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  job_title: string;
  source: string;
  status: string;
  estimated_value: string;
  owner: string;
  country: string;
  city: string;
  description: string;
  custom_fields: Record<string, unknown>;
}

const emptyForm: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  company_name: '',
  job_title: '',
  source: '',
  status: 'new',
  estimated_value: '',
  owner: '',
  country: '',
  city: '',
  description: '',
  custom_fields: {},
};

export function LeadFormModal({
  open,
  onClose,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
}) {
  const { t } = useTranslation(['leads', 'common']);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);

  useEffect(() => {
    if (open) {
      setForm(
        lead
          ? {
              first_name: lead.first_name,
              last_name: lead.last_name,
              email: lead.email,
              phone: lead.phone,
              company_name: lead.company_name,
              job_title: lead.job_title,
              source: lead.source,
              status: lead.status,
              estimated_value: lead.estimated_value ?? '',
              owner: lead.owner ? String(lead.owner) : '',
              country: lead.country,
              city: lead.city,
              description: lead.description,
              custom_fields: lead.custom_fields,
            }
          : emptyForm,
      );
      setDuplicates([]);
    }
  }, [open, lead]);

  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });
  const { data: sources } = useQuery({
    queryKey: ['lead-sources'],
    queryFn: () => customerCoreApi.sources({ active: true, page_size: 100 }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async (createAnyway: boolean) => {
      const payload: Partial<Lead> = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone,
        company_name: form.company_name,
        job_title: form.job_title,
        source: form.source as LeadSource,
        status: form.status as LeadStatus,
        estimated_value: form.estimated_value || null,
        owner: form.owner ? Number(form.owner) : null,
        country: form.country,
        city: form.city,
        description: form.description,
        custom_fields: form.custom_fields,
      };
      if (!lead && !createAnyway) {
        const result = await leadsApi.duplicateCheck(payload);
        if (result.candidates.length) {
          setDuplicates(result.candidates);
          return null;
        }
      }
      return lead ? leadsApi.update(lead.id, payload) : leadsApi.create(payload);
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success(lead ? t('common:toast.saved') : t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['leads'] });
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
      title={lead ? t('leads:form.editTitle') : t('leads:form.createTitle')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate(false)}
            loading={mutation.isPending}
            disabled={!form.first_name.trim()}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {duplicates.length > 0 && (
          <div className="sm:col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-500/10">
            <p className="font-semibold text-amber-950 dark:text-amber-100">{t('common:customerCore.possibleDuplicate')}</p>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{t('common:customerCore.duplicateExplanation')}</p>
            {duplicates.slice(0, 3).map((candidate) => (
              <div key={`${candidate.candidate_type}-${candidate.candidate_id}`} className="mt-3 flex items-center justify-between gap-3 border-t border-amber-200 pt-3 dark:border-amber-800">
                <div><p className="text-sm font-semibold">{candidate.display_name}</p><p className="text-xs">{t('common:customerCore.matched', { reasons: candidate.match_reasons.join(', ') })}</p></div>
                <Button size="sm" variant="outline" onClick={() => navigate(`/app/${candidate.candidate_type}s/${candidate.candidate_id}`)}>{t('common:customerCore.viewExisting')}</Button>
              </div>
            ))}
            <Button className="mt-4" size="sm" onClick={() => mutation.mutate(true)} loading={mutation.isPending}>{t('common:customerCore.createAnyway')}</Button>
          </div>
        )}
        <FormField label={t('common:labels.firstName')} required>
          <Input value={form.first_name} onChange={set('first_name')} autoFocus />
        </FormField>
        <FormField label={t('common:labels.lastName')}>
          <Input value={form.last_name} onChange={set('last_name')} />
        </FormField>
        <FormField label={t('common:labels.email')}>
          <Input type="email" value={form.email} onChange={set('email')} dir="ltr" />
        </FormField>
        <FormField label={t('common:labels.phone')}>
          <Input type="tel" value={form.phone} onChange={set('phone')} dir="ltr" />
        </FormField>
        <FormField label={t('leads:fields.companyName')}>
          <Input value={form.company_name} onChange={set('company_name')} />
        </FormField>
        <FormField label={t('leads:fields.jobTitle')}>
          <Input value={form.job_title} onChange={set('job_title')} />
        </FormField>
        <FormField label={t('common:labels.source')}>
          <Select value={form.source} onChange={set('source')}>
            <option value="">{t('common:labels.notSet')}</option>
            {sources?.results.map((source) => (
              <option key={source.id} value={source.key}>
                {source.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('common:labels.status')}>
          <Select value={form.status} onChange={set('status')} disabled={lead?.status === 'converted'}>
            {EDITABLE_LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`leads:statuses.${status}`)}
              </option>
            ))}
            {lead?.status === 'converted' && (
              <option value="converted">{t('leads:statuses.converted')}</option>
            )}
          </Select>
        </FormField>
        <FormField label={t('leads:fields.estimatedValue')}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.estimated_value}
            onChange={set('estimated_value')}
            dir="ltr"
          />
        </FormField>
        <FormField label={t('common:labels.owner')} className="sm:col-span-2">
          <Select value={form.owner} onChange={set('owner')}>
            <option value="">{t('common:labels.none')}</option>
            {members?.results.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {`${member.user.first_name} ${member.user.last_name}`.trim() || member.user.email}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('common:labels.country')}>
          <Input value={form.country} onChange={set('country')} />
        </FormField>
        <FormField label={t('common:labels.city')}>
          <Input value={form.city} onChange={set('city')} />
        </FormField>
        <FormField label={t('common:labels.description')} className="sm:col-span-2">
          <Textarea value={form.description} onChange={set('description')} />
        </FormField>
        <CustomFieldsEditor target="lead" values={form.custom_fields} onChange={(custom_fields) => setForm((current) => ({ ...current, custom_fields }))} />
      </div>
    </Modal>
  );
}
