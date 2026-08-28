import { useTranslation } from 'react-i18next';

import { formatNumber } from '@/lib/utils';

import { Button } from './Button';
import { BidiText } from './BidiText';
import { NextIcon, PreviousIcon } from './DirectionalIcon';

export function Pagination({
  page,
  pageSize,
  count,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  count: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation('common');
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  if (count === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/45 px-4 py-3 dark:border-gray-800 dark:bg-transparent">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('pagination.showing', {
          from: formatNumber(from),
          to: formatNumber(to),
          count,
          formattedCount: formatNumber(count),
        })}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <PreviousIcon className="h-4 w-4" />
          {t('pagination.previous')}
        </Button>
        <BidiText direction="ltr" className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
          {formatNumber(page)} / {formatNumber(totalPages)}
        </BidiText>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t('pagination.next')}
          <NextIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
