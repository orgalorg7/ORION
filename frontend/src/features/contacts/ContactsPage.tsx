import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Contact2, Filter, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { contactsApi } from '@/api/contacts';
import { organizationsApi } from '@/api/organizations';
import { CustomerListActions } from '@/components/shared/CustomerListActions';
import { Avatar, Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, SearchInput, Select, Table, toast, type Column } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatDate, fullName } from '@/lib/utils';
import type { Contact } from '@/types';

import { ContactFormModal } from './ContactFormModal';

const PAGE_SIZE = 20;

export function ContactsPage() {
  const { t } = useTranslation(['contacts', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('search') ?? '';
  const active = params.get('is_active') ?? '';
  const owner = params.get('owner') ?? '';
  const lifecycle = params.get('lifecycle_stage') ?? '';
  const archived = params.get('archived') ?? 'false';
  const ordering = params.get('ordering') ?? '-created_at';
  const update = (key: string, value: string, reset = true) => setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); if (reset && key !== 'page') next.delete('page'); return next; });
  const request = { page, page_size: PAGE_SIZE, search: search || undefined, is_active: active || undefined, owner: owner || undefined, lifecycle_stage: lifecycle || undefined, archived, ordering };
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['contacts', request], queryFn: () => contactsApi.list(request), placeholderData: keepPreviousData });
  const { data: members } = useQuery({ queryKey: ['memberships', 'options'], queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }) });
  const bulk = useMutation({ mutationFn: (operation: string) => contactsApi.bulk({ ids: [...selected], operation }), onSuccess: () => { setSelected(new Set()); queryClient.invalidateQueries({ queryKey: ['contacts'] }); }, onError: (mutationError) => toast.error(apiErrorMessage(mutationError)) });
  const columns: Column<Contact>[] = [
    { key: 'name', header: t('common:labels.name'), render: (contact) => <div className="flex items-center gap-3"><Avatar name={fullName(contact)} size="sm" /><div><p className="font-medium text-gray-900 dark:text-gray-100">{fullName(contact)}</p>{contact.job_title && <p className="text-xs text-gray-500 dark:text-gray-400">{contact.job_title}</p>}</div></div> },
    { key: 'company', header: t('contacts:fields.company'), render: (contact) => contact.company_detail?.name ?? '—' },
    { key: 'email', header: t('common:labels.email'), render: (contact) => <span dir="ltr">{contact.email || '—'}</span> },
    { key: 'phone', header: t('common:labels.phone'), render: (contact) => <span dir="ltr">{contact.phone || '—'}</span> },
    { key: 'owner', header: t('common:labels.owner'), render: (contact) => fullName(contact.owner_detail) },
    { key: 'lifecycle', header: t('common:customerCore.lifecycle'), render: (contact) => contact.lifecycle_stage || '—' },
    { key: 'status', header: t('common:labels.status'), render: (contact) => <Badge color={contact.is_active ? 'green' : 'gray'}>{t(`contacts:status.${contact.is_active ? 'active' : 'inactive'}`)}</Badge> },
    { key: 'created_at', header: t('common:labels.createdAt'), render: (contact) => formatDate(contact.created_at) },
  ];
  const exportFilters = { search, is_active: active, owner, lifecycle_stage: lifecycle, archived };
  return <div>
    <PageHeader title={t('contacts:title')} subtitle={t('contacts:subtitle', { count: data?.count ?? 0 })} actions={<><CustomerListActions target="contact" filters={exportFilters} sort={ordering} /><Button onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" />{t('contacts:addContact')}</Button></>} />
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 dark:border-gray-800">
        <SearchInput initialValue={search} onSearch={(value) => update('search', value)} className="w-full sm:w-72" />
        <Select value={active} onChange={(event) => update('is_active', event.target.value)} className="w-full sm:w-40"><option value="">{t('common:labels.all')}</option><option value="true">{t('contacts:status.active')}</option><option value="false">{t('contacts:status.inactive')}</option></Select>
        <Button variant="outline" onClick={() => setFiltersOpen((value) => !value)}><Filter className="h-4 w-4" />{filtersOpen ? t('common:customerCore.hideFilters') : t('common:customerCore.advancedFilters')}</Button>
      </div>
      {filtersOpen && <div className="grid grid-cols-1 gap-3 border-b border-gray-200 bg-gray-50/70 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-gray-800 dark:bg-gray-900/40"><Select value={owner} onChange={(event) => update('owner', event.target.value)}><option value="">{t('common:labels.owner')}: {t('common:labels.all')}</option>{members?.results.map((member) => <option key={member.user.id} value={member.user.id}>{fullName(member.user)}</option>)}</Select><Input value={lifecycle} onChange={(event) => update('lifecycle_stage', event.target.value)} placeholder={t('common:customerCore.lifecycle')} /><Select value={archived} onChange={(event) => update('archived', event.target.value)}><option value="false">{t('common:customerCore.activeOnly')}</option><option value="only">{t('common:customerCore.archivedOnly')}</option><option value="all">{t('common:customerCore.includeArchived')}</option></Select><Select value={ordering} onChange={(event) => update('ordering', event.target.value)}><option value="-created_at">{t('common:labels.createdAt')}</option><option value="display_name">{t('common:labels.name')}</option><option value="company">{t('contacts:fields.company')}</option></Select></div>}
      {selected.size > 0 && <div className="flex items-center gap-3 border-b border-primary-200 bg-primary-50 px-4 py-3 dark:border-primary-900 dark:bg-primary-500/10"><span className="text-sm font-semibold">{t('common:customerCore.selected', { count: selected.size })}</span><Button size="sm" variant="outline" onClick={() => bulk.mutate(archived === 'only' ? 'restore' : 'archive')}><Archive className="h-4 w-4" />{archived === 'only' ? t('common:customerCore.bulkRestore') : t('common:customerCore.bulkArchive')}</Button></div>}
      {isError ? <div className="p-8 text-center text-sm text-red-600 dark:text-red-400">{apiErrorMessage(error)}</div> : <Table columns={columns} rows={data?.results ?? []} rowKey={(contact) => contact.id} rowLabel={fullName} loading={isLoading} selectedKeys={selected} onSelectionChange={setSelected} onRowClick={(contact) => navigate(`/app/contacts/${contact.id}`)} emptyState={<EmptyState icon={<Contact2 className="h-5 w-5" />} title={search ? t('common:state.noResults') : t('common:state.empty')} description={search ? undefined : t('common:customerCore.emptyContacts')} action={search ? undefined : <Button size="sm" onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" />{t('contacts:addContact')}</Button>} />} />}
      <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={(value) => update('page', String(value), false)} />
    </Card>
    <ContactFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
  </div>;
}
