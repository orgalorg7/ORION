import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ticketsApi } from '@/api/tickets';
import {
  Avatar,
  BackIcon,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Select,
  Spinner,
  Textarea,
  toast,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { formatDateTime, fullName } from '@/lib/utils';
import type { Ticket, TicketPriority, TicketStatus } from '@/types';

import { PRIORITY_COLORS, STATUS_COLORS, TICKET_PRIORITIES, TICKET_STATUSES } from './constants';
import { TicketFormModal } from './TicketFormModal';

function DetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd dir="auto" className="text-end text-sm font-medium text-gray-900 dark:text-gray-100">{value ?? '—'}</dd>
    </div>
  );
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = Number(id);
  const { t } = useTranslation(['tickets', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);

  const { data: ticket, isLoading, isError } = useQuery({
    queryKey: ['tickets', ticketId],
    queryFn: () => ticketsApi.get(ticketId),
    enabled: Number.isFinite(ticketId),
  });

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ['tickets', ticketId, 'comments'],
    queryFn: () => ticketsApi.comments(ticketId),
    enabled: Number.isFinite(ticketId),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<Ticket>) => ticketsApi.update(ticketId, payload),
    onSuccess: () => {
      toast.success(t('common:toast.saved'));
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => ticketsApi.remove(ticketId),
    onSuccess: () => {
      toast.success(t('common:toast.deleted'));
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate('/app/tickets');
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const commentMutation = useMutation({
    mutationFn: () => ticketsApi.addComment(ticketId, { body: commentBody, is_internal: commentInternal }),
    onSuccess: () => {
      setCommentBody('');
      setCommentInternal(false);
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId, 'comments'] });
      queryClient.invalidateQueries({ queryKey: ['tickets', ticketId] });
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

  if (isError || !ticket) {
    return <EmptyState title={t('common:state.notFound')} />;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/app/tickets"
            aria-label={t('common:accessibility.backToList')}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <BackIcon className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span dir="ltr" className="font-mono text-sm text-gray-500 dark:text-gray-400">
                {`#${ticket.number}`}
              </span>
              <h1 dir="auto" className="text-start text-xl font-bold text-gray-900 dark:text-gray-50">
                {ticket.subject}
              </h1>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge color={STATUS_COLORS[ticket.status]}>
                {t(`tickets:statuses.${ticket.status}`)}
              </Badge>
              <Badge color={PRIORITY_COLORS[ticket.priority]}>
                {t(`tickets:priorities.${ticket.priority}`)}
              </Badge>
            </div>
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
                  label={t('common:labels.status')}
                  value={
                    <Select
                      value={ticket.status}
                      onChange={(event) =>
                        updateMutation.mutate({ status: event.target.value as TicketStatus })
                      }
                      disabled={updateMutation.isPending}
                      className="w-40 py-1.5"
                    >
                      {TICKET_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {t(`tickets:statuses.${status}`)}
                        </option>
                      ))}
                    </Select>
                  }
                />
                <DetailRow
                  label={t('tickets:fields.priority')}
                  value={
                    <Select
                      value={ticket.priority}
                      onChange={(event) =>
                        updateMutation.mutate({ priority: event.target.value as TicketPriority })
                      }
                      disabled={updateMutation.isPending}
                      className="w-40 py-1.5"
                    >
                      {TICKET_PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>
                          {t(`tickets:priorities.${priority}`)}
                        </option>
                      ))}
                    </Select>
                  }
                />
                <DetailRow
                  label={t('tickets:fields.category')}
                  value={t(`tickets:categories.${ticket.category}`)}
                />
                <DetailRow
                  label={t('tickets:fields.contact')}
                  value={
                    ticket.contact_detail ? (
                      <Link
                        to={`/app/contacts/${ticket.contact_detail.id}`}
                        className="text-primary-600 hover:underline dark:text-primary-400"
                      >
                        {fullName(ticket.contact_detail)}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <DetailRow
                  label={t('common:labels.assignedTo')}
                  value={
                    ticket.assigned_to_detail ? (
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={fullName(ticket.assigned_to_detail)} size="sm" />
                        {fullName(ticket.assigned_to_detail)}
                      </span>
                    ) : (
                      <span className="font-normal text-gray-500 dark:text-gray-400">
                        {t('tickets:fields.unassigned')}
                      </span>
                    )
                  }
                />
                <DetailRow
                  label={t('common:labels.createdAt')}
                  value={formatDateTime(ticket.created_at)}
                />
                <DetailRow
                  label={t('common:labels.updatedAt')}
                  value={formatDateTime(ticket.updated_at)}
                />
              </dl>
              {ticket.description && (
                <p dir="auto" className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-start text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
                  {ticket.description}
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={t('tickets:conversation.title')} />
            <CardBody className="p-0">
              {commentsLoading ? (
                <div className="flex justify-center py-10">
                  <Spinner className="h-6 w-6 text-primary-600" />
                </div>
              ) : !comments || comments.length === 0 ? (
                <EmptyState
                  icon={<MessageSquare className="h-5 w-5" />}
                  title={t('tickets:conversation.empty')}
                  description={t('tickets:conversation.emptyHint')}
                />
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {comments.map((comment) => (
                    <li key={comment.id} className="flex gap-3 px-5 py-4">
                      <Avatar name={fullName(comment.author_detail)} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {fullName(comment.author_detail)}
                          </span>
                          {comment.is_internal && (
                            <Badge color="amber">{t('tickets:conversation.internal')}</Badge>
                          )}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {formatDateTime(comment.created_at)}
                          </span>
                        </div>
                        <p dir="auto" className="mt-1 whitespace-pre-wrap text-start text-sm text-gray-600 dark:text-gray-300">
                          {comment.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t border-gray-200 p-4 dark:border-gray-800">
                <Textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder={t('tickets:conversation.placeholder')}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <Checkbox
                    checked={commentInternal}
                    onChange={(event) => setCommentInternal(event.target.checked)}
                    label={t('tickets:conversation.internalNote')}
                  />
                  <Button
                    onClick={() => commentMutation.mutate()}
                    loading={commentMutation.isPending}
                    disabled={!commentBody.trim()}
                  >
                    {t('tickets:conversation.send')}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <TicketFormModal open={editOpen} onClose={() => setEditOpen(false)} ticket={ticket} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title={t('common:confirmDelete.title', { item: ticket.subject })}
        loading={deleteMutation.isPending}
        confirmLabel={t('common:actions.delete')}
      />
    </div>
  );
}
