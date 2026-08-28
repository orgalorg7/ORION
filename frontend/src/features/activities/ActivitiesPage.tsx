import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Mail, Pencil, Phone, Plus, Trash2, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { activitiesApi } from '@/api/activities';
import type { ListParams } from '@/api/contacts';
import { organizationsApi } from '@/api/organizations';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  Tabs,
  toast,
  type Column,
  type TabItem,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { cn, formatDateTime, fullName } from '@/lib/utils';
import type { Activity, ActivityType } from '@/types';

import { ActivityFormModal } from './ActivityFormModal';

const PAGE_SIZE = 20;

const ACTIVITY_TYPES: ActivityType[] = ['task', 'call', 'email', 'meeting'];

const typeIcons: Record<ActivityType, ReactNode> = {
  call: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  meeting: <Users className="h-4 w-4" />,
  task: <CalendarCheck className="h-4 w-4" />,
};

type TabValue = 'upcoming' | 'overdue' | 'completed' | 'all';

function RelatedLink({ activity }: { activity: Activity }) {
  const linkClasses = 'text-primary-600 hover:underline dark:text-primary-400';
  if (activity.contact_detail) {
    return (
      <Link to={`/app/contacts/${activity.contact_detail.id}`} className={linkClasses}>
        {fullName(activity.contact_detail)}
      </Link>
    );
  }
  if (activity.company_detail) {
    return (
      <Link to={`/app/companies/${activity.company_detail.id}`} className={linkClasses}>
        {activity.company_detail.name}
      </Link>
    );
  }
  if (activity.deal_detail) {
    return (
      <Link to={`/app/deals/${activity.deal_detail.id}`} className={linkClasses}>
        {activity.deal_detail.title}
      </Link>
    );
  }
  if (activity.lead_detail) {
    return (
      <Link to={`/app/leads/${activity.lead_detail.id}`} className={linkClasses}>
        {fullName(activity.lead_detail)}
      </Link>
    );
  }
  return <span className="text-gray-400 dark:text-gray-500">—</span>;
}

