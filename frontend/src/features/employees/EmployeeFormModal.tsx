import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { departmentsApi, employeesApi } from '@/api/employees';
import { organizationsApi } from '@/api/organizations';
import { Button, FormField, Input, Modal, Select, toast } from '@/components/ui';
import { apiErrorMessage } from '@/lib/api';
import { fullName } from '@/lib/utils';
import type { Employee, EmployeeStatus, EmploymentType } from '@/types';

import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES } from './constants';

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  department: string;
  employment_type: string;
  status: string;
  hire_date: string;
  salary: string;
  manager: string;
  user: string;
}

const emptyForm: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  job_title: '',
  department: '',
  employment_type: 'full_time',
  status: 'active',
  hire_date: '',
  salary: '',
  manager: '',
  user: '',
};

export function EmployeeFormModal({
  open,
  onClose,
  employee,
}: {
  open: boolean;
  onClose: () => void;
  employee?: Employee | null;
}) {
  const { t } = useTranslation(['employees', 'common']);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (open) {
      setForm(
        employee
          ? {
              first_name: employee.first_name,
              last_name: employee.last_name,
              email: employee.email,
              phone: employee.phone,
              job_title: employee.job_title,
              department: employee.department ? String(employee.department) : '',
              employment_type: employee.employment_type,
              status: employee.status,
              hire_date: employee.hire_date ?? '',
              salary: employee.salary ?? '',
              manager: employee.manager ? String(employee.manager) : '',
              user: employee.user ? String(employee.user) : '',
            }
          : emptyForm,
      );
    }
  }, [open, employee]);

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.list(),
    enabled: open,
  });
  const { data: managers } = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => employeesApi.list({ page_size: 100 }),
    enabled: open,
  });
  const { data: members } = useQuery({
    queryKey: ['memberships', 'options'],
    queryFn: () => organizationsApi.members({ page_size: 100, is_active: true }),
    enabled: open,
  });

  const managerOptions = (managers?.results ?? []).filter(
    (candidate) => !employee || candidate.id !== employee.id,
  );

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<Employee> = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone: form.phone,
        job_title: form.job_title,
        department: form.department ? Number(form.department) : null,
        employment_type: form.employment_type as EmploymentType,
        status: form.status as EmployeeStatus,
        hire_date: form.hire_date || null,
        salary: form.salary || null,
        manager: form.manager ? Number(form.manager) : null,
        user: form.user ? Number(form.user) : null,
      };
      return employee ? employeesApi.update(employee.id, payload) : employeesApi.create(payload);
    },
    onSuccess: () => {
      toast.success(employee ? t('common:toast.saved') : t('common:toast.created'));
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const set = (key: keyof FormState) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={employee ? t('employees:form.editTitle') : t('employees:form.createTitle')}
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
        <FormField label={t('employees:fields.jobTitle')}>
          <Input value={form.job_title} onChange={set('job_title')} />
        </FormField>
        <FormField label={t('employees:fields.department')}>
          <Select value={form.department} onChange={set('department')}>
            <option value="">{t('common:labels.none')}</option>
            {departments?.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('employees:fields.employmentType')}>
          <Select value={form.employment_type} onChange={set('employment_type')}>
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`employees:types.${type}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('common:labels.status')}>
          <Select value={form.status} onChange={set('status')}>
            {EMPLOYEE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`employees:statuses.${status}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('employees:fields.hireDate')}>
          <Input type="date" value={form.hire_date} onChange={set('hire_date')} />
        </FormField>
        <FormField label={t('employees:fields.salary')}>
          <Input type="number" min={0} step="0.01" value={form.salary} onChange={set('salary')} />
        </FormField>
        <FormField label={t('employees:fields.manager')}>
          <Select value={form.manager} onChange={set('manager')}>
            <option value="">{t('common:labels.none')}</option>
            {managerOptions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {fullName(candidate)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label={t('employees:fields.linkedAccount')}
          hint={t('employees:fields.linkedAccountHint')}
        >
          <Select value={form.user} onChange={set('user')}>
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
