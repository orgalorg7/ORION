import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { contactsApi } from '@/api/contacts';
import { ActivitiesPanel } from '@/components/shared/ActivitiesPanel';
import { NotesPanel } from '@/components/shared/NotesPanel';
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
  toast,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatDate, fullName } from '@/lib/utils';

import { ContactFormModal } from './ContactFormModal';

function DetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd dir="auto" className="text-end text-sm font-medium text-gray-900 dark:text-gray-100">{value ?? '—'}</dd>
    </div>
  );
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const contactId = Number(id);
  const { t } = useTranslation(['contacts', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: contact, isLoading, isError } = useQuery({
    queryKey: ['contacts', contactId],
    queryFn: () => contactsApi.get(contactId),
    enabled: Number.isFinite(contactId),
  });

  const deleteMutation = useMutation({
    mutationFn: () => contactsApi.remove(contactId),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      navigate('/app/contacts');
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

  if (isError || !contact) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/app/contacts"
            aria-label={t('common:accessibility.backToList')}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <BackIcon className="h-5 w-5" />
          </Link>
          <Avatar name={fullName(contact)} size="lg" />
          <div>
            <h1 dir="auto" className="text-start text-xl font-bold text-gray-900 dark:text-gray-50">{fullName(contact)}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {[contact.job_title, contact.company_detail?.name].filter(Boolean).join(' · ') || '—'}
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
                  value={contact.email ? <span dir="ltr">{contact.email}</span> : '—'}
                />
                <DetailRow
                  label={t('common:labels.phone')}
                  value={contact.phone ? <span dir="ltr">{contact.phone}</span> : '—'}
                />
                <DetailRow
                  label={t('contacts:fields.company')}
                  value={
                    contact.company_detail ? (
                      <Link
                        to={`/app/companies/${contact.company_detail.id}`}
                        className="text-primary-600 hover:underline dark:text-primary-400"
                      >
                        {contact.company_detail.name}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailRow label={t('common:labels.owner')} value={fullName(contact.owner_detail)} />
                <DetailRow
                  label={t('common:labels.source')}
                  value={contact.source ? t(`common:sources.${contact.source}`) : '—'}
                />
                <DetailRow
                  label={t('common:labels.city')}
                  value={[contact.city, contact.country].filter(Boolean).join(', ') || '—'}
                />
                <DetailRow
                  label={t('common:labels.status')}
                  value={
                    contact.is_active ? (
                      <Badge color="green">{t('contacts:status.active')}</Badge>
                    ) : (
                      <Badge color="gray">{t('contacts:status.inactive')}</Badge>
                    )
                  }
                />
                <DetailRow label={t('common:labels.createdAt')} value={formatDate(contact.created_at)} />
              </dl>
              {contact.description && (
                <p dir="auto" className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-start text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                  {contact.description}
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <ActivitiesPanel related={{ contact: contactId }} />
          <NotesPanel related={{ contact: contactId }} />
        </div>
      </div>

      <ContactFormModal open={editOpen} onClose={() => setEditOpen(false)} contact={contact} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmDelete.title', { item: fullName(contact) })}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />
    </div>
  );
}
