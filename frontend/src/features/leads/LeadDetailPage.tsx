import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CheckCircle2, Pencil, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { leadsApi } from '@/api/leads';
import { ActivitiesPanel } from '@/components/shared/ActivitiesPanel';
import { NotesPanel } from '@/components/shared/NotesPanel';
import { TimelinePanel } from '@/components/shared/TimelinePanel';
import { CustomFieldsSummary } from '@/components/shared/CustomFieldsEditor';
import { TagManager } from '@/components/shared/TagManager';
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
  ForwardUpIcon,
  Select,
  Spinner,
  toast,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { useActiveMembership } from '@/stores/auth';
import { formatCurrency, formatDate, fullName } from '@/lib/utils';
import type { LeadStatus } from '@/types';

import { ConvertLeadModal } from './ConvertLeadModal';
import { LeadFormModal } from './LeadFormModal';
import { EDITABLE_LEAD_STATUSES, LEAD_STATUS_COLORS, ScoreBar } from './leadShared';

function DetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd dir="auto" className="text-end text-sm font-medium text-gray-900 dark:text-gray-100">{value ?? '—'}</dd>
    </div>
  );
}

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const leadId = Number(id);
  const { t } = useTranslation(['leads', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currency = useActiveMembership()?.organization.currency || 'USD';
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const { data: lead, isLoading, isError } = useQuery({
    queryKey: ['leads', leadId],
    queryFn: () => leadsApi.get(leadId),
    enabled: Number.isFinite(leadId),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (lead?.archived_at) await leadsApi.restore(leadId);
      else await leadsApi.remove(leadId);
    },
    onSuccess: () => {
      toast.success(t(lead?.archived_at ? 'common:toast.restored' : 'common:toast.archived'));
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      if (!lead?.archived_at) navigate('/app/leads');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const statusMutation = useMutation({
    mutationFn: (status: LeadStatus) => leadsApi.update(leadId, { status }),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      queryClient.invalidateQueries({ queryKey: ['leads'] });
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

  if (isError || !lead) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  const isConverted = lead.status === 'converted';

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/app/leads"
            aria-label={t('common:accessibility.backToList')}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <BackIcon className="h-5 w-5" />
          </Link>
          <Avatar name={fullName(lead)} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 dir="auto" className="text-start text-xl font-bold text-gray-900 dark:text-gray-50">{fullName(lead)}</h1>
              <Badge color={LEAD_STATUS_COLORS[lead.status]}>{t(`leads:statuses.${lead.status}`)}</Badge>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {[lead.company_name, lead.job_title].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isConverted && !lead.archived_at && (
            <Button onClick={() => setConvertOpen(true)}>
              <ForwardUpIcon className="h-4 w-4" />
              {t('leads:convert.action')}
            </Button>
          )}
          {!lead.archived_at && <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            {t('common:actions.edit')}
          </Button>}
          <Button variant={lead.archived_at ? 'outline' : 'danger'} onClick={() => lead.archived_at ? deleteMutation.mutate() : setDeleteOpen(true)}>
            {lead.archived_at ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            {t(lead.archived_at ? 'common:actions.restore' : 'common:actions.archive')}
          </Button>
        </div>
      </div>

      {isConverted && (
        <Card className="mb-6 border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <CardBody className="flex flex-wrap items-center gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm text-emerald-800 dark:text-emerald-200">
              {t('leads:converted.banner', { date: formatDate(lead.converted_at) })}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {lead.converted_contact !== null && (
                <Link
                  to={`/app/contacts/${lead.converted_contact}`}
                  className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                >
                  {t('leads:converted.viewContact')}
                </Link>
              )}
              {lead.converted_deal !== null && (
                <Link
                  to={`/app/deals/${lead.converted_deal}`}
                  className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                >
                  {t('leads:converted.viewDeal')}
                </Link>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('common:labels.details')} />
            <CardBody className="py-2">
              <dl className="divide-y divide-gray-100 dark:divide-gray-800">
                <DetailRow
                  label={t('common:labels.email')}
                  value={lead.email ? <span dir="ltr">{lead.email}</span> : '—'}
                />
                <DetailRow
                  label={t('common:labels.phone')}
                  value={lead.phone ? <span dir="ltr">{lead.phone}</span> : '—'}
                />
                <DetailRow label={t('leads:fields.companyName')} value={lead.company_name || '—'} />
                <DetailRow
                  label={t('common:labels.source')}
                  value={lead.source_detail?.label || lead.source || '—'}
                />
                <DetailRow label={t('leads:fields.score')} value={<ScoreBar score={lead.score} />} />
                <DetailRow
                  label={t('leads:fields.estimatedValue')}
                  value={formatCurrency(lead.estimated_value, currency)}
                />
                <DetailRow label={t('common:labels.owner')} value={fullName(lead.owner_detail)} />
                <DetailRow
                  label={t('common:labels.status')}
                  value={
                    <Select
                      value={lead.status}
                      onChange={(event) => statusMutation.mutate(event.target.value as LeadStatus)}
                      disabled={isConverted || Boolean(lead.archived_at) || statusMutation.isPending}
                      className="w-40 py-1.5 text-sm"
                    >
                      {EDITABLE_LEAD_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {t(`leads:statuses.${status}`)}
                        </option>
                      ))}
                      {isConverted && (
                        <option value="converted">{t('leads:statuses.converted')}</option>
                      )}
                    </Select>
                  }
                />
                <DetailRow label={t('common:labels.createdAt')} value={formatDate(lead.created_at)} />
              </dl>
              {lead.description && (
                <p dir="auto" className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-start text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                  {lead.description}
                </p>
              )}
            </CardBody>
          </Card>
          <CustomFieldsSummary values={lead.custom_fields} />
          <TagManager type="lead" id={leadId} tags={lead.tags_detail} readOnly={Boolean(lead.archived_at)} />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <ActivitiesPanel related={{ lead: leadId }} readOnly={Boolean(lead.archived_at)} />
          <NotesPanel related={{ lead: leadId }} readOnly={Boolean(lead.archived_at)} />
          <TimelinePanel type="lead" id={leadId} />
        </div>
      </div>

      <LeadFormModal open={editOpen} onClose={() => setEditOpen(false)} lead={lead} />
      <ConvertLeadModal open={convertOpen} onClose={() => setConvertOpen(false)} lead={lead} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmArchive.title', { item: fullName(lead) })}
        message={t('common:confirmArchive.message')}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.archive')}
        danger={false}
      />
    </div>
  );
}
