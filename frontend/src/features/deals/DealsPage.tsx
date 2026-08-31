import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Kanban, List, Plus, Target, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { dealsApi, pipelinesApi } from '@/api/deals';
import { CustomerListActions } from '@/components/shared/CustomerListActions';
import {
  Badge, Button, Card, EmptyState, PageHeader, Pagination, SearchInput, Select, StatCard, Table, Tabs, toast,
  type BadgeColor, type Column,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatCurrency, formatDate, fullName } from '@/lib/utils';
import type { Deal, DealPriority } from '@/types';

import { DealBoard } from './DealBoard';
import { DealFormModal } from './DealFormModal';

const PAGE_SIZE = 25;
const priorityColors: Record<DealPriority, BadgeColor> = { low: 'gray', medium: 'blue', high: 'amber', critical: 'red' };
function currencyTotals(
  rows: Array<{ currency: string; value: string; weighted_value: string }> | undefined,
  field: 'value' | 'weighted_value',
) {
  return rows?.length ? rows.map((row) => formatCurrency(row[field], row.currency)).join(' · ') : '0';
}

export function DealsPage() {
  const { t } = useTranslation(['deals', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [bulkStage, setBulkStage] = useState('');
  const [bulkPriority, setBulkPriority] = useState('');
  const view = params.get('view') ?? 'board';
  const page = Number(params.get('page') ?? 1);
  const pipelineParam = params.get('pipeline') ?? '';

  const updateParams = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(updates).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (!('page' in updates)) next.delete('page');
    setParams(next, { replace: true });
  };

  const { data: pipelines, isLoading: pipelinesLoading } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list });
  const selectedPipeline = useMemo(() => pipelines?.find((item) => String(item.id) === pipelineParam)
    ?? pipelines?.find((item) => item.is_default) ?? pipelines?.[0], [pipelines, pipelineParam]);

  const listParams = {
    page, page_size: PAGE_SIZE, pipeline: selectedPipeline?.id,
    search: params.get('search') || undefined, stage: params.get('stage') || undefined,
    status: params.get('status') || undefined, priority: params.get('priority') || undefined,
    ordering: params.get('ordering') || '-updated_at',
  };
  const { data: deals, isLoading: dealsLoading, isError } = useQuery({
    queryKey: ['deals', 'list', listParams], queryFn: () => dealsApi.list(listParams),
    enabled: view === 'list' && Boolean(selectedPipeline), placeholderData: keepPreviousData,
  });
  const { data: analytics } = useQuery({
    queryKey: ['deals', 'analytics', selectedPipeline?.id],
    queryFn: () => dealsApi.analytics({ pipeline: selectedPipeline!.id }), enabled: Boolean(selectedPipeline),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['deals'] });
  const bulk = useMutation({
    mutationFn: ({ operation, extra = {} }: { operation: string; extra?: Record<string, unknown> }) =>
      dealsApi.bulk({ ids: [...selected], operation, ...extra }),
    onSuccess: () => { setSelected(new Set()); setBulkStage(''); setBulkPriority(''); invalidate(); toast.success(t('common:toast.saved')); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const columns: Column<Deal>[] = [
    { key: 'title', header: 'Deal', render: (deal) => <div><p className="font-semibold text-gray-900 dark:text-gray-100">{deal.title}</p><p className="text-xs text-gray-500">{deal.company_detail?.name ?? 'No company'}</p></div> },
    { key: 'stage', header: 'Stage', render: (deal) => <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full" style={{ background: deal.stage_detail.color }} />{deal.stage_detail.name}</span> },
    { key: 'value', header: 'Amount', render: (deal) => <div><p className="font-medium">{formatCurrency(deal.value, deal.currency)}</p><p className="text-xs text-gray-500">{deal.probability}% · {formatCurrency(deal.weighted_value, deal.currency)} weighted</p></div> },
    { key: 'contact', header: 'Contact', render: (deal) => deal.contact_detail ? fullName(deal.contact_detail) : 'Not set' },
    { key: 'priority', header: 'Priority', render: (deal) => <Badge color={priorityColors[deal.priority]}>{deal.priority}</Badge> },
    { key: 'owner', header: 'Owner', render: (deal) => deal.owner_detail ? fullName(deal.owner_detail) : 'Unassigned' },
    { key: 'expected_close_date', header: 'Expected close', render: (deal) => <span className={deal.overdue_days ? 'text-red-600' : ''}>{formatDate(deal.expected_close_date)}</span> },
  ];
  return (
    <div>
      <PageHeader title={t('deals:title')} subtitle={t('deals:subtitle')} actions={<>
        <CustomerListActions target="deal" filters={listParams} sort={String(listParams.ordering)} />
        <Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" />{t('deals:addDeal')}</Button>
      </>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open pipeline" value={currencyTotals(analytics?.open_pipeline, 'value')} icon={<Kanban className="h-5 w-5" />} />
        <StatCard label="Weighted pipeline" value={currencyTotals(analytics?.open_pipeline, 'weighted_value')} icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Win rate" value={analytics?.win_rate ? `${analytics.win_rate}%` : 'Not enough data'} icon={<Target className="h-5 w-5" />} />
        <StatCard label="Overdue deals" value={String(analytics?.overdue ?? 0)} icon={<Target className="h-5 w-5" />} />
      </div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <Select value={selectedPipeline ? String(selectedPipeline.id) : ''} onChange={(event) => updateParams({ pipeline: event.target.value })} className="w-full sm:w-56" aria-label="Pipeline">
            {pipelines?.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
          </Select>
          {view === 'list' && <>
            <SearchInput initialValue={params.get('search') ?? ''} onSearch={(value) => updateParams({ search: value || undefined })} className="w-full sm:w-64" />
            <Select value={params.get('stage') ?? ''} onChange={(event) => updateParams({ stage: event.target.value || undefined })} aria-label="Stage">
              <option value="">All stages</option>{selectedPipeline?.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </Select>
            <Select value={params.get('priority') ?? ''} onChange={(event) => updateParams({ priority: event.target.value || undefined })} aria-label="Priority">
              <option value="">All priorities</option>{(['low', 'medium', 'high', 'critical'] as const).map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
            <Select value={params.get('ordering') ?? '-updated_at'} onChange={(event) => updateParams({ ordering: event.target.value })} aria-label="Sort Deals">
              <option value="-updated_at">Recently updated</option><option value="-value">Amount high to low</option>
              <option value="value">Amount low to high</option><option value="expected_close_date">Expected close</option>
              <option value="title">Deal title</option><option value="-weighted_amount_sort">Weighted value</option>
            </Select>
          </>}
        </div>
        <Tabs value={view} onChange={(value) => updateParams({ view: value })} items={[
          { value: 'board', label: 'Board', icon: <Kanban className="h-4 w-4" /> },
          { value: 'list', label: 'List', icon: <List className="h-4 w-4" /> },
        ]} />
      </div>

      {pipelinesLoading ? <div className="h-80 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" /> : !selectedPipeline ? (
        <Card><EmptyState title="No pipelines yet" description="Create a pipeline in Settings before adding Deals." /></Card>
      ) : view === 'board' ? <DealBoard pipeline={selectedPipeline} onAddDeal={() => setModalOpen(true)} /> : (
        <Card>
          {selected.size > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Select value={bulkStage} onChange={(event) => { setBulkStage(event.target.value); if (event.target.value) bulk.mutate({ operation: 'change_stage', extra: { stage: Number(event.target.value) } }); }} aria-label="Bulk stage" className="h-9">
              <option value="">Move stage</option>{selectedPipeline.stages.filter((stage) => stage.stage_type === 'open' || stage.stage_type === 'on_hold').map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </Select>
            <Select value={bulkPriority} onChange={(event) => { setBulkPriority(event.target.value); if (event.target.value) bulk.mutate({ operation: 'change_priority', extra: { priority: event.target.value } }); }} aria-label="Bulk priority" className="h-9">
              <option value="">Change priority</option>{(['low', 'medium', 'high', 'critical'] as const).map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate({ operation: 'archive' })} loading={bulk.isPending}>Archive</Button>
          </div>}
          <Table columns={columns} rows={deals?.results ?? []} rowKey={(deal) => deal.id} loading={dealsLoading}
            selectedKeys={selected} onSelectionChange={setSelected} rowLabel={(deal) => deal.title}
            onRowClick={(deal) => navigate(`/app/deals/${deal.id}`)}
            emptyState={<EmptyState title={isError ? 'Deals could not be loaded' : 'No deals match this view'} description="Change the filters or create a Deal." />} />
          <Pagination page={page} pageSize={PAGE_SIZE} count={deals?.count ?? 0} onPageChange={(next) => updateParams({ page: String(next) })} />
        </Card>
      )}
      <DealFormModal open={modalOpen} onClose={() => setModalOpen(false)} defaultPipeline={selectedPipeline?.id} />
    </div>
  );
}
