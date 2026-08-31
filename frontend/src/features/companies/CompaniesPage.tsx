import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Building2, Filter, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { companiesApi } from '@/api/contacts';
import { organizationsApi } from '@/api/organizations';
import { CustomerListActions } from '@/components/shared/CustomerListActions';
import { Avatar, Button, Card, EmptyState, Input, PageHeader, Pagination, SearchInput, Select, Table, toast, type Column } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatDate, formatNumber, fullName } from '@/lib/utils';
import type { Company } from '@/types';

import { CompanyFormModal } from './CompanyFormModal';
import { COMPANY_SIZES } from './constants';

const PAGE_SIZE = 20;

export function CompaniesPage() {
  const { t } = useTranslation(['companies', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const page = Math.max(1, Number(params.get('page')) || 1), search = params.get('search') ?? '', size = params.get('size') ?? '', industry = params.get('industry') ?? '', owner = params.get('owner') ?? '', lifecycle = params.get('lifecycle_stage') ?? '', country = params.get('country') ?? '', archived = params.get('archived') ?? 'false', ordering = params.get('ordering') ?? '-created_at';
  const update = (key: string, value: string, reset = true) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); if (reset && key !== 'page') next.delete('page'); return next; });
  const request = { page, page_size: PAGE_SIZE, search: search || undefined, size: size || undefined, industry: industry || undefined, owner: owner || undefined, lifecycle_stage: lifecycle || undefined, country: country || undefined, archived, ordering };
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['companies', request], queryFn: () => companiesApi.list(request), placeholderData: keepPreviousData });
  const { data: members } = useQuery({ queryKey: ['memberships', 'options'], queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }) });
  const bulk = useMutation({ mutationFn: (operation: string) => companiesApi.bulk({ ids: [...selected], operation }), onSuccess: () => { setSelected(new Set()); queryClient.invalidateQueries({ queryKey: ['companies'] }); }, onError: (mutationError) => toast.error(apiErrorMessage(mutationError)) });
  const columns: Column<Company>[] = [
    { key: 'name', header: t('common:labels.name'), render: (company) => <div className="flex items-center gap-3"><Avatar name={company.name} size="sm" /><div><p className="font-medium text-gray-900 dark:text-gray-100">{company.name}</p>{company.domain && <p dir="ltr" className="text-xs text-gray-500 dark:text-gray-400">{company.domain}</p>}</div></div> },
    { key: 'industry', header: t('companies:fields.industry'), render: (company) => company.industry || '—' },
    { key: 'contacts_count', header: t('companies:fields.contactsCount'), render: (company) => formatNumber(company.contacts_count) },
    { key: 'owner', header: t('common:labels.owner'), render: (company) => fullName(company.owner_detail) },
    { key: 'lifecycle', header: t('common:customerCore.lifecycle'), render: (company) => company.lifecycle_stage || '—' },
    { key: 'location', header: t('companies:fields.location'), render: (company) => [company.city, company.country].filter(Boolean).join(', ') || '—' },
    { key: 'created_at', header: t('common:labels.createdAt'), render: (company) => formatDate(company.created_at) },
  ];
  const exportFilters = { search, size, industry, owner, lifecycle_stage: lifecycle, country, archived };
  return <div>
    <PageHeader title={t('companies:title')} subtitle={t('companies:subtitle', { count: data?.count ?? 0 })} actions={<><CustomerListActions target="company" filters={exportFilters} sort={ordering} /><Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" />{t('companies:addCompany')}</Button></>} />
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-800"><SearchInput initialValue={search} onSearch={(value) => update('search', value)} className="w-full sm:w-72" /><Select value={size} onChange={(event) => update('size', event.target.value)} className="w-full sm:w-48"><option value="">{t('common:labels.all')}</option>{COMPANY_SIZES.map((item) => <option key={item} value={item}>{t(`companies:sizes.${item}`)}</option>)}</Select><Button variant="outline" onClick={() => setFiltersOpen((value) => !value)}><Filter className="h-4 w-4" />{filtersOpen ? t('common:customerCore.hideFilters') : t('common:customerCore.advancedFilters')}</Button></div>
      {filtersOpen && <div className="grid grid-cols-1 gap-3 border-b border-gray-200 bg-gray-50/70 p-4 sm:grid-cols-2 lg:grid-cols-3 dark:border-gray-800 dark:bg-gray-900/40"><Input value={industry} onChange={(event) => update('industry', event.target.value)} placeholder={t('companies:fields.industry')} /><Select value={owner} onChange={(event) => update('owner', event.target.value)}><option value="">{t('common:labels.owner')}: {t('common:labels.all')}</option>{members?.results.map((member) => <option key={member.user.id} value={member.user.id}>{fullName(member.user)}</option>)}</Select><Input value={lifecycle} onChange={(event) => update('lifecycle_stage', event.target.value)} placeholder={t('common:customerCore.lifecycle')} /><Input value={country} onChange={(event) => update('country', event.target.value)} placeholder={t('common:labels.country')} /><Select value={archived} onChange={(event) => update('archived', event.target.value)}><option value="false">{t('common:customerCore.activeOnly')}</option><option value="only">{t('common:customerCore.archivedOnly')}</option><option value="all">{t('common:customerCore.includeArchived')}</option></Select><Select value={ordering} onChange={(event) => update('ordering', event.target.value)}><option value="-created_at">{t('common:labels.createdAt')}</option><option value="name">{t('common:labels.name')}</option><option value="-annual_revenue">{t('companies:fields.annualRevenue')}</option></Select></div>}
      {selected.size > 0 && <div className="flex items-center gap-3 border-b border-primary-200 bg-primary-50 px-4 py-3 dark:border-primary-900 dark:bg-primary-500/10"><span className="text-sm font-semibold">{t('common:customerCore.selected', { count: selected.size })}</span><Button size="sm" variant="outline" onClick={() => bulk.mutate(archived === 'only' ? 'restore' : 'archive')}><Archive className="h-4 w-4" />{archived === 'only' ? t('common:customerCore.bulkRestore') : t('common:customerCore.bulkArchive')}</Button></div>}
      {isError ? <div className="p-8 text-center text-sm text-red-600 dark:text-red-400">{apiErrorMessage(error)}</div> : <Table columns={columns} rows={data?.results ?? []} rowKey={(company) => company.id} rowLabel={(company) => company.name} loading={isLoading} selectedKeys={selected} onSelectionChange={setSelected} onRowClick={(company) => navigate(`/app/companies/${company.id}`)} emptyState={<EmptyState icon={<Building2 className="h-5 w-5" />} title={search ? t('common:state.noResults') : t('common:state.empty')} description={search ? undefined : t('common:customerCore.emptyCompanies')} action={search ? undefined : <Button size="sm" onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" />{t('companies:addCompany')}</Button>} />} />}
      <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={(value) => update('page', String(value), false)} />
    </Card><CompanyFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
  </div>;
}
