import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { activitiesApi } from '@/api/activities';
import { companiesApi, contactsApi } from '@/api/contacts';
import { dealsApi } from '@/api/deals';
import { leadsApi } from '@/api/leads';
import { organizationsApi } from '@/api/organizations';
import { Button, FormField, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { fullName } from '@/lib/utils';
import type { Activity, ActivityType } from '@/types';

const ACTIVITY_TYPES: ActivityType[] = ['task', 'call', 'email', 'meeting'];

type RelatedType = '' | 'contact' | 'company' | 'deal' | 'lead';

const RELATED_TYPES: Exclude<RelatedType, ''>[] = ['contact', 'company', 'deal', 'lead'];

interface RelatedOption {
  id: number;
  label: string;
}

interface FormState {
  type: ActivityType;
  title: string;
  description: string;
  due_at: string;
  assigned_to: string;
  relatedType: RelatedType;
  relatedId: string;
}

const emptyForm: FormState = {
  type: 'task',
  title: '',
  description: '',
  due_at: '',
  assigned_to: '',
  relatedType: '',
  relatedId: '',
};

/** Convert an ISO timestamp to the local `datetime-local` input format. */
function toInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function relatedFromActivity(activity: Activity): { relatedType: RelatedType; relatedId: string } {
  if (activity.contact) return { relatedType: 'contact', relatedId: String(activity.contact) };
  if (activity.company) return { relatedType: 'company', relatedId: String(activity.company) };
  if (activity.deal) return { relatedType: 'deal', relatedId: String(activity.deal) };
  if (activity.lead) return { relatedType: 'lead', relatedId: String(activity.lead) };
  return { relatedType: '', relatedId: '' };
}

export function ActivityFormModal({
  open,
  onClose,
  activity,
}: {
  open: boolean;
  onClose: () => void;
  activity?: Activity | null;
}) {
  const { t } = useTranslation(['activities', 'common']);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (open) {
      setForm(
        activity
          ? {
              type: activity.type,
              title: activity.title,
              description: activity.description,
              due_at: toInputValue(activity.due_at),
              assigned_to: activity.assigned_to ? String(activity.assigned_to) : '',
              ...relatedFromActivity(activity),
            }
          : emptyForm,
      );
    }
  }, [open, activity]);

  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });

  const { data: relatedOptions } = useQuery({
    queryKey: ['related-options', form.relatedType],
    enabled: open && form.relatedType !== '',
    queryFn: async (): Promise<RelatedOption[]> => {
      const params = { page_size: 100 };
      switch (form.relatedType) {
        case 'contact':
          return (await contactsApi.list(params)).results.map((row) => ({
            id: row.id,
            label: fullName(row),
          }));
        case 'company':
          return (await companiesApi.list(params)).results.map((row) => ({
            id: row.id,
            label: row.name,
          }));
        case 'deal':
          return (await dealsApi.list(params)).results.map((row) => ({
            id: row.id,
            label: row.title,
          }));
        case 'lead':
          return (await leadsApi.list(params)).results.map((row) => ({
            id: row.id,
            label: fullName(row),
          }));
        default:
          return [];
      }
    },
  });

  // Ensure the currently linked entity is selectable even when it falls
  // outside the first page of options.
  const displayOptions = useMemo(() => {
    const options = [...(relatedOptions ?? [])];
    if (activity) {
      let current: RelatedOption | null = null;
      if (form.relatedType === 'contact' && activity.contact_detail) {
        current = { id: activity.contact_detail.id, label: fullName(activity.contact_detail) };
      } else if (form.relatedType === 'company' && activity.company_detail) {
        current = { id: activity.company_detail.id, label: activity.company_detail.name };
      } else if (form.relatedType === 'deal' && activity.deal_detail) {
        current = { id: activity.deal_detail.id, label: activity.deal_detail.title };
      } else if (form.relatedType === 'lead' && activity.lead_detail) {
        current = { id: activity.lead_detail.id, label: fullName(activity.lead_detail) };
      }
      if (current && !options.some((option) => option.id === current!.id)) {
        options.unshift(current);
      }
    }
    return options;
  }, [relatedOptions, activity, form.relatedType]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<Activity> = {
        type: form.type,
        title: form.title,
        description: form.description,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
        contact: form.relatedType === 'contact' && form.relatedId ? Number(form.relatedId) : null,
        company: form.relatedType === 'company' && form.relatedId ? Number(form.relatedId) : null,
        deal: form.relatedType === 'deal' && form.relatedId ? Number(form.relatedId) : null,
        lead: form.relatedType === 'lead' && form.relatedId ? Number(form.relatedId) : null,
      };
      return activity ? activitiesApi.update(activity.id, payload) : activitiesApi.create(payload);
    },
    onSuccess: () => {
      toast.success(activity ? t('common:toast.saved') : t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const set = (key: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={activity ? t('activities:form.editTitle') : t('activities:form.createTitle')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.title.trim()}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('activities:fields.type')} required>
          <Select value={form.type} onChange={set('type')}>
            {ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`common:activitiesPanel.types.${type}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('activities:fields.title')} required>
          <Input
            value={form.title}
            onChange={set('title')}
            placeholder={t('common:activitiesPanel.titlePlaceholder')}
            autoFocus
          />
        </FormField>
        <FormField label={t('common:labels.description')} className="sm:col-span-2">
          <Textarea value={form.description} onChange={set('description')} rows={3} />
        </FormField>
        <FormField label={t('common:activitiesPanel.dueAt')}>
          <Input type="datetime-local" value={form.due_at} onChange={set('due_at')} />
        </FormField>
        <FormField label={t('common:labels.assignedTo')}>
          <Select value={form.assigned_to} onChange={set('assigned_to')}>
            <option value="">{t('common:labels.none')}</option>
            {members?.results.map((member) => (
              <option key={member.id} value={member.user.id}>
                {fullName(member.user) === '—' ? member.user.email : fullName(member.user)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('activities:fields.related')} className="sm:col-span-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              value={form.relatedType}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  relatedType: event.target.value as RelatedType,
                  relatedId: '',
                }))
              }
            >
              <option value="">{t('common:labels.none')}</option>
              {RELATED_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`activities:relatedTypes.${type}`)}
                </option>
              ))}
            </Select>
            {form.relatedType !== '' && (
              <Select value={form.relatedId} onChange={set('relatedId')}>
                <option value="">{t('common:labels.notSet')}</option>
                {displayOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </FormField>
      </div>
    </Modal>
  );
}
