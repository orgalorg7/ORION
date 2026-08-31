import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, Trash2, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lostReasonsApi, pipelinesApi, productsApi, stagesApi } from '@/api/deals';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Input,
  FormField,
  Select,
  Spinner,
  toast,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { Pipeline, Stage } from '@/types';

const DEFAULT_STAGE_COLOR = '#d5a928';

function StageRow({
  stage,
  index,
  count,
  moving,
  onMove,
}: {
  stage: Stage;
  index: number;
  count: number;
  moving: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const [name, setName] = useState(stage.name);
  const [probability, setProbability] = useState(String(stage.probability));
  const [color, setColor] = useState(stage.color || DEFAULT_STAGE_COLOR);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const colorTimer = useRef<number | null>(null);

  useEffect(() => {
    setName(stage.name);
    setProbability(String(stage.probability));
    setColor(stage.color || DEFAULT_STAGE_COLOR);
  }, [stage.name, stage.probability, stage.color]);

  useEffect(() => {
    return () => {
      if (colorTimer.current) window.clearTimeout(colorTimer.current);
    };
  }, []);

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<Pick<Stage, 'name' | 'probability' | 'color' | 'stage_type'>>) =>
      stagesApi.update(stage.id, payload),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => stagesApi.remove(stage.id),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      setDeleteOpen(false);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const handleColorChange = (value: string) => {
    setColor(value);
    if (colorTimer.current) window.clearTimeout(colorTimer.current);
    colorTimer.current = window.setTimeout(() => updateMutation.mutate({ color: value }), 600);
  };

  const saveName = () => {
    const value = name.trim();
    if (!value) {
      setName(stage.name);
      return;
    }
    if (value !== stage.name) updateMutation.mutate({ name: value });
  };

  const saveProbability = () => {
    const parsed = Number(probability);
    if (!Number.isFinite(parsed)) {
      setProbability(String(stage.probability));
      return;
    }
    const value = Math.min(100, Math.max(0, Math.round(parsed)));
    setProbability(String(value));
    if (value !== stage.probability) updateMutation.mutate({ probability: value });
  };

  const iconButtonClasses =
    'rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300';

  return (
    <div className="flex flex-wrap items-center gap-2 py-2.5 sm:flex-nowrap">
      <input
        type="color"
        value={color}
        onChange={(event) => handleColorChange(event.target.value)}
        onBlur={() => {
          if (color !== (stage.color || DEFAULT_STAGE_COLOR)) {
            if (colorTimer.current) window.clearTimeout(colorTimer.current);
            updateMutation.mutate({ color });
          }
        }}
        aria-label={t('settings:pipelines.stageColor')}
        className="h-9 w-9 shrink-0 cursor-pointer rounded border border-gray-300 bg-transparent p-1 dark:border-gray-700"
      />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        placeholder={t('settings:pipelines.stageName')}
        aria-label={t('settings:pipelines.stageName')}
        className="h-9 min-w-32 flex-1"
      />
      <div className="flex items-center gap-1.5">
        <Select
          value={stage.stage_type}
          onChange={(event) => updateMutation.mutate({ stage_type: event.target.value as Stage['stage_type'] })}
          aria-label="Stage behavior"
          className="h-9 w-28 text-xs"
        >
          <option value="open">Open</option><option value="on_hold">On hold</option>
          <option value="won">Won</option><option value="lost">Lost</option>
        </Select>
        <Input
          type="number"
          min={0}
          max={100}
          value={probability}
          onChange={(event) => setProbability(event.target.value)}
          onBlur={saveProbability}
          aria-label={t('settings:pipelines.probability')}
          className="h-9 w-20"
          dir="ltr"
        />
        <span className="text-sm text-gray-500 dark:text-gray-400">%</span>
      </div>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => onMove(index, -1)}
          disabled={index === 0 || moving}
          title={t('settings:pipelines.moveUp')}
          aria-label={t('settings:pipelines.moveUp')}
          className={iconButtonClasses}
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(index, 1)}
          disabled={index === count - 1 || moving}
          title={t('settings:pipelines.moveDown')}
          aria-label={t('settings:pipelines.moveDown')}
          className={iconButtonClasses}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          title={t('common:actions.delete')}
          aria-label={t('common:actions.delete')}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmDelete.title', { item: stage.name })}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />
    </div>
  );
}

