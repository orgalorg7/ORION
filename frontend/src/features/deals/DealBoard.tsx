import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Clock3, Kanban, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { dealsApi, lostReasonsApi } from '@/api/deals';
import { Avatar, Badge, Button, Card, EmptyState, FormField, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { cn, formatCurrency, formatDate, formatDateTime, fullName } from '@/lib/utils';
import type { Deal, Pipeline, Stage } from '@/types';

function DealCard({ deal, stages, onOpen, onMove }: {
  deal: Deal; stages: Stage[]; onOpen: () => void; onMove: (stage: Stage) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `deal-${deal.id}` });
  return (
    <article ref={setNodeRef} className={cn('rounded-xl border border-line bg-white p-3 dark:bg-gray-900', isDragging && 'opacity-40')}>
      <button type="button" onClick={onOpen} className="block w-full text-start">
        <span dir="auto" className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{deal.title}</span>
        <span className="mt-1 block text-sm font-semibold text-primary-600">{formatCurrency(deal.value, deal.currency)}</span>
        {deal.company_detail && <span className="mt-1 block truncate text-xs text-gray-500">{deal.company_detail.name}</span>}
      </button>
      <div className="mt-3 flex items-center justify-between gap-2">
        {deal.owner_detail ? <Avatar name={fullName(deal.owner_detail)} size="sm" /> : <span />}
        {deal.expected_close_date && (
          <span className={cn('inline-flex items-center gap-1 text-xs', deal.overdue_days ? 'text-red-600' : 'text-gray-500')}>
            <CalendarDays className="h-3.5 w-3.5" />{formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>
      {deal.is_stale && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" /> {deal.stage_age_days} days in stage
        </p>
      )}
      {deal.next_activity_id ? <p className="mt-2 flex items-center gap-1 truncate text-xs text-primary-700 dark:text-primary-300">
        <Clock3 className="h-3.5 w-3.5 shrink-0" />{deal.next_activity_title} · {deal.next_activity_all_day ? formatDate(deal.next_activity_due_date) : formatDateTime(deal.next_activity_at)}
      </p> : <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">No next activity scheduled</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button" {...listeners} {...attributes}
          className="cursor-grab rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 active:cursor-grabbing dark:hover:bg-gray-800"
          aria-label={`Drag ${deal.title}`}
        >Move</button>
        <Select
          value={deal.stage} onChange={(event) => {
            const stage = stages.find((item) => item.id === Number(event.target.value));
            if (stage) onMove(stage);
          }}
          aria-label={`Move ${deal.title} to stage`} className="h-8 min-w-0 flex-1 text-xs"
        >
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </Select>
      </div>
    </article>
  );
}

function StageColumn({ stage, deals, totals, hasMore, stages, onOpen, onMove }: {
  stage: Stage; deals: Deal[]; totals: Array<{ currency: string; count: number; value: string }>;
  hasMore: boolean; stages: Stage[]; onOpen: (deal: Deal) => void; onMove: (deal: Deal, stage: Stage) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  const navigate = useNavigate();
  const count = totals.reduce((sum, row) => sum + row.count, 0);
  return (
    <section className="flex w-[19rem] shrink-0 flex-col rounded-xl border border-line bg-surface-muted/70 dark:bg-gray-800/40">
      <div className="h-1 rounded-t-xl" style={{ backgroundColor: stage.color }} />
      <header className="px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{stage.name}</h3><Badge color="gray">{count}</Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-gray-500">
          {totals.map((row) => <span key={row.currency}>{formatCurrency(row.value, row.currency)}</span>)}
        </div>
      </header>
      <div ref={setNodeRef} className={cn('min-h-36 flex-1 space-y-2 p-2 pt-0', isOver && 'bg-primary-50 dark:bg-primary-500/10')}>
        {deals.map((deal) => (
          <DealCard key={deal.id} deal={deal} stages={stages} onOpen={() => onOpen(deal)} onMove={(target) => onMove(deal, target)} />
        ))}
        {!deals.length && <p className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-xs text-gray-500">No deals in this stage</p>}
        {hasMore && <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate(`/app/deals?view=list&stage=${stage.id}`)}>View all</Button>}
      </div>
    </section>
  );
}

export function DealBoard({ pipeline, onAddDeal }: { pipeline: Pipeline; onAddDeal: () => void }) {
  const { t } = useTranslation(['deals', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Deal | null>(null);
  const [transition, setTransition] = useState<{ deal: Deal; stage: Stage } | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [details, setDetails] = useState('');
  const [closeDate, setCloseDate] = useState(new Date().toISOString().slice(0, 10));
  const key = ['deals', 'board', pipeline.id] as const;
  const { data, isLoading, isError } = useQuery({
    queryKey: key, queryFn: () => dealsApi.board(pipeline.id, { limit: 25 }), placeholderData: keepPreviousData,
  });
  const { data: reasons } = useQuery({ queryKey: ['lost-reasons'], queryFn: lostReasonsApi.list });
  const stages = useMemo(() => [...(data?.pipeline.stages ?? pipeline.stages)].sort((a, b) => a.order - b.order), [data, pipeline]);
  const allDeals = data?.columns.flatMap((column) => column.deals) ?? [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const moveMutation = useMutation({
    mutationFn: async ({ deal, stage }: { deal: Deal; stage: Stage }) => {
      if (stage.stage_type === 'won') return dealsApi.markWon(deal.id, { actual_close_date: closeDate, expected_version: deal.version });
      if (stage.stage_type === 'lost') return dealsApi.markLost(deal.id, { lost_reason: lostReason ? Number(lostReason) : undefined, lost_reason_text: details, expected_version: deal.version });
      return dealsApi.moveStage(deal.id, stage.id, deal.version);
    },
    onSuccess: () => {
      setTransition(null); setLostReason(''); setDetails('');
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      toast.success(t('common:toast.saved'));
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const requestMove = (deal: Deal, stage: Stage) => {
    if (deal.stage === stage.id) return;
    if (stage.stage_type === 'won' || stage.stage_type === 'lost') setTransition({ deal, stage });
    else moveMutation.mutate({ deal, stage });
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setActive(null);
    if (!event.over) return;
    const deal = allDeals.find((item) => `deal-${item.id}` === event.active.id);
    const stage = stages.find((item) => `stage-${item.id}` === event.over?.id);
    if (deal && stage) requestMove(deal, stage);
  };

  if (isError) return <Card><EmptyState title="Pipeline could not be loaded" description="Retry or use the Deal list." /></Card>;
  if (!isLoading && !allDeals.length) return (
    <Card><EmptyState icon={<Kanban className="h-5 w-5" />} title={t('deals:board.empty')} description={t('deals:board.emptyHint')}
      action={<Button size="sm" onClick={onAddDeal}><Plus className="h-4 w-4" />{t('deals:addDeal')}</Button>} /></Card>
  );
  return (
    <>
      <DndContext sensors={sensors} onDragStart={(event: DragStartEvent) => setActive(allDeals.find((deal) => `deal-${deal.id}` === event.active.id) ?? null)} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4" aria-label="Deal pipeline board">
          {(data?.columns ?? []).map((column) => (
            <StageColumn key={column.stage.id} stage={column.stage} deals={column.deals} totals={column.totals}
              hasMore={column.has_more} stages={stages} onOpen={(deal) => navigate(`/app/deals/${deal.id}`)} onMove={requestMove} />
          ))}
          {isLoading && stages.map((stage) => <div key={stage.id} className="h-80 w-[19rem] shrink-0 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />)}
        </div>
        <DragOverlay>{active ? <div className="w-[19rem] rotate-2"><Card className="p-3 font-semibold">{active.title}</Card></div> : null}</DragOverlay>
      </DndContext>
      <Modal
        open={Boolean(transition)} onClose={() => setTransition(null)}
        title={transition?.stage.stage_type === 'won' ? 'Mark deal as won' : 'Mark deal as lost'}
        footer={<><Button variant="outline" onClick={() => setTransition(null)}>Cancel</Button><Button
          onClick={() => transition && moveMutation.mutate(transition)} loading={moveMutation.isPending}
          disabled={transition?.stage.stage_type === 'lost' && pipeline.require_lost_reason && !lostReason}
        >Confirm</Button></>}
      >
        {transition?.stage.stage_type === 'won' ? (
          <FormField label="Actual close date"><Input type="date" value={closeDate} onChange={(event) => setCloseDate(event.target.value)} /></FormField>
        ) : (
          <div className="space-y-4">
            <FormField label="Lost reason" required={pipeline.require_lost_reason}><Select value={lostReason} onChange={(event) => setLostReason(event.target.value)}>
              <option value="">Select a reason</option>{reasons?.results.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
            </Select></FormField>
            <FormField label="Additional details"><Textarea value={details} onChange={(event) => setDetails(event.target.value)} /></FormField>
          </div>
        )}
      </Modal>
    </>
  );
}