export function ActivitiesPage() {
  const { t } = useTranslation(['activities', 'common']);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabValue>('upcoming');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Activity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null);

  // Recomputed only when the tab changes so the query key stays stable across renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- changing tabs intentionally refreshes the time boundary
  const nowISO = useMemo(() => new Date().toISOString(), [tab]);

  const tabParams: Record<TabValue, ListParams> = {
    upcoming: { completed: 'false', due_after: nowISO, ordering: 'due_at' },
    overdue: { completed: 'false', due_before: nowISO, ordering: 'due_at' },
    completed: { completed: 'true', ordering: '-completed_at' },
    all: { ordering: 'due_at' },
  };

  const { data, isLoading } = useQuery({
    queryKey: ['activities', 'list', { tab, nowISO, page, search, typeFilter, assignedFilter }],
    queryFn: () =>
      activitiesApi.list({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        type: typeFilter || undefined,
        assigned_to: assignedFilter || undefined,
        ...tabParams[tab],
      }),
    placeholderData: keepPreviousData,
  });

  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['activities'] });

  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) =>
      activitiesApi.complete(id, completed),
    onSuccess: invalidate,
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => activitiesApi.remove(id),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const tabs: TabItem[] = [
    { value: 'upcoming', label: t('activities:tabs.upcoming') },
    { value: 'overdue', label: t('activities:tabs.overdue') },
    { value: 'completed', label: t('activities:tabs.completed') },
    { value: 'all', label: t('common:labels.all') },
  ];

  const columns: Column<Activity>[] = [
    {
      key: 'completed',
      header: '',
      className: 'w-10',
      render: (activity) => (
        <Checkbox
          checked={activity.completed}
          onChange={(event) =>
            toggleMutation.mutate({ id: activity.id, completed: event.target.checked })
          }
          aria-label={t('common:activitiesPanel.completed')}
        />
      ),
    },
    {
      key: 'type',
      header: t('activities:fields.type'),
      render: (activity) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              activity.completed
                ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                : 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400',
            )}
          >
            {typeIcons[activity.type]}
          </span>
          <span className="text-gray-600 dark:text-gray-300">
            {t(`common:activitiesPanel.types.${activity.type}`)}
          </span>
        </div>
      ),
    },
    {
      key: 'title',
      header: t('activities:fields.title'),
      render: (activity) => (
        <div className="min-w-0">
          <p
            dir="auto"
            className={cn(
              'text-start font-medium',
              activity.completed
                ? 'text-gray-400 line-through dark:text-gray-500'
                : 'text-gray-900 dark:text-gray-100',
            )}
          >
            {activity.title}
          </p>
          {activity.description && (
            <p dir="auto" className="max-w-xs truncate text-start text-xs text-gray-500 dark:text-gray-400">
              {activity.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'related',
      header: t('activities:fields.related'),
      render: (activity) => <RelatedLink activity={activity} />,
    },
    {
      key: 'assigned_to',
      header: t('common:labels.assignedTo'),
      render: (activity) =>
        activity.assigned_to_detail ? (
          <div className="flex items-center gap-2">
            <Avatar name={fullName(activity.assigned_to_detail)} size="sm" />
            <span className="text-gray-700 dark:text-gray-300">
              {fullName(activity.assigned_to_detail)}
            </span>
          </div>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">—</span>
        ),
    },
    {
      key: 'due_at',
      header: t('common:activitiesPanel.dueAt'),
      render: (activity) => {
        const overdue =
          !!activity.due_at &&
          !activity.completed &&
          new Date(activity.due_at).getTime() < Date.now();
        return (
          <span
            className={cn(
              overdue
                ? 'font-medium text-red-600 dark:text-red-400'
                : 'text-gray-500 dark:text-gray-400',
            )}
          >
            {formatDateTime(activity.due_at)}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      className: 'w-24',
      render: (activity) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="px-2"
            onClick={() => setEditTarget(activity)}
            title={t('common:actions.edit')}
            aria-label={t('common:actions.edit')}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="px-2 hover:text-red-600 dark:hover:text-red-400"
            onClick={() => setDeleteTarget(activity)}
            title={t('common:actions.delete')}
            aria-label={t('common:actions.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('activities:title')}
        subtitle={t('activities:subtitle', { count: data?.count ?? 0 })}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('common:activitiesPanel.add')}
          </Button>
        }
      />

      <Card>
        <Tabs
          items={tabs}
          value={tab}
          onChange={(value) => {
            setTab(value as TabValue);
            setPage(1);
          }}
          className="px-4"
        />

        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-800">
          <SearchInput
            onSearch={(term) => {
              setSearch(term);
              setPage(1);
            }}
            className="w-full sm:w-72"
          />
          <Select
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="">{t('activities:filters.allTypes')}</option>
            {ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`common:activitiesPanel.types.${type}`)}
              </option>
            ))}
          </Select>
          <Select
            value={assignedFilter}
            onChange={(event) => {
              setAssignedFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-52"
          >
            <option value="">{t('activities:filters.allMembers')}</option>
            {members?.results.map((member) => (
              <option key={member.id} value={member.user.id}>
                {fullName(member.user) === '—' ? member.user.email : fullName(member.user)}
              </option>
            ))}
          </Select>
        </div>

        <Table
          columns={columns}
          rows={data?.results ?? []}
          rowKey={(activity) => activity.id}
          loading={isLoading}
          emptyState={
            <EmptyState
              icon={<CalendarCheck className="h-5 w-5" />}
              title={search ? t('common:state.noResults') : t('common:activitiesPanel.empty')}
              description={search ? undefined : t('common:state.emptyHint')}
              action={
                search ? undefined : (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('common:activitiesPanel.add')}
                  </Button>
                )
              }
            />
          }
        />

        <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={setPage} />
      </Card>

      <ActivityFormModal
        open={createOpen || !!editTarget}
        onClose={() => {
          setCreateOpen(false);
          setEditTarget(null);
        }}
        activity={editTarget}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title={t('common:confirmDelete.title', { item: deleteTarget?.title ?? '' })}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />
    </div>
  );
}
