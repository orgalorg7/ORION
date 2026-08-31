import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Contact2, Pencil, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { companiesApi, contactsApi } from '@/api/contacts';
import { ActivitiesPanel } from '@/components/shared/ActivitiesPanel';
import { NotesPanel } from '@/components/shared/NotesPanel';
import { TimelinePanel } from '@/components/shared/TimelinePanel';
import { CustomFieldsSummary } from '@/components/shared/CustomFieldsEditor';
import { TagManager } from '@/components/shared/TagManager';
import {
  Avatar,
  BackIcon,
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
import type { Contact } from '@/types';

import { CompanyFormModal } from './CompanyFormModal';
import { isKnownCompanySize } from './constants';

function DetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd dir="auto" className="text-end text-sm font-medium text-gray-900 dark:text-gray-100">{value ?? '—'}</dd>
    </div>
  );
}

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const companyId = Number(id);
  const { t } = useTranslation(['companies', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: company, isLoading, isError } = useQuery({
    queryKey: ['companies', companyId],
    queryFn: () => companiesApi.get(companyId),
    enabled: Number.isFinite(companyId),
  });

  const { data: contacts, isLoading: contactsLoading } = useQuery({
    queryKey: ['contacts', { company: companyId }],
    queryFn: () => contactsApi.list({ company: companyId, page_size: 50 }),
    enabled: Number.isFinite(companyId),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (company?.archived_at) await companiesApi.restore(companyId);
      else await companiesApi.remove(companyId);
    },
    onSuccess: () => {
      toast.success(t(company?.archived_at ? 'common:toast.restored' : 'common:toast.archived'));
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      if (!company?.archived_at) navigate('/app/companies');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8 text-primary-600" />
      </div>
    );
  }

  if (isError || !company) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  const websiteHref = company.website
    ? company.website.startsWith('http')
      ? company.website
      : `https://${company.website}`
    : null;

  const contactColumns: Column<Contact>[] = [
    {
      key: 'name',
      header: t('common:labels.name'),
      render: (contact) => (
        <div className="flex items-center gap-3">
          <Avatar name={fullName(contact)} size="sm" />
          <p className="font-medium text-gray-900 dark:text-gray-100">{fullName(contact)}</p>
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
      key: 'job_title',
      header: t('companies:fields.jobTitle'),
      render: (contact) => contact.job_title || '—',
    },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/app/companies"
            aria-label={t('common:accessibility.backToList')}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <BackIcon className="h-5 w-5" />
          </Link>
          <Avatar name={company.name} size="lg" />
          <div>
            <h1 dir="auto" className="text-start text-xl font-bold text-gray-900 dark:text-gray-50">{company.name}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {[company.industry, company.city].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!company.archived_at && <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            {t('common:actions.edit')}
          </Button>}
          <Button variant={company.archived_at ? 'outline' : 'danger'} onClick={() => company.archived_at ? deleteMutation.mutate() : setDeleteOpen(true)}>
            {company.archived_at ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {t(company.archived_at ? 'common:actions.restore' : 'common:actions.archive')}
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
                  label={t('companies:fields.website')}
                  value={
                    websiteHref ? (
                      <a
                        href={websiteHref}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                        className="text-primary-600 hover:underline dark:text-primary-400"
                      >
                        {company.website}
                      </a>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailRow
                  label={t('companies:fields.domain')}
                  value={company.domain ? <span dir="ltr">{company.domain}</span> : '—'}
                />
                <DetailRow
                  label={t('common:labels.email')}
                  value={company.email ? <span dir="ltr">{company.email}</span> : '—'}
                />
                <DetailRow
                  label={t('common:labels.phone')}
                  value={company.phone ? <span dir="ltr">{company.phone}</span> : '—'}
                />
                <DetailRow
                  label={t('companies:fields.size')}
                  value={
                    company.size
                      ? isKnownCompanySize(company.size)
                        ? t(`companies:sizes.${company.size}`)
                        : company.size
                      : '—'
                  }
                />
                <DetailRow
                  label={t('companies:fields.industry')}
                  value={company.industry || '—'}
                />
                <DetailRow
                  label={t('companies:fields.annualRevenue')}
                  value={formatCurrency(company.annual_revenue)}
                />
                <DetailRow label={t('common:labels.owner')} value={fullName(company.owner_detail)} />
                <DetailRow
                  label={t('common:labels.address')}
                  value={
                    [company.address, company.city, company.country].filter(Boolean).join(', ') || '—'
                  }
                />
                <DetailRow label={t('common:labels.createdAt')} value={formatDate(company.created_at)} />
              </dl>
              {company.description && (
                <p dir="auto" className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-start text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                  {company.description}
                </p>
              )}
            </CardBody>
          </Card>
          <CustomFieldsSummary values={company.custom_fields} />
          <TagManager type="company" id={companyId} tags={company.tags_detail} readOnly={Boolean(company.archived_at)} />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t('companies:detail.contacts')} />
            <Table
              columns={contactColumns}
              rows={contacts?.results ?? []}
              rowKey={(contact) => contact.id}
              loading={contactsLoading}
              onRowClick={(contact) => navigate(`/app/contacts/${contact.id}`)}
              emptyState={
                <EmptyState
                  icon={<Contact2 className="h-5 w-5" />}
                  title={t('companies:detail.noContacts')}
                />
              }
            />
          </Card>
          <ActivitiesPanel related={{ company: companyId }} readOnly={Boolean(company.archived_at)} />
          <NotesPanel related={{ company: companyId }} readOnly={Boolean(company.archived_at)} />
          <TimelinePanel type="company" id={companyId} />
        </div>
      </div>

      <CompanyFormModal open={editOpen} onClose={() => setEditOpen(false)} company={company} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmArchive.title', { item: company.name })}
        message={t('common:confirmArchive.message')}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.archive')}
        danger={false}
      />
    </div>
  );
}
