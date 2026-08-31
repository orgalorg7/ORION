import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { CalendarCheck, CalendarDays, Check, Clock3, List, Phone, Plus, RotateCcw, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { activitiesApi, activityOutcomesApi } from '@/api/activities';
import { customerCoreApi } from '@/api/customerCore';
import { organizationsApi } from '@/api/organizations';
import { CustomFieldsSummary } from '@/components/shared/CustomFieldsEditor';
import { CustomerListActions } from '@/components/shared/CustomerListActions';
import {
  Avatar, Badge, Button, Card, Checkbox, EmptyState, FormField, Input, Modal, PageHeader,
  Pagination, SearchInput, Select, Spinner, Table, Textarea, toast, type BadgeColor, type Column,
} from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { cn, formatDate, formatDateTime, formatRelativeTime, fullName } from '@/lib/utils';
import type { Activity, ActivityPriority, ActivityStatus, ActivityType } from '@/types';
import { ActivityFormModal } from './ActivityFormModal';

const PAGE_SIZE = 20;
const localDateTimeValue = (value: Date) => new Date(
  value.getTime() - value.getTimezoneOffset() * 60_000,
).toISOString().slice(0, 16);
const types: ActivityType[] = ['task', 'call', 'meeting', 'follow_up', 'reminder', 'email'];
const icons: Record<ActivityType, ReactNode> = {
  task: <CalendarCheck className="h-4 w-4" />, call: <Phone className="h-4 w-4" />,
  meeting: <Users className="h-4 w-4" />, follow_up: <Clock3 className="h-4 w-4" />,
  reminder: <CalendarCheck className="h-4 w-4" />, email: <CalendarCheck className="h-4 w-4" />,
};
const statusColor: Record<ActivityStatus, BadgeColor> = { open: 'blue', in_progress: 'amber', completed: 'green', cancelled: 'gray' };

function relatedLink(activity: Activity) {
  if (activity.deal_detail) return <Link className="text-primary-600 hover:underline" to={`/app/deals/${activity.deal_detail.id}`}>{activity.deal_detail.title}</Link>;
  if (activity.contact_detail) return <Link className="text-primary-600 hover:underline" to={`/app/contacts/${activity.contact_detail.id}`}>{fullName(activity.contact_detail)}</Link>;
  if (activity.company_detail) return <Link className="text-primary-600 hover:underline" to={`/app/companies/${activity.company_detail.id}`}>{activity.company_detail.name}</Link>;
  if (activity.lead_detail) return <Link className="text-primary-600 hover:underline" to={`/app/leads/${activity.lead_detail.id}`}>{fullName(activity.lead_detail)}</Link>;
  return <span className="text-gray-400">Internal</span>;
}

function ActivityRowCard({ activity, onOpen, onComplete }: { activity: Activity; onOpen: () => void; onComplete: () => void }) {
  const inactive = activity.status === 'completed' || activity.status === 'cancelled';
  return <div className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface-raised p-2 hover:border-line-strong">
    <button type="button" disabled={inactive} onClick={onComplete} aria-label={inactive ? `${activity.title} is ${activity.status}` : `Complete ${activity.title}`} className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full border', activity.completed ? 'border-green-500 bg-green-500 text-white' : 'border-line text-muted', inactive && 'cursor-default')}>{activity.completed ? <Check className="h-4 w-4" /> : icons[activity.type]}</button>
    <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 p-1 text-start">
      <span className="min-w-0 flex-1"><span dir="auto" className="block truncate text-sm font-semibold">{activity.title}</span><span className={cn('block text-xs', activity.is_overdue ? 'text-red-600' : 'text-muted')}>{activity.all_day ? formatDate(activity.due_date) : formatDateTime(activity.starts_at || activity.due_at)}</span></span>
      <Badge color={statusColor[activity.status]}>{activity.status.replace('_', ' ')}</Badge>
    </button>
  </div>;
}

function MyDayView({ onOpen, onComplete }: { onOpen: (activity: Activity) => void; onComplete: (activity: Activity) => void }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, isLoading, isError } = useQuery({ queryKey: ['activities', 'my-day', timezone], queryFn: () => activitiesApi.myDay({ timezone }) });
  if (isLoading) return <div className="flex justify-center py-24"><Spinner className="h-8 w-8 text-primary-600" /></div>;
  if (isError || !data) return <EmptyState title="My Day is unavailable" description="Refresh to load your work queue." />;
  const groups = [
    { key: 'overdue' as const, title: 'Overdue', hint: 'Needs attention first', rows: data.overdue, tone: 'text-red-600' },
    { key: 'today' as const, title: 'Today', hint: "Your committed work", rows: data.today, tone: 'text-gray-900' },
    { key: 'upcoming' as const, title: 'Upcoming', hint: 'The next scheduled actions', rows: data.upcoming, tone: 'text-gray-900' },
  ];
  return <div className="grid gap-5 xl:grid-cols-3">{groups.map((group) => <Card key={group.key}><div className="border-b border-line p-4"><div className="flex items-center justify-between"><div><h2 className={cn('font-display text-base font-semibold', group.tone)}>{group.title}</h2><p className="text-xs text-muted">{group.hint}</p></div><span className="text-2xl font-semibold tabular-nums">{data.counts[group.key]}</span></div></div><div className="space-y-2 p-3">{group.rows.length ? group.rows.map((activity) => <ActivityRowCard key={activity.id} activity={activity} onOpen={() => onOpen(activity)} onComplete={() => onComplete(activity)} />) : <EmptyState title={group.key === 'today' ? "You're clear for now" : `No ${group.title.toLowerCase()} activities`} className="py-10" />}{data.counts[group.key] > group.rows.length && <p className="px-2 py-1 text-xs text-muted">Showing the first {group.rows.length}; use Activity List for the full queue.</p>}</div></Card>)}</div>;
}

