import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, RotateCcw, Trash2, Trophy, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { dealsApi, pipelinesApi } from '@/api/deals';
import { ActivitiesPanel } from '@/components/shared/ActivitiesPanel';
import { NotesPanel } from '@/components/shared/NotesPanel';
import {
  Badge,
  BackIcon,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FormField,
  Modal,
  Select,
  Spinner,
  Textarea,
  toast,
  type BadgeColor,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, fullName } from '@/lib/utils';
import type { DealStatus } from '@/types';

import { DealFormModal } from './DealFormModal';

const STATUS_COLORS: Record<DealStatus, BadgeColor> = {
  open: 'blue',
  won: 'green',
  lost: 'red',
};

function DetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd dir="auto" className="text-end text-sm font-medium text-gray-900 dark:text-gray-100">{value ?? '—'}</dd>
    </div>
  );
}

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dealId = Number(id);
  const { t } = useTranslation(['deals', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');

  const { data: deal, isLoading, isError } = useQuery({
    queryKey: ['deals', dealId],
    queryFn: () => dealsApi.get(dealId),
    enabled: Number.isFinite(dealId),
  });

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list(),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['deals'] });

  const wonMutation = useMutation({
    mutationFn: () => dealsApi.markWon(dealId),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const lostMutation = useMutation({
    mutationFn: () => dealsApi.markLost(dealId, lostReason),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      setLostOpen(false);
      setLostReason('');
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const reopenMutation = useMutation({
    mutationFn: () => dealsApi.reopen(dealId),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const moveMutation = useMutation({
    mutationFn: (stage: number) => dealsApi.move(dealId, stage),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => dealsApi.remove(dealId),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      invalidate();
      navigate('/app/deals');
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

  if (isError || !deal) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  const pipeline = pipelines?.find((item) => item.id === deal.pipeline);
  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/app/deals"
            aria-label={t('common:accessibility.backToList')}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <BackIcon className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 dir="auto" className="text-start text-xl font-bold text-gray-900 dark:text-gray-50">{deal.title}</h1>
              <Badge color={STATUS_COLORS[deal.status]}>{t(`deals:status.${deal.status}`)}</Badge>
            </div>
            <p className="mt-1 text-lg font-semibold text-primary-600 dark:text-primary-400">
              {formatCurrency(deal.value, deal.currency)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {deal.status === 'open' ? (
            <>
              <Button onClick={() => wonMutation.mutate()} loading={wonMutation.isPending}>
                <Trophy className="h-4 w-4" />
                {t('deals:actions.markWon')}
              </Button>
              <Button variant="danger" onClick={() => setLostOpen(true)}>
                <XCircle className="h-4 w-4" />
                {t('deals:actions.markLost')}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => reopenMutation.mutate()}
              loading={reopenMutation.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              {t('deals:actions.reopen')}
            </Button>
          )}
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
                <DetailRow label={t('deals:fields.pipeline')} value={pipeline?.name ?? '—'} />
                <DetailRow
                  label={t('deals:fields.stage')}
                  value={
                    deal.status === 'open' && stages.length > 0 ? (
                      <Select
                        value={deal.stage !== null ? String(deal.stage) : ''}
                        onChange={(event) => {
                          if (event.target.value) moveMutation.mutate(Number(event.target.value));
                        }}
                        disabled={moveMutation.isPending}
                        className="w-44"
                        aria-label={t('deals:fields.stage')}
                      >
                        <option value="">{t('common:labels.notSet')}</option>
                        {stages.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      deal.stage_detail?.name ?? '—'
                    )
                  }
                />
                <DetailRow
                  label={t('deals:fields.contact')}
                  value={
                    deal.contact_detail ? (
                      <Link
                        to={`/app/contacts/${deal.contact_detail.id}`}
                        className="text-primary-600 hover:underline dark:text-primary-400"
                      >
                        {fullName(deal.contact_detail)}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailRow
                  label={t('deals:fields.company')}
                  value={
                    deal.company_detail ? (
                      <Link
                        to={`/app/companies/${deal.company_detail.id}`}
                        className="text-primary-600 hover:underline dark:text-primary-400"
                      >
                        {deal.company_detail.name}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailRow label={t('common:labels.owner')} value={fullName(deal.owner_detail)} />
                <DetailRow
                  label={t('deals:fields.expectedCloseDate')}
                  value={formatDate(deal.expected_close_date)}
                />
                {deal.closed_at && (
                  <DetailRow label={t('deals:fields.closedAt')} value={formatDateTime(deal.closed_at)} />
                )}
                {deal.status === 'lost' && (
                  <DetailRow label={t('deals:fields.lostReason')} value={deal.lost_reason || '—'} />
                )}
                <DetailRow label={t('common:labels.createdAt')} value={formatDate(deal.created_at)} />
              </dl>
              {deal.description && (
                <p dir="auto" className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-start text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                  {deal.description}
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <ActivitiesPanel related={{ deal: dealId }} />
          <NotesPanel related={{ deal: dealId }} />
        </div>
      </div>

      <DealFormModal open={editOpen} onClose={() => setEditOpen(false)} deal={deal} />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmDelete.title', { item: deal.title })}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />

      <Modal
        open={lostOpen}
        onClose={() => setLostOpen(false)}
        title={t('deals:lostModal.title')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setLostOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => lostMutation.mutate()}
              loading={lostMutation.isPending}
            >
              {t('deals:actions.markLost')}
            </Button>
          </>
        }
      >
        <FormField label={t('deals:fields.lostReason')}>
          <Textarea
            value={lostReason}
            onChange={(event) => setLostReason(event.target.value)}
            placeholder={t('deals:lostModal.reasonPlaceholder')}
            autoFocus
          />
        </FormField>
      </Modal>
    </div>
  );
}
