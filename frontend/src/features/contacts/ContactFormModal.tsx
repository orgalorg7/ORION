import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { companiesApi, contactsApi } from '@/api/contacts';
import { organizationsApi } from '@/api/organizations';
import { Button, FormField, Input, Modal, Select, Textarea, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import type { Contact, LeadSource } from '@/types';

const SOURCES: LeadSource[] = ['website', 'referral', 'social', 'email_campaign', 'event', 'cold_call', 'other'];

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  company: string;
  owner: string;
  source: string;
  city: string;
  country: string;
  description: string;
}

const emptyForm: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  job_title: '',
  company: '',
  owner: '',
  source: '',
  city: '',
  country: '',
  description: '',
};

export function ContactFormModal({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact?: Contact | null;
}) {
  const { t } = useTranslation(['contacts', 'common']);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (open) {
      setForm(
        contact
          ? {
              first_name: contact.first_name,
              last_name: contact.last_name,
              email: contact.email,
              phone: contact.phone,
              job_title: contact.job_title,
              company: contact.company ? String(contact.company) : '',
              owner: contact.owner ? String(contact.owner) : '',
              source: contact.source,
              city: contact.city,
              country: contact.country,
              description: contact.description,
            }
          : emptyForm,
      );
    }
  }, [open, contact]);

  const { data: companies } = useQuery({
    queryKey: ['companies', 'options'],
    queryFn: () => companiesApi.list({ page_size: 100 }),
    enabled: open,
  });
  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<Contact> = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone,
        job_title: form.job_title,
        company: form.company ? Number(form.company) : null,
        owner: form.owner ? Number(form.owner) : null,
        source: form.source as LeadSource,
        city: form.city,
        country: form.country,
        description: form.description,
      };
      return contact ? contactsApi.update(contact.id, payload) : contactsApi.create(payload);
    },
    onSuccess: () => {
      toast.success(contact ? t('common:toast.saved') : t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
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
      title={contact ? t('contacts:form.editTitle') : t('contacts:form.createTitle')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.first_name.trim()}
          >
            {t('common:actions.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label={t('common:labels.firstName')} required>
          <Input value={form.first_name} onChange={set('first_name')} autoFocus />
        </FormField>
        <FormField label={t('common:labels.lastName')}>
          <Input value={form.last_name} onChange={set('last_name')} />
        </FormField>
        <FormField label={t('common:labels.email')}>
          <Input type="email" value={form.email} onChange={set('email')} dir="ltr" />
        </FormField>
        <FormField label={t('common:labels.phone')}>
          <Input type="tel" value={form.phone} onChange={set('phone')} dir="ltr" />
        </FormField>
        <FormField label={t('contacts:fields.jobTitle')}>
          <Input value={form.job_title} onChange={set('job_title')} />
        </FormField>
        <FormField label={t('contacts:fields.company')}>
          <Select value={form.company} onChange={set('company')}>
            <option value="">{t('common:labels.none')}</option>
            {companies?.results.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('common:labels.owner')}>
          <Select value={form.owner} onChange={set('owner')}>
            <option value="">{t('common:labels.none')}</option>
            {members?.results.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {`${member.user.first_name} ${member.user.last_name}`.trim() || member.user.email}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('common:labels.source')}>
          <Select value={form.source} onChange={set('source')}>
            <option value="">{t('common:labels.notSet')}</option>
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`common:sources.${source}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('common:labels.city')}>
          <Input value={form.city} onChange={set('city')} />
        </FormField>
        <FormField label={t('common:labels.country')}>
          <Input value={form.country} onChange={set('country')} />
        </FormField>
        <FormField label={t('common:labels.description')} className="sm:col-span-2">
          <Textarea value={form.description} onChange={set('description')} />
        </FormField>
      </div>
    </Modal>
  );
}
