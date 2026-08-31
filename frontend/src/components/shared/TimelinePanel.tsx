import { useQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { companiesApi, contactsApi } from '@/api/contacts';
import { leadsApi } from '@/api/leads';
import { dealsApi } from '@/api/deals';
import { Avatar, Card, CardHeader, EmptyState, Spinner } from '@/components/ui';
import { formatDateTime, fullName } from '@/lib/utils';

const loaders = {
  lead: leadsApi.timeline,
  contact: contactsApi.timeline,
  company: companiesApi.timeline,
  deal: dealsApi.timeline,
};

export function TimelinePanel({ type, id }: { type: keyof typeof loaders; id: number }) {
  const { t } = useTranslation('common');
  const { data, isLoading } = useQuery({
    queryKey: ['timeline', type, id],
    queryFn: () => loaders[type](id, { page_size: 20 }),
  });
  return <Card>
    <CardHeader title={t('customerCore.timeline')} />
    <div className="p-5">
      {isLoading ? <div className="flex justify-center py-8"><Spinner className="text-primary-600" /></div> : !data?.results.length ? <EmptyState icon={<ActivityIcon className="h-5 w-5" />} title={t('customerCore.timelineEmpty')} className="py-6" /> : <ol className="relative ms-2 border-s border-gray-200 dark:border-gray-700">{data.results.map((event) => <li key={event.id} className="ms-6 pb-6 last:pb-0"><span className="absolute -start-2 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-primary-500 dark:border-gray-900" /><div className="flex items-start gap-3"><Avatar name={fullName(event.actor_detail) === '—' ? '?' : fullName(event.actor_detail)} size="sm" /><div><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{event.event_type.replace(/\./g, ' ')}</p><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{fullName(event.actor_detail)} · {formatDateTime(event.created_at)}</p></div></div></li>)}</ol>}
    </div>
  </Card>;
}
