import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { contactsApi } from '@/api/contacts';
import { organizationsApi } from '@/api/organizations';
import { ticketsApi } from '@/api/tickets';
import { Button, FormField, Modal, Input, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { fullName } from '@/lib/utils';
import type { Ticket, TicketCategory, TicketPriority } from '@/types';

import { TICKET_CATEGORIES, TICKET_PRIORITIES } from './constants';

interface FormState {
  subject: string;
  description: string;
  contact: string;
  priority: TicketPriority;
  category: TicketCategory;
  assigned_to: string;
}

const emptyForm: FormState = {
  subject: '',
  description: '',
  contact: '',
  priority: 'medium',
  category: 'general',
  assigned_to: '',
};

export function TicketFormModal({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket?: Ticket | null;
}) {
  const { t } = useTranslation(['tickets', 'common']);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (open) {
      setForm(
        ticket
          ? {
              subject: ticket.subject,
              description: ticket.description,
              contact: ticket.contact ? String(ticket.contact) : '',
              priority: ticket.priority,
              category: ticket.category,
              assigned_to: ticket.assigned_to ? String(ticket.assigned_to) : '',
            }
          : emptyForm,
      );
    }
  }, [open, ticket]);

  const { data: contacts } = useQuery({
    queryKey: ['contacts', 'options'],
    queryFn: () => contactsApi.list({ page_size: 100 }),
    enabled: open,
  });
  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<Ticket> = {
        subject: form.subject,
        description: form.description,
        contact: form.contact ? Number(form.contact) : null,
        priority: form.priority,
        category: form.category,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
      };
      return ticket ? ticketsApi.update(ticket.id, payload) : ticketsApi.create(payload);
    },
    onSuccess: () => {
      toast.success(ticket ? t('common:toast.saved') : t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
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
      title={ticket ? t('tickets:form.editTitle') : t('tickets:form.createTitle')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.subject.trim()}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('tickets:fields.subject')} required className="sm:col-span-2">
          <Input value={form.subject} onChange={set('subject')} autoFocus />
        </FormField>
        <FormField label={t('common:labels.description')} className="sm:col-span-2">
          <Textarea value={form.description} onChange={set('description')} />
        </FormField>
        <FormField label={t('tickets:fields.contact')}>
          <Select value={form.contact} onChange={set('contact')}>
            <option value="">{t('common:labels.none')}</option>
            {contacts?.results.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {fullName(contact)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('tickets:fields.priority')}>
          <Select value={form.priority} onChange={set('priority')}>
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`tickets:priorities.${priority}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('tickets:fields.category')}>
          <Select value={form.category} onChange={set('category')}>
            {TICKET_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`tickets:categories.${category}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('common:labels.assignedTo')}>
          <Select value={form.assigned_to} onChange={set('assigned_to')}>
            <option value="">{t('common:labels.none')}</option>
            {members?.results.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {`${member.user.first_name} ${member.user.last_name}`.trim() || member.user.email}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </Modal>
  );
}
