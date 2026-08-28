import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Mail, Phone, Plus, Trash2, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { activitiesApi } from '@/api/activities';
import {
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  FormField,
  Input,
  Modal,
  Select,
  Spinner,
  toast,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';
import type { ActivityType } from '@/types';

import type { RelatedFilter } from './NotesPanel';

const typeIcons: Record<ActivityType, ReactNode> = {
  call: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  meeting: <Users className="h-4 w-4" />,
  task: <CalendarCheck className="h-4 w-4" />,
};

export function ActivitiesPanel({ related }: { related: RelatedFilter }) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ type: 'task' as ActivityType, title: '', due_at: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['activities', related],
    queryFn: () => activitiesApi.list({ ...related, page_size: 50 }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['activities'] });

  const createMutation = useMutation({
    mutationFn: () =>
      activitiesApi.create({
        type: form.type,
        title: form.title,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        ...related,
      }),
    onSuccess: () => {
      setModalOpen(false);
      setForm({ type: 'task', title: '', due_at: '' });
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) =>
      activitiesApi.complete(id, completed),
    onSuccess: invalidate,
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => activitiesApi.remove(id),
    onSuccess: invalidate,
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const activities = data?.results ?? [];

  return (
    <Card>
      <CardHeader
        title={t('activitiesPanel.title')}
        actions={
          <Button size="sm" variant="secondary" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('activitiesPanel.add')}
          </Button>
        }
      />
      <div className="p-5">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="text-primary-600" />
          </div>
        ) : activities.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck className="h-5 w-5" />}
            title={t('activitiesPanel.empty')}
            className="py-6"
          />
        ) : (
          <ul className="space-y-2">
            {activities.map((activity) => (
              <li
                key={activity.id}
                className="group flex items-center gap-3 rounded-lg border border-gray-100 p-3 dark:border-gray-800"
              >
                <Checkbox
                  checked={activity.completed}
                  onChange={(event) =>
                    toggleMutation.mutate({ id: activity.id, completed: event.target.checked })
                  }
                />
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    activity.completed
                      ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                      : 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400',
                  )}
                >
                  {typeIcons[activity.type]}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    dir="auto"
                    className={cn(
                      'truncate text-start text-sm font-medium',
                      activity.completed
                        ? 'text-gray-400 line-through dark:text-gray-500'
                        : 'text-gray-800 dark:text-gray-200',
                    )}
                  >
                    {activity.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t(`activitiesPanel.types.${activity.type}`)}
                    {activity.due_at && ` · ${formatDateTime(activity.due_at)}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(activity.id)}
                  className="text-gray-400 opacity-100 transition-opacity hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 dark:text-gray-500"
                  aria-label={t('actions.delete')}
                  title={t('actions.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('activitiesPanel.add')}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending} disabled={!form.title.trim()}>
              {t('actions.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label={t('labels.name')} required>
            <Input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder={t('activitiesPanel.titlePlaceholder')}
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('labels.status')}>
              <Select
                value={form.type}
                onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as ActivityType }))}
              >
                {(['task', 'call', 'email', 'meeting'] as const).map((type) => (
                  <option key={type} value={type}>
                    {t(`activitiesPanel.types.${type}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={t('activitiesPanel.dueAt')}>
              <Input
                type="datetime-local"
                value={form.due_at}
                onChange={(event) => setForm((prev) => ({ ...prev, due_at: event.target.value }))}
              />
            </FormField>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