function CalendarView({ onOpen }: { onOpen: (activity: Activity) => void }) {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const mode = (params.get('calendar') ?? 'month') as 'day' | 'week' | 'month';
  const selected = new Date(`${params.get('date') ?? format(new Date(), 'yyyy-MM-dd')}T12:00:00`);
  const range = (() => {
    if (mode === 'day') return [startOfDay(selected), addDays(startOfDay(selected), 1)];
    if (mode === 'week') return [startOfWeek(selected, { weekStartsOn: 1 }), addDays(endOfWeek(selected, { weekStartsOn: 1 }), 1)];
    return [startOfWeek(startOfMonth(selected), { weekStartsOn: 1 }), addDays(endOfWeek(endOfMonth(selected), { weekStartsOn: 1 }), 1)];
  })();
  const { data, isLoading, isError } = useQuery({ queryKey: ['activities', 'calendar', mode, range[0].toISOString(), range[1].toISOString(), timezone, page], queryFn: () => activitiesApi.calendar(range[0].toISOString(), range[1].toISOString(), { timezone, page }) });
  const days = Array.from({ length: Math.ceil((range[1].getTime() - range[0].getTime()) / 86400000) }, (_, index) => addDays(range[0], index));
  const move = (amount: number) => {
    const date = mode === 'month' ? addMonths(selected, amount) : addDays(selected, amount * (mode === 'week' ? 7 : 1));
    setPage(1);
    setParams((current) => { current.set('date', format(date, 'yyyy-MM-dd')); return current; });
  };
  const setMode = (value: string) => { setPage(1); setParams((current) => { current.set('calendar', value); return current; }); };
  if (isError) return <EmptyState title="Calendar unavailable" description="The selected range could not be loaded." />;
  return <Card><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4"><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => move(-1)}>Previous</Button><Button variant="outline" size="sm" onClick={() => setParams((current) => { current.set('date', format(new Date(), 'yyyy-MM-dd')); return current; })}>Today</Button><Button variant="outline" size="sm" onClick={() => move(1)}>Next</Button></div><h2 className="font-display text-lg font-semibold">{mode === 'month' ? format(selected, 'MMMM yyyy') : format(range[0], 'MMM d') + (mode === 'week' ? ` – ${format(addDays(range[1], -1), 'MMM d')}` : '')}</h2><div className="flex rounded-lg border border-line p-1">{(['day', 'week', 'month'] as const).map((item) => <button type="button" key={item} onClick={() => setMode(item)} className={cn('rounded-md px-3 py-1 text-xs font-semibold capitalize', mode === item ? 'bg-primary-600 text-white' : 'text-muted')}>{item}</button>)}</div></div>
    {isLoading ? <div className="flex justify-center py-24"><Spinner className="text-primary-600" /></div> : <div className="overflow-x-auto"><div className={cn('grid min-w-[46rem]', mode === 'day' ? 'grid-cols-1' : 'grid-cols-7')} role="grid" aria-label={`${mode} activity calendar`}>{days.map((day) => { const rows = (data?.results ?? []).filter((activity) => { const value = activity.all_day ? activity.due_date : activity.starts_at || activity.due_at; return value && format(new Date(value.length === 10 ? `${value}T12:00:00` : value), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd'); }); return <section key={day.toISOString()} className="min-h-40 border-b border-e border-line p-2" aria-label={format(day, 'MMMM d')}><p className={cn('mb-2 text-xs font-semibold', format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? 'text-primary-600' : 'text-muted')}>{format(day, mode === 'month' ? 'EEE d' : 'EEEE, MMM d')}</p><div className="space-y-1">{rows.map((activity) => <button type="button" key={activity.id} onClick={() => onOpen(activity)} className={cn('block w-full truncate rounded-md border px-2 py-1 text-start text-xs font-medium', activity.is_overdue ? 'border-red-200 bg-red-50 text-red-800' : 'border-primary-100 bg-primary-50 text-primary-800')}>{activity.starts_at ? format(new Date(activity.starts_at), 'HH:mm') + ' ' : ''}{activity.title}</button>)}</div></section>; })}</div></div>}
    <Pagination page={page} pageSize={100} count={data?.count ?? 0} onPageChange={setPage} />
  </Card>;
}

export function ActivitiesPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'my-day';
  const page = Number(params.get('page') ?? 1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Activity | null>(null);
  const [detail, setDetail] = useState<Activity | null>(null);
  const [completion, setCompletion] = useState<Activity | null>(null);
  const [snoozeTarget, setSnoozeTarget] = useState<Activity | null>(null);
  const [snoozeAt, setSnoozeAt] = useState('');
  const [cancelTarget, setCancelTarget] = useState<Activity | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [bulkDueAt, setBulkDueAt] = useState('');
  const [completionForm, setCompletionForm] = useState({ outcomeId: '', outcome: '', duration: '', followUp: false, followUpAt: '' });
  const listParams = {
    page, page_size: PAGE_SIZE, search: params.get('search') || undefined,
    type: params.get('type') || undefined, status: params.get('status') || undefined,
    priority: params.get('priority') || undefined, assigned_to: params.get('owner') || undefined,
    team: params.get('team') || undefined,
    archived: params.get('archived') || 'false',
    ordering: params.get('ordering') || 'due_at',
  };
  const exportFilters = {
    search: listParams.search, type: listParams.type, status: listParams.status,
    priority: listParams.priority, assigned_to: listParams.assigned_to, team: listParams.team,
    archived: listParams.archived,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['activities', 'list', listParams], queryFn: () => activitiesApi.list(listParams),
    enabled: view === 'list', placeholderData: keepPreviousData,
  });
  const { data: members } = useQuery({
    queryKey: ['memberships', 'activity-filter', memberSearch],
    queryFn: () => organizationsApi.members({ page_size: 50, is_active: true, search: memberSearch || undefined }),
  });
  const { data: teams } = useQuery({
    queryKey: ['teams', 'activity-filter'], queryFn: () => customerCoreApi.teams({ page_size: 100, active: true }),
  });
  const { data: outcomeDefinitions } = useQuery({
    queryKey: ['activity-outcomes', completion?.type],
    queryFn: () => activityOutcomesApi.list(completion?.type === 'call' ? 'call' : 'meeting'),
    enabled: completion?.type === 'call' || completion?.type === 'meeting',
  });
  const { data: history } = useQuery({
    queryKey: ['activities', detail?.id, 'history'],
    queryFn: () => activitiesApi.history(detail!.id, { page_size: 20 }),
    enabled: Boolean(detail),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['activities'] });
  const complete = useMutation({
    mutationFn: (activity: Activity) => activitiesApi.complete(activity.id, true, {
      expected_version: activity.version, outcome: completionForm.outcome,
      outcome_definition: completionForm.outcomeId ? Number(completionForm.outcomeId) : undefined,
      duration_seconds: completionForm.duration ? Number(completionForm.duration) * 60 : undefined,
      follow_up: completionForm.followUp && completionForm.followUpAt ? { title: `Follow up: ${activity.title}`, due_at: fromZonedTime(completionForm.followUpAt, activity.scheduled_timezone).toISOString(), scheduled_timezone: activity.scheduled_timezone } : undefined,
    }),
    onSuccess: () => { setCompletion(null); setCompletionForm({ outcomeId: '', outcome: '', duration: '', followUp: false, followUpAt: '' }); invalidate(); toast.success('Activity completed'); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const quickComplete = (activity: Activity) => activity.type === 'call' || activity.type === 'meeting' ? setCompletion(activity) : complete.mutate(activity);
  const snooze = useMutation({
    mutationFn: ({ activity, until }: { activity: Activity; until: string }) => activitiesApi.snooze(activity.id, new Date(until).toISOString(), activity.version),
    onSuccess: (updated) => { setSnoozeTarget(null); setDetail(updated); invalidate(); toast.success('Activity snoozed'); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const cancel = useMutation({
    mutationFn: (activity: Activity) => activitiesApi.cancel(activity.id, cancellationReason, activity.version),
    onSuccess: () => { setCancelTarget(null); setDetail(null); setCancellationReason(''); invalidate(); toast.success('Activity cancelled'); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const openDetail = (activity: Activity) => {
    setDetail(activity);
    activitiesApi.get(activity.id).then((loaded) => {
      setDetail((current) => current?.id === activity.id ? loaded : current);
    }).catch((error) => toast.error(apiErrorMessage(error)));
  };
  const bulk = useMutation({
    mutationFn: ({ action, values = {} }: { action: string; values?: Parameters<typeof activitiesApi.bulk>[2] }) => activitiesApi.bulk(selected, action, values),
    onSuccess: () => { setSelected([]); setBulkDueAt(''); invalidate(); toast.success('Activities updated'); },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });
  const setParam = (key: string, value: string) => setParams((current) => {
    if ((current.get(key) ?? '') === value) return current;
    if (value) current.set(key, value); else current.delete(key);
    current.set('page', '1');
    return current;
  });

  const columns: Column<Activity>[] = [
    { key: 'select', header: '', className: 'w-10', render: (row) => <Checkbox checked={selected.includes(row.id)} onChange={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /> },
    { key: 'type', header: 'Type', render: (row) => <span className="inline-flex items-center gap-2 capitalize">{icons[row.type]}{row.type.replace('_', ' ')}</span> },
    { key: 'title', header: 'Activity', render: (row) => <button type="button" onClick={() => openDetail(row)} className="max-w-xs text-start"><span dir="auto" className="block truncate font-semibold">{row.title}</span><span className="text-xs text-muted">{row.description}</span></button> },
    { key: 'related', header: 'Related to', render: relatedLink },
    { key: 'owner', header: 'Owner', render: (row) => row.owner_detail ? <span className="flex items-center gap-2"><Avatar name={fullName(row.owner_detail)} size="sm" />{fullName(row.owner_detail)}</span> : 'Unassigned' },
    { key: 'priority', header: 'Priority', render: (row) => <span className="capitalize">{row.priority}</span> },
    { key: 'status', header: 'Status', render: (row) => <Badge color={statusColor[row.status]}>{row.status.replace('_', ' ')}</Badge> },
    { key: 'due', header: 'Due', render: (row) => <span className={row.is_overdue ? 'font-semibold text-red-600' : 'text-muted'}>{row.all_day ? formatDate(row.due_date) : formatDateTime(row.starts_at || row.due_at)}</span> },
    { key: 'complete', header: '', render: (row) => row.status === 'completed' ? <Check className="h-4 w-4 text-green-600" /> : row.status === 'cancelled' ? null : <Button size="sm" variant="ghost" onClick={() => quickComplete(row)}>Complete</Button> },
  ];

  return <div>
    <PageHeader title="My Work" subtitle="Calls, meetings, tasks and customer follow-ups in one execution queue." actions={<><CustomerListActions target="activity" filters={exportFilters} sort={String(listParams.ordering)} /><Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />New activity</Button></>} />
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Activity views">{[
      ['my-day', 'My Day', <Clock3 className="h-4 w-4" />], ['list', 'Activity List', <List className="h-4 w-4" />], ['calendar', 'Calendar', <CalendarDays className="h-4 w-4" />],
    ].map(([key, label, icon]) => <button type="button" key={key as string} onClick={() => setParam('view', key as string)} className={cn('inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold', view === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-muted')}>{icon}{label}</button>)}</nav>
    {view === 'my-day' && <MyDayView onOpen={openDetail} onComplete={quickComplete} />}
    {view === 'calendar' && <CalendarView onOpen={openDetail} />}
    {view === 'list' && <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4"><SearchInput initialValue={params.get('search') ?? ''} onSearch={(value) => setParam('search', value)} className="w-full sm:w-64" /><Select value={params.get('type') ?? ''} onChange={(event) => setParam('type', event.target.value)} className="w-full sm:w-40"><option value="">All types</option>{types.map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}</Select><Select value={params.get('status') ?? ''} onChange={(event) => setParam('status', event.target.value)} className="w-full sm:w-40"><option value="">All statuses</option>{(['open', 'in_progress', 'completed', 'cancelled'] as ActivityStatus[]).map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</Select><Select value={params.get('priority') ?? ''} onChange={(event) => setParam('priority', event.target.value)} className="w-full sm:w-36"><option value="">All priorities</option>{(['low', 'medium', 'high', 'urgent'] as ActivityPriority[]).map((priority) => <option key={priority}>{priority}</option>)}</Select><SearchInput onSearch={setMemberSearch} placeholder="Find owner" className="w-full sm:w-44" /><Select value={params.get('owner') ?? ''} onChange={(event) => setParam('owner', event.target.value)} className="w-full sm:w-48"><option value="">All owners</option>{members?.results.map((member) => <option key={member.id} value={member.user.id}>{fullName(member.user) === '—' ? member.user.email : fullName(member.user)}</option>)}</Select><Select value={params.get('team') ?? ''} onChange={(event) => setParam('team', event.target.value)} className="w-full sm:w-44"><option value="">All teams</option>{teams?.results.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select><Select value={params.get('archived') ?? 'false'} onChange={(event) => setParam('archived', event.target.value)} className="w-full sm:w-44"><option value="false">Active only</option><option value="only">Archived only</option><option value="all">Include archived</option></Select></div>
      {selected.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-line bg-primary-50 px-4 py-2 text-sm"><strong>{selected.length} selected</strong><Select className="w-44" defaultValue="" onChange={(event) => event.target.value && bulk.mutate({ action: 'assign', values: { assigned_to: Number(event.target.value), team: null } })}><option value="">Assign owner…</option>{members?.results.map((member) => <option key={member.id} value={member.user.id}>{fullName(member.user) === '—' ? member.user.email : fullName(member.user)}</option>)}</Select><Select className="w-40" defaultValue="" onChange={(event) => event.target.value && bulk.mutate({ action: 'assign', values: { team: Number(event.target.value), assigned_to: null } })}><option value="">Assign team…</option>{teams?.results.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select><Select className="w-36" defaultValue="" onChange={(event) => event.target.value && bulk.mutate({ action: 'priority', values: { priority: event.target.value as ActivityPriority } })}><option value="">Priority…</option>{(['low', 'medium', 'high', 'urgent'] as ActivityPriority[]).map((priority) => <option key={priority}>{priority}</option>)}</Select><Input type="datetime-local" value={bulkDueAt} onChange={(event) => setBulkDueAt(event.target.value)} className="w-52" /><Button size="sm" variant="ghost" disabled={!bulkDueAt} onClick={() => bulk.mutate({ action: 'reschedule', values: { due_at: new Date(bulkDueAt).toISOString() } })}>Reschedule</Button><Button size="sm" variant="ghost" onClick={() => bulk.mutate({ action: 'complete' })}>Complete</Button><Button size="sm" variant="ghost" onClick={() => bulk.mutate({ action: 'cancel' })}>Cancel</Button><Button size="sm" variant="ghost" onClick={() => bulk.mutate({ action: listParams.archived === 'only' ? 'restore' : 'archive' })}>{listParams.archived === 'only' ? 'Restore' : 'Archive'}</Button></div>}
      <div className="hidden md:block"><Table columns={columns} rows={data?.results ?? []} rowKey={(row) => row.id} loading={isLoading} emptyState={<EmptyState title="No matching activities" description="Adjust the filters or create the next action." />} /></div>
      <div className="space-y-2 p-3 md:hidden">{isLoading ? <Spinner /> : (data?.results ?? []).map((row) => <ActivityRowCard key={row.id} activity={row} onOpen={() => openDetail(row)} onComplete={() => quickComplete(row)} />)}</div>
      <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPageChange={(value) => setParam('page', String(value))} />
    </Card>}

    <ActivityFormModal open={createOpen || Boolean(editTarget)} onClose={() => { setCreateOpen(false); setEditTarget(null); }} activity={editTarget} />
    <Modal
      open={Boolean(detail)}
      onClose={() => setDetail(null)}
      title={detail?.title ?? 'Activity'}
      size="lg"
      footer={detail && (detail.archived_at ? (
        <Button onClick={() => activitiesApi.restore(detail.id).then(() => { invalidate(); setDetail(null); toast.success('Activity restored'); }).catch((error) => toast.error(apiErrorMessage(error)))}>Restore</Button>
      ) : <>
        <Button variant="outline" onClick={() => { setEditTarget(detail); setDetail(null); }}>Edit</Button>
        {detail.status === 'completed' || detail.status === 'cancelled' ? (
          <Button onClick={() => activitiesApi.reopen(detail.id, detail.version).then(() => { invalidate(); setDetail(null); }).catch((error) => toast.error(apiErrorMessage(error)))}><RotateCcw className="h-4 w-4" />Reopen</Button>
        ) : <>
          <Button variant="outline" onClick={() => { setSnoozeTarget(detail); setSnoozeAt(localDateTimeValue(addDays(new Date(), 1))); setDetail(null); }}>Snooze</Button>
          <Button variant="outline" onClick={() => { setCancelTarget(detail); setDetail(null); }}>Cancel</Button>
          {detail.status === 'open' && <Button variant="outline" onClick={() => activitiesApi.start(detail.id, detail.version).then((updated) => { invalidate(); setDetail(updated); toast.success('Activity started'); }).catch((error) => toast.error(apiErrorMessage(error)))}>Start</Button>}
          <Button onClick={() => { setCompletion(detail); setDetail(null); }}>Complete</Button>
        </>}
        <Button variant="outline" onClick={() => activitiesApi.archive(detail.id).then(() => { invalidate(); setDetail(null); toast.success('Activity archived'); }).catch((error) => toast.error(apiErrorMessage(error)))}>Archive</Button>
      </>)}
    >
      {detail && <div className="grid gap-5 sm:grid-cols-2">
        <section><p className="text-xs font-semibold uppercase text-muted">Status</p><div className="mt-2 flex gap-2"><Badge color={statusColor[detail.status]}>{detail.status}</Badge><Badge>{detail.priority}</Badge></div></section>
        <section><p className="text-xs font-semibold uppercase text-muted">Schedule</p><p className="mt-2 text-sm font-medium">{detail.all_day ? formatDate(detail.due_date) : formatDateTime(detail.starts_at || detail.due_at)}</p><p className="text-xs text-muted">{detail.scheduled_timezone}</p></section>
        <section className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-muted">Related records</p><div className="mt-2 text-sm">{relatedLink(detail)}</div></section>
        {detail.description && <section className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-muted">Description</p><p dir="auto" className="mt-2 whitespace-pre-wrap text-sm">{detail.description}</p></section>}
        <section><p className="text-xs font-semibold uppercase text-muted">Owner</p><p className="mt-2 text-sm">{detail.owner_detail ? fullName(detail.owner_detail) : 'Unassigned'}</p></section>
        <section><p className="text-xs font-semibold uppercase text-muted">Created</p><p className="mt-2 text-sm">{formatRelativeTime(detail.created_at)}</p></section>
        {(detail.outcome_label_snapshot || detail.outcome) && <section className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-muted">Outcome</p><p className="mt-2 text-sm font-medium">{detail.outcome_label_snapshot || 'Completed'}</p>{detail.outcome && <p dir="auto" className="mt-1 whitespace-pre-wrap text-sm text-muted">{detail.outcome}</p>}</section>}
        {detail.attendees.length > 0 && <section className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-muted">Attendees</p><ul className="mt-2 space-y-1 text-sm">{detail.attendees.map((attendee) => <li key={attendee.id}>{attendee.user_detail ? fullName(attendee.user_detail) : attendee.contact_detail ? fullName(attendee.contact_detail) : attendee.external_email} · {attendee.response_status.replace('_', ' ')}</li>)}</ul></section>}
        {detail.reminders.length > 0 && <section className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-muted">Reminders</p><ul className="mt-2 space-y-1 text-sm">{detail.reminders.map((reminder) => <li key={reminder.id}>{formatDateTime(reminder.scheduled_for)} · {reminder.channel} · {reminder.status}</li>)}</ul></section>}
        <section className="sm:col-span-2"><CustomFieldsSummary values={detail.custom_fields} /></section>
        <section className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-muted">History</p><ol className="mt-2 divide-y divide-line rounded-lg border border-line">{history?.results.length ? history.results.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="capitalize">{item.event_type.replace('_', ' ')}</span><span className="text-xs text-muted">{item.actor_detail ? fullName(item.actor_detail) : 'System'} · {formatDateTime(item.occurred_at)}</span></li>) : <li className="px-3 py-4 text-sm text-muted">No history recorded yet.</li>}</ol></section>
      </div>}
    </Modal>
    <Modal open={Boolean(snoozeTarget)} onClose={() => setSnoozeTarget(null)} title="Snooze activity" footer={<><Button variant="outline" onClick={() => setSnoozeTarget(null)}>Cancel</Button><Button disabled={!snoozeAt} loading={snooze.isPending} onClick={() => snoozeTarget && snooze.mutate({ activity: snoozeTarget, until: snoozeAt })}>Snooze</Button></>}>
      <div className="space-y-4"><div className="grid grid-cols-3 gap-2"><Button variant="outline" size="sm" onClick={() => setSnoozeAt(localDateTimeValue(new Date(Date.now() + 3 * 60 * 60 * 1000)))}>Later today</Button><Button variant="outline" size="sm" onClick={() => setSnoozeAt(localDateTimeValue(addDays(new Date(), 1)))}>Tomorrow</Button><Button variant="outline" size="sm" onClick={() => setSnoozeAt(localDateTimeValue(addDays(new Date(), 7)))}>Next week</Button></div><FormField label="Snooze until"><Input type="datetime-local" value={snoozeAt} onChange={(event) => setSnoozeAt(event.target.value)} /></FormField></div>
    </Modal>
    <Modal open={Boolean(cancelTarget)} onClose={() => setCancelTarget(null)} title="Cancel activity" footer={<><Button variant="outline" onClick={() => setCancelTarget(null)}>Keep activity</Button><Button loading={cancel.isPending} onClick={() => cancelTarget && cancel.mutate(cancelTarget)}>Cancel activity</Button></>}>
      <FormField label="Reason (optional)"><Textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} rows={3} placeholder="Why is this no longer needed?" /></FormField>
    </Modal>
    <Modal open={Boolean(completion)} onClose={() => setCompletion(null)} title={`Complete ${completion?.type.replace('_', ' ') ?? 'activity'}`} footer={<><Button variant="outline" onClick={() => setCompletion(null)}>Cancel</Button><Button onClick={() => completion && complete.mutate(completion)} loading={complete.isPending}>Complete activity</Button></>}><div className="space-y-4">{outcomeDefinitions && <FormField label="Outcome"><Select value={completionForm.outcomeId} onChange={(event) => setCompletionForm((current) => ({ ...current, outcomeId: event.target.value }))}><option value="">Select an outcome</option>{outcomeDefinitions.results.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}</Select></FormField>}<FormField label="Notes"><Textarea value={completionForm.outcome} onChange={(event) => setCompletionForm((current) => ({ ...current, outcome: event.target.value }))} rows={3} placeholder="What happened?" /></FormField>{completion?.type === 'call' && <FormField label="Duration (minutes)"><Input type="number" min="0" max="1440" value={completionForm.duration} onChange={(event) => setCompletionForm((current) => ({ ...current, duration: event.target.value }))} /></FormField>}<label className="flex items-center gap-3"><Checkbox checked={completionForm.followUp} onChange={(event) => setCompletionForm((current) => ({ ...current, followUp: event.target.checked }))} /><span className="text-sm font-medium">Create the next follow-up</span></label>{completionForm.followUp && <FormField label="Follow up at"><Input type="datetime-local" value={completionForm.followUpAt} onChange={(event) => setCompletionForm((current) => ({ ...current, followUpAt: event.target.value }))} /></FormField>}</div></Modal>
  </div>;
}
