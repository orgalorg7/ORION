import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { activitiesApi } from '@/api/activities';
import { companiesApi, contactsApi } from '@/api/contacts';
import { customerCoreApi } from '@/api/customerCore';
import { dealsApi } from '@/api/deals';
import { leadsApi } from '@/api/leads';
import { organizationsApi } from '@/api/organizations';
import { CustomFieldsEditor } from '@/components/shared/CustomFieldsEditor';
import { Button, Checkbox, FormField, Input, Modal, SearchInput, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { fullName } from '@/lib/utils';
import type { Activity, ActivityPriority, ActivityType, CustomFieldValues } from '@/types';

export type ActivityRelated = Partial<Record<'contact' | 'company' | 'deal' | 'lead', number>>;

const TYPES: ActivityType[] = ['task', 'call', 'meeting', 'follow_up', 'reminder', 'email'];
const PRIORITIES: ActivityPriority[] = ['low', 'medium', 'high', 'urgent'];
type RelatedType = '' | keyof ActivityRelated;

interface FormState {
  type: ActivityType;
  title: string;
  description: string;
  priority: ActivityPriority;
  assigned_to: string;
  team: string;
  relatedType: RelatedType;
  relatedId: string;
  all_day: boolean;
  due_at: string;
  due_date: string;
  starts_at: string;
  ends_at: string;
  scheduled_timezone: string;
  call_direction: '' | 'inbound' | 'outbound';
  phone_number: string;
  location: string;
  meeting_url: string;
  reminder: string;
  recurrence: '' | 'daily' | 'weekly' | 'monthly';
  attendee: string;
  custom_fields: CustomFieldValues;
}

function zonedInput(iso: string | null, timezone: string) {
  if (!iso) return '';
  return format(toZonedTime(iso, timezone), "yyyy-MM-dd'T'HH:mm");
}

function initialState(activity?: Activity | null, related?: ActivityRelated, initialType: ActivityType = 'task'): FormState {
  const scheduledTimezone = activity?.scheduled_timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const relation = activity
    ? (activity.contact ? ['contact', activity.contact] : activity.company ? ['company', activity.company] : activity.deal ? ['deal', activity.deal] : activity.lead ? ['lead', activity.lead] : ['', ''])
    : Object.entries(related ?? {})[0] ?? ['', ''];
  return {
    type: activity?.type ?? initialType,
    title: activity?.title ?? '', description: activity?.description ?? '',
    priority: activity?.priority ?? 'medium', assigned_to: activity?.assigned_to ? String(activity.assigned_to) : '',
    team: activity?.team ? String(activity.team) : '',
    relatedType: relation[0] as RelatedType, relatedId: relation[1] ? String(relation[1]) : '',
    all_day: activity?.all_day ?? false, due_at: zonedInput(activity?.due_at ?? null, scheduledTimezone),
    due_date: activity?.due_date ?? '', starts_at: zonedInput(activity?.starts_at ?? null, scheduledTimezone),
    ends_at: zonedInput(activity?.ends_at ?? null, scheduledTimezone),
    scheduled_timezone: scheduledTimezone,
    call_direction: activity?.call_direction ?? '', phone_number: activity?.phone_number ?? '',
    location: activity?.location ?? '', meeting_url: activity?.meeting_url ?? '',
    reminder: '', recurrence: activity?.recurrence_rule.includes('DAILY') ? 'daily' : activity?.recurrence_rule.includes('WEEKLY') ? 'weekly' : activity?.recurrence_rule.includes('MONTHLY') ? 'monthly' : '',
    attendee: activity?.attendees.find((item) => item.user)?.user?.toString() ?? '',
    custom_fields: activity?.custom_fields ?? {},
  };
}

export function ActivityFormModal({
  open, onClose, activity, related, initialType = 'task',
}: {
  open: boolean;
  onClose: () => void;
  activity?: Activity | null;
  related?: ActivityRelated;
  initialType?: ActivityType;
}) {
  const { t } = useTranslation(['activities', 'common']);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialState(activity, related, initialType));
  const [memberSearch, setMemberSearch] = useState('');
  const [relationSearch, setRelationSearch] = useState('');

  useEffect(() => {
    if (open) setForm(initialState(activity, related, initialType));
  }, [open, activity, related, initialType]);

  const { data: members } = useQuery({
    queryKey: ['memberships', 'activity-options', memberSearch],
    queryFn: () => organizationsApi.members({ page_size: 50, is_active: true, search: memberSearch || undefined }),
    enabled: open,
  });
  const { data: teams } = useQuery({
    queryKey: ['teams', 'activity-options'], queryFn: () => customerCoreApi.teams({ page_size: 100, active: true }), enabled: open,
  });
  const { data: relatedOptions } = useQuery({
    queryKey: ['activity-related-options', form.relatedType, relationSearch], enabled: open && Boolean(form.relatedType),
    queryFn: async () => {
      const params = { page_size: 50, search: relationSearch || undefined };
      if (form.relatedType === 'contact') return (await contactsApi.list(params)).results.map((row) => ({ id: row.id, label: fullName(row) }));
      if (form.relatedType === 'company') return (await companiesApi.list(params)).results.map((row) => ({ id: row.id, label: row.name }));
      if (form.relatedType === 'deal') return (await dealsApi.list(params)).results.map((row) => ({ id: row.id, label: row.title }));
      if (form.relatedType === 'lead') return (await leadsApi.list(params)).results.map((row) => ({ id: row.id, label: fullName(row) }));
      return [];
    },
  });
  const displayOptions = useMemo(() => relatedOptions ?? [], [relatedOptions]);
  const currentRelatedLabel = form.relatedType === 'contact' && activity?.contact_detail ? fullName(activity.contact_detail)
    : form.relatedType === 'company' && activity?.company_detail ? activity.company_detail.name
      : form.relatedType === 'deal' && activity?.deal_detail ? activity.deal_detail.title
        : form.relatedType === 'lead' && activity?.lead_detail ? fullName(activity.lead_detail) : '';

  const mutation = useMutation({
    mutationFn: async () => {
      const relationship = form.relatedType && form.relatedId ? { [form.relatedType]: Number(form.relatedId) } : {};
      const schedule = {
        due_at: !form.all_day && form.due_at ? fromZonedTime(form.due_at, form.scheduled_timezone).toISOString() : null,
        due_date: form.all_day ? form.due_date || null : null,
        all_day: form.all_day,
        starts_at: !form.all_day && form.starts_at ? fromZonedTime(form.starts_at, form.scheduled_timezone).toISOString() : null,
        ends_at: !form.all_day && form.ends_at ? fromZonedTime(form.ends_at, form.scheduled_timezone).toISOString() : null,
        scheduled_timezone: form.scheduled_timezone,
      };
      const payload = {
        type: form.type, title: form.title.trim(), description: form.description,
        priority: form.priority,
        ...(form.assigned_to ? { assigned_to: Number(form.assigned_to) } : activity ? { assigned_to: null } : {}),
        ...(form.team ? { team: Number(form.team) } : activity ? { team: null } : {}),
        expected_version: activity?.version,
        call_direction: form.type === 'call' ? form.call_direction : '', phone_number: form.phone_number,
        location: form.location, meeting_url: form.meeting_url, ...relationship,
        custom_fields: form.custom_fields,
      };
      if (activity) {
        const updated = await activitiesApi.update(activity.id, payload);
        const changed = schedule.all_day !== activity.all_day || schedule.due_at !== activity.due_at || schedule.due_date !== activity.due_date ||
          schedule.starts_at !== activity.starts_at || schedule.ends_at !== activity.ends_at ||
          schedule.scheduled_timezone !== activity.scheduled_timezone;
        const finalActivity = changed ? await activitiesApi.reschedule(activity.id, { ...schedule, expected_version: updated.version }) : updated;
        if (form.type === 'meeting' && form.attendee && !activity.attendees.some((item) => item.user === Number(form.attendee))) {
          await activitiesApi.addAttendee(activity.id, { user: Number(form.attendee) });
        }
        return finalActivity;
      }
      const recurrence_rule = form.recurrence ? `FREQ=${form.recurrence.toUpperCase()};INTERVAL=1` : '';
      const reminder_configurations = form.reminder ? [{ offset_minutes: Number(form.reminder), channel: 'in_app' }] : [];
      const created = await activitiesApi.create({ ...payload, ...schedule, recurrence_rule, reminder_configurations });
      if (form.type === 'meeting' && form.attendee) {
        await activitiesApi.addAttendee(created.id, { user: Number(form.attendee) });
      }
      return created;
    },
    onSuccess: () => {
      toast.success(activity ? t('common:toast.saved') : t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const isMeeting = form.type === 'meeting';

  return <Modal open={open} onClose={onClose} title={activity ? t('activities:form.editTitle') : t('activities:form.createTitle')} size="lg" footer={<>
    <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
    <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.title.trim() || (isMeeting && !form.all_day && (!form.starts_at || !form.ends_at))}>{t('common:actions.save')}</Button>
  </>}>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField label={t('activities:fields.type')} required><Select value={form.type} onChange={set('type')} disabled={Boolean(activity)}>{TYPES.map((type) => <option key={type} value={type}>{type.replace('_', ' ')}</option>)}</Select></FormField>
      <FormField label={t('activities:fields.title')} required><Input value={form.title} onChange={set('title')} autoFocus /></FormField>
      <FormField label="Priority"><Select value={form.priority} onChange={set('priority')}>{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</Select></FormField>
      <FormField label={t('common:labels.assignedTo')}><div className="space-y-2"><SearchInput onSearch={setMemberSearch} placeholder="Find a workspace member" /><Select value={form.assigned_to} onChange={set('assigned_to')}><option value="">{t('common:labels.none')}</option>{activity?.assigned_to && !members?.results.some((member) => member.user.id === activity.assigned_to) && <option value={activity.assigned_to}>{activity.assigned_to_detail ? fullName(activity.assigned_to_detail) : `User ${activity.assigned_to}`}</option>}{members?.results.map((member) => <option key={member.id} value={member.user.id}>{fullName(member.user) === '—' ? member.user.email : fullName(member.user)}</option>)}</Select></div></FormField>
      <FormField label="Team"><Select value={form.team} onChange={set('team')}><option value="">No team</option>{teams?.results.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select></FormField>
      <FormField label={t('common:labels.description')} className="sm:col-span-2"><Textarea value={form.description} onChange={set('description')} rows={3} /></FormField>
      <div className="sm:col-span-2 flex items-center gap-3 rounded-lg border border-line p-3"><Checkbox checked={form.all_day} onChange={(event) => setForm((current) => ({ ...current, all_day: event.target.checked }))} /><span className="text-sm font-medium">All-day activity</span></div>
      {form.all_day ? <FormField label="Date"><Input type="date" value={form.due_date} onChange={set('due_date')} /></FormField> : isMeeting ? <>
        <FormField label="Starts"><Input type="datetime-local" value={form.starts_at} onChange={set('starts_at')} /></FormField>
        <FormField label="Ends"><Input type="datetime-local" value={form.ends_at} onChange={set('ends_at')} /></FormField>
      </> : <FormField label={t('common:activitiesPanel.dueAt')}><Input type="datetime-local" value={form.due_at} onChange={set('due_at')} /></FormField>}
      <FormField label="Timezone"><Input value={form.scheduled_timezone} onChange={set('scheduled_timezone')} /></FormField>
      {form.type === 'call' && <>
        <FormField label="Direction"><Select value={form.call_direction} onChange={set('call_direction')}><option value="">Not set</option><option value="outbound">Outbound</option><option value="inbound">Inbound</option></Select></FormField>
        <FormField label="Phone"><Input value={form.phone_number} onChange={set('phone_number')} dir="ltr" /></FormField>
      </>}
      {isMeeting && <><FormField label="Location"><Input value={form.location} onChange={set('location')} /></FormField><FormField label="Meeting URL"><Input value={form.meeting_url} onChange={set('meeting_url')} dir="ltr" /></FormField><FormField label="Internal attendee"><Select value={form.attendee} onChange={set('attendee')}><option value="">No additional attendee</option>{members?.results.filter((member) => String(member.user.id) !== form.assigned_to).map((member) => <option key={member.id} value={member.user.id}>{fullName(member.user) === '—' ? member.user.email : fullName(member.user)}</option>)}</Select></FormField></>}
      {!activity && <><FormField label="Reminder"><Select value={form.reminder} onChange={set('reminder')}><option value="">No reminder</option><option value="10">10 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></Select></FormField><FormField label="Repeat"><Select value={form.recurrence} onChange={set('recurrence')}><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select></FormField></>}
      <FormField label={t('activities:fields.related')} className="sm:col-span-2"><div className="grid gap-3 sm:grid-cols-3"><Select value={form.relatedType} onChange={(event) => { setRelationSearch(''); setForm((current) => ({ ...current, relatedType: event.target.value as RelatedType, relatedId: '' })); }}><option value="">{t('common:labels.none')}</option>{(['lead', 'contact', 'company', 'deal'] as const).map((type) => <option key={type} value={type}>{t(`activities:relatedTypes.${type}`)}</option>)}</Select>{form.relatedType && <><SearchInput onSearch={setRelationSearch} placeholder={`Find ${form.relatedType}`} /><Select value={form.relatedId} onChange={set('relatedId')}><option value="">{t('common:labels.notSet')}</option>{form.relatedId && currentRelatedLabel && !displayOptions.some((option) => option.id === Number(form.relatedId)) && <option value={form.relatedId}>{currentRelatedLabel}</option>}{displayOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</Select></>}</div></FormField>
      <CustomFieldsEditor target="activity" values={form.custom_fields} onChange={(custom_fields) => setForm((current) => ({ ...current, custom_fields }))} />
    </div>
  </Modal>;
}
