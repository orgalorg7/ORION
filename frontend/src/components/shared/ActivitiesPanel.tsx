import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarDays, Phone, Plus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { activitiesApi, activityOutcomesApi } from '@/api/activities';
import { ActivityFormModal } from '@/features/activities/ActivityFormModal';
import { Button, Card, CardHeader, Checkbox, EmptyState, FormField, Input, Modal, Select, Spinner, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import type { Activity, ActivityType } from '@/types';
import type { RelatedFilter } from './NotesPanel';

const icons: Record<ActivityType, ReactNode> = {
  task: <CalendarCheck className="h-4 w-4" />, call: <Phone className="h-4 w-4" />,
  meeting: <Users className="h-4 w-4" />, follow_up: <CalendarDays className="h-4 w-4" />,
  reminder: <CalendarCheck className="h-4 w-4" />, email: <CalendarCheck className="h-4 w-4" />,
};

export function ActivitiesPanel({ related, readOnly = false }: { related: RelatedFilter; readOnly?: boolean }) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [createType, setCreateType] = useState<ActivityType | null>(null);
  const [completion, setCompletion] = useState<Activity | null>(null);
  const [outcomeId, setOutcomeId] = useState('');
  const [notes, setNotes] = useState('');
  const [duration, setDuration] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['activities', related], queryFn: () => activitiesApi.list({ ...related, completed: false, page_size: 20, ordering: 'due_at' }),
  });
  const { data: outcomes } = useQuery({
    queryKey: ['activity-outcomes', completion?.type],
    queryFn: () => activityOutcomesApi.list(completion?.type === 'call' ? 'call' : 'meeting'),
    enabled: completion?.type === 'call' || completion?.type === 'meeting',
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['activities'] });
    const [type, id] = Object.entries(related)[0] ?? [];
    if (type && id) queryClient.invalidateQueries({ queryKey: ['timeline', type, id] });
  };
  const complete = useMutation({
    mutationFn: (activity: Activity) => activitiesApi.complete(activity.id, true, {
      expected_version: activity.version,
      outcome_definition: outcomeId ? Number(outcomeId) : undefined,
      outcome: notes,
      duration_seconds: duration ? Number(duration) * 60 : undefined,
    }),
    onSuccess: () => { setCompletion(null); setOutcomeId(''); setNotes(''); setDuration(''); invalidate(); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const requestCompletion = (activity: Activity) => activity.type === 'call' || activity.type === 'meeting'
    ? setCompletion(activity) : complete.mutate(activity);
  const rows = data?.results ?? [];

  return <Card>
    <CardHeader title={t('activitiesPanel.title')} actions={!readOnly ? <div className="flex flex-wrap gap-1">
      {(['task', 'call', 'meeting', 'follow_up'] as ActivityType[]).map((type) => <Button key={type} size="sm" variant="ghost" onClick={() => setCreateType(type)}>{icons[type]}<span className="hidden sm:inline">{type.replace('_', ' ')}</span></Button>)}
    </div> : undefined} />
    <div className="p-5">
      {isLoading ? <div className="flex justify-center py-8"><Spinner className="text-primary-600" /></div> : isError ? <EmptyState title="Activities unavailable" description="Refresh to try again." /> : !rows.length ? <EmptyState icon={<CalendarCheck className="h-5 w-5" />} title="No activity yet" description="Schedule the next customer action while the context is fresh." action={!readOnly ? <Button size="sm" onClick={() => setCreateType('task')}><Plus className="h-4 w-4" />Create activity</Button> : undefined} /> : <ul className="divide-y divide-line">
        {rows.map((activity) => <li key={activity.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <Checkbox checked={activity.completed} disabled={readOnly || activity.status === 'cancelled' || complete.isPending} onChange={() => requestCompletion(activity)} aria-label={`Complete ${activity.title}`} />
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', activity.completed ? 'bg-gray-100 text-gray-400' : activity.is_overdue ? 'bg-red-50 text-red-600' : 'bg-primary-50 text-primary-600')}>{icons[activity.type]}</span>
          <div className="min-w-0 flex-1"><p dir="auto" className={cn('truncate text-sm font-medium', activity.completed && 'text-gray-400 line-through')}>{activity.title}</p><p className={cn('text-xs', activity.is_overdue ? 'text-red-600' : 'text-gray-500')}>{activity.type.replace('_', ' ')} · {activity.all_day ? formatDate(activity.due_date) : formatDateTime(activity.starts_at || activity.due_at)}</p></div>
          <span className="rounded-md bg-surface-muted px-2 py-1 text-[11px] font-semibold uppercase text-muted">{activity.priority}</span>
        </li>)}
      </ul>}
    </div>
    <ActivityFormModal open={Boolean(createType)} onClose={() => setCreateType(null)} initialType={createType ?? 'task'} related={related} />
    <Modal open={Boolean(completion)} onClose={() => setCompletion(null)} title={`Complete ${completion?.type ?? 'activity'}`} footer={<><Button variant="outline" onClick={() => setCompletion(null)}>Cancel</Button><Button loading={complete.isPending} onClick={() => completion && complete.mutate(completion)}>Complete</Button></>}>
      <div className="space-y-4"><FormField label="Outcome"><Select value={outcomeId} onChange={(event) => setOutcomeId(event.target.value)}><option value="">Select an outcome</option>{outcomes?.results.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}</Select></FormField>{completion?.type === 'call' && <FormField label="Duration (minutes)"><Input type="number" min="0" max="1440" value={duration} onChange={(event) => setDuration(event.target.value)} /></FormField>}<FormField label="Notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></FormField></div>
    </Modal>
  </Card>;
}
