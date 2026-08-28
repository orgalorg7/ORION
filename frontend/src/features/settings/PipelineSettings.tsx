import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, Trash2, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { pipelinesApi, stagesApi } from '@/api/deals';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Input,
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
    mutationFn: (payload: Partial<Pick<Stage, 'name' | 'probability' | 'color'>>) =>
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

function PipelineCard({ pipeline, onlyPipeline }: { pipeline: Pipeline; onlyPipeline: boolean }) {
  const { t } = useTranslation(['settings', 'common']);
  const queryClient = useQueryClient();
  const [name, setName] = useState(pipeline.name);
  const [newStageName, setNewStageName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => setName(pipeline.name), [pipeline.name]);

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pipelines'] });

  const updateMutation = useMutation({
    mutationFn: (payload: { name?: string; is_default?: boolean }) =>
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
    mutationFn: ([first, second]: [Stage, Stage]) =>
      Promise.all([
        stagesApi.update(first.id, { order: second.order }),
        stagesApi.update(second.id, { order: first.order }),
      ]),
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
    swapMutation.mutate([stages[index], target]);
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
        (pipelines ?? []).map((pipeline) => (
          <PipelineCard key={pipeline.id} pipeline={pipeline} onlyPipeline={(pipelines ?? []).length === 1} />
        ))
      )}
    </div>
  );
}
