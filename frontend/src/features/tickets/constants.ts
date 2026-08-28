import type { BadgeColor } from '@/components/ui';
import type { TicketCategory, TicketPriority, TicketStatus } from '@/types';

export const TICKET_STATUSES: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];
export const TICKET_CATEGORIES: TicketCategory[] = ['general', 'billing', 'technical', 'feature_request'];

export const STATUS_COLORS: Record<TicketStatus, BadgeColor> = {
  open: 'blue',
  in_progress: 'amber',
  resolved: 'green',
  closed: 'gray',
};

export const PRIORITY_COLORS: Record<TicketPriority, BadgeColor> = {
  low: 'gray',
  medium: 'blue',
  high: 'amber',
  urgent: 'red',
};
