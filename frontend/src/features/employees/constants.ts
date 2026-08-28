import type { BadgeColor } from '@/components/ui';
import type { EmployeeStatus, EmploymentType } from '@/types';

export const EMPLOYEE_STATUSES: EmployeeStatus[] = ['active', 'on_leave', 'terminated'];

export const EMPLOYMENT_TYPES: EmploymentType[] = ['full_time', 'part_time', 'contract', 'intern'];

export const STATUS_COLORS: Record<EmployeeStatus, BadgeColor> = {
  active: 'green',
  on_leave: 'amber',
  terminated: 'red',
};