function PipelineCard({ pipeline, onlyPipeline, index, count, onMove }: {
  pipeline: Pipeline; onlyPipeline: boolean; index: number; count: number; onMove: (index: number, direction: -1 | 1) => void;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const [name, setName] = useState(pipeline.name);
  const [newStageName, setNewStageName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => setName(pipeline.name), [pipeline.name]);

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pipelines'] });

  const updateMutation = useMutation({
    mutationFn: (payload: Pick<Partial<Pipeline>, 'name' | 'is_default' | 'require_lost_reason' | 'stale_activity_days' | 'stale_stage_days'>) =>
      pipelinesApi.update(pipeline.id, payload),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => pipelinesApi.remove(pipeline.id),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      invalidate();
      setDeleteOpen(false);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const addStageMutation = useMutation({
    mutationFn: () =>
      stagesApi.create({
        pipeline: pipeline.id,
        name: newStageName.trim(),
        // Orders are not renumbered on delete, so "length" can collide with an
        // existing stage and make reorder swaps no-ops — always go past the max.
        order: pipeline.stages.reduce((max, stage) => Math.max(max, stage.order), -1) + 1,
        probability: 50,
      }),
    onSuccess: () => {
      toast.success(t('common:toast.created'));
      setNewStageName('');
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const swapMutation = useMutation({
    mutationFn: (stageIds: number[]) => pipelinesApi.reorderStages(pipeline.id, stageIds, pipeline.version),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const saveName = () => {
    const value = name.trim();
    if (!value) {
      setName(pipeline.name);
      return;
    }
    if (value !== pipeline.name) updateMutation.mutate({ name: value });
  };

  const moveStage = (index: number, direction: -1 | 1) => {
    const target = stages[index + direction];
    if (!target) return;
    const reordered = stages.map((stage) => stage.id);
    [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    swapMutation.mutate(reordered);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          aria-label={t('settings:pipelines.pipelineName')}
          className="h-9 w-full font-medium sm:max-w-60"
        />
        {pipeline.is_default ? (
          <Badge color="green">{t('settings:pipelines.default')}</Badge>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateMutation.mutate({ is_default: true })}
            loading={updateMutation.isPending}
          >
            {t('settings:pipelines.makeDefault')}
          </Button>
        )}
        <div className="flex">
          <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Move pipeline up"><ChevronUp className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label="Move pipeline down"><ChevronDown className="h-4 w-4" /></Button>
        </div>
        {!onlyPipeline && (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            title={t('common:actions.delete')}
            aria-label={t('common:actions.delete')}
            className="ms-auto rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <CardBody className="py-3">
        <div className="mb-4 grid gap-3 rounded-lg bg-surface-muted p-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pipeline.require_lost_reason} onChange={(event) => updateMutation.mutate({ require_lost_reason: event.target.checked })} />Require lost reason</label>
          <FormField label="Stale after no activity (days)"><Input type="number" min="0" max="3650" defaultValue={pipeline.stale_activity_days} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value !== pipeline.stale_activity_days) updateMutation.mutate({ stale_activity_days: value }); }} /></FormField>
          <FormField label="Stale in stage (days)"><Input type="number" min="0" max="3650" defaultValue={pipeline.stale_stage_days} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value !== pipeline.stale_stage_days) updateMutation.mutate({ stale_stage_days: value }); }} /></FormField>
        </div>
        {stages.length === 0 ? (
          <p className="py-2 text-sm text-gray-500 dark:text-gray-400">
            {t('settings:pipelines.noStages')}
          </p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800/70">
            {stages.map((stage, index) => (
              <StageRow
                key={stage.id}
                stage={stage}
                index={index}
                count={stages.length}
                moving={swapMutation.isPending}
                onMove={moveStage}
              />
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          <Input
            value={newStageName}
            onChange={(event) => setNewStageName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newStageName.trim()) addStageMutation.mutate();
            }}
            placeholder={t('settings:pipelines.stageName')}
            className="h-9 flex-1"
          />
          <Button
            size="sm"
            onClick={() => addStageMutation.mutate()}
            loading={addStageMutation.isPending}
            disabled={!newStageName.trim()}
          >
            <Plus className="h-4 w-4" />
            {t('settings:pipelines.addStage')}
          </Button>
        </div>
      </CardBody>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmDelete.title', { item: pipeline.name })}
        message={t('settings:pipelines.deleteMessage')}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />
    </Card>
  );
}

export function PipelineSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();

  const { data: pipelines, isLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: () => pipelinesApi.create({ name: t('settings:pipelines.defaultName') }),
    onSuccess: () => {
      toast.success(t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const reorderPipelines = useMutation({
    mutationFn: (ids: number[]) => pipelinesApi.reorder(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipelines'] }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const movePipeline = (index: number, direction: -1 | 1) => {
    const ids = (pipelines ?? []).map((pipeline) => pipeline.id);
    if (!ids[index + direction]) return;
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    reorderPipelines.mutate(ids);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8 text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('settings:pipelines.title')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings:pipelines.subtitle')}</p>
        </div>
        <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
          <Plus className="h-4 w-4" />
          {t('settings:pipelines.newPipeline')}
        </Button>
      </div>

      {(pipelines ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<Workflow className="h-5 w-5" />}
            title={t('settings:pipelines.empty')}
            description={t('settings:pipelines.emptyHint')}
            action={
              <Button size="sm" onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
                <Plus className="h-4 w-4" />
                {t('settings:pipelines.newPipeline')}
              </Button>
            }
          />
        </Card>
      ) : (
        (pipelines ?? []).map((pipeline, index) => (
          <PipelineCard key={pipeline.id} pipeline={pipeline} onlyPipeline={(pipelines ?? []).length === 1}
            index={index} count={(pipelines ?? []).length} onMove={movePipeline} />
        ))
      )}
      <CommercialSettings />
    </div>
  );
}

function CommercialSettings() {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [product, setProduct] = useState({ name: '', sku: '', default_price: '', currency: 'USD' });
  const { data: reasons } = useQuery({ queryKey: ['lost-reasons'], queryFn: lostReasonsApi.list });
  const { data: products } = useQuery({ queryKey: ['products', 'settings'], queryFn: () => productsApi.list({ page_size: 100 }) });
  const addReason = useMutation({
    mutationFn: () => lostReasonsApi.create({ label: reason, display_order: reasons?.results.length ?? 0 }),
    onSuccess: () => { setReason(''); queryClient.invalidateQueries({ queryKey: ['lost-reasons'] }); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const addProduct = useMutation({
    mutationFn: () => productsApi.create({ ...product, default_price: product.default_price || '0' }),
    onSuccess: () => { setProduct({ name: '', sku: '', default_price: '', currency: 'USD' }); queryClient.invalidateQueries({ queryKey: ['products'] }); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const updateProduct = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { name?: string; default_price?: string } }) =>
      productsApi.update(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const archiveProduct = useMutation({
    mutationFn: (id: number) => productsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  return <div className="grid gap-6 xl:grid-cols-2">
    <Card><CardBody>
      <h3 className="font-semibold">Lost reasons</h3><p className="mt-1 text-sm text-gray-500">Structured reasons keep loss analytics reliable.</p>
      <ul className="mt-4 divide-y divide-line">{reasons?.results.map((item, index, all) => <li key={item.id} className="flex items-center gap-2 py-2 text-sm"><Input defaultValue={item.label} className="h-8 flex-1" aria-label={`Rename ${item.label}`} onBlur={(event) => { const label = event.target.value.trim(); if (label && label !== item.label) lostReasonsApi.update(item.id, { label }).then(() => queryClient.invalidateQueries({ queryKey: ['lost-reasons'] })); }} /><Button size="sm" variant="ghost" disabled={index === 0} aria-label="Move reason up" onClick={() => { const ids = all.map((reason) => reason.id); [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]]; lostReasonsApi.reorder(ids).then(() => queryClient.invalidateQueries({ queryKey: ['lost-reasons'] })); }}><ChevronUp className="h-4 w-4" /></Button><Button size="sm" variant="ghost" disabled={index === all.length - 1} aria-label="Move reason down" onClick={() => { const ids = all.map((reason) => reason.id); [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]; lostReasonsApi.reorder(ids).then(() => queryClient.invalidateQueries({ queryKey: ['lost-reasons'] })); }}><ChevronDown className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => lostReasonsApi.remove(item.id).then(() => queryClient.invalidateQueries({ queryKey: ['lost-reasons'] }))}>Archive</Button></li>)}</ul>
      <div className="mt-4 flex gap-2"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="New lost reason" /><Button onClick={() => addReason.mutate()} disabled={!reason.trim()} loading={addReason.isPending}>Add</Button></div>
    </CardBody></Card>
    <Card><CardBody>
      <h3 className="font-semibold">Product catalog</h3><p className="mt-1 text-sm text-gray-500">Sellable CRM products, independent of warehouse inventory.</p>
      <ul className="mt-4 divide-y divide-line">{products?.results.map((item) => <li key={item.id} className="grid items-center gap-2 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_auto]"><div><Input defaultValue={item.name} className="h-8 font-medium" aria-label={`Rename ${item.name}`} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== item.name) updateProduct.mutate({ id: item.id, payload: { name } }); }} /><small className="text-gray-500">{item.sku || 'No SKU'}</small></div><FormField label={item.currency}><Input type="number" min="0" step="0.01" defaultValue={item.default_price} className="h-8" aria-label={`${item.name} default price`} onBlur={(event) => { if (event.target.value !== item.default_price) updateProduct.mutate({ id: item.id, payload: { default_price: event.target.value } }); }} /></FormField><Button size="sm" variant="ghost" onClick={() => archiveProduct.mutate(item.id)}>Archive</Button></li>)}</ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><FormField label="Product name"><Input value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} /></FormField><FormField label="SKU"><Input value={product.sku} onChange={(event) => setProduct({ ...product, sku: event.target.value })} /></FormField><FormField label="Default price"><Input type="number" min="0" value={product.default_price} onChange={(event) => setProduct({ ...product, default_price: event.target.value })} /></FormField><FormField label="Currency"><Input maxLength={3} value={product.currency} onChange={(event) => setProduct({ ...product, currency: event.target.value.toUpperCase() })} /></FormField></div>
      <Button className="mt-3" onClick={() => addProduct.mutate()} disabled={!product.name.trim()} loading={addProduct.isPending}>Add product</Button>
    </CardBody></Card>
  </div>;
}
