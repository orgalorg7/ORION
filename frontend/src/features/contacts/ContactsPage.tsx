import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Contact2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { contactsApi } from '@/api/contacts';
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
import { formatDate, fullName } from '@/lib/utils';
import type { Contact } from '@/types';

import { ContactFormModal } from './ContactFormModal';

const PAGE_SIZE = 20;

export function ContactsPage() {
  const { t } = useTranslation(['contacts', 'common']);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', { page, search, activeFilter }],
    queryFn: () =>
      contactsApi.list({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        is_active: activeFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: t('common:labels.name'),
      render: (contact) => (
        <div className="flex items-center gap-3">
          <Avatar name={fullName(contact)} size="sm" />
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">{fullName(contact)}</p>
            {contact.job_title && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{contact.job_title}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: t('common:labels.email'),
      render: (contact) => (
        <span dir="ltr" className="text-gray-600 dark:text-gray-300">
          {contact.email || '—'}
        </span>
      ),
    },
    {
      key: 'company',
      header: t('contacts:fields.company'),
      render: (contact) => contact.company_detail?.name ?? '—',
    },
    {
      key: 'tags',
      header: t('common:labels.tags'),
      render: (contact) => (
        <div className="flex flex-wrap gap-1">
          {contact.tags_detail.length === 0
            ? '—'
            : contact.tags_detail.slice(0, 3).map((tag) => (
                <Badge key={tag.id} color="indigo">
                  {tag.name}
                </Badge>
              ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('common:labels.status'),
      render: (contact) =>
        contact.is_active ? (
          <Badge color="green">{t('contacts:status.active')}</Badge>
        ) : (
          <Badge color="gray">{t('contacts:status.inactive')}</Badge>
        ),
    },
    {
      key: 'created_at',
      header: t('common:labels.createdAt'),
      render: (contact) => (
        <span className="text-gray-500 dark:text-gray-400">{formatDate(contact.created_at)}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('contacts:title')}
        subtitle={t('contacts:subtitle', { count: data?.count ?? 0 })}
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('contacts:addContact')}
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
            value={activeFilter}
            onChange={(event) => {
              setActiveFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="">{t('common:labels.all')}</option>
            <option value="true">{t('contacts:status.active')}</option>
            <option value="false">{t('contacts:status.inactive')}</option>
          </Select>
        </div>

        <Table
          columns={columns}
          rows={data?.results ?? []}
          rowKey={(contact) => contact.id}
          loading={isLoading}
          onRowClick={(contact) => navigate(`/app/contacts/${contact.id}`)}
          emptyState={
            <EmptyState
              icon={<Contact2 className="h-5 w-5" />}
              title={search ? t('common:state.noResults') : t('common:state.empty')}
              description={search ? undefined : t('common:state.emptyHint')}
              action={
                search ? undefined : (
                  <Button size="sm" onClick={() => setModalOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('contacts:addContact')}
                  </Button>
                )
              }
            />
          }
        />

        <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={setPage} />
      </Card>

      <ContactFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
