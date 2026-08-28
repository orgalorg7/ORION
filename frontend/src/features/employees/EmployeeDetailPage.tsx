import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { employeesApi } from '@/api/employees';
import {
  Avatar,
  BackIcon,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Spinner,
  Table,
  toast,
  type Column,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatCurrency, formatDate, fullName } from '@/lib/utils';
import { useActiveMembership } from '@/stores/auth';
import type { Employee } from '@/types';

import { EmployeeFormModal } from './EmployeeFormModal';
import { STATUS_COLORS } from './constants';

function DetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd dir="auto" className="text-end text-sm font-medium text-gray-900 dark:text-gray-100">{value ?? '—'}</dd>
    </div>
  );
}

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const employeeId = Number(id);
  const { t } = useTranslation(['employees', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const membership = useActiveMembership();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: employee, isLoading, isError } = useQuery({
    queryKey: ['employees', employeeId],
    queryFn: () => employeesApi.get(employeeId),
    enabled: Number.isFinite(employeeId),
  });

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ['employees', { manager: employeeId }],
    queryFn: () => employeesApi.list({ manager: employeeId, page_size: 100 }),
    enabled: Number.isFinite(employeeId),
  });

  const deleteMutation = useMutation({
    mutationFn: () => employeesApi.remove(employeeId),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      navigate('/app/employees');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const reportColumns: Column<Employee>[] = [
    {
      key: 'name',
      header: t('common:labels.name'),
      render: (report) => (
        <div className="flex items-center gap-3">
          <Avatar name={fullName(report)} size="sm" />
          <p className="font-medium text-gray-900 dark:text-gray-100">{fullName(report)}</p>
        </div>
      ),
    },
    {
      key: 'job_title',
      header: t('employees:fields.jobTitle'),
      render: (report) => report.job_title || '—',
    },
    {
      key: 'status',
      header: t('common:labels.status'),
      render: (report) => (
        <Badge color={STATUS_COLORS[report.status]}>{t(`employees:statuses.${report.status}`)}</Badge>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8 text-primary-600" />
      </div>
    );
  }

  if (isError || !employee) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/app/employees"
            aria-label={t('common:accessibility.backToList')}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <BackIcon className="h-5 w-5" />
          </Link>
          <Avatar name={fullName(employee)} size="lg" />
          <div>
            <h1 dir="auto" className="text-start text-xl font-bold text-gray-900 dark:text-gray-50">{fullName(employee)}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {[employee.job_title, employee.department_detail?.name].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            {t('common:actions.edit')}
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />
            {t('common:actions.delete')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('common:labels.details')} />
            <CardBody className="py-2">
              <dl className="divide-y divide-gray-100 dark:divide-gray-800">
                <DetailRow
                  label={t('common:labels.email')}
                  value={employee.email ? <span dir="ltr">{employee.email}</span> : '—'}
                />
                <DetailRow
                  label={t('common:labels.phone')}
                  value={employee.phone ? <span dir="ltr">{employee.phone}</span> : '—'}
                />
                <DetailRow
                  label={t('employees:fields.department')}
                  value={employee.department_detail?.name ?? '—'}
                />
                <DetailRow
                  label={t('employees:fields.employmentType')}
                  value={t(`employees:types.${employee.employment_type}`)}
                />
                <DetailRow
                  label={t('common:labels.status')}
                  value={
                    <Badge color={STATUS_COLORS[employee.status]}>
                      {t(`employees:statuses.${employee.status}`)}
                    </Badge>
                  }
                />
                <DetailRow
                  label={t('employees:fields.hireDate')}
                  value={formatDate(employee.hire_date)}
                />
                <DetailRow
                  label={t('employees:fields.salary')}
                  value={formatCurrency(employee.salary, membership?.organization.currency)}
                />
                <DetailRow
                  label={t('employees:fields.manager')}
                  value={
                    employee.manager_detail ? (
                      <Link
                        to={`/app/employees/${employee.manager_detail.id}`}
                        className="text-primary-600 hover:underline dark:text-primary-400"
                      >
                        {fullName(employee.manager_detail)}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailRow
                  label={t('employees:fields.linkedAccount')}
                  value={employee.user_detail ? fullName(employee.user_detail) : '—'}
                />
                <DetailRow
                  label={t('common:labels.city')}
                  value={[employee.city, employee.country].filter(Boolean).join(', ') || '—'}
                />
                <DetailRow
                  label={t('common:labels.createdAt')}
                  value={formatDate(employee.created_at)}
                />
              </dl>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title={t('employees:detail.directReports')}
              subtitle={t('employees:detail.directReportsCount', { count: reports?.count ?? 0 })}
            />
            <Table
              columns={reportColumns}
              rows={reports?.results ?? []}
              rowKey={(report) => report.id}
              loading={reportsLoading}
              onRowClick={(report) => navigate(`/app/employees/${report.id}`)}
              emptyState={
                <EmptyState
                  icon={<Users className="h-5 w-5" />}
                  title={t('employees:detail.noReports')}
                  description={t('employees:detail.noReportsHint')}
                />
              }
            />
          </Card>
        </div>
      </div>

      <EmployeeFormModal open={editOpen} onClose={() => setEditOpen(false)} employee={employee} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmDelete.title', { item: fullName(employee) })}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />
    </div>
  );
}
