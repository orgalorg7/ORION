import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { pipelinesApi } from '@/api/deals';
import { companiesApi, contactsApi } from '@/api/contacts';
import { leadsApi } from '@/api/leads';
import { Button, Checkbox, FormField, Input, Modal, Select, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { fullName } from '@/lib/utils';
import type { DuplicateCandidate, Lead } from '@/types';

export function ConvertLeadModal({
  open,
  onClose,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  lead: Lead;
}) {
  const { t } = useTranslation(['leads', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [createDeal, setCreateDeal] = useState(true);
  const [contactMode, setContactMode] = useState<'create' | 'existing'>('create');
  const [companyMode, setCompanyMode] = useState<'create' | 'existing' | 'none'>('create');
  const [contactId, setContactId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list(),
    enabled: open,
  });
  const { data: contacts } = useQuery({
    queryKey: ['contacts', 'conversion-options'],
    queryFn: () => contactsApi.list({ page_size: 100, ordering: 'display_name' }),
    enabled: open && contactMode === 'existing',
  });
  const { data: companies } = useQuery({
    queryKey: ['companies', 'conversion-options'],
    queryFn: () => companiesApi.list({ page_size: 100, ordering: 'name' }),
    enabled: open && companyMode === 'existing',
  });

  useEffect(() => {
    if (open) {
      setCreateDeal(true);
      setContactMode('create');
      setCompanyMode(lead.company_name || lead.company ? 'create' : 'none');
      setContactId('');
      setCompanyId('');
      setDealTitle(fullName(lead));
      setDealValue(lead.estimated_value ?? '');
      setPipelineId('');
      setStageId('');
      setDuplicates([]);
    }
  }, [open, lead]);

  // Default to the default pipeline once the list loads.
  useEffect(() => {
    if (open && pipelines && pipelines.length > 0 && !pipelineId) {
      const defaultPipeline = pipelines.find((p) => p.is_default) ?? pipelines[0];
      setPipelineId(String(defaultPipeline.id));
    }
  }, [open, pipelines, pipelineId]);

  const selectedPipeline = pipelines?.find((p) => String(p.id) === pipelineId);
  const stages = useMemo(
    () => [...(selectedPipeline?.stages ?? [])].sort((a, b) => a.order - b.order),
    [selectedPipeline],
  );

  // Default to the first stage of the selected pipeline.
  useEffect(() => {
    if (stages.length > 0 && !stages.some((stage) => String(stage.id) === stageId)) {
      setStageId(String(stages[0].id));
    }
  }, [stages, stageId]);

  const mutation = useMutation({
    mutationFn: (allowDuplicates: boolean) =>
      leadsApi.convert(lead.id, {
        create_contact: contactMode === 'create',
        existing_contact: contactMode === 'existing' && contactId ? Number(contactId) : undefined,
        create_company: companyMode === 'create',
        existing_company: companyMode === 'existing' && companyId ? Number(companyId) : undefined,
        allow_duplicates: allowDuplicates,
        create_deal: createDeal,
        ...(createDeal
          ? {
              deal_title: dealTitle,
              deal_value: dealValue ? Number(dealValue) : undefined,
              pipeline: pipelineId ? Number(pipelineId) : undefined,
              stage: stageId ? Number(stageId) : undefined,
            }
          : {}),
      }),
    onSuccess: (result) => {
      toast.success(t('leads:convert.success'));
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      onClose();
      navigate(`/app/contacts/${result.contact_id}`);
    },
    onError: (error) => {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const candidates = error.response.data?.duplicate_candidates as DuplicateCandidate[] | undefined;
        if (candidates?.length) {
          setDuplicates(candidates);
          return;
        }
      }
      toast.error(apiErrorMessage(error));
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('leads:convert.title')}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate(false)}
            loading={mutation.isPending}
            disabled={(createDeal && !dealTitle.trim()) || (contactMode === 'existing' && !contactId) || (companyMode === 'existing' && !companyId)}
          >
            {t('leads:convert.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('leads:convert.explanation')}</p>

        {duplicates.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-500/10">
            <p className="font-semibold text-amber-950 dark:text-amber-100">{t('common:customerCore.possibleDuplicate')}</p>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{t('common:customerCore.duplicateExplanation')}</p>
            {duplicates.slice(0, 3).map((candidate) => (
              <div key={`${candidate.candidate_type}-${candidate.candidate_id}`} className="mt-3 flex items-center justify-between border-t border-amber-200 pt-3 dark:border-amber-800">
                <div><p className="text-sm font-semibold">{candidate.display_name}</p><p className="text-xs">{t('common:customerCore.matched', { reasons: candidate.match_reasons.join(', ') })}</p></div>
                <Button size="sm" variant="outline" onClick={() => navigate(`/app/${candidate.candidate_type}s/${candidate.candidate_id}`)}>{t('common:customerCore.viewExisting')}</Button>
              </div>
            ))}
            <Button className="mt-4" size="sm" onClick={() => mutation.mutate(true)}>{t('common:customerCore.createAnyway')}</Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 p-4 sm:grid-cols-2 dark:border-gray-800">
          <FormField label={t('leads:convert.contact')}>
            <Select value={contactMode} onChange={(event) => setContactMode(event.target.value as 'create' | 'existing')}>
              <option value="create">{t('leads:convert.createContact')}</option>
              <option value="existing">{t('leads:convert.useContact')}</option>
            </Select>
          </FormField>
          {contactMode === 'existing' && <FormField label={t('leads:convert.selectContact')}><Select value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">{t('common:labels.notSet')}</option>{contacts?.results.map((contact) => <option key={contact.id} value={contact.id}>{fullName(contact)}</option>)}</Select></FormField>}
          <FormField label={t('leads:convert.company')}>
            <Select value={companyMode} onChange={(event) => setCompanyMode(event.target.value as 'create' | 'existing' | 'none')}>
              <option value="create">{t('leads:convert.createCompany', { name: lead.company_name || lead.company_detail?.name || '—' })}</option>
              <option value="existing">{t('leads:convert.useCompany')}</option>
              <option value="none">{t('leads:convert.noCompany')}</option>
            </Select>
          </FormField>
          {companyMode === 'existing' && <FormField label={t('leads:convert.selectCompany')}><Select value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">{t('common:labels.notSet')}</option>{companies?.results.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</Select></FormField>}
        </div>

        <Checkbox
          checked={createDeal}
          onChange={(event) => setCreateDeal(event.target.checked)}
          label={t('leads:convert.createDeal')}
        />

        {createDeal && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('leads:convert.dealTitle')} required className="sm:col-span-2">
              <Input value={dealTitle} onChange={(event) => setDealTitle(event.target.value)} />
            </FormField>
            <FormField label={t('leads:convert.dealValue')} className="sm:col-span-2">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={dealValue}
                onChange={(event) => setDealValue(event.target.value)}
                dir="ltr"
              />
            </FormField>
            <FormField label={t('leads:convert.pipeline')}>
              <Select
                value={pipelineId}
                onChange={(event) => {
                  setPipelineId(event.target.value);
                  setStageId('');
                }}
              >
                {pipelines?.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('leads:convert.stage')}>
              <Select value={stageId} onChange={(event) => setStageId(event.target.value)}>
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        )}
      </div>
    </Modal>
  );
}
