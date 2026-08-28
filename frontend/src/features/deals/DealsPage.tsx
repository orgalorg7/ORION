import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Kanban, Plus, Trophy, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { dealsApi, pipelinesApi } from '@/api/deals';
import {
  Card,
  Button,
  EmptyState,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  Tabs,
  type Column,
  type TabItem,
} from '@/components/ui';
import { formatCurrency, formatDate, fullName } from '@/lib/utils';
import type { Deal } from '@/types';

import { DealBoard } from './DealBoard';
import { DealFormModal } from './DealFormModal';

const PAGE_SIZE = 20;

function ClosedDealsTable({ status, pipeline }: { status: 'won' | 'lost'; pipeline: number }) {
  const { t } = useTranslation(['deals', 'common']);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['deals', 'closed', { status, pipeline, page }],
    queryFn: () => dealsApi.list({ status, pipeline, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Deal>[] = [
    {
      key: 'title',
      header: t('deals:fields.title'),
      render: (deal) => (
        <span className="font-medium text-gray-900 dark:text-gray-100">{deal.title}</span>
      ),
    },
    {
      key: 'value',
      header: t('deals:fields.value'),
      render: (deal) => (
        <span className="font-medium text-gray-700 dark:text-gray-300">
          {formatCurrency(deal.value, deal.currency)}
        </span>
      ),
    },
    {
      key: 'contact',
      header: t('deals:fields.contact'),
      render: (deal) => (deal.contact_detail ? fullName(deal.contact_detail) : '—'),
    },
    {
      key: 'company',
      header: t('deals:fields.company'),
      render: (deal) => deal.company_detail?.name ?? '—',
    },
    {
      key: 'closed_at',
      header: t('deals:fields.closedAt'),
      render: (deal) => (
        <span className="text-gray-500 dark:text-gray-400">{formatDate(deal.closed_at)}</span>
      ),
    },
    ...(status === 'lost'
      ? [
          {
            key: 'lost_reason',
            header: t('deals:fields.lostReason'),
            render: (deal: Deal) => deal.lost_reason || '—',
          } satisfies Column<Deal>,
        ]
      : []),
  ];

  return (
    <Card>
      <Table
        columns={columns}
        rows={data?.results ?? []}
        rowKey={(deal) => deal.id}
        loading={isLoading}
        onRowClick={(deal) => navigate(`/app/deals/${deal.id}`)}
        emptyState={
          <EmptyState
            icon={status === 'won' ? <Trophy className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            title={t(`deals:empty.${status}`)}
            description={t('common:state.emptyHint')}
          />
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={setPage} />
    </Card>
  );
}

export function DealsPage() {
  const { t } = useTranslation(['deals', 'common']);
  const [pipelineId, setPipelineId] = useState('');
  const [tab, setTab] = useState('board');
  const [modalOpen, setModalOpen] = useState(false);

  const { data: pipelines, isLoading: pipelinesLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list(),
  });

  const selectedPipeline = useMemo(() => {
    if (!pipelines?.length) return undefined;
    return (
      pipelines.find((pipeline) => String(pipeline.id) === pipelineId) ??
      pipelines.find((pipeline) => pipeline.is_default) ??
      pipelines[0]
    );
  }, [pipelines, pipelineId]);

  const tabs: TabItem[] = [
    { value: 'board', label: t('deals:tabs.board'), icon: <Kanban className="h-4 w-4" /> },
    { value: 'won', label: t('deals:tabs.won'), icon: <Trophy className="h-4 w-4" /> },
    { value: 'lost', label: t('deals:tabs.lost'), icon: <XCircle className="h-4 w-4" /> },
  ];

  return (
    <div>
      <PageHeader
        title={t('deals:title')}
        subtitle={t('deals:subtitle')}
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('deals:addDeal')}
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select
          value={selectedPipeline ? String(selectedPipeline.id) : ''}
          onChange={(event) => setPipelineId(event.target.value)}
          className="w-full sm:w-64"
          aria-label={t('deals:fields.pipeline')}
        >
          {pipelines?.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </Select>
        <Tabs items={tabs} value={tab} onChange={setTab} />
      </div>

      {pipelinesLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-primary-600" />
        </div>
      ) : !selectedPipeline ? (
        <Card>
          <EmptyState
            icon={<Kanban className="h-5 w-5" />}
            title={t('deals:board.noPipelines')}
            description={t('deals:board.noPipelinesHint')}
          />
        </Card>
      ) : tab === 'board' ? (
        <DealBoard pipeline={selectedPipeline} onAddDeal={() => setModalOpen(true)} />
      ) : (
        <ClosedDealsTable
          key={`${tab}-${selectedPipeline.id}`}
          status={tab as 'won' | 'lost'}
          pipeline={selectedPipeline.id}
        />
      )}

      <DealFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultPipeline={selectedPipeline?.id}
      />
    </div>
  );
}
