import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Ticket as TicketIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ticketsApi } from '@/api/tickets';
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
import { formatDate, formatNumber, fullName } from '@/lib/utils';
import type { Ticket } from '@/types';

import { PRIORITY_COLORS, STATUS_COLORS, TICKET_PRIORITIES, TICKET_STATUSES } from './constants';
import { TicketFormModal } from './TicketFormModal';

const PAGE_SIZE = 20;

export function TicketsPage() {
  const { t } = useTranslation(['tickets', 'common']);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tickets', { page, search, statusFilter, priorityFilter }],
    queryFn: () =>
      ticketsApi.list({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Ticket>[] = [
    {
      key: 'number',
      header: t('tickets:fields.number'),
      render: (ticket) => (
        <span dir="ltr" className="font-mono text-xs text-gray-500 dark:text-gray-400">
          {`#${ticket.number}`}
        </span>
      ),
    },
    {
      key: 'subject',
      header: t('tickets:fields.subject'),
      render: (ticket) => (
        <div>
          <p className="font-medium text-gray-900 dark:text-gray-100">{ticket.subject}</p>
          <Badge color="gray" className="mt-1">
            {t(`tickets:categories.${ticket.category}`)}
          </Badge>
        </div>
      ),
    },
    {
      key: 'contact',
      header: t('tickets:fields.contact'),
      render: (ticket) =>
        ticket.contact_detail ? (
          fullName(ticket.contact_detail)
        ) : (
          <span className="text-gray-500 dark:text-gray-400">—</span>
        ),
    },
    {
      key: 'priority',
      header: t('tickets:fields.priority'),
      render: (ticket) => (
        <Badge color={PRIORITY_COLORS[ticket.priority]}>
          {t(`tickets:priorities.${ticket.priority}`)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('common:labels.status'),
      render: (ticket) => (
        <Badge color={STATUS_COLORS[ticket.status]}>{t(`tickets:statuses.${ticket.status}`)}</Badge>
      ),
    },
    {
      key: 'assigned_to',
      header: t('common:labels.assignedTo'),
      render: (ticket) =>
        ticket.assigned_to_detail ? (
          <div className="flex items-center gap-2">
            <Avatar name={fullName(ticket.assigned_to_detail)} size="sm" />
            <span className="text-gray-700 dark:text-gray-300">
              {fullName(ticket.assigned_to_detail)}
            </span>
          </div>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">{t('tickets:fields.unassigned')}</span>
        ),
    },
    {
      key: 'comments_count',
      header: t('tickets:fields.comments'),
      render: (ticket) => (
        <span className="text-gray-500 dark:text-gray-400">{formatNumber(ticket.comments_count)}</span>
      ),
    },
    {
      key: 'created_at',
      header: t('common:labels.createdAt'),
      render: (ticket) => (
        <span className="text-gray-500 dark:text-gray-400">{formatDate(ticket.created_at)}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('tickets:title')}
        subtitle={t('tickets:subtitle', { count: data?.count ?? 0 })}
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('tickets:addTicket')}
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
            <option value="">{t('tickets:filters.allStatuses')}</option>
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`tickets:statuses.${status}`)}
              </option>
            ))}
          </Select>
          <Select
            value={priorityFilter}
            onChange={(event) => {
              setPriorityFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="">{t('tickets:filters.allPriorities')}</option>
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`tickets:priorities.${priority}`)}
              </option>
            ))}
          </Select>
        </div>

        <Table
          columns={columns}
          rows={data?.results ?? []}
          rowKey={(ticket) => ticket.id}
          loading={isLoading}
          onRowClick={(ticket) => navigate(`/app/tickets/${ticket.id}`)}
          emptyState={
            <EmptyState
              icon={<TicketIcon className="h-5 w-5" />}
              title={
                search || statusFilter || priorityFilter
                  ? t('common:state.noResults')
                  : t('common:state.empty')
              }
              description={
                search || statusFilter || priorityFilter ? undefined : t('common:state.emptyHint')
              }
              action={
                search || statusFilter || priorityFilter ? undefined : (
                  <Button size="sm" onClick={() => setModalOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('tickets:addTicket')}
                  </Button>
                )
              }
            />
          }
        />

        <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={setPage} />
      </Card>

      <TicketFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
