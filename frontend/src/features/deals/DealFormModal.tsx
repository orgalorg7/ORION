import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { companiesApi, contactsApi } from '@/api/contacts';
import { dealsApi, pipelinesApi } from '@/api/deals';
import { organizationsApi } from '@/api/organizations';
import { Button, FormField, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { fullName } from '@/lib/utils';
import type { Deal, Pipeline } from '@/types';

interface FormState {
  title: string;
  value: string;
  pipeline: string;
  stage: string;
  contact: string;
  company: string;
  owner: string;
  expected_close_date: string;
  description: string;
}

const emptyForm: FormState = {
  title: '',
  value: '',
  pipeline: '',
  stage: '',
  contact: '',
  company: '',
  owner: '',
  expected_close_date: '',
  description: '',
};

function sortedStages(pipeline: Pipeline | undefined) {
  return pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];
}

export function DealFormModal({
  open,
  onClose,
  deal,
  defaultPipeline,
}: {
  open: boolean;
  onClose: () => void;
  deal?: Deal | null;
  defaultPipeline?: number;
}) {
  const { t } = useTranslation(['deals', 'common']);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list(),
    enabled: open,
  });
  const { data: contacts } = useQuery({
    queryKey: ['contacts', 'options'],
    queryFn: () => contactsApi.list({ page_size: 100 }),
    enabled: open,
  });
  const { data: companies } = useQuery({
    queryKey: ['companies', 'options'],
    queryFn: () => companiesApi.list({ page_size: 100 }),
    enabled: open,
  });
  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setForm(
        deal
          ? {
              title: deal.title,
              value: deal.value,
              pipeline: String(deal.pipeline),
              stage: deal.stage !== null ? String(deal.stage) : '',
              contact: deal.contact !== null ? String(deal.contact) : '',
              company: deal.company !== null ? String(deal.company) : '',
              owner: deal.owner !== null ? String(deal.owner) : '',
              expected_close_date: deal.expected_close_date ?? '',
              description: deal.description,
            }
          : emptyForm,
      );
    }
  }, [open, deal]);

  // Default the pipeline (and its first stage) once pipelines are available.
  useEffect(() => {
    if (!open || !pipelines?.length) return;
    setForm((prev) => {
      if (prev.pipeline) return prev;
      const fallback =
        pipelines.find((pipeline) => pipeline.id === defaultPipeline) ??
        pipelines.find((pipeline) => pipeline.is_default) ??
        pipelines[0];
      const firstStage = sortedStages(fallback)[0];
      return { ...prev, pipeline: String(fallback.id), stage: firstStage ? String(firstStage.id) : '' };
    });
  }, [open, pipelines, defaultPipeline]);

  const selectedPipeline = pipelines?.find((pipeline) => String(pipeline.id) === form.pipeline);
  const stages = sortedStages(selectedPipeline);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<Deal> = {
        title: form.title,
        value: form.value || '0',
        pipeline: Number(form.pipeline),
        stage: form.stage ? Number(form.stage) : null,
        contact: form.contact ? Number(form.contact) : null,
        company: form.company ? Number(form.company) : null,
        owner: form.owner ? Number(form.owner) : null,
        expected_close_date: form.expected_close_date || null,
        description: form.description,
      };
      return deal ? dealsApi.update(deal.id, payload) : dealsApi.create(payload);
    },
    onSuccess: () => {
      toast.success(deal ? t('common:toast.saved') : t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const set = (key: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const handlePipelineChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const pipelineId = event.target.value;
    const pipeline = pipelines?.find((item) => String(item.id) === pipelineId);
    const firstStage = sortedStages(pipeline)[0];
    setForm((prev) => ({ ...prev, pipeline: pipelineId, stage: firstStage ? String(firstStage.id) : '' }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={deal ? t('deals:form.editTitle') : t('deals:form.createTitle')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.title.trim() || !form.pipeline}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('deals:fields.title')} required className="sm:col-span-2">
          <Input value={form.title} onChange={set('title')} autoFocus />
        </FormField>
        <FormField label={t('deals:fields.value')}>
          <Input type="number" min="0" step="0.01" value={form.value} onChange={set('value')} dir="ltr" />
        </FormField>
        <FormField label={t('deals:fields.expectedCloseDate')}>
          <Input type="date" value={form.expected_close_date} onChange={set('expected_close_date')} />
        </FormField>
        <FormField label={t('deals:fields.pipeline')} required>
          <Select value={form.pipeline} onChange={handlePipelineChange}>
            {pipelines?.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('deals:fields.stage')}>
          <Select value={form.stage} onChange={set('stage')}>
            <option value="">{t('common:labels.notSet')}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('deals:fields.contact')}>
          <Select value={form.contact} onChange={set('contact')}>
            <option value="">{t('common:labels.none')}</option>
            {contacts?.results.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {fullName(contact)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('deals:fields.company')}>
          <Select value={form.company} onChange={set('company')}>
            <option value="">{t('common:labels.none')}</option>
            {companies?.results.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
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
