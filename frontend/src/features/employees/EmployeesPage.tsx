import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { departmentsApi, employeesApi } from '@/api/employees';
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
import type { Employee } from '@/types';

import { DepartmentsModal } from './DepartmentsModal';
import { EmployeeFormModal } from './EmployeeFormModal';
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, STATUS_COLORS } from './constants';

const PAGE_SIZE = 20;

export function EmployeesPage() {
  const { t } = useTranslation(['employees', 'common']);
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', { page, search, departmentFilter, statusFilter, typeFilter }],
    queryFn: () =>
      employeesApi.list({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        department: departmentFilter || undefined,
        status: statusFilter || undefined,
        employment_type: typeFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.list(),
  });

  const hasFilters = Boolean(search || departmentFilter || statusFilter || typeFilter);

  const columns: Column<Employee>[] = [
    {
      key: 'name',
      header: t('common:labels.name'),
      render: (employee) => (
        <div className="flex items-center gap-3">
          <Avatar name={fullName(employee)} size="sm" />
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">{fullName(employee)}</p>
            {employee.job_title && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{employee.job_title}</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'department',
      header: t('employees:fields.department'),
      render: (employee) => employee.department_detail?.name ?? '—',
    },
    {
      key: 'email',
      header: t('common:labels.email'),
      render: (employee) => (
        <span dir="ltr" className="text-gray-600 dark:text-gray-300">
          {employee.email || '—'}
        </span>
      ),
    },
    {
      key: 'phone',
      header: t('common:labels.phone'),
      render: (employee) => (
        <span dir="ltr" className="text-gray-600 dark:text-gray-300">
          {employee.phone || '—'}
        </span>
      ),
    },
    {
      key: 'employment_type',
      header: t('employees:fields.employmentType'),
      render: (employee) => (
        <Badge color="indigo">{t(`employees:types.${employee.employment_type}`)}</Badge>
      ),
    },
    {
      key: 'status',
      header: t('common:labels.status'),
      render: (employee) => (
        <Badge color={STATUS_COLORS[employee.status]}>
          {t(`employees:statuses.${employee.status}`)}
        </Badge>
      ),
    },
    {
      key: 'hire_date',
      header: t('employees:fields.hireDate'),
      render: (employee) => (
        <span className="text-gray-500 dark:text-gray-400">{formatDate(employee.hire_date)}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('employees:title')}
        subtitle={t('employees:subtitle', { count: data?.count ?? 0 })}
        actions={
          <>
            <Button variant="outline" onClick={() => setDepartmentsOpen(true)}>
              <Building2 className="h-4 w-4" />
              {t('employees:departments')}
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('employees:addEmployee')}
            </Button>
          </>
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
            value={departmentFilter}
            onChange={(event) => {
              setDepartmentFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="">{t('employees:allDepartments')}</option>
            {departments?.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="">{t('common:labels.all')}</option>
            {EMPLOYEE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`employees:statuses.${status}`)}
              </option>
            ))}
          </Select>
          <Select
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
          >
            <option value="">{t('employees:allTypes')}</option>
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`employees:types.${type}`)}
              </option>
            ))}
          </Select>
        </div>

        <Table
          columns={columns}
          rows={data?.results ?? []}
          rowKey={(employee) => employee.id}
          loading={isLoading}
          onRowClick={(employee) => navigate(`/app/employees/${employee.id}`)}
          emptyState={
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title={hasFilters ? t('common:state.noResults') : t('common:state.empty')}
              description={hasFilters ? undefined : t('common:state.emptyHint')}
              action={
                hasFilters ? undefined : (
                  <Button size="sm" onClick={() => setFormOpen(true)}>
                    <Plus className="h-4 w-4" />
                    {t('employees:addEmployee')}
                  </Button>
                )
              }
            />
          }
        />

        <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={setPage} />
      </Card>

      <EmployeeFormModal open={formOpen} onClose={() => setFormOpen(false)} />
      <DepartmentsModal open={departmentsOpen} onClose={() => setDepartmentsOpen(false)} />
    </div>
  );
}
