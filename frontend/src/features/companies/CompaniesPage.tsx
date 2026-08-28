import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { companiesApi } from '@/api/contacts';
import {
  Avatar,
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
import { formatCurrency, formatDate, formatNumber, fullName } from '@/lib/utils';
import type { Company } from '@/types';

import { CompanyFormModal } from './CompanyFormModal';
import { COMPANY_SIZES } from './constants';

const PAGE_SIZE = 20;

export function CompaniesPage() {
  const { t } = useTranslation(['companies', 'common']);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['companies', { page, search, sizeFilter }],
    queryFn: () =>
      companiesApi.list({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        size: sizeFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Company>[] = [
    {
      key: 'name',
      header: t('common:labels.name'),
      render: (company) => (
        <div className="flex items-center gap-3">
          <Avatar name={company.name} size="sm" />
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">{company.name}</p>
            {company.domain && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                <span dir="ltr">{company.domain}</span>
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'industry',
      header: t('companies:fields.industry'),
      render: (company) => company.industry || '—',
    },
    {
      key: 'location',
      header: t('companies:fields.location'),
      render: (company) => [company.city, company.country].filter(Boolean).join(', ') || '—',
    },
    {
      key: 'contacts_count',
      header: t('companies:fields.contactsCount'),
      render: (company) => (
        <span className="text-gray-600 dark:text-gray-300">{formatNumber(company.contacts_count)}</span>
      ),
    },
    {
      key: 'owner',
      header: t('common:labels.owner'),
      render: (company) => fullName(company.owner_detail),
    },
    {
      key: 'annual_revenue',
      header: t('companies:fields.annualRevenue'),
      render: (company) => (
        <span className="text-gray-600 dark:text-gray-300">{formatCurrency(company.annual_revenue)}</span>
      ),
    },
    {
      key: 'created_at',
      header: t('common:labels.createdAt'),
      render: (company) => (
        <span className="text-gray-500 dark:text-gray-400">{formatDate(company.created_at)}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('companies:title')}
        subtitle={t('companies:subtitle', { count: data?.count ?? 0 })}
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('companies:addCompany')}
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
            value={sizeFilter}
            onChange={(event) => {
              setSizeFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-52"
          >
            <option value="">{t('common:labels.all')}</option>
            {COMPANY_SIZES.map((size) => (
              <option key={size} value={size}>
                {t(`companies:sizes.${size}`)}
              </option>
            ))}
          </Select>
        </div>

        <Table
          columns={columns}
          rows={data?.results ?? []}
          rowKey={(company) => company.id}
          loading={isLoading}
          onRowClick={(company) => navigate(`/app/companies/${company.id}`)}
          emptyState={
            <EmptyState
              icon={<Building2 className="h-5 w-5" />}
              title={search ? t('common:state.noResults') : t('common:state.empty')}
              description={search ? undefined : t('common:state.emptyHint')}
              action={
                search ? undefined : (
                  <Button size="sm" onClick={() => setModalOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('companies:addCompany')}
                  </Button>
                )
              }
            />
          }
        />

        <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={setPage} />
      </Card>

      <CompanyFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
