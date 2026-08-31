import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Columns3, Filter, Plus, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { customerCoreApi } from '@/api/customerCore';
import { leadsApi } from '@/api/leads';
import { organizationsApi } from '@/api/organizations';
import { CustomerListActions } from '@/components/shared/CustomerListActions';
import {
  Avatar, Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, SearchInput, Select, Table,
  toast, type Column,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatDate, fullName } from '@/lib/utils';
import type { Lead } from '@/types';

import { LeadFormModal } from './LeadFormModal';
import { LEAD_STATUSES, LEAD_STATUS_COLORS, ScoreBar } from './leadShared';

const PAGE_SIZE = 20;
const DEFAULT_COLUMNS = ['name', 'company_name', 'email', 'phone', 'source', 'score', 'status', 'owner', 'created_at'];

export function LeadsPage() {
  const { t } = useTranslation(['leads', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(DEFAULT_COLUMNS));
  const [selected, setSelected] = useState<Set<string | number>>(new Set());

  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const statusFilter = params.get('status') ?? '';
  const sourceFilter = params.get('source') ?? '';
  const ownerFilter = params.get('owner') ?? '';
  const scoreMin = params.get('scoreMin') ?? '';
  const scoreMax = params.get('scoreMax') ?? '';
  const archived = params.get('archived') ?? 'false';
  const ordering = params.get('ordering') ?? '-created_at';

  const updateParam = (key: string, value: string, resetPage = true) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value); else next.delete(key);
      if (resetPage && key !== 'page') next.delete('page');
      return next;
    });
  };

  const requestParams = {
    page, page_size: PAGE_SIZE, search: search || undefined, status: statusFilter || undefined,
    source: sourceFilter || undefined, owner: ownerFilter || undefined, score_min: scoreMin || undefined,
    score_max: scoreMax || undefined, archived, ordering,
  };
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['leads', requestParams],
    queryFn: () => leadsApi.list(requestParams),
    placeholderData: keepPreviousData,
  });
  const { data: sources } = useQuery({ queryKey: ['lead-sources'], queryFn: () => customerCoreApi.sources({ active: true, page_size: 100 }) });
  const { data: members } = useQuery({ queryKey: ['memberships', 'options'], queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }) });

  const bulkMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => leadsApi.bulk({ ids: [...selected], ...payload }),
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (mutationError) => toast.error(apiErrorMessage(mutationError)),
  });

  const allColumns: Column<Lead>[] = useMemo(() => [
    { key: 'name', header: t('common:labels.name'), render: (lead) => <div className="flex items-center gap-3"><Avatar name={fullName(lead)} size="sm" /><div><p className="font-medium text-gray-900 dark:text-gray-100">{fullName(lead)}</p>{lead.job_title && <p className="text-xs text-gray-500 dark:text-gray-400">{lead.job_title}</p>}</div></div> },
    { key: 'company_name', header: t('leads:fields.companyName'), render: (lead) => lead.company_detail?.name || lead.company_name || '—' },
    { key: 'email', header: t('common:labels.email'), render: (lead) => <span dir="ltr">{lead.email || '—'}</span> },
    { key: 'phone', header: t('common:labels.phone'), render: (lead) => <span dir="ltr">{lead.phone || '—'}</span> },
    { key: 'source', header: t('common:labels.source'), render: (lead) => lead.source_detail?.label || lead.source || '—' },
    { key: 'score', header: t('leads:fields.score'), render: (lead) => <ScoreBar score={lead.score} /> },
    { key: 'status', header: t('common:labels.status'), render: (lead) => <Badge color={LEAD_STATUS_COLORS[lead.status]}>{t(`leads:statuses.${lead.status}`)}</Badge> },
    { key: 'owner', header: t('common:labels.owner'), render: (lead) => fullName(lead.owner_detail) },
    { key: 'created_at', header: t('common:labels.createdAt'), render: (lead) => <span className="text-gray-500 dark:text-gray-400">{formatDate(lead.created_at)}</span> },
  ], [t]);
  const columns = allColumns.filter((column) => visibleColumns.has(column.key));
  const exportFilters = { search, status: statusFilter, source: sourceFilter, owner: ownerFilter, archived, score_min: scoreMin, score_max: scoreMax };

  return (
    <div>
      <PageHeader
        title={t('leads:title')}
        subtitle={t('leads:subtitle', { count: data?.count ?? 0 })}
        actions={<><CustomerListActions target="lead" filters={exportFilters} sort={ordering} /><Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" />{t('leads:addLead')}</Button></>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-800">
          <SearchInput initialValue={search} onSearch={(term) => updateParam('search', term)} className="w-full sm:w-72" />
          <Select value={statusFilter} onChange={(event) => updateParam('status', event.target.value)} className="w-full sm:w-40">
            <option value="">{t('common:labels.all')}</option>{LEAD_STATUSES.map((item) => <option key={item} value={item}>{t(`leads:statuses.${item}`)}</option>)}
          </Select>
          <Select value={sourceFilter} onChange={(event) => updateParam('source', event.target.value)} className="w-full sm:w-40">
            <option value="">{t('common:labels.all')}</option>{sources?.results.map((item) => <option key={item.id} value={item.key}>{item.label}</option>)}
          </Select>
          <Button variant="outline" onClick={() => setFiltersOpen((current) => !current)}><Filter className="h-4 w-4" />{filtersOpen ? t('common:customerCore.hideFilters') : t('common:customerCore.advancedFilters')}</Button>
          <div className="relative">
            <Button variant="outline" onClick={() => setColumnsOpen((current) => !current)}><Columns3 className="h-4 w-4" />{t('common:customerCore.columns')}</Button>
            {columnsOpen && <div className="absolute end-0 z-20 mt-2 w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900">{allColumns.map((column) => <label key={column.key} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"><input type="checkbox" checked={visibleColumns.has(column.key)} onChange={(event) => setVisibleColumns((current) => { const next = new Set(current); if (event.target.checked) next.add(column.key); else if (next.size > 1) next.delete(column.key); return next; })} />{column.header}</label>)}</div>}
          </div>
        </div>
        {filtersOpen && <div className="grid grid-cols-1 gap-3 border-b border-gray-200 bg-gray-50/70 p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-gray-800 dark:bg-gray-900/40">
          <Select value={ownerFilter} onChange={(event) => updateParam('owner', event.target.value)}><option value="">{t('common:labels.owner')}: {t('common:labels.all')}</option>{members?.results.map((member) => <option key={member.user.id} value={member.user.id}>{fullName(member.user)}</option>)}</Select>
          <Input type="number" min="0" value={scoreMin} onChange={(event) => updateParam('scoreMin', event.target.value)} placeholder={t('common:customerCore.scoreMin')} />
          <Input type="number" min="0" value={scoreMax} onChange={(event) => updateParam('scoreMax', event.target.value)} placeholder={t('common:customerCore.scoreMax')} />
          <Select value={archived} onChange={(event) => updateParam('archived', event.target.value)}><option value="false">{t('common:customerCore.activeOnly')}</option><option value="only">{t('common:customerCore.archivedOnly')}</option><option value="all">{t('common:customerCore.includeArchived')}</option></Select>
          <Select value={ordering} onChange={(event) => updateParam('ordering', event.target.value)}><option value="-created_at">{t('common:labels.createdAt')}</option><option value="-score">{t('leads:fields.score')}</option><option value="display_name">{t('common:labels.name')}</option><option value="-estimated_value">{t('leads:fields.estimatedValue')}</option></Select>
        </div>}
        {selected.size > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-primary-200 bg-primary-50 px-4 py-3 dark:border-primary-900 dark:bg-primary-500/10"><span className="me-2 text-sm font-semibold">{t('common:customerCore.selected', { count: selected.size })}</span><Select className="w-40" defaultValue="" onChange={(event) => event.target.value && bulkMutation.mutate({ operation: 'change_status', value: event.target.value })}><option value="">{t('common:customerCore.bulkStatus')}</option>{LEAD_STATUSES.filter((item) => item !== 'converted').map((item) => <option key={item} value={item}>{t(`leads:statuses.${item}`)}</option>)}</Select><Button size="sm" variant="outline" onClick={() => bulkMutation.mutate({ operation: archived === 'only' ? 'restore' : 'archive' })}><Archive className="h-4 w-4" />{archived === 'only' ? t('common:customerCore.bulkRestore') : t('common:customerCore.bulkArchive')}</Button></div>}
        {isError ? <div className="p-8 text-center"><p className="text-sm text-red-600 dark:text-red-400">{apiErrorMessage(error)}</p><Button className="mt-3" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['leads'] })}>{t('common:actions.retry')}</Button></div> : <Table columns={columns} rows={data?.results ?? []} rowKey={(lead) => lead.id} rowLabel={fullName} loading={isLoading} selectedKeys={selected} onSelectionChange={setSelected} onRowClick={(lead) => navigate(`/app/leads/${lead.id}`)} emptyState={<EmptyState icon={<Target className="h-5 w-5" />} title={search ? t('common:state.noResults') : t('common:state.empty')} description={search ? undefined : t('common:customerCore.emptyLeads')} action={search ? undefined : <div className="flex gap-2"><Button size="sm" onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" />{t('leads:addLead')}</Button></div>} />} />}
        <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={(next) => updateParam('page', String(next), false)} />
      </Card>
      <LeadFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
