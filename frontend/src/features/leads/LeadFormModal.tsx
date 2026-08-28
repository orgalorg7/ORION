import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { leadsApi } from '@/api/leads';
import { organizationsApi } from '@/api/organizations';
import { Button, FormField, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { Lead, LeadSource, LeadStatus } from '@/types';

import { EDITABLE_LEAD_STATUSES, LEAD_SOURCES } from './leadShared';

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  job_title: string;
  source: string;
  status: string;
  score: string;
  estimated_value: string;
  owner: string;
  description: string;
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
  score: '0',
  estimated_value: '',
  owner: '',
  description: '',
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
  const [form, setForm] = useState<FormState>(emptyForm);

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
              score: String(lead.score),
              estimated_value: lead.estimated_value ?? '',
              owner: lead.owner ? String(lead.owner) : '',
              description: lead.description,
            }
          : emptyForm,
      );
    }
  }, [open, lead]);

  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const score = Math.max(0, Math.min(100, Number(form.score) || 0));
      const payload: Partial<Lead> = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone,
        company_name: form.company_name,
        job_title: form.job_title,
        source: form.source as LeadSource,
        status: form.status as LeadStatus,
        score,
        estimated_value: form.estimated_value || null,
        owner: form.owner ? Number(form.owner) : null,
        description: form.description,
      };
      return lead ? leadsApi.update(lead.id, payload) : leadsApi.create(payload);
    },
    onSuccess: () => {
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
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.first_name.trim()}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            {LEAD_SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`common:sources.${source}`)}
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
        <FormField label={t('leads:fields.score')}>
          <Input type="number" min={0} max={100} value={form.score} onChange={set('score')} dir="ltr" />
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
        <FormField label={t('common:labels.description')} className="sm:col-span-2">
          <Textarea value={form.description} onChange={set('description')} />
        </FormField>
      </div>
    </Modal>
  );
}
