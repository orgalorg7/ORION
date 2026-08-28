import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { pipelinesApi } from '@/api/deals';
import { leadsApi } from '@/api/leads';
import { Button, Checkbox, FormField, Input, Modal, Select, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { fullName } from '@/lib/utils';
import type { Lead } from '@/types';

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
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [stageId, setStageId] = useState('');

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list(),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setCreateDeal(true);
      setDealTitle(fullName(lead));
      setDealValue(lead.estimated_value ?? '');
      setPipelineId('');
      setStageId('');
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
    mutationFn: () =>
      leadsApi.convert(lead.id, {
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
    onError: (error) => toast.error(apiErrorMessage(error)),
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
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={createDeal && !dealTitle.trim()}
          >
            {t('leads:convert.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">{t('leads:convert.explanation')}</p>

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
