import { type BadgeColor } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { LeadSource, LeadStatus } from '@/types';

export const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'unqualified', 'converted'];

export const EDITABLE_LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'unqualified'];

export const LEAD_STATUS_COLORS: Record<LeadStatus, BadgeColor> = {
  new: 'blue',
  contacted: 'amber',
  qualified: 'green',
  unqualified: 'gray',
  converted: 'purple',
};

export const LEAD_SOURCES: LeadSource[] = [
  'website',
  'referral',
  'social',
  'email_campaign',
  'event',
  'cold_call',
  'other',
];

/** Numeric lead score with a small progress track filled to score%. */
export function ScoreBar({ score, className }: { score: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{clamped}</span>
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className="h-full rounded-full bg-primary-400" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
