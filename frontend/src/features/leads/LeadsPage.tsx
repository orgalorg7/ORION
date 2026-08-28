import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { leadsApi } from '@/api/leads';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  type Column,
} from '@/components/ui';
import { useActiveMembership } from '@/stores/auth';
import { formatCurrency, formatDate, fullName } from '@/lib/utils';
import type { Lead } from '@/types';

import { LeadFormModal } from './LeadFormModal';
import { LEAD_SOURCES, LEAD_STATUSES, LEAD_STATUS_COLORS, ScoreBar } from './leadShared';

const PAGE_SIZE = 20;

export function LeadsPage() {
  const { t } = useTranslation(['leads', 'common']);
  const navigate = useNavigate();
  const currency = useActiveMembership()?.organization.currency || 'USD';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', { page, search, statusFilter, sourceFilter }],
    queryFn: () =>
      leadsApi.list({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        status: statusFilter || undefined,
        source: sourceFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Lead>[] = [
    {
      key: 'name',
      header: t('common:labels.name'),
      render: (lead) => (
        <div className="flex items-center gap-3">
          <Avatar name={fullName(lead)} size="sm" />
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">{fullName(lead)}</p>
            {lead.job_title && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{lead.job_title}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'company_name',
      header: t('leads:fields.companyName'),
      render: (lead) => lead.company_name || '—',
    },
    {
      key: 'email',
      header: t('common:labels.email'),
      render: (lead) => (
        <span dir="ltr" className="text-gray-600 dark:text-gray-300">
          {lead.email || '—'}
        </span>
      ),
    },
    {
      key: 'source',
      header: t('common:labels.source'),
      render: (lead) => (lead.source ? t(`common:sources.${lead.source}`) : '—'),
    },
    {
      key: 'status',
      header: t('common:labels.status'),
      render: (lead) => (
        <Badge color={LEAD_STATUS_COLORS[lead.status]}>{t(`leads:statuses.${lead.status}`)}</Badge>
      ),
    },
    {
      key: 'score',
      header: t('leads:fields.score'),
      render: (lead) => <ScoreBar score={lead.score} />,
    },
    {
      key: 'estimated_value',
      header: t('leads:fields.estimatedValue'),
      render: (lead) => (
        <span className="text-gray-600 dark:text-gray-300">
          {formatCurrency(lead.estimated_value, currency)}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: t('common:labels.createdAt'),
      render: (lead) => (
        <span className="text-gray-500 dark:text-gray-400">{formatDate(lead.created_at)}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('leads:title')}
        subtitle={t('leads:subtitle', { count: data?.count ?? 0 })}
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('leads:addLead')}
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-800">
          <SearchInput
            onSearch={(term) => {
              setSearch(term);
              setPage(1);
            }}
            className="w-full sm:w-72"
          />
          <Select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="">{t('common:labels.all')}</option>
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`leads:statuses.${status}`)}
              </option>
            ))}
          </Select>
          <Select
            value={sourceFilter}
            onChange={(event) => {
              setSourceFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="">{t('common:labels.all')}</option>
            {LEAD_SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`common:sources.${source}`)}
              </option>
            ))}
          </Select>
        </div>

        <Table
          columns={columns}
          rows={data?.results ?? []}
          rowKey={(lead) => lead.id}
          loading={isLoading}
          onRowClick={(lead) => navigate(`/app/leads/${lead.id}`)}
          emptyState={
            <EmptyState
              icon={<Target className="h-5 w-5" />}
              title={search ? t('common:state.noResults') : t('common:state.empty')}
              description={search ? undefined : t('common:state.emptyHint')}
              action={
                search ? undefined : (
                  <Button size="sm" onClick={() => setModalOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('leads:addLead')}
                  </Button>
                )
              }
            />
          }
        />

        <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={setPage} />
      </Card>

      <LeadFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
