import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Kanban, Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { dealsApi } from '@/api/deals';
import { Avatar, Badge, Button, Card, EmptyState, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { cn, formatCurrency, formatDate, fullName } from '@/lib/utils';
import type { Deal, Paginated, Pipeline, Stage } from '@/types';

function DealCardContent({ deal }: { deal: Deal }) {
  return (
    <Card className="p-4">
      <p dir="auto" className="text-start text-sm font-medium text-gray-900 dark:text-gray-100">{deal.title}</p>
      <p dir="auto" className="mt-1 text-start text-sm font-semibold text-primary-600 dark:text-primary-400">
        {formatCurrency(deal.value, deal.currency)}
      </p>
      {deal.company_detail && (
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{deal.company_detail.name}</p>
      )}
      {(deal.owner_detail || deal.expected_close_date) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          {deal.owner_detail ? <Avatar name={fullName(deal.owner_detail)} size="sm" /> : <span />}
          {deal.expected_close_date && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDate(deal.expected_close_date)}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

function DraggableDealCard({ deal, onOpen }: { deal: Deal; onOpen: (deal: Deal) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `deal-${deal.id}` });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(deal)}
      className={cn('cursor-grab touch-none active:cursor-grabbing', isDragging && 'opacity-40')}
    >
      <DealCardContent deal={deal} />
    </div>
  );
}

function StageColumn({
  stage,
  deals,
  currency,
  loading,
  onOpen,
}: {
  stage: Stage;
  deals: Deal[];
  currency: string;
  loading: boolean;
  onOpen: (deal: Deal) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  const sum = deals.reduce((acc, deal) => acc + (parseFloat(deal.value) || 0), 0);

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl border border-line/70 bg-surface-muted/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-transparent dark:bg-gray-800/40 dark:shadow-none">
      <div className="h-[3px] rounded-full" style={{ backgroundColor: stage.color }} />
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 dir="auto" className="truncate text-start text-sm font-semibold text-gray-900 dark:text-gray-100">
            {stage.name}
          </h3>
          <Badge color="gray">{deals.length}</Badge>
        </div>
        <span dir="auto" className="shrink-0 text-start text-xs font-medium text-gray-500 dark:text-gray-400">
          {formatCurrency(sum, currency)}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'min-h-40 flex-1 space-y-3 rounded-b-xl p-3 pt-1 transition-colors',
          isOver && 'bg-primary-50 dark:bg-primary-500/10',
        )}
      >
        {loading
          ? Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-800" />
            ))
          : deals.map((deal) => <DraggableDealCard key={deal.id} deal={deal} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

export function DealBoard({ pipeline, onAddDeal }: { pipeline: Pipeline; onAddDeal: () => void }) {
  const { t } = useTranslation(['deals', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const suppressClickRef = useRef(false);

  const boardKey = useMemo(() => ['deals', 'board', pipeline.id] as const, [pipeline.id]);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: boardKey,
    // The API caps page_size at 100 — walk every page so large pipelines
    // render completely instead of silently truncating.
    queryFn: async () => {
      const params = { pipeline: pipeline.id, status: 'open', page_size: 100 } as const;
      const first = await dealsApi.list(params);
      const results = [...first.results];
      let next = first.next;
      let page = 2;
      while (next && page <= 20) {
        const more = await dealsApi.list({ ...params, page });
        results.push(...more.results);
        next = more.next;
        page += 1;
      }
      return { ...first, results };
    },
    placeholderData: keepPreviousData,
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const stages = useMemo(() => [...pipeline.stages].sort((a, b) => a.order - b.order), [pipeline.stages]);
  const deals = useMemo(() => data?.results ?? [], [data]);
  const loading = isLoading || isPlaceholderData;

  const dealsByStage = useMemo(() => {
    const map = new Map<number, Deal[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const deal of deals) {
      if (deal.stage !== null && map.has(deal.stage)) map.get(deal.stage)!.push(deal);
    }
    return map;
  }, [stages, deals]);

  // Deals whose stage was deleted (stage=null) or points outside this
  // pipeline's stages must stay reachable — surface them in a pseudo-column.
  const unstagedDeals = useMemo(
    () => deals.filter((deal) => deal.stage === null || !dealsByStage.has(deal.stage)),
    [deals, dealsByStage],
  );
  const unstagedColumn: Stage = useMemo(
    () => ({
      id: -1,
      pipeline: pipeline.id,
      name: t('deals:board.unstaged'),
      order: -1,
      probability: 0,
      color: '#9ca3af',
    }),
    [pipeline.id, t],
  );

  const boardCurrency = deals[0]?.currency ?? 'USD';

  const openDeal = (deal: Deal) => {
    if (suppressClickRef.current) return;
    navigate(`/app/deals/${deal.id}`);
  };

  const handleDragStart = (event: DragStartEvent) => {
    suppressClickRef.current = true;
    setActiveDeal(deals.find((deal) => `deal-${deal.id}` === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeal(null);
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    const { active, over } = event;
    if (!over) return;
    const dealId = Number(String(active.id).replace('deal-', ''));
    const stageId = Number(String(over.id).replace('stage-', ''));
    const deal = deals.find((item) => item.id === dealId);
    // stageId <= 0 is the pseudo "unstaged" column — not a valid drop target.
    if (!deal || !Number.isFinite(stageId) || stageId <= 0 || deal.stage === stageId) return;

    const targetStage = stages.find((stage) => stage.id === stageId);
    const previous = queryClient.getQueryData<Paginated<Deal>>(boardKey);

    queryClient.setQueryData<Paginated<Deal>>(boardKey, (old) =>
      old
        ? {
            ...old,
            results: old.results.map((item) =>
              item.id === dealId
                ? { ...item, stage: stageId, stage_detail: targetStage ?? item.stage_detail }
                : item,
            ),
          }
        : old,
    );

    dealsApi
      .move(dealId, stageId)
      .then(() => queryClient.invalidateQueries({ queryKey: ['deals'] }))
      .catch((error) => {
        queryClient.setQueryData(boardKey, previous);
        toast.error(apiErrorMessage(error));
      });
  };

  if (stages.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Kanban className="h-5 w-5" />}
          title={t('deals:board.noStages')}
          description={t('deals:board.noStagesHint')}
        />
      </Card>
    );
  }

  if (!loading && deals.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Kanban className="h-5 w-5" />}
          title={t('deals:board.empty')}
          description={t('deals:board.emptyHint')}
          action={
            <Button size="sm" onClick={onAddDeal}>
              <Plus className="h-4 w-4" />
              {t('deals:addDeal')}
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            deals={dealsByStage.get(stage.id) ?? []}
            currency={boardCurrency}
            loading={loading}
            onOpen={openDeal}
          />
        ))}
        {unstagedDeals.length > 0 && (
          <StageColumn
            key="unstaged"
            stage={unstagedColumn}
            deals={unstagedDeals}
            currency={boardCurrency}
            loading={loading}
            onOpen={openDeal}
          />
        )}
      </div>
      <DragOverlay>
        {activeDeal ? (
          <div className="w-72 rotate-2 cursor-grabbing">
            <DealCardContent deal={activeDeal} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
